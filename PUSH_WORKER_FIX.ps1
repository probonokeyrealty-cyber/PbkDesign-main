# PBK away-mode worker — parser fix push helper
# Run from PowerShell in: C:\Users\Dell\Documents\New project 2\PbkDesign-main
#
# Stages ONLY scripts/pbk-agent-worker.ps1.
#
# What's in this commit:
#   Get-OpenClawJson() was using $RawText.IndexOf('{') which grabbed the first
#   brace in the buffer. OpenClaw's stderr emits log lines like
#     [agent/embedded] embedded run agent end: ... rawError=Google ... (429): { "error": { ... } }
#   BEFORE the real final payload JSON. The first '{' was a log-line artifact,
#   not the actual payload, so ConvertFrom-Json choked and the worker reported
#   a parse failure even though the OpenAI fallback had completed successfully.
#
# Fix:
#   - Scan stderr for lines that are exactly '{' (markers of pretty-printed
#     multi-line JSON objects).
#   - Try the latest candidate first (the real payload is always at the end
#     of stderr, the log-line snippets come earlier).
#   - Fall back to the original first-brace heuristic only as a last resort
#     for output that has no `^{$` markers (e.g. single-line inline JSON).
#
# Verified locally:
#   - PowerShell parser passes on the worker script.
#   - Bridge smoke test still green (unrelated layer, but confirms nothing
#     else regressed).
#
# After pushing: run a manual pickup to confirm the full unattended lane
# completes end-to-end:
#
#   powershell -ExecutionPolicy Bypass `
#     -File .\scripts\pbk-agent-worker.ps1 `
#     -RepoPath C:\Users\Dell\pbk-agent-runner -IssueNumber 1
#
# Expected new behavior:
#   1. Gemini fails (429 quota).
#   2. Fallback to pbk-worker-openai profile succeeds.
#   3. Agent edits index.html, npm run build + test:founder pass.
#   4. Worker parses the OpenAI success payload from stderr (this commit).
#   5. Worker creates a PR via gh, comments on issue #1, removes agent/ready.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[1/5] Removing stale git index lock if present ..." -ForegroundColor Cyan
if (Test-Path ".git\index.lock") { Remove-Item ".git\index.lock" -Force; Write-Host "      removed." }
else { Write-Host "      none found." }

Write-Host "[2/5] Verifying worker file shape ..." -ForegroundColor Cyan
$worker = Get-Content -Raw "scripts\pbk-agent-worker.ps1"
$markers = @(
    'function Get-OpenClawJson',
    '[array]::Reverse($candidates)',
    'Last-chance: the original first-brace approach'
)
foreach ($m in $markers) {
    if ($worker -notmatch [regex]::Escape($m)) {
        throw "Missing marker: $m  (parser fix not in place)"
    }
    Write-Host "      ok: $m"
}

Write-Host "[3/5] PowerShell syntax check ..." -ForegroundColor Cyan
$null = [System.Management.Automation.PSParser]::Tokenize($worker, [ref]$null)
Write-Host "      parses clean."

Write-Host "[4/5] Staging + committing ..." -ForegroundColor Cyan
git add -- scripts/pbk-agent-worker.ps1
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nothing staged. Worker already at HEAD." -ForegroundColor Yellow
    exit 0
}

git commit -m "Fix away-mode worker parser to find the real OpenAI payload

The Gemini -> OpenAI fallback path was completing successfully end to
end (Gemini 429 -> OpenAI run -> agent edits index.html -> npm run
build / test:founder both pass), but the worker was reporting parse
failure and refusing to promote the result.

Root cause:
  Get-OpenClawJson() used `$RawText.IndexOf('{')` to find the start
  of the JSON payload. OpenClaw's stderr stream contains log lines
  with inline brace-rich snippets, e.g.:

    [agent/embedded] embedded run agent end: ... rawError=Google
    Generative AI API error (429): { 'error': { 'code': 429, ... } }

  The first '{' was inside that log-line snippet, not the real
  pretty-printed multi-line JSON payload that OpenClaw writes at the
  end of stderr after a successful run. ConvertFrom-Json then choked
  on the malformed substring and the worker fell into its 'parse
  failed' catch path.

Fix:
  - Find every line that is exactly '{' (with optional surrounding
    whitespace). These mark the start of pretty-printed multi-line
    JSON objects, which is exactly the shape OpenClaw uses for its
    final payload.
  - Try candidates from latest to earliest. The real payload is
    always the last one written to stderr; earlier candidates would
    only exist if there were multiple top-level objects, in which
    case the latest is still the freshest.
  - Fall back to the original first-brace heuristic only as a last
    resort, for output that has no '^{$' markers (e.g. single-line
    inline JSON).

This unblocks the full unattended pickup path. The fallback profile
itself was already wired correctly by Codex's earlier patches; only
the result-promotion step was failing.

Verified:
  - Worker script parses clean (PSParser).
  - Bridge smoke test (npm run test:bridge) still passes (unrelated
    layer, but confirms nothing else regressed).

To validate end-to-end after push, run a manual pickup:

  powershell -ExecutionPolicy Bypass \
    -File .\scripts\pbk-agent-worker.ps1 \
    -RepoPath C:\Users\Dell\pbk-agent-runner -IssueNumber 1"

Write-Host "[5/5] Pushing to origin/main ..." -ForegroundColor Cyan
git push origin main

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "Next step: validate end-to-end with a manual pickup." -ForegroundColor Yellow
Write-Host ""
Write-Host "  powershell -ExecutionPolicy Bypass ``"
Write-Host "    -File .\scripts\pbk-agent-worker.ps1 ``"
Write-Host "    -RepoPath C:\Users\Dell\pbk-agent-runner -IssueNumber 1"
Write-Host ""
Write-Host "Expected: ~5-7 minute run, agent edits index.html in the runner"
Write-Host "clone, build + tests pass, parser correctly extracts the success"
Write-Host "JSON, worker creates a PR and comments on issue #1."
