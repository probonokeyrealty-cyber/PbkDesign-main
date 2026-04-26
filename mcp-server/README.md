# pbk-openclaw-mcp-server

MCP server that wraps the PBK OpenClaw bridge so any MCP-aware client (Claude Desktop, Cursor, Windsurf, custom agents) can drive PBK Paradise the same way the live frontend does.

The PBK bridge is the brain — this just makes it speak MCP.

## What it exposes

| Tool | Bridge call | Side effects |
|------|------------|--------------|
| `pbk_health` | `GET /health` | none — confirms revision + auth state |
| `pbk_list_tools` | `GET /api/tools` | none |
| `pbk_get_state` | `GET /state` | none — returns approvals/activity/brainDocs/etc, sliceable |
| `pbk_analyze_deal` | `POST /invoke analyzeDeal` | adds analyzerRun + activity |
| `pbk_create_approval` | `POST /invoke createApproval` | queues approval, fans to n8n |
| `pbk_decide_approval` | `PUT /api/approvals/:id` | flips status, adds activity |
| `pbk_list_approvals` | `GET /api/approvals` | none |
| `pbk_get_brain_state` | `POST /invoke getBrainState` | reads brainDocs, may add activity |
| `pbk_ingest_research_doc` | `POST /invoke ingestResearchDoc` | adds brainDoc |
| `pbk_lead_intake` | `POST /api/leads/import` | adds leadImport + activity |
| `pbk_check_dnc` | `POST /invoke checkDNC` | none — pure lookup |
| `pbk_send_sms` | `POST /invoke telnyx_sms` | sends SMS unless DNC blocks |
| `pbk_make_call` | `POST /invoke telnyx_call` | starts Telnyx call unless DNC blocks |
| `pbk_send_contract` | `POST /invoke sendDocuSign` | creates DocuSign envelope |
| `pbk_skip_trace` | `POST /invoke skipTrace` | runs skip-trace |
| `pbk_slack_notify` | `POST /invoke slackNotify` | posts to bridge's Slack notify path |

All tools return both human-readable JSON in `content[0].text` and `structuredContent` for MCP clients that consume structured outputs.

## Configuration

Set via environment variables (in your MCP client's config, **not** in the repo):

| Variable | Default | What it does |
|----------|---------|--------------|
| `PBK_BRIDGE_ENDPOINT` | `https://pbk-openclaw-bridge.onrender.com` | Bridge base URL. Use `http://127.0.0.1:8788` for the local OptiPlex bridge. |
| `PBK_BRIDGE_API_KEY` | _(empty)_ | Bearer token. Must match the bridge's `PBK_BRIDGE_API_KEY` Render env var. Leave empty for an open local bridge. |

## Build

```bash
npm install
npm run build
```

Outputs `dist/index.js`.

## Wire it into Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pbk-openclaw": {
      "command": "node",
      "args": ["C:\\Users\\Dell\\Documents\\New project 2\\PbkDesign-main\\mcp-server\\dist\\index.js"],
      "env": {
        "PBK_BRIDGE_ENDPOINT": "https://pbk-openclaw-bridge.onrender.com",
        "PBK_BRIDGE_API_KEY": "paste-your-key-here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "pbk-openclaw" in the MCP indicator and all `pbk_*` tools become callable.

## Wire it into Cursor / Windsurf / generic clients

Same shape, the keys/path differ slightly per client. Use `node /abs/path/to/dist/index.js` as the command and pass `PBK_BRIDGE_ENDPOINT` + `PBK_BRIDGE_API_KEY` via env.

## Local dev

```bash
npm run dev
```

Uses `tsx` to run `src/index.ts` directly with hot reload. Talks to whichever bridge `PBK_BRIDGE_ENDPOINT` points at.

## Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Walk through every tool against your live bridge before connecting Claude Desktop.

## Notes

- The bridge's `/invoke` accepts looser parameter shapes than the schemas here. The MCP schemas pick the shape that's most useful for an LLM — extra fields are stripped via `.strict()` Zod validation.
- All errors come back as `{ isError: true, content: [{type:"text", text:"..."}]}` with actionable messages (e.g., "Set `PBK_BRIDGE_API_KEY`...").
- `pbk_check_dnc` should be the first call before any outbound communication.
