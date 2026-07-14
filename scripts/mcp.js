#!/usr/bin/env node
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const {
    applyEnvFile,
    bitableCreateRecord,
    bitableListFields,
    bitableListTables,
    bitableSearchRecords,
    bitableUpdateRecord,
    downloadDriveMedia,
    downloadMessageResource,
    parseBitableAppTokenFromUrl,
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
            text: JSON.stringify(redactForText(payload), null, 2),
        }],
        structuredContent: payload,
    };
}

function redactForText(value) {
    if (Array.isArray(value)) return value.map(redactForText);
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
        if (["chatId", "chat_id"].includes(key)) return [key, "<redacted>"];
        return [key, redactForText(entry)];
    }));
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

    server.registerTool("feishu_download_message_resource", {
        title: "Download Feishu message resource",
        description: "Download a file, image, audio, or media resource attached to a Feishu message.",
        inputSchema: {
            message_id: z.string().min(1),
            file_key: z.string().min(1),
            type: z.enum(["file", "image", "audio", "media"]).default("file").optional(),
            save_path: z.string().min(1),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await downloadMessageResource(currentEnv(), {
            messageId: args.message_id,
            fileKey: args.file_key,
            type: args.type,
            savePath: args.save_path,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_download_drive_media", {
        title: "Download Feishu Drive media",
        description: "Download a Feishu Drive media/file token to an explicit local save_path.",
        inputSchema: {
            file_token: z.string().min(1),
            save_path: z.string().min(1),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await downloadDriveMedia(currentEnv(), {
            fileToken: args.file_token,
            savePath: args.save_path,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_bitable_parse_url", {
        title: "Parse Feishu Base URL",
        description: "Extract the Bitable app_token from a Feishu Base URL.",
        inputSchema: {
            url: z.string().url(),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: false,
        },
    }, async (args) => {
        return result({ ok: true, appToken: parseBitableAppTokenFromUrl(args.url) });
    });

    server.registerTool("feishu_bitable_list_tables", {
        title: "List Feishu Bitable tables",
        description: "List tables in a Feishu Base/Bitable app.",
        inputSchema: {
            app_token: z.string().min(1),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await bitableListTables(currentEnv(), {
            appToken: args.app_token,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_bitable_list_fields", {
        title: "List Feishu Bitable fields",
        description: "List fields in a Feishu Base/Bitable table.",
        inputSchema: {
            app_token: z.string().min(1),
            table_id: z.string().min(1),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await bitableListFields(currentEnv(), {
            appToken: args.app_token,
            tableId: args.table_id,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_bitable_search_records", {
        title: "Search Feishu Bitable records",
        description: "Search records in a Feishu Base/Bitable table.",
        inputSchema: {
            app_token: z.string().min(1),
            table_id: z.string().min(1),
            view_id: z.string().min(1).optional(),
            page_size: z.number().int().min(1).max(500).default(100).optional(),
            page_token: z.string().min(1).optional(),
            filter: z.record(z.string(), z.any()).optional(),
            sort: z.array(z.record(z.string(), z.any())).optional(),
            field_names: z.array(z.string()).optional(),
        },
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await bitableSearchRecords(currentEnv(), {
            appToken: args.app_token,
            tableId: args.table_id,
            viewId: args.view_id,
            pageSize: args.page_size,
            pageToken: args.page_token,
            filter: args.filter,
            sort: args.sort,
            fieldNames: args.field_names,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_bitable_create_record", {
        title: "Create Feishu Bitable record",
        description: "Create one record in a Feishu Base/Bitable table.",
        inputSchema: {
            app_token: z.string().min(1),
            table_id: z.string().min(1),
            fields: z.record(z.string(), z.any()),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await bitableCreateRecord(currentEnv(), {
            appToken: args.app_token,
            tableId: args.table_id,
            fields: args.fields,
        });
        return result({ ok: true, ...data });
    });

    server.registerTool("feishu_bitable_update_record", {
        title: "Update Feishu Bitable record",
        description: "Update one record in a Feishu Base/Bitable table.",
        inputSchema: {
            app_token: z.string().min(1),
            table_id: z.string().min(1),
            record_id: z.string().min(1),
            fields: z.record(z.string(), z.any()),
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
        },
    }, async (args) => {
        const data = await bitableUpdateRecord(currentEnv(), {
            appToken: args.app_token,
            tableId: args.table_id,
            recordId: args.record_id,
            fields: args.fields,
        });
        return result({ ok: true, ...data });
    });

    await server.connect(new StdioServerTransport());
}

main().catch((error) => {
    console.error(`feishu-bridge-mcp failed: ${error.stack || error.message}`);
    process.exit(1);
});
