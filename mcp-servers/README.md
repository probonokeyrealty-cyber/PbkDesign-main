# PBK External MCP Registry

The `mcp-server/` package in this repo is the PBK bridge MCP server.

This `mcp-servers/` folder is for external server registration templates that PBK can use alongside it.

Included:

- `registry.example.json` with PBK + Context7 + Tavily + BrowserOS starter registration

Recommended order:

1. `pbk-openclaw` for runtime actions
2. `context7` for live library/API docs
3. `tavily` when you want Ava/Rex to access live web-search through MCP. Keep the real key in your runtime secret manager or local MCP config, not in this example file.
4. `browseros` when you want Rex to launch browser-native research without leaving the PBK Brain lane
5. other optional browser/research servers once you are ready for that layer
