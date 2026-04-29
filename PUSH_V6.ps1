# PBK v6 commit + push helper — narrow scope
# Run from PowerShell in: C:\Users\Dell\Documents\New project 2\PbkDesign-main
#
# Stages ONLY these four files:
#   - scripts/openclaw-local-server.mjs   (bridge replay-safety, BUILD_REVISION v6)
#   - package.json                         (test:bridge / test:mcp / test:founder)
#   - scripts/openclaw-smoke.mjs           (smoke harness — Codex's, untracked)
#   - RELEASE_CHECKLIST.md                 (founder release checklist — Codex's, untracked)
#
# Everything else in the working tree (index.html, n8n-lite/*, public/*,
# src/imports/*, CallModeTab, supabase/, theme.css rename, etc.) is left alone.
# Those are mid-flight Codex changes — don't accidentally take them in this commit.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/5] Removing stale git index lock if present ..." -ForegroundColor Cyan
if (Test-Path ".git\index.lock") {
    Remove-Item ".git\index.lock" -Force
    Write-Host "      removed."
} else {
    Write-Host "      none found."
}

Write-Host "[2/5] Verifying expected files exist ..." -ForegroundColor Cyan
$expected = @(
    "scripts\openclaw-local-server.mjs",
    "package.json",
    "scripts\openclaw-smoke.mjs",
    "RELEASE_CHECKLIST.md"
)
foreach ($f in $expected) {
    if (-not (Test-Path $f)) { throw "Missing expected file: $f" }
    Write-Host "      ok: $f"
}

Write-Host "[3/5] Staging the narrow set ..." -ForegroundColor Cyan
git add -- scripts/openclaw-local-server.mjs
git add -- package.json
git add -- scripts/openclaw-smoke.mjs
git add -- RELEASE_CHECKLIST.md

Write-Host ""
Write-Host "[4/5] Cached diff (what will commit):" -ForegroundColor Cyan
git diff --cached --stat

Write-Host ""
$cached = git diff --cached --quiet; $LASTEXITCODE
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nothing staged. Working tree is clean for these files." -ForegroundColor Yellow
    exit 0
}

Write-Host "[5/5] Committing + pushing ..." -ForegroundColor Cyan
git commit -m "Add replay-safety to /events + founder test scripts

Bridge:
- BUILD_REVISION bumped to 2026-04-26-founder-replay-v6.
- handleEvent('lead-intake'): when payload.eventId is present and a
  prior leadImport already records that eventId, return
  {ok:true, replayed:true, leadImport: prior, eventId} immediately.
  No state mutation, no extra activity entry. Catches n8n retries.
- handleEvent('approval-callback'): when status/actor/actedAt all
  match the current approval's values, return
  {ok:true, replayed:true, approval} immediately. Same idempotency
  guarantee for the decision callback path.
- leadImport objects now carry eventId when one was sent.

Test layer:
- Adds three npm scripts to package.json:
    test:bridge   = node ./scripts/openclaw-smoke.mjs
    test:mcp      = cd mcp-server && tsc --noEmit
    test:founder  = build && test:mcp && test:bridge
- Includes scripts/openclaw-smoke.mjs (smoke harness asserting
  /health revision/auth/backend, 401 unauth, 200 auth, lead replay
  flag, approval replay flag, /invoke getBrainState, valid PDF from
  /api/documents/pdf).
- RELEASE_CHECKLIST.md captures the founder release gate.

Verified:
- npm run test:bridge passes end-to-end on the local bridge:
    revision: 2026-04-26-founder-replay-v6
    authRequired: true
    stateBackend: file
    leadReplaySafe: true
    approvalReplaySafe: true
    pdfBytes: 104716
- npm run test:mcp passes (mcp-server tsc --noEmit clean).
- node --check on the bridge passes."

git push origin main

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "What happens next:" -ForegroundColor Yellow
Write-Host "  - Render auto-deploys from this commit (Dockerfile.openclaw triggers a rebuild)."
Write-Host "  - Watch the Deploys tab on https://app.netlify.com/projects/pbkcommandcenter for Netlify if any frontend bits sneak in."
Write-Host "  - Verify the Render bridge:"
Write-Host '       curl https://pbk-openclaw-bridge.onrender.com/health | jq .'
Write-Host "    Expect:"
Write-Host '       revision: "2026-04-26-founder-replay-v6"'
Write-Host '       features.authRequired: true'
Write-Host '       features.stateBackend: "file"   (until PBK_DATABASE_URL is set)'
Write-Host ""
Write-Host "  - Then follow RENDER_POSTGRES_SETUP.md to flip to durable Postgres state."
