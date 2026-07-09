#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const {
    applyEnvFile,
    readChatMessages,
    resolveMemberByName,
    sendChatText,
} = require("../lib/feishu");
const pkg = require("../package.json");

function currentEnv() {
    return process.env;
}

function result(payload) {
    return {
        content: [{
            type: "text",
            text: JSON.stringify(payload, null, 2),
        }],
        structuredContent: payload,
    };
}

function mentionText(openId, label, text) {
    return `<at user_id="${openId}">${label || openId}</at> ${text}`;
}

async function main() {
    const envResult = applyEnvFile(process.env.FEISHU_BRIDGE_ENV_FILE || process.env.FEISHU_BRIDGE_ENV);
    if (envResult.loaded) {
        console.error(`feishu-bridge-mcp loaded environment from ${envResult.envFile}`);
    }

    const server = new McpServer({
        name: "feishu-bridge",
        version: pkg.version,
    }, {
        instructions: [
            "Use these tools to read and send Feishu group messages through the configured self-built Feishu app.",
            "Prefer read-only tools unless the user explicitly asks to send a message.",
            "Never expose FEISHU_APP_SECRET, tenant tokens, raw .env contents, or private chat IDs in responses.",
            "When sending, confirm the destination chat when the request is ambiguous.",
        ].join(" "),
    });

    server.registerTool("feishu_read_messages", {
        title: "Read Feishu messages",
        description: "Read recent messages from the configured Feishu group or an explicit chat_id.",
        inputSchema: {
            chat_id: z.string().min(1).optional(),
            hours: z.number().positive().default(24).optional(),
            days: z.number().positive().optional(),
            limit: z.number().int().min(1).max(100).default(20).optional(),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await readChatMessages(currentEnv(), {
            chatId: args.chat_id,
            hours: args.hours,
            days: args.days,
            limit: args.limit,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_send_text", {
        title: "Send Feishu text",
        description: "Send a text message to the configured Feishu group or an explicit chat_id.",
        inputSchema: {
            text: z.string().min(1).max(3500),
            chat_id: z.string().min(1).optional(),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await sendChatText(currentEnv(), {
            chatId: args.chat_id,
            text: args.text,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_find_member", {
        title: "Find Feishu group member",
        description: "Resolve one Feishu group member by visible name or open_id-like member id.",
        inputSchema: {
            name: z.string().min(1),
            chat_id: z.string().min(1).optional(),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await resolveMemberByName(currentEnv(), {
            chatId: args.chat_id,
            name: args.name,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_send_text_at_member", {
        title: "Send Feishu text at member",
        description: "Resolve one group member by name, mention them, and send a text message.",
        inputSchema: {
            name: z.string().min(1),
            text: z.string().min(1).max(3500),
            chat_id: z.string().min(1).optional(),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (args) => {
        const resolved = await resolveMemberByName(currentEnv(), {
            chatId: args.chat_id,
            name: args.name,
        });
        const data = await sendChatText(currentEnv(), {
            chatId: resolved.chatId,
            text: mentionText(resolved.member.openId, resolved.member.name || args.name, args.text),
        });
        return result({ ok: true, member: resolved.member, ...data });
    });

    await server.connect(new StdioServerTransport());
}

main().catch((error) => {
    console.error(`feishu-bridge-mcp failed: ${error.stack || error.message}`);
    process.exit(1);
});
