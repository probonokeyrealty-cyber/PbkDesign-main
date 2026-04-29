# PBK Command Center Plugin

This repo-local Codex plugin keeps PBK Wholesale Paradise feature work inside the existing command-center design system.

Core rule:

`Extend, do not replace.`

## What it gives the team

- a PBK-specific UI/UX skill for future agent work
- a local plugin manifest that can be installed from this repo
- a starter MCP registry for the PBK bridge, Context7, and BrowserOS

## Install path

The repo marketplace entry lives at:

- `../../.agents/plugins/marketplace.json`

The plugin root lives at:

- `./`

## Source of truth for PBK design

Before making UI changes, align to these files in the main repo:

- `../../index.html`
- `../../index.before-figma.html`
- `../../public/legacy/PBK_Command_Center v5.html`
- `../../src/imports/PBK_Command_Center_v5.html`
- `../../src/imports/PBK_Command_Center_v5-1.html`
- `../../src/imports/pasted_text/figma-pbk-migration.md`
- `../../CLAUDE.md`

## BrowserOS and runtime wiring

This plugin includes an MCP example file at:

- `./.mcp.json`

It points to:

- the PBK bridge MCP server in `../../mcp-server/dist/index.js`
- Context7 via `@upstash/context7-mcp`
- BrowserOS at `http://127.0.0.1:9000/mcp`

BrowserOS should stay inside the PBK Brain lane and existing tooling cards. It is a runtime extension, not a new app shell.

Reference repo:

- [BrowserOS](https://github.com/browseros-ai/BrowserOS)

## Local verification

When doing frontend work, verify against the existing PBK surface first.

- live engine: `http://127.0.0.1:4173/`
- shell preview: `http://127.0.0.1:4173/index.shell.html#/brain`

If `@browser-use` fails before attaching, run:

```bash
npm run doctor:browser-use
```

If that reports a Temp-directory ESM problem, fix the local `%LOCALAPPDATA%\Temp\package.json` issue before blaming the PBK frontend.
