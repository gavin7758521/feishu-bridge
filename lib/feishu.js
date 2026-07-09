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
    const resp = await requestJson("POST", "/open-apis/auth/v3/tenant_access_token/internal", null, {
        app_id: env.FEISHU_APP_ID,
        app_secret: env.FEISHU_APP_SECRET,
    });
    if (resp.json.code !== 0) {
        throw new Error(`tenant token failed: ${resp.json.code} ${resp.json.msg}`);
    }
    return resp.json.tenant_access_token;
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
    loadEnv,
    normalizeName,
    parseEnv,
    parseTextContent,
    requestJson,
    resolveChatId,
    resolveEnv,
};
