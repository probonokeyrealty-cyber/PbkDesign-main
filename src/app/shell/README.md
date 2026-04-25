# Paradise Shell — `src/app/shell/`

Outer chrome of the Paradise UI. Wraps the engine; never modifies it.

## Files

- `ParadiseLayout.tsx` — sidebar + topbar + `<Outlet />`
- `Sidebar.tsx` — left nav rail (Command Center, Leads, Deal, Inbox, Settings)
- `ShellTopbar.tsx` — global search, Autopilot toggle stub, account chip
- `router.tsx` — React Router 7 `createBrowserRouter` config + `ParadiseRouter`

## Routes (live at `src/app/routes/`)

- `/` → `CommandCenter` (KPI tiles + LiveCallWidget + ActivityFeed placeholder)
- `/leads` → `Leads` (placeholder)
- `/deal` → `DealView` — **the seam**: mounts the existing engine `<App />`
- `/deal/:id` → `DealView` (will load deal by id once Supabase is wired)
- `/inbox` → `Inbox` (placeholder)
- `/settings` → `Settings` (placeholder)

## Entry points

- `index.html` + `src/main.tsx` — **engine-only** mount (`<App />`). Untouched. Live deploy still uses this.
- `index.shell.html` + `src/main.shell.tsx` — **shell mount** (`<ParadiseRouter />`). Open `http://localhost:5173/index.shell.html` after `npm run dev`.

## Sacred ground (do not touch)

- `src/app/utils/dealCalculations.ts`
- All components in `src/app/components/` (engine layer)
- `src/app/App.tsx`

The shell layer ONLY adds files. No engine file is modified by step (a) or (c).

## Step (c) additions — `LiveCallWidget`

`src/app/components/shell/LiveCallWidget.tsx` (NEW shell-layer component, NOT
in the engine `components/` root) — Bloomberg-style live call card:

- header: status badge (LIVE/HOLD/etc) + elapsed timer + Ava agent mode
- caller block: name, CRM context, phone, sentiment dial (0–100, color-coded)
- transcript: last N lines, auto-scrolls, color-tagged by speaker
- actions: Take Over / Mute Ava / End

Wired into `routes/CommandCenter.tsx`. Take Over uses `useNavigate` from
`react-router` to route to `/deal/:id` (or `/deal` if no dealId), which
mounts the engine `<App />` via `routes/DealView.tsx` — that's the seam.

State source today is a stub (`STUB_STATE` in the file) so the page demos
end-to-end. Phase 2 will swap the stub for an OpenClaw WebSocket subscription
following the same `LiveCallState` shape.

## Phase 1 LiveCallInputs status — already complete

The migration blueprint's "Phase 1 missing fields" list is OUTDATED. Verified
against current code (102 references in `LiveCallInputs.tsx`, 17 in `types.ts`):
all CF/MT/RBP/Cash/Land path fields and the universal Notes/Reductions/Vacant/
Confirmation block are already implemented. No engine field additions needed.
