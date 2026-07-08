# Feishu Bridge

Local Feishu long-connection bridge with pluggable reply backends and CLI helpers.

It can:

- Receive Feishu `im.message.receive_v1` events through a self-built Feishu app long connection.
- Reply in `echo`, `codex`, or generic `command` mode.
- Send group messages from the CLI.
- Read recent group history from the CLI.
- Run as a systemd service.

Keep real credentials outside version control. Commit `.env.example`, not `.env`.

## Setup

```sh
npm install
cp .env.example .env
```

Fill in the private `.env` file:

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
- Receive long-connection events: subscribe to `im.message.receive_v1` in the Feishu developer console.

## Run

```sh
npm start
```

The bridge only replies to text messages. If `FEISHU_TARGET_CHAT_ID` is set, other chats are ignored. If `FEISHU_BOT_OPEN_ID` is set, the bridge ignores its own messages.

## Reply Modes

### Echo

```sh
FEISHU_BRIDGE_MODE=echo
```

Replies with a short receipt.

### Codex

```sh
FEISHU_BRIDGE_MODE=codex
CODEX_BRIDGE_CWD=/path/to/workspace
CODEX_BRIDGE_TIMEOUT_MS=120000
```

Runs:

```sh
codex -s read-only -a never exec --ephemeral
```

Existing deployments that still set `CODEX_BRIDGE_MODE=codex` continue to work.

### Command

```sh
FEISHU_BRIDGE_MODE=command
FEISHU_BRIDGE_REPLY_COMMAND='node /path/to/replier.js'
FEISHU_BRIDGE_REPLY_COMMAND_CWD=/path/to/project
FEISHU_BRIDGE_REPLY_COMMAND_TIMEOUT_MS=120000
```

The configured command receives the incoming message text on stdin. The command's stdout becomes the Feishu reply.

The bridge also passes context as environment variables:

```text
FEISHU_MESSAGE_TEXT
FEISHU_CHAT_ID
FEISHU_MESSAGE_ID
FEISHU_SENDER_OPEN_ID
```

## CLI

Read recent messages:

```sh
npm run read -- --hours 24 --limit 20
npm run read -- --days 7 --json
```

Send a message:

```sh
npm run send -- --text "message"
```

Mention a member:

```sh
npm run send -- --at-open-id ou_xxx --at-label "Name" --text "message"
npm run send -- --at-name "Name" --text "message"
```

Check the service:

```sh
npm run status
```

## Service

The included unit file is an example template:

```sh
feishu-bridge.service
```

Copy it to systemd and adjust `User`, `Group`, `WorkingDirectory`, `EnvironmentFile`, and `ExecStart` for your deployment:

```sh
sudo cp feishu-bridge.service /etc/systemd/system/feishu-bridge.service
sudo systemctl daemon-reload
```

Common commands:

```sh
sudo systemctl status feishu-bridge
sudo systemctl restart feishu-bridge
sudo systemctl stop feishu-bridge
sudo journalctl -u feishu-bridge -f
```

The helper script wraps common operations:

```sh
./bridgectl.sh status
./bridgectl.sh logs
./bridgectl.sh mode echo
./bridgectl.sh mode codex
./bridgectl.sh mode command
```

`bridgectl.sh` defaults to the current directory and service name `feishu-bridge`. Override with:

```sh
FEISHU_BRIDGE_ROOT=/opt/feishu-bridge
FEISHU_BRIDGE_ENV_FILE=/etc/feishu-bridge.env
FEISHU_BRIDGE_SERVICE=feishu-bridge
```

## Open Source Hygiene

- Commit source files, `.env.example`, service templates, and documentation.
- Do not commit `.env`, `.env.*`, real app secrets, tenant tokens, or chat transcripts.
- Keep deployment-specific service names, chat IDs, paths, and credentials in private configuration.

## Development

```sh
npm run check
```
