# PBK Browser Research Layer

This folder is the handoff point for BrowserOS or `agent-browser` style research automation.

UI rule:

- keep browser research inside the PBK Brain lane or existing Settings tooling cards
- do not create a separate browser-research app shell or redesign the command center

Use cases:

- public-record owner verification
- property condition pass from photos or listing pages
- distress-signal scan
- recent listing/agent scan before the opening call

Seed jobs from the live PBK bridge:

```bash
npm run research:seed-browser-jobs
```

That writes `generated-jobs.json`, which can be fed into BrowserOS, Browser Use, or a parallel research runner.

Recommended local BrowserOS registration:

```json
{
  "mcpServers": {
    "browseros": {
      "url": "http://127.0.0.1:9000/mcp"
    }
  }
}
```
