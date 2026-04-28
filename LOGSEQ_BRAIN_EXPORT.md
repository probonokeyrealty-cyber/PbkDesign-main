# PBK to Logseq Brain Export

This project now includes a one-way founder-safe export from the PBK runtime into Logseq-style markdown pages.

## Why this exists

PBK's source of truth stays in the bridge runtime and Postgres:

- deals
- approvals
- contracts
- activity
- provider state

The Logseq layer is intentionally read-friendly, not transactional. It gives Codex, OpenClaw, and future agents a stable markdown memory surface for:

- research summaries
- deal recaps
- founder notes
- runtime/provider snapshots

## Command

```powershell
cd "C:\Users\Dell\Documents\New project 2\PbkDesign-main"
npm run brain:export
```

## What it writes

- Repo graph root:
  - [brain-export](C:\Users\Dell\Documents\New%20project%202\PbkDesign-main\brain-export)
- OpenClaw workspace mirror:
  - [C:\Users\Dell\.openclaw\workspace\brain-export](C:\Users\Dell\.openclaw\workspace\brain-export)

The exporter creates:

- `pages/generated/PBK Brain Home.md`
- `pages/generated/Research Library.md`
- `pages/generated/Deal Recaps.md`
- `pages/generated/Contracts Pipeline.md`
- `pages/generated/Provider Status.md`
- `pages/generated/OpenClaw Runtime.md`
- `pages/generated/Founder Activity.md`
- generated research pages
- generated deal recap pages
- `journals/generated/<YYYY-MM-DD>.md`

## Source order

The exporter tries these sources in order:

1. hosted bridge at `PBK_HOSTED_BRIDGE_URL` or `https://pbk-openclaw-bridge.onrender.com`
2. local bridge at `PBK_LOCAL_BRIDGE_URL` or `http://127.0.0.1:8788`
3. local state file at `.pbk-local/openclaw-state.json`

If `PBK_BRIDGE_API_KEY` is present, it is sent automatically for protected endpoints.

## Safe usage

- This is a one-way export.
- It does not mutate PBK deal state.
- It is safe to refresh repeatedly.
- Generated pages are kept under `generated/` so future manual notes can live alongside them without being overwritten.
