# Retire the Netlify mirror — repoint pbkcommandcenter directly at PbkDesign-main

Today PBK has a **two-repo deploy setup**:

```
   probonokeyrealty-cyber/PbkDesign-main      probonokeyrealty-cyber/pbkcommandcenter
   ─────────────────────────────────────       ─────────────────────────────────────────
   • dev repo                                  • Netlify deploy mirror
   • Render bridge auto-deploys from here      • Netlify auto-deploys from here
   • You push code here                        • You sync-push here AFTER every dev push
```

This works (Codex's `7ff0b9d` is the sync template, `SYNC_TO_MIRROR.ps1` automates the sync), but it's a foot-gun. Forget the sync once and the live frontend silently lags the dev repo. This doc retires the mirror by repointing Netlify directly at the dev repo. **One-time, ~5 minutes.**

## What changes

| Before | After |
|--------|-------|
| Netlify watches `pbkcommandcenter` repo | Netlify watches `PbkDesign-main` repo |
| You push to dev → run SYNC_TO_MIRROR → Netlify rebuilds | You push to dev → Netlify rebuilds. Done. |
| Two repos, two pushes | One repo, one push |
| Mirror stays as a backup but no one writes to it | Mirror becomes a frozen historical artifact |

The **live URL stays the same** (`pbkcommandcenter.netlify.app`). The Netlify project keeps its name and site ID. We're only changing what Git source it watches.

## Prerequisites

1. **Render bridge is healthy** — confirm `/health` shows `revision: providers-live-v8` (or newer). The repoint shouldn't affect Render, but be in a known-good state before changing anything.
2. **Dev repo (`PbkDesign-main`) has a clean root `netlify.toml`** that builds without a `base = "PbkDesign-main"` redirect. The current repo already has this — `netlify.toml` at the dev-repo root sets `command = "npm run build"` and `publish = "dist"`. Good as-is.
3. **No pending mirror-only changes** — make sure everything in the mirror also exists in the dev repo. If you're unsure, run `SYNC_TO_MIRROR.ps1` once first so you know the two are in sync, then proceed.

## Step-by-step

### 1. Open the Netlify project Build & Deploy settings

- https://app.netlify.com/projects/pbkcommandcenter/configuration/deploys
- Site Settings (gear icon) → **Build & deploy** in the left sidebar.

### 2. Disconnect from the current repo

- Scroll to **Continuous Deployment** section.
- Click **Manage repository** (or "Link to a different repository" depending on Netlify's current UI).
- Choose **Unlink** to disconnect from `pbkcommandcenter`.
- Confirm. The site stays live (last successful deploy keeps serving) — only the auto-deploy trigger disappears.

### 3. Reconnect to the new repo

- Click **Link repository**.
- **Authorize Netlify** for `probonokeyrealty-cyber` if prompted.
- Pick **`probonokeyrealty-cyber/PbkDesign-main`** from the list.
- **Branch**: `main`
- **Base directory**: leave blank (root). The dev repo's root has its own `netlify.toml` and `package.json`.
- **Build command**: should auto-fill to `npm run build` from `netlify.toml`. Confirm.
- **Publish directory**: should auto-fill to `dist`. Confirm.
- Save.

### 4. Trigger a fresh deploy

- **Deploys** tab → **Trigger deploy → Deploy site**.
- Watch the build. First-build expected duration: 2-3 minutes.
- Verify it goes green and the deploy permalink (`https://<deploy-id>--pbkcommandcenter.netlify.app`) renders cleanly.

### 5. Verify against production

```bash
curl -s https://pbkcommandcenter.netlify.app/ | grep -o '🧠 Active Memory'
# expect: 🧠 Active Memory   (the encoding-fix proof point)

curl -sI https://pbkcommandcenter.netlify.app/ | grep -i 'x-nf'
# expect: x-nf-request-id with a fresh deploy id
```

### 6. Test the new flow

- In `Documents\New project 2\PbkDesign-main`, make any tiny change to `index.html`.
- `git add`, `git commit -m "test: confirm Netlify auto-deploys from PbkDesign-main"`, `git push`.
- Open Netlify Deploys → there should be a new deploy queued within ~30 seconds, no `SYNC_TO_MIRROR.ps1` needed.

### 7. (Optional) Archive the mirror

Once a couple of weeks pass with no issues:
- Go to https://github.com/probonokeyrealty-cyber/pbkcommandcenter/settings
- Bottom of the page → **Archive this repository**.
- This freezes the mirror so nobody accidentally edits it expecting it to deploy.

## Rollback (if anything goes wrong)

The mirror still exists and still has the latest sync. If the new wiring breaks:

1. In Netlify → Build & deploy → **Manage repository** → re-link `pbkcommandcenter`.
2. **Trigger deploy → Deploy site**.
3. The mirror's most recent commit ships, traffic routes to the old wiring within ~3 minutes.
4. Then `SYNC_TO_MIRROR.ps1` continues to be the path until you're ready to retry.

## What this doesn't change

- **Render bridge** — watches `PbkDesign-main` already (via `render.yaml`). Untouched.
- **n8n workflows** — connected to webhooks at the bridge URL. Untouched.
- **GitHub Actions** in `PbkDesign-main/.github/` — already in the dev repo. Untouched.
- **Domain** — `pbkcommandcenter.netlify.app` stays. Custom domains (if any) stay.

## After the repoint

Update `CLAUDE.md` to remove the "Repo reality" callout. The two-repo setup is a temporary workaround; once retired, future Claude/Codex sessions don't need to know about it.

Suggested replacement copy for the CLAUDE.md callout:

> **Single-repo deploy.** As of 2026-04-XX, `pbkcommandcenter.netlify.app` deploys directly from `github.com/probonokeyrealty-cyber/PbkDesign-main` (one repo, one push). The old mirror at `pbkcommandcenter` is archived; do not push to it.
