# PBK Command Center Plugin Privacy

This plugin is a repo-local assistant layer for PBK Wholesale Paradise.

## What it does

- loads PBK-specific skill instructions from this repository
- references local MCP server examples for the PBK bridge, Context7, and BrowserOS
- helps future agent work stay inside PBK's existing command-center design system

## Data handling

- the plugin itself does not transmit analytics or collect its own telemetry
- any runtime data access is performed by the MCP servers or bridge endpoints you choose to run
- BrowserOS, Context7, PBK bridge, Netlify, GitHub, or other connected services follow their own policies and credentials

## Operator responsibility

- keep production secrets out of repo-local config files
- rotate compromised or previously exposed credentials before production use
- review MCP endpoint configuration before enabling remote services
