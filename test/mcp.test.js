const assert = require("node:assert/strict");
const test = require("node:test");

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

test("mcp server starts and lists Feishu tools", async () => {
    const client = new Client({ name: "feishu-bridge-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: ["scripts/mcp.js"],
        cwd: process.cwd(),
        stderr: "pipe",
    });

    await client.connect(transport);
    try {
        const tools = await client.listTools();
        assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
            "feishu_find_member",
            "feishu_read_messages",
            "feishu_send_text",
            "feishu_send_text_at_member",
        ]);
    } finally {
        await client.close();
    }
});
