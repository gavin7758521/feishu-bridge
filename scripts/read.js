#!/usr/bin/env node
const {
    DEFAULT_ENV_FILE,
    getTenantToken,
    parseTextContent,
    requestJson,
    resolveChatId,
    resolveEnv,
} = require("../lib/feishu");

function usage(exitCode = 0) {
    const out = exitCode === 0 ? process.stdout : process.stderr;
    out.write(`Usage:
  read.js
  read.js --hours 24 --limit 20
  read.js --days 7 --json

Options:
  --env PATH          Env file path. Defaults to ${DEFAULT_ENV_FILE}
  --chat-id CHAT_ID   Target chat_id. Defaults to FEISHU_TARGET_CHAT_ID.
  --hours HOURS       Look back this many hours. Defaults to 24.
  --days DAYS         Look back this many days. Overrides --hours.
  --limit N           Max messages to return. Defaults to 20, max 100.
  --json              Print structured JSON instead of readable text.
  --help              Show this help.
`);
    process.exit(exitCode);
}

function parseArgs(argv) {
    const args = { hours: 24, limit: 20, json: false };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) usage(1);
            return argv[++i];
        };
        if (arg === "--help" || arg === "-h") usage(0);
        else if (arg === "--env") args.envFile = next();
        else if (arg === "--chat-id") args.chatId = next();
        else if (arg === "--hours") args.hours = Number(next());
        else if (arg === "--days") args.days = Number(next());
        else if (arg === "--limit") args.limit = Number(next());
        else if (arg === "--json") args.json = true;
        else {
            console.error(`Unknown option: ${arg}`);
            usage(1);
        }
    }

    if (!Number.isFinite(args.hours) || args.hours <= 0) {
        throw new Error("--hours must be a positive number");
    }
    if (args.days !== undefined && (!Number.isFinite(args.days) || args.days <= 0)) {
        throw new Error("--days must be a positive number");
    }
    if (!Number.isInteger(args.limit) || args.limit <= 0 || args.limit > 100) {
        throw new Error("--limit must be an integer from 1 to 100");
    }
    return args;
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

function formatTime(value) {
    const millis = Number(value);
    if (!Number.isFinite(millis)) return String(value || "");
    return new Date(millis).toISOString();
}

async function main() {
    const args = parseArgs(process.argv);
    const { env } = resolveEnv(args.envFile);
    const chatId = resolveChatId(args.chatId, env);
    const token = await getTenantToken(env);

    const end = Math.floor(Date.now() / 1000);
    const lookbackSeconds = Math.round((args.days ? args.days * 24 : args.hours) * 3600);
    const start = end - lookbackSeconds;
    const requestPath = `/open-apis/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(chatId)}&start_time=${start}&end_time=${end}&sort_type=ByCreateTimeDesc&page_size=${args.limit}`;
    const resp = await requestJson("GET", requestPath, token);
    if (resp.json.code !== 0) {
        throw new Error(`read failed: ${resp.json.code} ${resp.json.msg}`);
    }

    const messages = (resp.json.data?.items || []).map(normalizeMessage);
    if (args.json) {
        console.log(JSON.stringify({
            ok: true,
            chatId,
            hasMore: Boolean(resp.json.data?.has_more),
            pageToken: resp.json.data?.page_token || "",
            messages,
        }, null, 2));
        return;
    }

    console.log(`Read ${messages.length} message(s) from ${chatId}.`);
    for (const message of messages) {
        const sender = [message.senderType, message.senderId].filter(Boolean).join(":") || "unknown";
        console.log(`\n[${formatTime(message.createTime)}] ${sender} ${message.msgType}`);
        console.log(message.text || "(empty)");
    }
}

main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exit(1);
});
