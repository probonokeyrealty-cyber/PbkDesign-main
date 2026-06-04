# PBK Command Center — Starter Kit

Everything Codex needs to render PBK components correctly. Five files, zero ambiguity.

## Files

| File                           | What it does                                                                                   | Where to put it                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| `pbk-tokens.css`               | Design tokens (colors, fonts, spacing, radii, animations)                                      | `src/styles/pbk-tokens.css`     |
| `pbk-components.css`           | All component CSS classes (buttons, chips, status, tags, scores, toasts, panels, inputs, etc.) | `src/styles/pbk-components.css` |
| `tailwind.pbk.config.ts`       | Tailwind theme extension mapping PBK tokens                                                    | Merge into `tailwind.config.ts` |
| `pbk-components.tsx`           | Typed React components (PbkButton, PbkStatusChip, PbkScorePill, PbkPageHead, etc.)             | `src/components/pbk/index.tsx`  |
| `pbk-paradise-codex-prompt.md` | Design system prompt for Codex — paste into your AI assistant                                  | Root of repo or `.cursorrules`  |

## Setup (3 steps)

### 1. Import CSS (order matters)

In your global entry point (`src/app/layout.tsx` or `src/index.css`):

```css
@import './styles/pbk-tokens.css'; /* MUST be first */
@import './styles/pbk-components.css';
```

Or in your layout component:

```tsx
import '../styles/pbk-tokens.css';
import '../styles/pbk-components.css';
```

### 2. Add fonts to `<head>`

In your `index.html` or Next.js `layout.tsx`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,800&family=JetBrains+Mono:wght@400;500;600;700&family=Geist:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

**If you skip this step, Fraunces doesn't load and headlines render in generic sans-serif. That's the #1 reason the design looks "downgraded."**

### 3. Extend Tailwind config

```ts
// tailwind.config.ts
import { pbkTheme, pbkSafelist, pbkContentPaths } from './tailwind.pbk.config';

export default {
  content: ['./src/**/*.{ts,tsx}', ...pbkContentPaths],
  safelist: [...pbkSafelist],
  theme: {
    extend: {
      ...pbkTheme,
    },
  },
};
```

## Usage

### Import components

```tsx
import {
  PbkButton,
  PbkStatusChip,
  PbkScorePill,
  PbkTag,
  PbkPageHead,
  PbkPanel,
  PbkAvatar,
  PbkChip,
  PbkInput,
  PbkField,
  PbkToggle,
  PbkToast,
  PbkEmpty,
  PbkSkeleton,
  PbkErrorBanner,
  PbkPulseDot,
  PbkPageStatus,
  PbkDemoTag,
  PbkDataSource,
} from '@/components/pbk';
```

### Page head (every route)

```tsx
<PbkPageHead
  eyebrow="Mission Control · 2 active · 4 queued"
  title={
    <>
      The <em>call floor</em>.
    </>
  }
  description="Every live AI call on one screen."
  status="production"
  statusLabel="Production"
  actions={
    <>
      <PbkButton variant="ghost">Call history</PbkButton>
      <PbkButton variant="primary">Start outbound batch</PbkButton>
    </>
  }
/>
```

### Buttons

```tsx
<PbkButton variant="primary">Send to Ava</PbkButton>
<PbkButton variant="ghost">Cancel</PbkButton>
<PbkButton variant="danger">Archive</PbkButton>
<PbkButton variant="success">▶ Call Now</PbkButton>
<PbkButton variant="sky-gradient">+ Compose</PbkButton>
```

### Status chips

```tsx
<PbkStatusChip status="live">Live</PbkStatusChip>
<PbkStatusChip status="won">Won</PbkStatusChip>
<PbkStatusChip status="pending">Pending</PbkStatusChip>
```

### Score pills (auto-bucketed)

```tsx
<PbkScorePill score={94} />  {/* → lime (hot) */}
<PbkScorePill score={71} />  {/* → sky (warm) */}
<PbkScorePill score={52} />  {/* → amber (cool) */}
<PbkScorePill score={28} />  {/* → gray (cold) */}
```

### Lead tags

```tsx
<PbkTag variant="probate">Probate</PbkTag>
<PbkTag variant="vacant">Vacant</PbkTag>
<PbkTag>Skip-traced</PbkTag>
```

### Panels with priority

```tsx
<PbkPanel priority="live">Active call card</PbkPanel>
<PbkPanel priority="high">Pending approval</PbkPanel>
<PbkPanel priority="money">Revenue card</PbkPanel>
<PbkPanel priority="low">System health</PbkPanel>
```

### Form fields

```tsx
<PbkField label="Property address" required help="Type to autocomplete from BatchData.">
  <PbkInput placeholder="202 Cherry Ln, Columbus OH" />
</PbkField>

<PbkField label="Phone" required error="Must be 10 digits">
  <PbkInput error placeholder="(330) 555-..." />
</PbkField>
```

### Loading + error states

```tsx
{
  isLoading && <PbkSkeleton variant="card" />;
}
{
  error && <PbkErrorBanner message={error} onRetry={refetch} />;
}
{
  !isLoading && !error && items.length === 0 && (
    <PbkEmpty variant="ok" title="No approvals waiting" description="Ava is clear to continue" />
  );
}
```

### Data source caption (honest endpoint label)

```tsx
<PbkDataSource endpoint="snapshot.approvals" status="ships" />
<PbkDataSource endpoint="GET /api/founder/work-queue" status="needs-wiring" note="proposed" />
```

## What NOT to do

1. **Do not import shadcn/ui Button, Card, Badge, Dialog defaults.** Use PBK components.
2. **Do not use Tailwind `bg-blue-500`, `text-emerald-500`** for semantic accents. Use `bg-pbk-sky`, `text-pbk-lime`, or the CSS variables.
3. **Do not use Inter for headlines.** Fraunces is mandatory for display text.
4. **Do not use glass-morphism on panels.** Panels are flat solid `bg-panel`. Only toasts use backdrop-blur.
5. **Do not use rounded-2xl on cards.** Our radii: 4px chips, 6px buttons, 10px cards, 16px floating.
6. **Do not generate fake data.** Pair unwired features with `<PbkDemoTag caption="No real send — wired in production" />`.

## Visual reference

Open `pbk-styleguide-v2.html` alongside Codex as the full visual reference. It contains live renders of every component with copy-paste markup.

## Color quick reference

| Token       | Hex       | Usage                               |
| ----------- | --------- | ----------------------------------- |
| `--sky`     | `#7DD3FC` | Primary brand, active states, links |
| `--lime`    | `#A3E635` | Money, success, deals closed        |
| `--amber`   | `#FFB020` | Pending, warming, caution           |
| `--crimson` | `#F87171` | Errors, DNC, live calls             |
| `--magenta` | `#E879F9` | Human takeover, probate, Rex        |
| `--ion`     | `#38BDF8` | Info, secondary blue                |

## Font quick reference

| Font           | Role                 | Example                                 |
| -------------- | -------------------- | --------------------------------------- |
| Fraunces       | Display headlines    | `The *call floor*.`                     |
| Geist          | Body UI text         | Paragraphs, descriptions                |
| JetBrains Mono | Data, labels, stamps | Phone numbers, timestamps, field labels |
