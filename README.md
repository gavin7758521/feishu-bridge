# Feishu Bridge

Feishu MCP server and CLI helpers for Codex, Claude, and other agent clients.

The current architecture is:

```text
Codex / Claude / MCP client -> Feishu Bridge MCP -> Feishu OpenAPI
```

This project does not run a Feishu long-connection listener. Agents call Feishu tools when they need to read or send messages, download message/Drive files, or work with Feishu Base/Bitable records.

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
- Read group history: `im:message.group_msg` or an equivalent permission.
- Read message resources: the permission for getting resource files in messages.
- Resolve group member names for mentions: chat member read permission.
- Download Drive files/media: Drive media/file read and download permissions.
- Bitable read: Base/Bitable app, table, field, and record read permissions.
- Bitable write: Base/Bitable record create and update permissions.

Base files may also require adding the app as a collaborator or allowlisting it in advanced permissions.

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
  - Keeps the legacy message fields and adds `bodyContent` plus `parsedContent`.
  - `parsedContent` includes text content, file metadata such as `fileKey`, `fileName`, `fileSize`, and `fileType`, image keys, and raw JSON for richer message types.
- `feishu_download_message_resource`: download a file, image, audio, or media resource attached to a message to an explicit `save_path`.
- `feishu_download_drive_media`: download a Drive media/file token to an explicit `save_path`.
- `feishu_send_text`: send text to the configured group or an explicit `chat_id`.
- `feishu_find_member`: resolve one group member by visible name or member id.
- `feishu_send_text_at_member`: resolve one group member by name, mention them, and send text.
- `feishu_bitable_parse_url`: extract `app_token` from a Feishu Base URL.
- `feishu_bitable_list_tables`: list tables in a Base app.
- `feishu_bitable_list_fields`: list fields in a Base table.
- `feishu_bitable_search_records`: search records in a Base table.
- `feishu_bitable_create_record`: create one Base table record.
- `feishu_bitable_update_record`: update one Base table record.

Message-sending and Bitable create/update tools are side-effecting. Configure your MCP client to require approval before sending or writing records.

### Download message attachments

1. Call `feishu_read_messages` and inspect a `file` message's `messageId` and `parsedContent.fileKey`.
2. Call `feishu_download_message_resource` with `message_id`, `file_key`, optional `type`, and an explicit `save_path`.

Example MCP arguments:

```json
{
  "message_id": "om_xxx",
  "file_key": "file_xxx",
  "type": "file",
  "save_path": "/tmp/report.xlsx"
}
```

The tool returns `saved`, `savePath`, `bytes`, `contentType`, and `fileNameFromHeader`. It never chooses a default project-path download location; callers must pass `save_path`.

For Drive media/file tokens, call `feishu_download_drive_media`:

```json
{
  "file_token": "boxcn_xxx",
  "save_path": "/tmp/report.xlsx"
}
```

### Work with Base/Bitable

Use `feishu_bitable_parse_url` to extract an `app_token` from URLs like:

```text
https://example.feishu.cn/base/QPnubkmjXaPpwCs4EHGcGPDBnih
```

Then call:

```text
feishu_bitable_list_tables -> feishu_bitable_list_fields -> feishu_bitable_search_records
```

For writes, use `feishu_bitable_create_record` or `feishu_bitable_update_record` with a `fields` object matching the table field names and value types expected by Feishu.

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
- Keep deployment-specific chat IDs, paths, Base IDs, and credentials in private configuration.
- Do not put app secrets, tenant tokens, or private chat IDs in examples, logs, prompts, or plugin manifests.
- Run `npm pack --dry-run` before publishing to confirm the package contents.
- Read `SECURITY.md` before sharing logs or opening public issues.

## Development

```sh
npm run check
npm test
npm audit --omit=dev
npm pack --dry-run
```

See [docs/release.md](docs/release.md) for versioning and npm release policy.
