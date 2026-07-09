const fs = require("fs");
const https = require("https");
const path = require("path");

const DEFAULT_ENV_FILE = process.env.FEISHU_BRIDGE_ENV_FILE
    || process.env.FEISHU_BRIDGE_ENV
    || path.resolve(process.cwd(), ".env");

function parseEnv(content) {
    const env = {};
    for (const line of content.split(/\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^(?:export\s+)?([^=\s]+)=(.*)$/s);
        if (!match) continue;
        let value = match[2].replace(/\r$/, "");
        const quote = value[0];
        if ((quote === "\"" || quote === "'") && value[value.length - 1] === quote) {
            value = value.slice(1, -1);
        }
        env[match[1]] = value;
    }
    return env;
}

function loadEnv(file) {
    return parseEnv(fs.readFileSync(file, "utf8"));
}

function applyEnvFile(file = DEFAULT_ENV_FILE, options = {}) {
    const envFile = file || DEFAULT_ENV_FILE;
    const optional = options.optional !== false;
    if (!fs.existsSync(envFile)) {
        if (optional) return { env: {}, envFile, loaded: false };
        throw new Error(`missing env file: ${envFile}`);
    }

    const env = loadEnv(envFile);
    for (const [name, value] of Object.entries(env)) {
        if (options.override || process.env[name] === undefined) {
            process.env[name] = value;
        }
    }
    return { env, envFile, loaded: true };
}

function resolveEnv(file) {
    const envFile = file || DEFAULT_ENV_FILE;
    const env = loadEnv(envFile);
    for (const name of ["FEISHU_APP_ID", "FEISHU_APP_SECRET"]) {
        if (!env[name]) {
            throw new Error(`missing ${name} in ${envFile}`);
        }
    }
    return { env, envFile };
}

function resolveChatId(chatId, env) {
    const resolved = chatId || env.FEISHU_TARGET_CHAT_ID;
    if (!resolved) {
        throw new Error("missing chat id; provide --chat-id or FEISHU_TARGET_CHAT_ID");
    }
    return resolved;
}

function requireAppEnv(env) {
    for (const name of ["FEISHU_APP_ID", "FEISHU_APP_SECRET"]) {
        if (!env[name]) {
            throw new Error(`missing ${name}`);
        }
    }
}

function requestJson(method, requestPath, token, payload) {
    return new Promise((resolve, reject) => {
        const body = payload ? JSON.stringify(payload) : "";
        const req = https.request({
            method,
            hostname: "open.feishu.cn",
            path: requestPath,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(body ? {
                    "Content-Type": "application/json; charset=utf-8",
                    "Content-Length": Buffer.byteLength(body),
                } : {}),
            },
            timeout: 15000,
        }, (res) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, json: JSON.parse(data) });
                } catch (error) {
                    reject(new Error(`failed to parse Feishu response: ${error.message}; ${data.slice(0, 200)}`));
                }
            });
        });
        req.on("timeout", () => req.destroy(new Error("request timeout")));
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

async function getTenantToken(env) {
    requireAppEnv(env);
    const resp = await requestJson("POST", "/open-apis/auth/v3/tenant_access_token/internal", null, {
        app_id: env.FEISHU_APP_ID,
        app_secret: env.FEISHU_APP_SECRET,
    });
    if (resp.json.code !== 0) {
        throw new Error(`tenant token failed: ${resp.json.code} ${resp.json.msg}`);
    }
    return resp.json.tenant_access_token;
}

function normalizeMessage(message) {
    return {
        messageId: message.message_id,
        msgType: message.msg_type,
        createTime: message.create_time,
        updateTime: message.update_time,
        deleted: Boolean(message.deleted),
        senderType: message.sender?.sender_type,
        senderId: message.sender?.id,
        text: parseTextContent(message.body?.content),
    };
}

async function readChatMessages(env, options = {}) {
    const chatId = resolveChatId(options.chatId, env);
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
        throw new Error("limit must be an integer from 1 to 100");
    }

    const hours = options.hours ?? 24;
    const days = options.days;
    if (!Number.isFinite(hours) || hours <= 0) {
        throw new Error("hours must be a positive number");
    }
    if (days !== undefined && (!Number.isFinite(days) || days <= 0)) {
        throw new Error("days must be a positive number");
    }

    const token = await getTenantToken(env);
    const end = Math.floor(Date.now() / 1000);
    const lookbackSeconds = Math.round((days ? days * 24 : hours) * 3600);
    const start = end - lookbackSeconds;
    const requestPath = `/open-apis/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(chatId)}&start_time=${start}&end_time=${end}&sort_type=ByCreateTimeDesc&page_size=${limit}`;
    const resp = await requestJson("GET", requestPath, token);
    if (resp.json.code !== 0) {
        throw new Error(`read failed: ${resp.json.code} ${resp.json.msg}`);
    }

    return {
        chatId,
        hasMore: Boolean(resp.json.data?.has_more),
        pageToken: resp.json.data?.page_token || "",
        messages: (resp.json.data?.items || []).map(normalizeMessage),
    };
}

async function sendChatText(env, options = {}) {
    const chatId = resolveChatId(options.chatId, env);
    const text = String(options.text || "");
    if (!text) {
        throw new Error("text is required");
    }

    const token = await getTenantToken(env);
    const sendResp = await requestJson("POST", "/open-apis/im/v1/messages?receive_id_type=chat_id", token, {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
    });

    if (sendResp.json.code !== 0) {
        throw new Error(`send failed: ${sendResp.json.code} ${sendResp.json.msg}`);
    }

    return {
        sent: true,
        chatId,
        messageId: sendResp.json.data?.message_id,
    };
}

async function listChatMembers(env, options = {}) {
    const chatId = resolveChatId(options.chatId, env);
    const token = await getTenantToken(env);
    let pageToken = "";
    const members = [];
    do {
        const requestPath = `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members?page_size=100&member_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
        const resp = await requestJson("GET", requestPath, token);
        if (resp.json.code !== 0) {
            throw new Error(`chat members failed: ${resp.json.code} ${resp.json.msg}`);
        }
        members.push(...(resp.json.data?.items || []));
        pageToken = resp.json.data?.page_token || "";
    } while (pageToken);

    return { chatId, members };
}

async function resolveMemberByName(env, options = {}) {
    const name = String(options.name || "");
    if (!name) {
        throw new Error("name is required");
    }

    const { chatId, members } = await listChatMembers(env, options);
    const target = normalizeName(name);
    const matches = members.filter((member) => {
        return [member.name, member.member_id].some((value) => normalizeName(value).includes(target));
    });

    if (matches.length !== 1) {
        const visible = matches.slice(0, 10).map((member) => ({
            name: member.name,
            openId: member.member_id,
            memberType: member.member_type,
        }));
        throw new Error(`expected one member match for "${name}", got ${matches.length}; matches=${JSON.stringify(visible)}`);
    }

    return {
        chatId,
        member: {
            name: matches[0].name,
            openId: matches[0].member_id,
            memberType: matches[0].member_type,
        },
    };
}

function parseTextContent(content) {
    try {
        const parsed = JSON.parse(content || "{}");
        if (typeof parsed.text === "string") return parsed.text;
        return JSON.stringify(parsed);
    } catch {
        return String(content || "");
    }
}

function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/[\s._-]+/g, "");
}

module.exports = {
    DEFAULT_ENV_FILE,
    applyEnvFile,
    getTenantToken,
    listChatMembers,
    loadEnv,
    normalizeName,
    normalizeMessage,
    parseEnv,
    parseTextContent,
    readChatMessages,
    requestJson,
    requireAppEnv,
    resolveChatId,
    resolveMemberByName,
    resolveEnv,
    sendChatText,
};
