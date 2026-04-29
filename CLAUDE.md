## PBK Implementation Rules

### Product Scope
- Build PBK Wholesale Paradise as an operations-complete platform first.
- Do not treat the React shell as a separate product or a redesign target.
- Extend existing runtime surfaces before inventing parallel systems.

### UI/UX Constraints
- Extend, do not replace.
- Never redesign the overall PBK Command Center.
- All new features must reuse the existing design language:
  - existing CSS variables and color system
  - Fraunces, Geist, and JetBrains Mono typography
  - existing panel, card, button, chip, and rail patterns
- If a feature needs top-level navigation, add it through the existing left-rail pattern.
- Prefer modals, drawers, collapsible panels, inline cards, or route-level sections inside the current app structure over brand-new page systems.
- Do not introduce a new color palette, alternate shell branding, or a second visual identity.
- Small changes are expected and encouraged, as long as they are implemented inside the existing PBK command-center language.

### Design Source Of Truth
- Treat the GitHub repo itself as the source of truth for PBK visual direction.
- Before changing PBK UI, review and align to these in-repo design references:
  - `index.html`
  - `index.before-figma.html`
  - `public/legacy/PBK_Command_Center v5.html`
  - `src/imports/PBK_Command_Center_v5.html`
  - `src/imports/PBK_Command_Center_v5-1.html`
  - `src/imports/pasted_text/figma-pbk-migration.md`
- Use those files to preserve:
  - the dark Bloomberg-style control-room atmosphere
  - dense operator-first information layout
  - Fraunces / Geist / JetBrains Mono hierarchy
  - PBK sky-blue, amber, and graphite accent system
  - high-impact modern polish without introducing a new product aesthetic
- BrowserOS, MCP, observability, or any other new system must inherit the PBK command-center design, not redefine it.

### Feature Placement
- Tooling status belongs in Settings and runtime summary cards.
- Browser research belongs in the Brain lane, not a separate app.
- Context7 is invisible unless the user explicitly asks for documentation status.
- Observability can live behind `/metrics` and status summaries, but not as a replacement dashboard inside PBK.
- Approval-backed infra actions must appear in the existing approval/admin queue patterns.

### Browser Research Rules
- BrowserOS integration is an extension of Rex and the Brain.
- Register BrowserOS through the MCP registry and surface its readiness through the existing tooling cards.
- Any BrowserOS trigger inside PBK should launch from a Brain action, modal, chip, or inline runtime card, not a separate navigation product.

### Local Verification Note
- If `@browser-use` fails before attaching, check `%LOCALAPPDATA%\\Temp\\package.json`.
- A Temp-wide `"type": "module"` can break the Browser Use node-repl kernel because its generated kernel file still expects CommonJS `require(...)`.
- Use `npm run doctor:browser-use` before assuming the PBK frontend is at fault.

### Implementation Bias
- Prefer shared bridge-backed runtime adapters over duplicate client logic.
- Keep analyzer math and operational state in the bridge.
- Any new ops feature must work in both the legacy engine and the React shell unless explicitly deferred.
