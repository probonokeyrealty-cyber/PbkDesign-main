# PBK Command Center · Paradise Design System Prompt

You are building UI for the PBK Command Center — a wholesale-real-estate AI operating system. Every component you generate must match the **Paradise** design language defined below. This is non-negotiable. If a request seems to conflict with this spec, follow the spec.

This document supersedes any prior "modern shell" or "dark dashboard" prompts. The aesthetic is **mission-control cockpit**, not generic SaaS admin.

---

## CORE PHILOSOPHY

Five rules that decide every choice:

1. **Honest about scope.** Real bridge data only. No mock APIs, no invented Supabase tables, no placeholder data dressed as production. If a feature isn't wired, mark it visibly with a `<DemoTag />` component and a one-line caption that says exactly what's missing.
2. **Editorial display, technical body.** Headlines use Fraunces italic for emphasis (the italic word is the emotional center). Body uses Geist. Data and labels use JetBrains Mono. Three fonts, three roles — never blur them.
3. **Sky is the brand.** `#7DD3FC` is the primary accent everywhere. Not Tailwind `blue-500`, not `#3B82F6`. The sky-glow background `rgba(125, 211, 252, 0.15)` is the active/hover/focus indicator.
4. **Hierarchy through color, not size.** Critical (live calls, money, urgent approvals) uses semantic accents — lime for money/wins, crimson for live/DNC/errors, amber for pending/warnings, magenta for human-takeover/probate. Routine system health stays muted — mono labels in `--text-tertiary`.
5. **One italic per heading.** "The _call floor_." not "_The_ call floor." The italicized word carries the emphasis. Restrain to one per title.

---

## DESIGN TOKENS

Copy this `:root` block into your global stylesheet. Reference variables by name — never hard-code hex values in components.

```css
:root {
  /* Backgrounds (darkest → lightest) */
  --bg-void: #06080b;
  --bg-console: #0b0e13;
  --bg-panel: #11151c;
  --bg-panel-elevated: #171c25;
  --bg-hover: #1d232e;

  /* Borders */
  --border-dim: #1c222c;
  --border: #2a3140;
  --border-bright: #3b4352;

  /* Text */
  --text-primary: #e8edf4;
  --text-secondary: #9aa4b4;
  --text-tertiary: #5a6372;
  --text-ghost: #38404d;

  /* Sky — primary brand */
  --sky: #7dd3fc;
  --sky-bright: #bae6fd;
  --sky-dim: #38bdf8;
  --sky-deep: #0284c7;
  --sky-glow: rgba(125, 211, 252, 0.15);
  --sky-glow-strong: rgba(125, 211, 252, 0.28);

  /* Semantic accents */
  --amber: #ffb020; /* pending, warming, caution */
  --amber-glow: rgba(255, 176, 32, 0.12);
  --ion: #38bdf8; /* info, secondary blue */
  --ion-glow: rgba(56, 189, 248, 0.12);
  --crimson: #f87171; /* errors, DNC, live */
  --crimson-deep: #ef4444;
  --crimson-glow: rgba(248, 113, 113, 0.12);
  --magenta: #e879f9; /* human takeover, probate */
  --magenta-glow: rgba(232, 121, 249, 0.12);
  --lime: #a3e635; /* deals closed, money, success */
  --lime-glow: rgba(163, 230, 53, 0.12);

  /* Typography */
  --font-display: 'Fraunces', 'Times New Roman', serif;
  --font-ui: 'Geist', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;

  /* Spacing */
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-5: 20px;
  --s-6: 24px;
  --s-8: 32px;
  --s-10: 40px;
  --s-12: 48px;
  --s-16: 64px;

  /* Radii */
  --radius-sm: 4px;
  --radius: 6px;
  --radius-lg: 10px;
  --radius-xl: 16px;
}
```

Required Google Fonts link in `<head>`:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,800&family=JetBrains+Mono:wght@400;500;600;700&family=Geist:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

If you skip these fonts, the whole aesthetic collapses. Fraunces is what makes the headlines feel editorial. Without it you get a generic Inter-default sans-serif and the design downgrades.

---

## TYPOGRAPHY PATTERNS

### Display titles (page heads, modal titles)

```tsx
<h1 className="font-display text-[56px] font-normal tracking-[-0.02em] leading-[1.05]">
  Good morning, Jordan.{' '}
  <em className="italic text-sky font-semibold">Your agents closed $18,240 overnight.</em>
</h1>
```

- 56px for page heroes, 32px for section h2, 22px for modal/card h3
- Always one italic per heading (the italic word is the emphasis)
- Italic color is `var(--sky)`, weight 600
- Tracking is tight (`-0.02em`), leading is tight (`1.05`)

### Eyebrows (above titles, section headers)

```tsx
<div className="font-mono text-[11px] tracking-[0.16em] uppercase text-sky">
  ▸ Mission Control · 2 active · 4 queued
</div>
```

- Prefix with `▸ ` (the sky-colored chevron is the visual signature)
- Uppercase, wide letter-spacing, mono font
- 11px for page eyebrows, 10px for section eyebrows

### Labels (form fields, table headers, meta strips)

```tsx
<label className="font-mono text-[10px] tracking-[0.12em] uppercase text-tertiary">
  Property address
</label>
```

- Always above the input, never inline
- Tertiary text color so they recede

### Data display (numbers, phone, addresses, timestamps)

```tsx
<span className="font-mono text-[12px] text-primary">+1 (614) 555-0142 · last used 2m ago</span>
```

- Monospace for ALL numeric/data display — never Geist for phone numbers, ARV values, percentages

### Body copy (paragraphs, descriptions)

```tsx
<p className="font-ui text-[14px] leading-[1.5] text-primary">
  Every AI agent — live calls, campaigns, learning — at a glance.
</p>
```

- Geist for prose, never JetBrains Mono
- Secondary text color for sub-headings and explanations

---

## COMPONENT TAXONOMY

### Buttons

Five variants, never improvise more:

```tsx
// Primary CTA — one per page
<button className="btn btn-primary">Send to Ava</button>

// Secondary actions
<button className="btn btn-ghost">Cancel</button>

// Destructive
<button className="btn btn-danger">Archive</button>

// Affirmative high-stakes (call now, send, approve)
<button className="btn btn-success">▶ Call Now</button>

// Hero CTAs (compose, start batch)
<button className="btn btn-sky-gradient">+ Compose</button>
```

CSS (port directly):

```css
.btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: 8px 16px;
  border-radius: var(--radius);
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-primary {
  background: var(--sky);
  color: var(--bg-void);
  border-color: var(--sky);
}
.btn-primary:hover {
  background: var(--sky-bright);
  box-shadow: 0 0 12px var(--sky-glow-strong);
}
.btn-ghost {
  color: var(--text-secondary);
}
.btn-ghost:hover {
  color: var(--text-primary);
  border-color: var(--border-bright);
  background: var(--bg-hover);
}
.btn-danger {
  background: var(--crimson-deep);
  border-color: var(--crimson-deep);
}
.btn-danger:hover {
  background: var(--crimson);
}
.btn-success {
  background: linear-gradient(135deg, var(--lime), #84cc16);
  color: var(--bg-void);
  border-color: #84cc16;
  font-weight: 700;
  box-shadow: 0 4px 12px rgba(163, 230, 53, 0.25);
}
.btn-sky-gradient {
  background: linear-gradient(135deg, var(--sky-deep), var(--sky-dim));
  color: white;
  border-color: var(--sky-dim);
  font-weight: 600;
  box-shadow: 0 4px 12px rgba(125, 211, 252, 0.2);
}
```

**Do NOT use Tailwind's `bg-blue-500`, `bg-emerald-500`, or shadcn's default button variants.** These produce the downgraded look. Use the classes above.

### Chip buttons (filter tabs)

```tsx
<button className="chip-btn active">All · 12</button>
<button className="chip-btn">Calls · 5</button>
```

Active state uses sky-glow background. Mono, uppercase-ish, 10px.

### Status chips (lead/call lifecycle)

Seven variants, semantically color-coded:

```tsx
<span className="status-chip new">New</span>          {/* ion blue */}
<span className="status-chip neg">Negotiating</span>  {/* amber */}
<span className="status-chip sent">Sent</span>        {/* magenta */}
<span className="status-chip won">Won</span>          {/* lime */}
<span className="status-chip signed">Signed</span>    {/* sky */}
<span className="status-chip cold">Cold</span>        {/* gray */}
<span className="status-chip live">Live</span>        {/* crimson + pulsing dot */}
```

The `.live` variant has a pulsing crimson dot — this is essential cinematic detail. Don't skip the animation.

### Score pills (lead scores 0-100)

Color-bucketed by value:

- `.hot` ≥80 → lime
- `.warm` ≥60 → sky
- `.cool` ≥40 → amber
- `.cold` <40 → gray

```tsx
<span className="score-pill hot">94</span>
```

### Lead tags (property attributes)

```tsx
<span className="tag probate">Probate</span>   {/* magenta */}
<span className="tag absentee">Absentee</span> {/* ion */}
<span className="tag vacant">Vacant</span>     {/* amber */}
<span className="tag pre-fc">Pre-FC</span>     {/* crimson */}
<span className="tag hot">Hot</span>           {/* lime */}
```

### Page status pills (honest about feature state)

Critical for the "honest about scope" principle:

```tsx
<span className="page-status-pill production">Production</span>    {/* lime */}
<span className="page-status-pill partial">Partial integration</span> {/* amber */}
<span className="page-status-pill concept">Concept · design only</span> {/* magenta */}
```

Use these on every page header so operators know what to trust. A page wired to real Mastra endpoints gets `.production`. A page with partial bridge wiring gets `.partial`. A pure UI concept gets `.concept`.

### Demo tag (inline, on partial features)

```tsx
<span className="demo-tag">Demo</span>
<span className="text-mono text-[11px] text-tertiary">
  No real message is sent — wired to Telnyx/Instantly in production.
</span>
```

Every demo-only action must pair the tag with a clarifying caption. Never use Demo as a shrug.

### Avatars (agents)

Gradient circles with Fraunces italic initial:

```tsx
<div className="avatar">A</div>          {/* sky → ion: Ava */}
<div className="avatar magenta">R</div>  {/* magenta → ion: Rex */}
<div className="avatar lime">N</div>     {/* lime → sky: Nora */}
<div className="avatar amber">Z</div>    {/* amber → crimson: Zed */}
```

### Toasts

Four variants, left-border accent:

```tsx
<div className="toast success">
  <div className="icon">✓</div>
  <div className="body">
    <div className="title">SMS sent</div>
    <div className="desc">Delivered to Diane Kowalski via Telnyx</div>
  </div>
</div>
```

Variants: `.success` (lime), `.error` (crimson), `.warning` (amber), `.info` (sky). Backdrop blur for glass effect.

---

## PAGE-LEVEL PATTERNS

### Page head (top of every route)

```tsx
<div className="page-head">
  <div className="page-head-left">
    <div className="page-head-tag-row">
      <span className="ph-tag">▸ Mission Control · 2 active · 4 queued</span>
      <span className="page-status-pill production">Production</span>
    </div>
    <h2 className="font-display text-[32px] font-normal tracking-tight">
      The <em className="italic text-sky font-semibold">call floor</em>.
    </h2>
    <p className="text-secondary text-[13px] mt-1">
      Every live AI call on one screen. Read the transcript, watch sentiment, barge in, or let Ava
      close.
    </p>
  </div>
  <div className="page-head-actions">
    <button className="btn btn-ghost">Call history</button>
    <button className="btn btn-ghost">Recordings</button>
    <button className="btn btn-primary">Start outbound batch</button>
  </div>
</div>
```

Every page opens with this exact anatomy: eyebrow + (optional status pill) + display title with italic emphasis + lede paragraph + actions cluster. No exceptions.

### Hero numbers (signature data display)

Big Fraunces with italic dollar sign or key digit:

```tsx
<div className="hero-num">$<em className="italic text-sky font-semibold">91,500</em></div>
<div className="font-mono text-[11px] text-lime mt-1.5">▼ from $95,000 anchor</div>
```

Use this for MAO, monthly revenue, deal count — any single number that needs to dominate visually.

### Sidebar rail

76px collapsed, 220px expanded. Icon-only by default. Active item has a sky pin on the left and sky-glow background. Notification counts appear as amber `.ct` badges.

```tsx
<aside className="nav-rail-sample">
  <div className="rail-logo">P</div>
  <div className="rail-item active">
    <svg>...icon...</svg>
    <span className="ct">3</span>
  </div>
</aside>
```

### Topbar (56px)

Operational state, not just utility:

- Breadcrumb on the left
- Global search with ⌘K hint in the middle
- **Mode picker** (Auto / Approval / Manual) with active state in amber — this is the autopilot indicator
- Theme toggle, notification bell with amber dot for unread
- Avatar

The mode picker is non-negotiable — it shows operational state and has real consequences.

---

## LAYOUT PRINCIPLES

### Weighted hierarchy

Not everything is equally important. Make priority obvious:

- **Critical** (live calls, urgent approvals, money): larger cards, semantic-color borders, hero numbers
- **Notable** (recent activity, agent status): standard panels, sky accents
- **Routine** (system health, deploy version): mono badges in muted tertiary text

A $300k hot lead and a bridge heartbeat must NOT look visually equal. The hot lead dominates; the heartbeat lives in a small mono badge.

### Live system feel

A command center should feel active even when idle:

- Pulsing crimson dot on `.status-chip.live`
- Sky-glow on active rail items
- Subtle hover lift on cards (`transform: translateY(-1px)` on btn-success/btn-sky-gradient)
- Real bridge polling with smooth transitions when data changes (no jarring re-renders)

### Empty states with personality

When a list is empty, the empty state itself is a status:

- "No approvals waiting · Ava is clear to continue"
- "No failed sends today · bridge healthy"
- "No callbacks due in next 2h"

Never a blank panel or a stark "no data" placeholder. Always a sentence that tells the operator absence is intentional.

```tsx
<div className="empty-state">
  <div className="font-mono text-[11px] text-tertiary tracking-wider">
    ◯ No approvals waiting · Ava is clear to continue
  </div>
</div>
```

### Mobile fallbacks

Tables don't survive <720px. Replace with stacked cards using `.lmc-card` pattern. Score pill + name + address + ARV + status + last touch, with a floating call icon in the top-right.

---

## CODING CONVENTIONS

### TypeScript + React

- Function components with named exports
- Props interfaces: `XxxProps`
- Tailwind utilities for layout; PBK CSS classes (`.btn`, `.status-chip`, etc.) for design tokens
- **Do NOT use shadcn/ui Button, Card, or Badge defaults** — they encode a different design system. Build with PBK classes.
- **Do NOT use Tailwind color utilities for accents** — no `text-blue-500`, `bg-emerald-500`, `border-red-400`. Use `text-[var(--sky)]`, `bg-[var(--lime-glow)]`, etc.

### Real bridge wiring

Every component that displays data must use `useRuntimeSnapshot()` or `invokeRuntimeTool()`. If you find yourself writing `const mockLeads = [...]` to populate UI, stop. Pair with a `<DemoTag />` and a caption explaining what bridge endpoint is missing.

### Loading states

Skeleton shimmer for initial load (220ms fade-in). Don't show spinners on initial paint — show skeleton blocks that match the final layout.

### Error states

Red-bordered panel with retry button. Never silent failures.

```tsx
{
  error && (
    <div className="border border-crimson bg-[var(--crimson-glow)] rounded-md p-4 flex justify-between items-center">
      <span className="text-crimson font-mono text-[12px]">{error}</span>
      <button onClick={retry} className="btn btn-ghost">
        Retry
      </button>
    </div>
  );
}
```

---

## EXAMPLE COMPONENT (canonical reference)

```tsx
import { useState } from 'react';
import { useRuntimeSnapshot } from '@/hooks/useRuntimeSnapshot';
import { invokeRuntimeTool } from '@/lib/bridge';

interface CallFloorProps {
  agentId?: string;
}

export function CallFloor({ agentId }: CallFloorProps) {
  const { activeCalls, isLoading, error } = useRuntimeSnapshot();
  const [callingId, setCallingId] = useState<string | null>(null);

  const handleTakeover = async (callId: string) => {
    setCallingId(callId);
    try {
      await invokeRuntimeTool('callTakeover', { callId });
    } finally {
      setCallingId(null);
    }
  };

  return (
    <div className="page-head">
      <div className="page-head-left">
        <div className="page-head-tag-row">
          <span className="ph-tag">
            ▸ Mission Control · {activeCalls?.active ?? 0} active · {activeCalls?.queued ?? 0}{' '}
            queued
          </span>
          <span className="page-status-pill production">Production</span>
        </div>
        <h2 className="font-display text-[32px] tracking-tight">
          The <em className="italic text-sky font-semibold">call floor</em>.
        </h2>
        <p className="text-secondary text-[13px] mt-1">Every live AI call on one screen.</p>
      </div>
      <div className="page-head-actions">
        <button className="btn btn-ghost">Call history</button>
        <button className="btn btn-primary">Start outbound batch</button>
      </div>

      {isLoading && <div className="skeleton-shimmer h-32 mt-6 rounded-lg" />}
      {error && (
        <div className="border border-crimson bg-[var(--crimson-glow)] rounded-md p-4 mt-4">
          <span className="text-crimson font-mono text-[12px]">{error}</span>
        </div>
      )}
      {!isLoading && !error && activeCalls?.calls?.length === 0 && (
        <div className="font-mono text-[11px] text-tertiary mt-8 text-center">
          ◯ No active calls · queue is clear
        </div>
      )}
      {/* Real call cards render here from activeCalls.calls */}
    </div>
  );
}
```

This component: uses real bridge data, has a proper page head with eyebrow + italic title, shows skeleton on load, error in crimson, intentional empty state. No mock data. No shadcn defaults. No Tailwind blue accents.

---

## WHAT NOT TO DO

1. **Do not import shadcn/ui Button, Card, Badge, Dialog defaults.** They encode generic dashboard aesthetics. Build with PBK classes.
2. **Do not use Tailwind `bg-blue-500`, `text-emerald-500`, `border-red-500`** for semantic accents. Use the CSS variables.
3. **Do not use Inter or Roboto for headlines.** Fraunces is mandatory for display text. Without it, headlines lose their editorial soul.
4. **Do not use glass-morphism (`backdrop-blur-xl bg-white/5`) on panels.** Our panels are flat solid `bg-panel`. The only place backdrop-blur lives is on toasts.
5. **Do not use rounded-2xl or rounded-3xl on cards.** Our radii: 4px (chips), 6px (buttons, inputs), 10px (cards, modals), 16px (Ava panel only).
6. **Do not use generic empty state text** like "No data" or "Nothing here yet." Write empty states as status sentences ("No approvals waiting · Ava is clear").
7. **Do not omit page status pills.** Every route must declare production/partial/concept honestly.
8. **Do not generate fake data, fake API endpoints, fake Supabase tables.** If a bridge endpoint doesn't exist, pair the UI with a Demo tag + caption.
9. **Do not over-bullet, over-card, or over-grid.** Visual weight comes from semantic color and italic typography, not from boxes-within-boxes.
10. **Do not skip the mode picker on the topbar.** Auto/Approval/Manual is operationally important — show it as the active autopilot state.

---

## WHEN IN DOUBT

If a component decision isn't covered here, ask: _would this fit alongside the existing PBK Paradise components_ (page-head with italic title, status chips with semantic colors, score pills color-bucketed, hero Fraunces numbers)? If yes, ship it. If it would feel like it belongs to a different product, redesign before shipping.

Reference the standalone style guide at `pbk-styleguide-v2.html` (the v2 reference doc with foundation + components + tables + forms + modals + data viz + navigation chrome + voice) for the full visual vocabulary. Every pattern there is canonical.

Now build components that feel like PBK's operating room — editorial, technical, alive, and unmistakably mission-control.
