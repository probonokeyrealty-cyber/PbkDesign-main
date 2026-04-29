# PBK Final Preview

Use this before any GitHub push tied to deployment or before a Netlify production publish.

## Goal

Confirm that the PBK shell remains inside the existing command-center design language while the live runtime and bridge-backed features are healthy.

## One-command verification

```bash
npm run preview:final
```

That runs:

- `npm run build`
- `npm run test:parity`
- `npm run test:tooling`
- `npm run doctor:browser-use`

## Browser preview URLs

Open both surfaces and compare them against the PBK design references:

- live engine: `http://127.0.0.1:4173/`
- shell preview: `http://127.0.0.1:4173/index.shell.html#/brain`
- shell settings preview: `http://127.0.0.1:4173/index.shell.html#/settings`

## Visual rules

- keep the dark control-room atmosphere
- keep the existing left rail and command-center layout
- keep PBK sky-blue, amber, and graphite accents
- keep operator density; do not simplify into a generic airy SaaS dashboard
- BrowserOS, tooling, quotas, and admin surfaces should feel like added PBK panels, not a second product

## BrowserOS note

Codex is already configured with:

- `browseros = http://127.0.0.1:9000/mcp`

Use BrowserOS or Browser Use for final live preview checks, but keep all BrowserOS actions inside the Brain or Settings tooling surfaces.

## Deployment note

Do not treat this preview as production approval by itself.

Before production:

- rotate any exposed secrets
- restart the latest local bridge if runtime data appears stale
- verify hosted smoke tests separately when you are ready
