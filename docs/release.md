# Release Policy

This project follows Semantic Versioning:

```text
MAJOR.MINOR.PATCH
```

## Version Meaning

- `MAJOR`: breaking changes to MCP tool names, CLI commands, configuration, or return shapes.
- `MINOR`: backwards-compatible new features, such as new MCP tools or CLI options.
- `PATCH`: backwards-compatible bug fixes, documentation fixes, dependency updates, and packaging fixes.

While the project is below `1.0.0`, the public surface is still settling. Treat `0.x` releases as usable but not yet stable.

## Current Release Line

The first npm release should use:

```text
0.1.0
```

This is appropriate because the package is newly public and the MCP tool surface may still change after real-world use.

## Examples

```text
0.1.0 -> 0.1.1  packaging fix, bug fix, docs fix
0.1.0 -> 0.2.0  new MCP tool or new CLI option
0.2.0 -> 0.3.0  Codex plugin marketplace bundle
0.x.y -> 1.0.0  MCP tools, CLI commands, and config are stable
1.0.0 -> 1.0.1  bug fix
1.0.0 -> 1.1.0  backwards-compatible feature
1.0.0 -> 2.0.0  breaking change
```

## Pre-Releases

Use pre-release versions only when a release should not be installed by default:

```text
0.2.0-beta.0
1.0.0-rc.0
```

Publish pre-releases with a non-latest tag:

```sh
npm version prerelease --preid beta
npm publish --access public --tag beta
```

## Stable Release Checklist

Before publishing:

```sh
npm run check
npm audit --omit=dev
npm pack --dry-run
```

Confirm the package does not include `.env`, `.env.*`, chat transcripts, handoff notes, tokens, or real Feishu identifiers.
