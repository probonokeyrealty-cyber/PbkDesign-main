# PBK Command Center Design System

This file is the AI-readable design source of truth for PBK Wholesale Paradise. Any coding agent changing frontend UI must preserve the existing modern command-center look and use the rules below before inventing new styling.

## Product Feel

PBK should feel like a high-trust real estate acquisitions control room: dense, sharp, modern, calm under pressure, and operator-first. The visual direction is not generic SaaS. It is a dark Bloomberg-style command center with polished cards, baby-blue signal accents, warm approval states, and clear action hierarchy.

Do not redesign the shell. Extend the current system.

## Design Principles

1. Preserve the current modern UI/UX.
2. Keep information dense but readable.
3. Use existing cards, panels, chips, rails, tables, and runtime widgets before creating new component patterns.
4. Treat mobile as containment and stacking work, not as a separate visual identity.
5. Every page must avoid horizontal overflow at phone widths.
6. Long labels, addresses, transcripts, and provider messages must wrap inside their cards.
7. Destructive or production-impacting actions must look guarded and intentional.
8. Runtime/provider status should feel operational, not decorative.

## Color Tokens

Use the CSS variables already defined in `index.html`.

Core surfaces:

- `--bg-void`: app background.
- `--bg-console`: command-console surface.
- `--bg-panel`: standard card/panel surface.
- `--bg-panel-elevated`: raised card or modal surface.
- `--bg-hover`: hover/active row surface.

Primary accents:

- `--sky`: primary PBK baby-blue action/status accent.
- `--sky-bright`: bright emphasis.
- `--sky-dim`: borders and lower-emphasis blue.
- `--sky-deep`: pressed/deeper accents.
- `--sky-glow`: soft blue background highlight.
- `--sky-glow-strong`: stronger aura/highlight.

Operational accents:

- `--amber`: approval, pending, caution.
- `--crimson`: DNC, danger, urgent failure.
- `--lime`: success, signed, clear go signal.
- `--ion`: secondary live/voice/energy signal.
- `--magenta`: document or special workflow accent.

Do not introduce a new palette unless the change first updates this file and explains why the existing tokens cannot express the state.

## Typography

Use the existing font hierarchy:

- Display: `var(--font-display)` for PBK logo, major page titles, names, and expressive emphasis.
- UI: `var(--font-ui)` for normal product copy and readable controls.
- Mono: `var(--font-mono)` for data, stats, provider statuses, timestamps, IDs, prices, and operational labels.

PBK style uses italic display emphasis inside titles, especially for key nouns:

```html
<h2>The <em>pipeline</em>.</h2>
```

Keep this sparing and intentional.

## Layout

Desktop:

- Preserve the left rail navigation.
- Keep topbar status and provider controls compact.
- Use grid layouts for operator dashboards and sidebars.
- Prefer side panels, cards, queues, tables, and inline runtime widgets.

Mobile:

- Hide the rail and use the existing mobile navigation.
- Stack multi-column layouts into one column.
- Keep tables inside horizontal scroll containers when they are true data tables.
- Wrap button groups and long labels.
- Do not shrink text below readability just to force a desktop layout onto mobile.

## Component Patterns

Buttons:

- Primary actions use `.btn.btn-primary`.
- Secondary actions use `.btn.btn-ghost` or `.chip-btn`.
- High-risk actions should not look casual; use crimson styling or approval flow.
- On mobile, buttons may wrap or become full-width, but their color/style should stay the same.

Cards and panels:

- Use `var(--bg-panel)` with `var(--border-dim)` and `var(--radius-lg)`.
- Raised panels may use `var(--bg-panel-elevated)`.
- Runtime cards should include clear state labels and short status notes.

Tables:

- Use mono headers with small uppercase labels.
- Keep tables scrollable on mobile.
- Do not collapse true operational tables into unreadable card soup unless explicitly requested.

Runtime/provider status:

- Use compact cards or badges.
- Show ready/warning/failure states clearly.
- Do not hide provider issues behind decorative copy.

Approval and admin queues:

- Reuse existing approval queue/admin task patterns.
- Approval, rejection, and destructive actions must be explicit.
- Prefer Slack/bridge-backed approval paths for real provider writes.

## Page Guidance

Dashboard:

- Keep the hero and metrics crisp.
- Avoid marketing-page spacing; this is an operator dashboard.

Inbox:

- Conversation actions must wrap on mobile.
- Bubbles and call recaps must never exceed their container.

Leads:

- Keep import/upload actions visible.
- Lead data tables may scroll horizontally.
- Bulk actions must wrap and remain reachable.

Analyzer:

- Keep it native and tool-like, not embedded-looking.
- Preserve fast inputs, verdict clarity, and "send to agent" workflow.

Brain/Rex:

- Rex stays inside Brain.
- Admin ability should be inferred from plain language, not exposed as a new shell or separate UI mode.

Contracts:

- Deal path, template, underwriting, and DocuSign states should feel like a pipeline.
- Contract actions should be guarded and auditable.

Settings:

- Provider readiness belongs here.
- Keep configuration dense but legible.

## Do Not Do

- Do not replace the command center with a generic SaaS dashboard.
- Do not introduce a second visual identity.
- Do not default to purple gradients, plain white cards, or generic admin templates.
- Do not create a new navigation system unless explicitly requested.
- Do not make mobile changes that alter the desktop look.
- Do not hardcode secrets, provider keys, webhook URLs, or JWT-shaped values.

## Required Verification For UI Changes

Before calling a UI change done:

1. Run `npm run build`.
2. Run the relevant smoke test, usually `npm run test:hosted` or `npm run test:e2e:browseros`.
3. Check mobile width around 390px for overflow.
4. Confirm the current modern UI/UX is preserved.

