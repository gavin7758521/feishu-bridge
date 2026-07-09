# Security Policy

## Supported Versions

Security fixes are applied to the latest published version.

## Reporting a Vulnerability

Please report security issues privately through GitHub Security Advisories when available, or contact the maintainer before opening a public issue.

Do not include real Feishu app secrets, tenant tokens, chat transcripts, or private chat IDs in public issues.

## Secrets

Keep these values outside version control:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_TARGET_CHAT_ID`
- `FEISHU_BOT_OPEN_ID`
- tenant access tokens
- local `.env` files
- deployment-specific handoff notes

This package intentionally ships `.env.example`, not `.env`.

## Runtime Notes

`command` mode runs the configured `FEISHU_BRIDGE_REPLY_COMMAND` through a shell. Only use commands and working directories controlled by a trusted operator.

The bridge may receive private chat content from Feishu. Review your logging, systemd journal retention, and reply backend behavior before using it in sensitive groups.
