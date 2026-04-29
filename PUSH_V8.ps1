# PBK v8 commit + push helper — providers-live slice
# Run from PowerShell in: C:\Users\Dell\Documents\New project 2\PbkDesign-main
#
# Stages ONLY these three files:
#   - scripts/openclaw-local-server.mjs   (DocuSign JWT + envelope, BatchData skip-trace,
#                                          Slack webhook; revision -> 2026-04-26-providers-live-v8)
#   - render.yaml                         (declares 21 env vars total: Telnyx + DocuSign +
#                                          BatchData + Slack + existing core/state/n8n keys)
#   - PROVIDERS.md                        (operator setup runbook for all four providers)
#
# Untouched (Codex's mid-flight work): index.html, n8n-lite/*, CallModeTab, etc.

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
    "render.yaml",
    "PROVIDERS.md"
)
foreach ($f in $expected) {
    if (-not (Test-Path $f)) { throw "Missing expected file: $f" }
    Write-Host "      ok: $f"
}

Write-Host "[3/5] Staging the narrow set ..." -ForegroundColor Cyan
git add -- scripts/openclaw-local-server.mjs
git add -- render.yaml
git add -- PROVIDERS.md

Write-Host ""
Write-Host "[4/5] Cached diff (what will commit):" -ForegroundColor Cyan
git diff --cached --stat

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nothing staged. Working tree is clean for these files." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "[5/5] Committing + pushing ..." -ForegroundColor Cyan
git commit -m "Wire DocuSign, BatchData, Slack providers + render.yaml + PROVIDERS.md

Bridge (scripts/openclaw-local-server.mjs):
- BUILD_REVISION bumped to 2026-04-26-providers-live-v8.
- DocuSign: JWT auth (RSA-SHA256 sign via node:crypto, no extra deps),
  access-token caching with 60s skew, envelope create POSTs the deal
  package PDF (generated via the existing /api/documents/pdf path) as
  the envelope document. Falls back to stub when PBK_DOCUSIGN_*
  env vars aren't fully set.
- BatchData: real POST /api/v1/property/skip-trace with bearer auth,
  parses persons -> phoneNumbers / emails into the contact shape PBK
  already uses. Falls back to inferSkipTraceContact when not configured.
- Slack: real POST to PBK_SLACK_WEBHOOK_URL with text/blocks payload.
  Activity feed records pending status when not configured.
- /health surfaces .providers.{telnyx, docusign, batchdata, slack}
  with {configured, ready, missing} so the operator panel and
  monitors can show provider state.

render.yaml:
- 21 env vars total. New for this slice:
    PBK_PUBLIC_BASE_URL
    PBK_TELNYX_API_KEY, PBK_TELNYX_FROM_NUMBER, PBK_TELNYX_CONNECTION_ID,
      PBK_TELNYX_MESSAGING_PROFILE_ID, PBK_TELNYX_WEBHOOK_URL
    PBK_DOCUSIGN_INTEGRATION_KEY, PBK_DOCUSIGN_USER_ID,
      PBK_DOCUSIGN_ACCOUNT_ID, PBK_DOCUSIGN_AUTH_HOST,
      PBK_DOCUSIGN_REST_BASE, PBK_DOCUSIGN_PRIVATE_KEY
    PBK_BATCHDATA_API_KEY, PBK_BATCHDATA_BASE_URL
    PBK_SLACK_WEBHOOK_URL
- Inline comments document each provider's purpose and where to find
  the value (DocuSign integration page, BatchData dashboard, etc.)

PROVIDERS.md:
- Step-by-step setup for Telnyx (already wired by Codex), DocuSign
  (JWT auth + RSA keypair + impersonation consent), BatchData, Slack.
- Each provider section includes: env var table, /health verification
  one-liner, smoke-test invoke command, troubleshooting.

Verified locally:
- node --check passes.
- npm run test:bridge passes end-to-end:
    revision: 2026-04-26-providers-live-v8
    authRequired: true, leadReplaySafe: true, approvalReplaySafe: true
    pdfBytes: 104802
- /health.providers reports configured:false missing:[...] correctly
  for every unset provider. With env vars set, providers flip to
  configured:true ready:true."

git push origin main

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Render auto-redeploys from this commit (~2-3 min)."
Write-Host "  2. Verify revision flipped:"
Write-Host '       curl https://pbk-openclaw-bridge.onrender.com/health | jq .revision'
Write-Host "     should show: 2026-04-26-providers-live-v8"
Write-Host ""
Write-Host "  3. Wire whatever providers you want live by following PROVIDERS.md:"
Write-Host "     - Slack:     5 minutes (one webhook URL)"
Write-Host "     - BatchData: 5 minutes (one API key)"
Write-Host "     - DocuSign: ~15 minutes (RSA keypair + consent)"
Write-Host "     - Telnyx:    already wired (Codex commit c2b9f1c)"
Write-Host ""
Write-Host "  4. After each provider env var is saved on Render, recheck:"
Write-Host '       curl https://pbk-openclaw-bridge.onrender.com/health | jq .providers'
