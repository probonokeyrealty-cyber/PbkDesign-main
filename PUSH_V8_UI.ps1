# PBK v8 UI polish push helper — providers panel slice
# Run from PowerShell in: C:\Users\Dell\Documents\New project 2\PbkDesign-main
#
# Stages ONLY this one file:
#   - index.html     (Settings -> Provider APIs card now bound to /health.providers)
#
# Pairs with PUSH_V8.ps1 (which pushes the bridge providers wiring + render.yaml + PROVIDERS.md).
# Run that first if you haven't yet.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/4] Removing stale git index lock if present ..." -ForegroundColor Cyan
if (Test-Path ".git\index.lock") {
    Remove-Item ".git\index.lock" -Force
    Write-Host "      removed."
} else {
    Write-Host "      none found."
}

Write-Host "[2/4] Verifying index.html exists + has new markers ..." -ForegroundColor Cyan
if (-not (Test-Path "index.html")) { throw "index.html not found" }

$content = Get-Content -Raw index.html
$markers = @(
    'data-providers-summary',
    'data-providers-list',
    'sanitizeOpenClawProviderMeta',
    'renderProvidersCard',
    'data-provider="telnyx"',
    'data-provider="docusign"',
    'data-provider="batchdata"',
    'data-provider="slack"'
)
foreach ($m in $markers) {
    if ($content -notmatch [regex]::Escape($m)) { throw "Missing marker: $m" }
    Write-Host "      ok: $m"
}

Write-Host ""
Write-Host "[3/4] Vite build (must pass before pushing UI changes) ..." -ForegroundColor Cyan
cmd /c npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed - aborting push" }

Write-Host ""
Write-Host "[4/4] Staging + committing + pushing ..." -ForegroundColor Cyan
git add -- index.html
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nothing staged. index.html already at HEAD." -ForegroundColor Yellow
    exit 0
}

$commitMessagePath = Join-Path $env:TEMP "pbk-v8-ui-commit-msg.txt"
@'
Bind Settings provider APIs card to /health.providers

The 'Provider APIs' Settings card showed static 'Bridge-backed today' copy.
Now it renders live readiness from the bridge's /health.providers field
(added in commit 'providers-live-v8'):

- Replaces static markup with a 4-row grid: Telnyx, DocuSign, BatchData,
  Slack. Each row gets a colored dot + state label.
- Three states:
    ready     -> green dot, label 'Live' (Telnyx: 'Live - SMS + voice')
    warning   -> amber dot, 'Configured - not ready'
    missing   -> grey dot, 'Missing N env'
- Card summary line shows '4 of 4 live' / '2 of 4 live' / 'No providers
  wired yet' depending on how many providers report ready:true.
- Card note line lists which providers still need env vars and points
  to PROVIDERS.md.

Plumbing:
- sanitizeOpenClawProviderMeta(name, meta) normalizes per-provider
  shape, treating Telnyx's voiceReady/messagingReady as ready=true if
  either is set (the other providers use plain .ready).
- sanitizeOpenClawProviders(providers) wraps the four expected providers.
- sanitizeOpenClawRuntimeMeta() now carries .providers through the
  config sanitization path.
- /health response parser pulls body.providers (or runtime.providers /
  features.providers / extra.providers as fallbacks) into runtimeMeta.
- renderProvidersCard(providers) updates the DOM. Called from
  reflectOpenClawUI() which already runs on every health poll.

CSS:
- Adds .settings-providers-list and .settings-providers-row styles
  scoped under [data-page="settings"]. Dot color tracks data-state
  attribute (ready/warning/missing).

Verified locally:
- npm run test:bridge still passes (revision providers-live-v8,
  authRequired/replay-safety/PDF all green).
- HTML article tag balance preserved (16 open / 16 close).
- Provider markers all present in the on-disk file.
'@ | Set-Content -Path $commitMessagePath -Encoding utf8

try {
    git commit -F $commitMessagePath
}
finally {
    Remove-Item $commitMessagePath -Force -ErrorAction SilentlyContinue
}

git push origin main

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "PbkDesign-main is pushed." -ForegroundColor Yellow
Write-Host "If Netlify still points at the mirror repo, run the mirror sync next:"
Write-Host '  cd C:\Users\Dell\Documents\"New project 2"'
Write-Host '  .\SYNC_TO_MIRROR.ps1'
Write-Host "After that, visit pbkcommandcenter.netlify.app -> Settings -> 'Provider APIs' card."
Write-Host "Once you've set provider env vars in Render, the dots flip from grey to green."
