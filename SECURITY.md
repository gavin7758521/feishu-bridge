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

This package intentionally ships `env.example`, not `.env`.

## Runtime Notes

The MCP server may read private chat content from Feishu when a client invokes read tools. Review client logs and transcript retention before using it with sensitive groups.

When using the MCP server, keep message-sending tools behind client approval. For Codex, prefer `default_tools_approval_mode = "prompt"` so sending to Feishu requires explicit confirmation.
