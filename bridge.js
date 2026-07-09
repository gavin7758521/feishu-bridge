#!/usr/bin/env node
const lark = require("@larksuiteoapi/node-sdk");
const axios = require("axios");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { applyEnvFile } = require("./lib/feishu");

try {
    const envResult = applyEnvFile();
    if (envResult.loaded) {
        console.log(`Loaded environment from ${envResult.envFile}`);
    }
} catch (error) {
    console.error(`Failed to load environment file: ${error.message}`);
    process.exit(1);
}

const REQUIRED_ENV = ["FEISHU_APP_ID", "FEISHU_APP_SECRET"];
for (const name of REQUIRED_ENV) {
    if (!process.env[name]) {
        console.error(`Missing required environment variable: ${name}`);
        process.exit(1);
    }
}

const appId = process.env.FEISHU_APP_ID;
const appSecret = process.env.FEISHU_APP_SECRET;
const targetChatId = process.env.FEISHU_TARGET_CHAT_ID || "";
const botOpenId = process.env.FEISHU_BOT_OPEN_ID || "";
const bridgeMode = process.env.FEISHU_BRIDGE_MODE || process.env.CODEX_BRIDGE_MODE || "echo";
const codexCommand = process.env.CODEX_BRIDGE_CODEX_BIN || "codex";
const codexCwd = process.env.CODEX_BRIDGE_CWD || process.cwd();
const codexTimeoutMs = Number(process.env.CODEX_BRIDGE_TIMEOUT_MS || 120000);
const replyCommand = process.env.FEISHU_BRIDGE_REPLY_COMMAND || "";
const replyCommandCwd = process.env.FEISHU_BRIDGE_REPLY_COMMAND_CWD || process.cwd();
const replyCommandTimeoutMs = Number(process.env.FEISHU_BRIDGE_REPLY_COMMAND_TIMEOUT_MS || 120000);
const replyCommandMaxBuffer = Number(process.env.FEISHU_BRIDGE_REPLY_COMMAND_MAX_BUFFER || 1024 * 1024 * 5);
const maxReplyChars = Number(process.env.FEISHU_BRIDGE_MAX_REPLY_CHARS || process.env.CODEX_BRIDGE_MAX_REPLY_CHARS || 3500);
const lockFile = process.env.FEISHU_BRIDGE_LOCK_FILE || process.env.CODEX_BRIDGE_LOCK_FILE || "/tmp/feishu-bridge.lock";

function processExists(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function acquireProcessLock() {
    if (fsSync.existsSync(lockFile)) {
        const existingPid = Number(fsSync.readFileSync(lockFile, "utf8").trim());
        if (Number.isInteger(existingPid) && existingPid > 0 && processExists(existingPid)) {
            console.error(`Another Feishu bridge is already running with PID ${existingPid}.`);
            process.exit(1);
        }
        fsSync.rmSync(lockFile, { force: true });
    }

    fsSync.writeFileSync(lockFile, String(process.pid), { flag: "wx", mode: 0o600 });
}

function releaseProcessLock() {
    try {
        const existingPid = fsSync.readFileSync(lockFile, "utf8").trim();
        if (existingPid === String(process.pid)) {
            fsSync.rmSync(lockFile, { force: true });
        }
    } catch {
        // Best effort only.
    }
}

acquireProcessLock();
const httpInstance = axios.create({ proxy: false });
httpInstance.interceptors.response.use((response) => {
    if (response.config["$return_headers"]) {
        return {
            data: response.data,
            headers: response.headers,
        };
    }
    return response.data;
});

const client = new lark.Client({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
    httpInstance,
    loggerLevel: lark.LoggerLevel.warn,
});

const wsClient = new lark.WSClient({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu,
    httpInstance,
    loggerLevel: lark.LoggerLevel.info,
    onError: (error) => {
        console.error(`Feishu WS terminal error: ${error.message}`);
        process.exit(1);
    },
});

function parseTextMessage(content) {
    try {
        const parsed = JSON.parse(content || "{}");
        return typeof parsed.text === "string" ? parsed.text.trim() : "";
    } catch {
        return "";
    }
}

async function sendText(chatId, text, rootId) {
    const data = {
        receive_id: chatId,
        content: JSON.stringify({ text }),
        msg_type: "text",
    };

    if (rootId) {
        data.root_id = rootId;
    }

    await client.im.v1.message.create({
        params: {
            receive_id_type: "chat_id",
        },
        data,
    });
}

async function runCodex(text) {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "feishu-codex-"));
    const outputFile = path.join(tmpDir, "reply.txt");
    const prompt = [
        "你正在通过飞书群回复用户。",
        "请直接回答用户消息，保持简洁；不要执行文件修改、不要打印密钥、不要声称你能看到飞书之外的上下文。",
        "",
        `用户消息：${text}`,
    ].join("\n");

    const args = [
        "-s",
        "read-only",
        "-a",
        "never",
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--color",
        "never",
        "--output-last-message",
        outputFile,
        prompt,
    ];

    try {
        await new Promise((resolve, reject) => {
            const child = execFile(codexCommand, args, {
                cwd: codexCwd,
                timeout: codexTimeoutMs,
                maxBuffer: 1024 * 1024 * 5,
            }, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });

            child.stdin?.end();
        });

        const reply = (await fs.readFile(outputFile, "utf8")).trim();
        return reply || "Codex 没有生成可发送的回复。";
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

async function runReplyCommand(text, context) {
    if (!replyCommand) {
        throw new Error("FEISHU_BRIDGE_REPLY_COMMAND is required in command mode");
    }

    return new Promise((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let settled = false;
        const child = spawn("/bin/sh", ["-lc", replyCommand], {
            cwd: replyCommandCwd,
            env: {
                ...process.env,
                FEISHU_MESSAGE_TEXT: text,
                FEISHU_CHAT_ID: context.chatId,
                FEISHU_MESSAGE_ID: context.messageId,
                FEISHU_SENDER_OPEN_ID: context.senderOpenId || "",
            },
            stdio: ["pipe", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
            settled = true;
            child.kill("SIGTERM");
            reject(new Error(`reply command timed out after ${replyCommandTimeoutMs}ms`));
        }, replyCommandTimeoutMs);

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
            if (stdout.length + stderr.length > replyCommandMaxBuffer) {
                settled = true;
                clearTimeout(timer);
                child.kill("SIGTERM");
                reject(new Error(`reply command output exceeded ${replyCommandMaxBuffer} bytes`));
            }
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
            if (stdout.length + stderr.length > replyCommandMaxBuffer) {
                settled = true;
                clearTimeout(timer);
                child.kill("SIGTERM");
                reject(new Error(`reply command output exceeded ${replyCommandMaxBuffer} bytes`));
            }
        });
        child.on("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
        });
        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code !== 0) {
                reject(new Error(`reply command exited with ${code}: ${stderr.trim() || stdout.trim()}`));
                return;
            }
            resolve(stdout.trim() || stderr.trim() || "Reply command did not produce output.");
        });

        child.stdin.end(text);
    });
}

async function buildReply(text, context) {
    let reply;
    if (bridgeMode === "echo") {
        reply = `Feishu bridge 已收到：${text}`;
    } else if (bridgeMode === "codex") {
        reply = await runCodex(text);
    } else if (bridgeMode === "command") {
        reply = await runReplyCommand(text, context);
    } else {
        throw new Error(`Unsupported bridge mode: ${bridgeMode}`);
    }

    return reply.length > maxReplyChars
        ? `${reply.slice(0, maxReplyChars)}\n\n[回复过长，已截断]`
        : reply;
}

const eventDispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
        const { message, sender } = data;
        const chatId = message.chat_id;
        const messageId = message.message_id;
        const text = parseTextMessage(message.content);
        const senderOpenId = sender?.sender_id?.open_id;

        if (targetChatId && chatId !== targetChatId) {
            console.log(`Ignored message from non-target chat: ${chatId}`);
            return;
        }

        if (botOpenId && senderOpenId === botOpenId) {
            return;
        }

        if (!text) {
            await sendText(chatId, "Feishu bridge 已收到消息，但当前只处理文本。", messageId);
            return;
        }

        console.log(`Received text from ${senderOpenId || "unknown"} in ${chatId}: ${text}`);
        try {
            const reply = await buildReply(text, { chatId, messageId, senderOpenId });
            await sendText(chatId, reply, messageId);
        } catch (error) {
            console.error(`Failed to build reply: ${error.message}`);
            await sendText(chatId, "Feishu bridge 收到消息，但生成回复失败。", messageId);
        }
    },
});

function shutdown(signal) {
    console.log(`Stopping Feishu Codex bridge after ${signal}...`);
    try {
        wsClient.close({ force: true });
    } finally {
        releaseProcessLock();
        process.exit(0);
    }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
    console.error(`Uncaught exception: ${error.stack || error.message}`);
    releaseProcessLock();
    process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
    console.error(`Unhandled rejection: ${message}`);
    releaseProcessLock();
    process.exit(1);
});
process.on("exit", releaseProcessLock);

console.log("Starting Feishu bridge over Feishu long connection...");
console.log(targetChatId ? `Target chat: ${targetChatId}` : "Target chat: all visible chats");
console.log(`Bridge mode: ${bridgeMode}`);
if (bridgeMode === "command") {
    console.log(`Reply command: ${replyCommand || "(not configured)"}`);
}
wsClient.start({ eventDispatcher });
