---
name: pbk-command-center-design
description: Preserve the PBK command-center design language while implementing small, high-impact features.
---

# PBK Command Center Design

Use this skill whenever you are changing PBK Wholesale Paradise UI, UX, layout, BrowserOS placement, tooling surfaces, or other visible workflow elements.

## Goal

Keep PBK modern, sharp, and high-impact without redesign drift.

The rule is:

`Extend, do not replace.`

Small changes are expected and encouraged. The overall PBK command-center identity is not up for reinvention unless the user explicitly asks for a redesign.

## Source of truth

Before touching PBK UI, review these repo files:

- `../../../index.html`
- `../../../index.before-figma.html`
- `../../../public/legacy/PBK_Command_Center v5.html`
- `../../../src/imports/PBK_Command_Center_v5.html`
- `../../../src/imports/PBK_Command_Center_v5-1.html`
- `../../../src/imports/pasted_text/figma-pbk-migration.md`
- `../../../CLAUDE.md`

Use them to preserve:

- the dark Bloomberg-style control-room atmosphere
- dense operator-first information layout
- Fraunces / Geist / JetBrains Mono hierarchy
- PBK sky-blue, amber, and graphite accents
- decisive, premium, high-signal UI behavior

## Layout rules

- Never redesign the overall Command Center unless the user explicitly asks.
- Reuse existing PBK layout patterns before introducing new ones.
- Prefer:
  - inline cards
  - panels
  - drawers
  - modals
  - collapsed sections
  - rail-based additions
- Avoid:
  - new product shells
  - alternate nav systems
  - second branding systems
  - unrelated color palettes
  - airy SaaS-dashboard simplification that loses operator density

## BrowserOS and tooling placement

- BrowserOS belongs in the Brain lane and Settings tooling surfaces.
- Context7 should usually remain invisible and improve answers, not add clutter.
- Observability belongs in metrics/status affordances, not as a replacement PBK dashboard.
- Meta-agent, MCP, admin, and quota surfaces must inherit PBK card/panel patterns.

## React shell rule

- The React shell is a mirror of PBK, not a separate app aesthetic.
- If changing shell visuals, compare them against the legacy engine and align toward the PBK command-center look.

## Implementation bias

- Keep the bridge as source of truth for operational state.
- Prefer shared adapters over duplicated feature logic.
- When in doubt, make the smallest visible change that delivers the feature cleanly.

## Browser verification

After meaningful frontend changes, verify with the in-app browser when available.

If Browser Use fails before attaching, check:

- `%LOCALAPPDATA%\\Temp\\package.json`

And run:

- `npm run doctor:browser-use`
