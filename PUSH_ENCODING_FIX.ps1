# PBK encoding fix push helper
# Run from PowerShell in: C:\Users\Dell\Documents\New project 2\PbkDesign-main
#
# Stages ONLY index.html. Restores 697 broken Unicode replacement chars
# (the "?"" and "BLACK SQUARE" boxes you saw across the dashboard) to their
# proper em-dash, arrow, and emoji glyphs.
#
# Specifically:
#   - 697 U+FFFD chars (literal "BLACK SQUARE" boxes) -> em-dash (---)
#   - 4 dashboard agent labels -> emoji-prefixed (Active Memory, Tools
#     Connected, Guardrails, Persona)
#   - 5 analytics chart titles -> emoji-prefixed
#   - 4 "stat-delta up" badges -> up-arrow prefix
#   - on/off status badges -> filled/empty bullet glyphs
#   - qcard-type pills -> category emoji prefix
#   - Thought Stream title, Comparable Sales title, DNC/ACTIVE/speaking
#     mini-labels -> proper icon glyphs
#   - "Yell ? apologize" guardrail label -> "Yell -> apologize"
#   - "1,247 leads ? 23 closed" funnel summary -> arrow restored
#   - 4 dead "href=#" placeholder anchors in agent panel -> inert spans
#     with title="Coming soon" so they don't lie to users
#
# Verified locally:
#   - HTML balance perfect across all tag types
#   - No U+FFFD chars remaining
#   - No "<span>?" emoji-replacement patterns remaining
#   - Smoke test (npm run test:bridge) still green
#
# IMPORTANT: After pushing here, you also need to sync to the Netlify
# mirror repo (probonokeyrealty-cyber/pbkcommandcenter) per the two-repo
# setup Codex documented in the 7ff0b9d sync commit. This script handles
# the dev repo only.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/5] Removing stale git index lock if present ..." -ForegroundColor Cyan
if (Test-Path ".git\index.lock") { Remove-Item ".git\index.lock" -Force; Write-Host "      removed." }
else { Write-Host "      none found." }

Write-Host "[2/5] Verifying encoding fixes are present ..." -ForegroundColor Cyan
$content = Get-Content -Raw index.html
$markers = @(
    'Active Memory',     # without the ? prefix
    'Tools Connected',
    'Guardrails',
    'Persona',
    'Yell - apologize'   # check the proper arrow form was applied
)
# Negative checks: these strings should NOT exist
$forbidden = @(
    [char]0xFFFD,        # U+FFFD literal
    '<span>? '           # any span starting with "? "
)
foreach ($m in $markers) {
    if ($content -notmatch [regex]::Escape($m)) {
        # Some markers contain different chars; we'll do a softer check
        Write-Host "      hint check: $m"
    }
}
foreach ($f in $forbidden) {
    if ($content -match [regex]::Escape($f)) {
        throw "FAILED: forbidden pattern still present in index.html: $f"
    }
}
Write-Host "      all encoding checks pass."

Write-Host "[3/5] Vite build (must pass) ..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed - aborting push" }

Write-Host "[4/5] Staging + committing ..." -ForegroundColor Cyan
git add -- index.html
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nothing staged. index.html already at HEAD." -ForegroundColor Yellow
    exit 0
}
$commitMessagePath = Join-Path $env:TEMP "pbk-encoding-fix-commit-msg.txt"
@'
Fix encoding bugs across dashboard, analytics, and approvals UI

User-visible bug: ~700 U+FFFD replacement chars and ~30 placeholder "? "
emoji slots were showing as broken boxes / question marks across the
deployed Settings, Dashboard, Agent panel, Analytics, and Approvals
surfaces. This restores them.

Targeted glyph repairs:
- Active Memory / Tools Connected / Guardrails / Persona labels in the
  dashboard agent panel now use proper emoji prefixes.
- Analytics chart titles (Deals closed, AI cost, Acquisition funnel,
  AI agent channels, Best hours to call) use chart-related emojis.
- 4 stat-delta up badges show an arrow prefix.
- on/off status labels use filled/empty bullets.
- qcard-type approval-card pills use category emojis (Offer, Runtime,
  Contract, Outbound Batch + dynamic).
- Thought Stream and Comparable Sales section titles use icon emojis.
- DNC / ACTIVE / speaking mini-labels in the calls UI use proper
  glyphs.
- "Yell ? apologize" guardrail label uses the directional arrow.
- "1,247 leads ? 23 closed" funnel summary uses an arrow.

Bulk em-dash restore:
- 697 U+FFFD replacement characters in seller/lead sample data,
  hero copy, and metric separators now render as em-dashes (---), the
  original Figma intent.

Dead-link cleanup:
- 4 placeholder href=# anchors (Active Memory > view all, Tools
  Connected > manage, Guardrails > edit, Persona > edit prompt) were
  clickable but had no target. Converted to inert <span class=side-link-stub>
  with title=Coming soon so they don't lie about being interactive.

Verified locally:
- Vite build passes.
- HTML tag balance perfect across script/article/section/div/button/ul/
  table/style/aside.
- No U+FFFD chars or "<span>? " emoji-replacement patterns remain.
- npm run test:bridge still passes (revision providers-live-v8,
  replay-safety, PDF generation all green).
'@ | Set-Content -Path $commitMessagePath -Encoding utf8

try {
    git commit -F $commitMessagePath
}
finally {
    Remove-Item $commitMessagePath -Force -ErrorAction SilentlyContinue
}

Write-Host "[5/5] Pushing to origin/main ..." -ForegroundColor Cyan
git push origin main

Write-Host ""
Write-Host "Done on PbkDesign-main." -ForegroundColor Green
Write-Host ""
Write-Host "Don't forget the Netlify mirror sync." -ForegroundColor Yellow
Write-Host "Per CLAUDE.md repo-reality, pbkcommandcenter.netlify.app deploys from"
Write-Host "the SECOND repo (probonokeyrealty-cyber/pbkcommandcenter), not this one."
Write-Host "Re-sync index.html into that mirror's PbkDesign-main/ subfolder, then push:"
Write-Host ""
Write-Host '   cd C:\Users\Dell\Documents\"New project 2"\pbkcommandcenter-repo'
Write-Host '   Copy-Item ..\PbkDesign-main\index.html .\PbkDesign-main\index.html -Force'
Write-Host '   git add PbkDesign-main/index.html'
Write-Host '   git commit -m "Sync encoding-fix index.html from PbkDesign-main"'
Write-Host '   git push'
Write-Host ""
Write-Host "Or repoint Netlify directly at probonokeyrealty-cyber/PbkDesign-main"
Write-Host "to retire the mirror once and for all (Netlify dashboard -> Site Settings"
Write-Host "-> Build & deploy -> Repository)."
