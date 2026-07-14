# Feishu Bridge MCP

The recommended agent-facing shape is:

```text
Codex / Claude -> Feishu Bridge MCP server -> Feishu OpenAPI
```

Keep existing Feishu configuration files. The MCP server reads the same environment variable names and does not require moving secrets into Codex, Claude, or this repository. It can read/send group messages, download message and Drive files, and operate Feishu Base/Bitable records through OpenAPI.

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
  - Existing fields remain: `messageId`, `msgType`, timestamps, sender fields, and `text`.
  - New fields include `bodyContent` and `parsedContent`.
  - `parsedContent` handles `text`, `file`, and `image` messages directly, and preserves `rawContent`/JSON for `post`, `share_card`, `interactive`, and other message types.
- `feishu_download_message_resource`: download a resource from a message with `message_id`, `file_key`, optional `type`, and explicit `save_path`.
- `feishu_download_drive_media`: download a Drive media/file token with `file_token` and explicit `save_path`.
- `feishu_send_text`: send text to the configured group or an explicit `chat_id`.
- `feishu_find_member`: resolve one group member by visible name or member id.
- `feishu_send_text_at_member`: resolve one group member by name, mention them, and send text.
- `feishu_bitable_parse_url`: extract a Base `app_token` from a Feishu Base URL.
- `feishu_bitable_list_tables`: list tables in a Base app.
- `feishu_bitable_list_fields`: list fields in a Base table.
- `feishu_bitable_search_records`: search records in a Base table; supports `view_id`, pagination, `filter`, `sort`, and `field_names`.
- `feishu_bitable_create_record`: create one record with a `fields` object.
- `feishu_bitable_update_record`: update one record by `record_id` with a `fields` object.

Read/list/search/download tools are marked read-only. Send tools and Bitable create/update tools are not idempotent and should be approved by the user before use.

## Downloading Attachments

For files attached to group messages, first call `feishu_read_messages`. A file message will include metadata in `parsedContent`, for example:

```json
{
  "messageId": "om_xxx",
  "msgType": "file",
  "parsedContent": {
    "fileKey": "file_xxx",
    "fileName": "report.xlsx",
    "fileSize": 12345,
    "fileType": "xlsx"
  }
}
```

Then call `feishu_download_message_resource`:

```json
{
  "message_id": "om_xxx",
  "file_key": "file_xxx",
  "type": "file",
  "save_path": "/tmp/report.xlsx"
}
```

The tool saves exactly to `save_path` and returns `saved`, `savePath`, `bytes`, `contentType`, and `fileNameFromHeader`. It does not choose a default download path and refuses directory paths.

For Drive media/file tokens, call:

```json
{
  "file_token": "boxcn_xxx",
  "save_path": "/tmp/report.xlsx"
}
```

## Base / Bitable

For a Base URL such as:

```text
https://example.feishu.cn/base/QPnubkmjXaPpwCs4EHGcGPDBnih
```

call `feishu_bitable_parse_url` to get:

```json
{
  "appToken": "QPnubkmjXaPpwCs4EHGcGPDBnih"
}
```

Typical read flow:

```text
feishu_bitable_list_tables
feishu_bitable_list_fields
feishu_bitable_search_records
```

Typical write flow:

```text
feishu_bitable_create_record
feishu_bitable_update_record
```

The `fields` object must match the Feishu table field names and value shapes for the target field types. Base permissions can be stricter than app scopes; add the self-built app as a Base collaborator or advanced-permission allowlist entry when Feishu returns permission errors.

## Feishu Permissions

Permission names vary by Feishu admin console version. At minimum, enable the equivalent permissions for the capabilities you use:

- Send messages: `im:message:send_as_bot`.
- Read group history: `im:message.group_msg` or equivalent.
- Read message resource files: permissions for getting resource files in messages.
- Read group members: chat member read permission.
- Download Drive files: Drive media/file read and download permissions.
- Bitable read: Base/Bitable app, table, field, and record read permissions.
- Bitable write: Base/Bitable record create and update permissions.

Base files may also require adding the app as a collaborator or advanced-permission allowlist entry.

## Security Notes

- Do not put real app secrets in Codex prompts, Claude prompts, plugin manifests, examples, or committed files.
- Prefer `FEISHU_BRIDGE_ENV_FILE` pointing at an existing private env file.
- Do not commit `.env`, app secrets, tenant tokens, chat IDs, message transcripts, or downloaded private files.
- Pass `save_path` explicitly for downloads; avoid project directories unless that is intentional.
- Keep `default_tools_approval_mode = "prompt"` for Codex so message-sending actions require approval.
- The MCP server writes operational startup messages to stderr, not stdout, so it does not corrupt stdio JSON-RPC.
