# PBK Wholesale Paradise Design System

This is the PBK-specific companion to `DESIGN.md`. Coding agents should read both files before changing the UI. `DESIGN.md` preserves the standard AI-agent convention; this file makes the PBK scope explicit.

## Scope

Use this design system only for PBK Wholesale Paradise:

- PBK Command Center.
- PBK analyzer.
- PBK Brain/Rex lane.
- PBK contract and acquisition workflows.
- PBK provider/admin/runtime surfaces.

Do not use this file as a general-purpose design system for unrelated apps.

## Visual Identity

PBK is a dark, modern, operator-first acquisitions command center. The interface should feel like a serious real estate control room, not a generic SaaS dashboard.

Core traits:

- Dense but calm.
- High trust.
- Fast to scan.
- Baby-blue operational accents.
- Warm amber approval states.
- Graphite/dark-panel surfaces.
- Expressive Fraunces headings.
- Geist UI copy.
- JetBrains Mono operational data.

## Tokens

Use the existing CSS variables from `index.html`.

Primary surfaces:

- `--bg-void`
- `--bg-console`
- `--bg-panel`
- `--bg-panel-elevated`
- `--bg-hover`

Primary PBK accent:

- `--sky`
- `--sky-bright`
- `--sky-dim`
- `--sky-deep`
- `--sky-glow`
- `--sky-glow-strong`

Operational accents:

- `--amber` for approval and caution.
- `--crimson` for danger, DNC, and failure.
- `--lime` for success and clear go states.
- `--ion` for voice/live energy.
- `--magenta` for document/special workflow accents.

Typography:

- `--font-display`: Fraunces.
- `--font-ui`: Geist.
- `--font-mono`: JetBrains Mono.

Layout:

- Desktop rail stays.
- Mobile bottom nav stays.
- Mobile breakpoint is 720px.
- Grid gutters should usually use existing spacing tokens.
- Tables may scroll horizontally on mobile when they are true data tables.

## Component Rules

Buttons:

- Primary: `.btn.btn-primary`.
- Secondary: `.btn.btn-ghost`.
- Compact: `.chip-btn`.
- Dangerous: crimson styling plus approval guard where appropriate.

Cards:

- Use `var(--bg-panel)`, `var(--border-dim)`, and `var(--radius-lg)`.
- Keep long text inside the card with wrapping.
- Do not let cards overflow at phone width.

Modals and drawers:

- Use existing modal/backdrop styling.
- Do not introduce a second modal language.

Runtime/provider cards:

- Keep them compact, explicit, and operational.
- Show real readiness and missing-provider states honestly.

## Forbidden Drift

Do not:

- Add a new palette.
- Replace the shell.
- Move Rex out of Brain.
- Create a separate admin app.
- Turn PBK into a generic white SaaS dashboard.
- Use purple gradients as the default accent.
- Hide operational warnings behind marketing copy.

## Mobile Requirements

Every PBK page must:

- Avoid horizontal viewport overflow.
- Wrap long labels and addresses.
- Keep buttons reachable.
- Preserve the desktop visual identity.
- Stack columns without changing the brand look.

## Verification

Before completing UI work:

1. Run `npm run build`.
2. Run `npm run test:hosted` when runtime seams are touched.
3. Run `npm run test:e2e:browseros` when BrowserOS/Rex lanes are touched.
4. Check a 390px mobile viewport for overflow.

