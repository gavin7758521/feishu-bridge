const fs = require("fs");
const https = require("https");
const path = require("path");
const { URL } = require("url");

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
                    reject(new Error(`failed to parse Feishu response: ${error.message}; ${sanitizeResponseSnippet(data.slice(0, 200))}`));
                }
            });
        });
        req.on("timeout", () => req.destroy(new Error("request timeout")));
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

function requestBinary(method, requestPath, token) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            method,
            hostname: "open.feishu.cn",
            path: requestPath,
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            timeout: 30000,
        }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () => {
                const buffer = Buffer.concat(chunks);
                const contentType = String(res.headers["content-type"] || "");
                const status = res.statusCode || 0;

                if (status < 200 || status >= 300) {
                    reject(new Error(formatBinaryError("Feishu binary request failed", status, contentType, buffer)));
                    return;
                }

                if (isJsonContent(contentType, buffer)) {
                    try {
                        const json = JSON.parse(buffer.toString("utf8"));
                        if (json && typeof json === "object" && json.code !== undefined && json.code !== 0) {
                            reject(new Error(`Feishu binary request failed: ${json.code} ${json.msg || ""}`.trim()));
                            return;
                        }
                    } catch {
                        // Some downloads may have JSON-like bytes. Treat unparsable 2xx content as binary.
                    }
                }

                resolve({ status, headers: res.headers, buffer });
            });
        });
        req.on("timeout", () => req.destroy(new Error("request timeout")));
        req.on("error", reject);
        req.end();
    });
}

function isJsonContent(contentType, buffer) {
    return contentType.toLowerCase().includes("application/json")
        || buffer.toString("utf8", 0, Math.min(buffer.length, 1)) === "{";
}

function formatBinaryError(prefix, status, contentType, buffer) {
    const suffix = readJsonError(contentType, buffer) || sanitizeResponseSnippet(buffer.toString("utf8", 0, 200));
    return `${prefix}: HTTP ${status}${suffix ? ` ${suffix}` : ""}`;
}

function readJsonError(contentType, buffer) {
    if (!isJsonContent(contentType, buffer)) return "";
    try {
        const json = JSON.parse(buffer.toString("utf8"));
        if (json && typeof json === "object") {
            return `${json.code ?? ""} ${json.msg ?? ""}`.trim();
        }
    } catch {
        return "";
    }
    return "";
}

function sanitizeResponseSnippet(value) {
    return String(value || "")
        .replace(/"tenant_access_token"\s*:\s*"[^"]+"/g, "\"tenant_access_token\":\"<redacted>\"")
        .replace(/"app_secret"\s*:\s*"[^"]+"/g, "\"app_secret\":\"<redacted>\"");
}

async function getTenantToken(env, options = {}) {
    requireAppEnv(env);
    const jsonRequest = options.requestJson || requestJson;
    const resp = await jsonRequest("POST", "/open-apis/auth/v3/tenant_access_token/internal", null, {
        app_id: env.FEISHU_APP_ID,
        app_secret: env.FEISHU_APP_SECRET,
    });
    if (resp.json.code !== 0) {
        throw new Error(`tenant token failed: ${resp.json.code} ${resp.json.msg}`);
    }
    return resp.json.tenant_access_token;
}

function parseMessageContent(msgType, content) {
    const rawContent = String(content || "");
    let parsed;
    try {
        parsed = JSON.parse(rawContent || "{}");
    } catch {
        return { msgType, rawContent, parseError: "invalid_json" };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { msgType, rawContent, value: parsed };
    }

    if (msgType === "text") {
        return {
            msgType,
            rawContent,
            text: typeof parsed.text === "string" ? parsed.text : "",
            json: parsed,
        };
    }

    if (msgType === "file") {
        return {
            msgType,
            rawContent,
            fileKey: parsed.file_key,
            fileName: parsed.file_name,
            fileSize: parsed.file_size,
            fileType: parsed.file_type,
            fileToken: parsed.file_token,
            mimeType: parsed.mime_type,
            json: parsed,
        };
    }

    if (msgType === "image") {
        return {
            msgType,
            rawContent,
            imageKey: parsed.image_key,
            json: parsed,
        };
    }

    return { msgType, rawContent, json: parsed };
}

function normalizeMessage(message) {
    const bodyContent = message.body?.content || "";
    const parsedContent = parseMessageContent(message.msg_type, bodyContent);
    return {
        messageId: message.message_id,
        msgType: message.msg_type,
        createTime: message.create_time,
        updateTime: message.update_time,
        deleted: Boolean(message.deleted),
        senderType: message.sender?.sender_type,
        senderId: message.sender?.id,
        text: parseTextContent(bodyContent),
        bodyContent,
        parsedContent,
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

    const token = await getTenantToken(env, options);
    const jsonRequest = options.requestJson || requestJson;
    const end = Math.floor(Date.now() / 1000);
    const lookbackSeconds = Math.round((days ? days * 24 : hours) * 3600);
    const start = end - lookbackSeconds;
    const requestPath = `/open-apis/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(chatId)}&start_time=${start}&end_time=${end}&sort_type=ByCreateTimeDesc&page_size=${limit}`;
    const resp = await jsonRequest("GET", requestPath, token);
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

    const token = await getTenantToken(env, options);
    const jsonRequest = options.requestJson || requestJson;
    const sendResp = await jsonRequest("POST", "/open-apis/im/v1/messages?receive_id_type=chat_id", token, {
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
    const token = await getTenantToken(env, options);
    const jsonRequest = options.requestJson || requestJson;
    let pageToken = "";
    const members = [];
    do {
        const requestPath = `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members?page_size=100&member_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
        const resp = await jsonRequest("GET", requestPath, token);
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
    const parsed = parseMessageContent("text", content);
    if (typeof parsed.text === "string") return parsed.text;
    if (parsed.json !== undefined) return JSON.stringify(parsed.json);
    return String(content || "");
}

function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/[\s._-]+/g, "");
}

function requireNonEmptyString(name, value) {
    const stringValue = String(value || "").trim();
    if (!stringValue) {
        throw new Error(`${name} is required`);
    }
    return stringValue;
}

function validateSavePath(savePath) {
    const target = requireNonEmptyString("save_path", savePath);
    const resolved = path.resolve(target);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        throw new Error("save_path points to a directory");
    }
    return resolved;
}

function parseFileNameFromContentDisposition(value) {
    const header = String(value || "");
    const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
        try {
            return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
        } catch {
            return utf8Match[1].trim().replace(/^"|"$/g, "");
        }
    }

    const plainMatch = header.match(/filename="?([^";]+)"?/i);
    return plainMatch ? plainMatch[1].trim() : "";
}

async function saveBinaryDownload(env, requestPath, savePath, options = {}) {
    const target = validateSavePath(savePath);
    const token = await getTenantToken(env, options);
    const binaryRequest = options.requestBinary || requestBinary;
    const resp = await binaryRequest("GET", requestPath, token);
    await fs.promises.writeFile(target, resp.buffer);

    return {
        saved: true,
        savePath: target,
        bytes: resp.buffer.length,
        contentType: String(resp.headers["content-type"] || ""),
        fileNameFromHeader: parseFileNameFromContentDisposition(resp.headers["content-disposition"]),
    };
}

async function downloadMessageResource(env, options = {}) {
    const messageId = requireNonEmptyString("message_id", options.messageId);
    const fileKey = requireNonEmptyString("file_key", options.fileKey);
    const type = options.type || "file";
    if (!["file", "image", "audio", "media"].includes(type)) {
        throw new Error("type must be one of: file, image, audio, media");
    }

    const requestPath = `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${encodeURIComponent(type)}`;
    return saveBinaryDownload(env, requestPath, options.savePath, options);
}

async function downloadDriveMedia(env, options = {}) {
    const fileToken = requireNonEmptyString("file_token", options.fileToken);
    const requestPath = `/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`;
    return saveBinaryDownload(env, requestPath, options.savePath, options);
}

function ensureFeishuOk(context, resp) {
    if (!resp || !resp.json) {
        throw new Error(`${context} failed: empty response`);
    }
    if (resp.json.code !== 0) {
        throw new Error(`${context} failed: ${resp.json.code} ${resp.json.msg || ""}`.trim());
    }
    return resp.json.data || {};
}

async function bitableRequest(env, context, method, requestPath, payload, options = {}) {
    const token = await getTenantToken(env, options);
    const jsonRequest = options.requestJson || requestJson;
    const resp = await jsonRequest(method, requestPath, token, payload);
    return ensureFeishuOk(context, resp);
}

async function bitableListTables(env, options = {}) {
    const appToken = requireNonEmptyString("app_token", options.appToken);
    const requestPath = `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=100`;
    const data = await bitableRequest(env, "bitable list tables", "GET", requestPath, null, options);
    return {
        items: data.items || [],
        hasMore: Boolean(data.has_more),
        pageToken: data.page_token || "",
    };
}

async function bitableListFields(env, options = {}) {
    const appToken = requireNonEmptyString("app_token", options.appToken);
    const tableId = requireNonEmptyString("table_id", options.tableId);
    const requestPath = `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields?page_size=100`;
    const data = await bitableRequest(env, "bitable list fields", "GET", requestPath, null, options);
    return {
        items: data.items || [],
        hasMore: Boolean(data.has_more),
        pageToken: data.page_token || "",
    };
}

async function bitableSearchRecords(env, options = {}) {
    const appToken = requireNonEmptyString("app_token", options.appToken);
    const tableId = requireNonEmptyString("table_id", options.tableId);
    const pageSize = options.pageSize ?? 100;
    if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 500) {
        throw new Error("page_size must be an integer from 1 to 500");
    }

    const params = new URLSearchParams({ page_size: String(pageSize) });
    if (options.pageToken) params.set("page_token", options.pageToken);
    const requestPath = `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/search?${params.toString()}`;
    const payload = {};
    if (options.viewId) payload.view_id = options.viewId;
    if (options.filter) payload.filter = options.filter;
    if (options.sort) payload.sort = options.sort;
    if (options.fieldNames) payload.field_names = options.fieldNames;

    const data = await bitableRequest(env, "bitable search records", "POST", requestPath, payload, options);
    return {
        items: data.items || [],
        hasMore: Boolean(data.has_more),
        pageToken: data.page_token || "",
        total: data.total,
    };
}

async function bitableCreateRecord(env, options = {}) {
    const appToken = requireNonEmptyString("app_token", options.appToken);
    const tableId = requireNonEmptyString("table_id", options.tableId);
    const fields = options.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        throw new Error("fields must be an object");
    }

    const requestPath = `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records`;
    return bitableRequest(env, "bitable create record", "POST", requestPath, { fields }, options);
}

async function bitableUpdateRecord(env, options = {}) {
    const appToken = requireNonEmptyString("app_token", options.appToken);
    const tableId = requireNonEmptyString("table_id", options.tableId);
    const recordId = requireNonEmptyString("record_id", options.recordId);
    const fields = options.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
        throw new Error("fields must be an object");
    }

    const requestPath = `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`;
    return bitableRequest(env, "bitable update record", "PUT", requestPath, { fields }, options);
}

function parseBitableAppTokenFromUrl(value) {
    const raw = requireNonEmptyString("url", value);
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error("url must be a valid URL");
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    const baseIndex = segments.indexOf("base");
    const appToken = baseIndex >= 0 ? segments[baseIndex + 1] : "";
    if (!appToken) {
        throw new Error("could not find app_token in Base URL");
    }
    return appToken;
}

module.exports = {
    DEFAULT_ENV_FILE,
    applyEnvFile,
    bitableCreateRecord,
    bitableListFields,
    bitableListTables,
    bitableSearchRecords,
    bitableUpdateRecord,
    downloadDriveMedia,
    downloadMessageResource,
    getTenantToken,
    listChatMembers,
    loadEnv,
    normalizeName,
    normalizeMessage,
    parseBitableAppTokenFromUrl,
    parseEnv,
    parseFileNameFromContentDisposition,
    parseMessageContent,
    parseTextContent,
    readChatMessages,
    requestBinary,
    requestJson,
    requireAppEnv,
    resolveChatId,
    resolveMemberByName,
    resolveEnv,
    sendChatText,
};
