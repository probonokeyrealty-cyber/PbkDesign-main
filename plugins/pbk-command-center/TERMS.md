# PBK Command Center Plugin Terms

This plugin is provided as a repo-local workflow aid for PBK Wholesale Paradise.

## Intended use

- use it to guide UI implementation, BrowserOS placement, and bridge-backed PBK runtime work
- keep new features inside the existing PBK command-center design language unless an explicit redesign is requested

## Usage boundaries

- do not treat this plugin as a substitute for production security review
- do not assume third-party MCP servers or connected services are safe by default
- validate local and hosted bridge configuration before production rollout

## Operational note

The plugin may reference local services such as:

- `http://127.0.0.1:8788`
- `http://127.0.0.1:9000/mcp`

Those endpoints must be available and correctly secured in your environment before use.
