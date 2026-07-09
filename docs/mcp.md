# Feishu Bridge MCP

The recommended agent-facing shape is:

```text
Codex / Claude -> Feishu Bridge MCP server -> Feishu OpenAPI
```

Keep existing Feishu configuration files. The MCP server reads the same environment variable names and does not require moving secrets into Codex, Claude, or this repository.

## Configuration

The MCP server reads `.env` from its current working directory by default. You can point it at an existing server config file with:

```sh
FEISHU_BRIDGE_ENV_FILE=/home/finnchart/personal/feishu-bridge/.env
```

Required values:

```text
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_TARGET_CHAT_ID=oc_xxx
```

Optional:

```text
FEISHU_BOT_OPEN_ID=ou_xxx
```

## Run Manually

From a git checkout:

```sh
FEISHU_BRIDGE_ENV_FILE=/path/to/.env npm run mcp
```

From a global npm install:

```sh
FEISHU_BRIDGE_ENV_FILE=/path/to/.env feishu-bridge-mcp
```

The MCP server uses stdio. Do not run it as a long-lived systemd HTTP service unless you intentionally wrap it with another transport.

## Codex

Codex supports stdio MCP servers. Add this server with the CLI:

```sh
codex mcp add feishu-bridge --env FEISHU_BRIDGE_ENV_FILE=/home/finnchart/personal/feishu-bridge/.env -- feishu-bridge-mcp
```

Equivalent `~/.codex/config.toml`:

```toml
[mcp_servers.feishu_bridge]
command = "feishu-bridge-mcp"
env = { FEISHU_BRIDGE_ENV_FILE = "/home/finnchart/personal/feishu-bridge/.env" }
default_tools_approval_mode = "prompt"
```

For local development from this repository:

```toml
[mcp_servers.feishu_bridge]
command = "node"
args = ["scripts/mcp.js"]
cwd = "/home/finnchart/personal/feishu-bridge"
env = { FEISHU_BRIDGE_ENV_FILE = "/home/finnchart/personal/feishu-bridge/.env" }
default_tools_approval_mode = "prompt"
```

## Claude

Claude Desktop-style MCP config uses the same stdio command shape:

```json
{
  "mcpServers": {
    "feishu-bridge": {
      "command": "feishu-bridge-mcp",
      "env": {
        "FEISHU_BRIDGE_ENV_FILE": "/home/finnchart/personal/feishu-bridge/.env"
      }
    }
  }
}
```

## Tools

- `feishu_read_messages`: read recent messages from the configured group or an explicit `chat_id`.
- `feishu_send_text`: send text to the configured group or an explicit `chat_id`.
- `feishu_find_member`: resolve one group member by visible name or member id.
- `feishu_send_text_at_member`: resolve one group member by name, mention them, and send text.

Read tools are marked read-only. Send tools are not idempotent and should be approved by the user before use.

## Security Notes

- Do not put real app secrets in Codex prompts, Claude prompts, plugin manifests, examples, or committed files.
- Prefer `FEISHU_BRIDGE_ENV_FILE` pointing at an existing private env file.
- Keep `default_tools_approval_mode = "prompt"` for Codex so message-sending actions require approval.
- The MCP server writes operational startup messages to stderr, not stdout, so it does not corrupt stdio JSON-RPC.
