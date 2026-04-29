# PBK bridge fix — commit + push helper
# Run from PowerShell in: C:\Users\Dell\Documents\New project 2\PbkDesign-main
#
# Why this script exists:
#   - I patched 3 files and added 1 file in this folder (Dockerfile.openclaw,
#     render.yaml, scripts/openclaw-local-server.mjs, .dockerignore).
#   - Code is verified — bridge boots, /health is 200, API-key gate works.
#   - The git index is currently held by a stale lock file (.git/index.lock)
#     that the sandbox can't delete due to Windows file ownership.
#   - This script removes the lock, commits the 4 files, pushes to main.

$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "[1/5] Removing stale git index lock (if present) ..." -ForegroundColor Cyan
if (Test-Path ".git\index.lock") {
    Remove-Item ".git\index.lock" -Force
    Write-Host "      removed."
} else {
    Write-Host "      (no lock present)"
}

Write-Host "[2/5] Verifying changed files exist ..." -ForegroundColor Cyan
$expected = @(
    "Dockerfile.openclaw",
    "render.yaml",
    "scripts\openclaw-local-server.mjs",
    ".dockerignore"
)
foreach ($f in $expected) {
    if (-not (Test-Path $f)) { throw "Missing expected file: $f" }
    Write-Host "      ok: $f"
}

Write-Host "[3/5] Staging changes ..." -ForegroundColor Cyan
git add -- Dockerfile.openclaw render.yaml scripts/openclaw-local-server.mjs .dockerignore
git status --short

Write-Host "[4/5] Committing ..." -ForegroundColor Cyan
git commit -m "Fix bridge container deps + add API key auth

Dockerfile.openclaw was copying only the bridge .mjs file with no
package install, so @sparticuz/chromium and puppeteer-core were never
present at runtime and the container crashed on boot. That's why Render
kept serving the older revision.

Changes:
- Dockerfile.openclaw: switch to node:22-slim, install Chrome runtime
  libs via apt, install @sparticuz/chromium@147.0.1 and
  puppeteer-core@24.41.0 directly (avoid pulling the frontend's React
  universe into the bridge image).
- .dockerignore: keep node_modules / dist / src / public / .git out of
  the build context.
- scripts/openclaw-local-server.mjs: add PBK_BRIDGE_API_KEY env. When
  set, all non-/health endpoints require Authorization: Bearer <key>.
  /health stays open so Render's healthCheckPath keeps working.
  Bumps BUILD_REVISION to 2026-04-26-bridge-auth-v3 and surfaces
  features.authRequired so the frontend can detect the gate.
- render.yaml: declare PBK_BRIDGE_API_KEY (sync:false, set in dashboard).

Verified locally:
  - node --check passes
  - bridge boots in --public mode, /health returns revision v3
  - 401 on /state and /invoke without auth
  - 401 on wrong key
  - 200 with correct Bearer token"

Write-Host "[5/5] Pushing to origin/main ..." -ForegroundColor Cyan
git push origin main

Write-Host ""
Write-Host "Done. Render should pick this up automatically." -ForegroundColor Green
Write-Host "Next steps:"
Write-Host "  1. In Render dashboard for pbk-openclaw-bridge:"
Write-Host "     - Set env var PBK_BRIDGE_API_KEY to a long random string."
Write-Host "       Generate one with: -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | %{[char]`$_})"
Write-Host "     - Wait for the rebuild (watch Deploys tab) until status = Live."
Write-Host "  2. Verify revision flipped:"
Write-Host "     curl https://pbk-openclaw-bridge.onrender.com/health"
Write-Host "     should show revision: 2026-04-26-bridge-auth-v3 and features.authRequired: true"
Write-Host "  3. In the live PBK app at pbkcommandcenter.netlify.app, Settings -> OpenClaw:"
Write-Host "     - endpoint: https://pbk-openclaw-bridge.onrender.com"
Write-Host "     - api key:  same value you set for PBK_BRIDGE_API_KEY"
