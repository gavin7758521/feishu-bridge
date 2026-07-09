# Feishu Bridge

Feishu MCP server and CLI helpers for Codex, Claude, and other agent clients.

The current architecture is:

```text
Codex / Claude / MCP client -> Feishu Bridge MCP -> Feishu OpenAPI
```

This project does not run a Feishu long-connection listener. Agents call Feishu tools when they need to read or send messages.

## Setup

Install from npm:

```sh
npm install -g @gavin7758521/feishu-bridge
```

Or install from a git checkout:

```sh
npm install
cp env.example .env
```

Fill in a private env file:

```sh
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_TARGET_CHAT_ID=oc_xxx
FEISHU_BOT_OPEN_ID=ou_xxx
```

Required Feishu permissions depend on what you use:

- Send messages: message send permission, such as `im:message:send_as_bot`.
- Read group history: `im:message.group_msg`.
- Resolve group member names for mentions: chat member read permission.

Keep real credentials outside version control. Commit `env.example`, not `.env`.

## MCP

Start the MCP server from a global npm install:

```sh
FEISHU_BRIDGE_ENV_FILE=/path/to/.env feishu-bridge-mcp
```

The `feishu-bridge` command is an alias for the same MCP server:

```sh
FEISHU_BRIDGE_ENV_FILE=/path/to/.env feishu-bridge
```

Add it to Codex:

```sh
codex mcp add feishu-bridge --env FEISHU_BRIDGE_ENV_FILE=/path/to/.env -- feishu-bridge-mcp
```

For this machine, the existing private config can be reused:

```sh
codex mcp add feishu-bridge --env FEISHU_BRIDGE_ENV_FILE=/home/finnchart/personal/feishu-bridge/.env -- feishu-bridge-mcp
```

See [docs/mcp.md](docs/mcp.md) for Codex and Claude configuration examples.

## MCP Tools

- `feishu_read_messages`: read recent messages from the configured group or an explicit `chat_id`.
- `feishu_send_text`: send text to the configured group or an explicit `chat_id`.
- `feishu_find_member`: resolve one group member by visible name or member id.
- `feishu_send_text_at_member`: resolve one group member by name, mention them, and send text.

Message-sending tools are side-effecting. Configure your MCP client to require approval before sending.

## CLI

Read recent messages:

```sh
npm run read -- --hours 24 --limit 20
npm run read -- --days 7 --json
feishu-bridge-read --hours 24 --limit 20
```

Send a message:

```sh
npm run send -- --text "message"
feishu-bridge-send --text "message"
```

Mention a member:

```sh
npm run send -- --at-open-id ou_xxx --at-label "Name" --text "message"
npm run send -- --at-name "Name" --text "message"
feishu-bridge-send --at-name "Name" --text "message"
```

The CLI helpers load `.env` from the current working directory by default. Override with:

```sh
FEISHU_BRIDGE_ENV_FILE=/path/to/feishu-bridge.env
```

## Open Source Hygiene

- Commit source files, `env.example`, and documentation.
- Do not commit `.env`, `.env.*`, real app secrets, tenant tokens, or chat transcripts.
- Keep deployment-specific chat IDs, paths, and credentials in private configuration.
- Run `npm pack --dry-run` before publishing to confirm the package contents.
- Read `SECURITY.md` before sharing logs or opening public issues.

## Development

```sh
npm run check
npm test
npm audit --omit=dev
npm pack --dry-run
```
