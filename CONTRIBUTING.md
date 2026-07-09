# Contributing

Thanks for helping improve Feishu Bridge.

## Development

Install dependencies:

```sh
npm install
```

Run checks:

```sh
npm run check
```

Run tests only:

```sh
npm test
```

## Local Runtime

Copy the example environment file and fill in private values:

```sh
cp env.example .env
```

Never commit `.env`, `.env.*`, chat transcripts, tokens, or deployment handoff files.

## Pull Requests

- Keep changes focused.
- Update README or examples when behavior changes.
- Add or update tests for parsing, CLI behavior, or other logic that can be tested without real Feishu credentials.
- Do not include real app IDs, secrets, tenant tokens, or private chat IDs.

## Release Checklist

This project follows Semantic Versioning. See `docs/release.md` for version rules and examples.

Before publishing:

```sh
npm run check
npm audit --omit=dev
npm pack --dry-run
```
