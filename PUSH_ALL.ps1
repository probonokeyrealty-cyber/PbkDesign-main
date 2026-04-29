# PBK launch push helper — bridge fix + MCP server
# Run from PowerShell in: C:\Users\Dell\Documents\New project 2\PbkDesign-main
#
# What this commits/pushes (depends on what's actually changed in your tree):
#   1. Bridge container fix:
#       - Dockerfile.openclaw  (rewritten: node:22-slim, installs deps)
#       - .dockerignore        (new)
#       - render.yaml          (adds PBK_BRIDGE_API_KEY env var)
#       - scripts/openclaw-local-server.mjs  (Bearer auth + revision bump)
#   2. PBK MCP server:
#       - mcp-server/          (whole subtree: package.json, tsconfig.json,
#         src/, README.md, .gitignore, .env.example)
#
# Render auto-deploys when the bridge files change.
# After push:
#   - Set PBK_BRIDGE_API_KEY in Render dashboard.
#   - Verify /health flips to revision 2026-04-26-bridge-auth-v3 with authRequired:true.
#   - Create the 'PBK Bridge Bearer' credential in n8n cloud (same key value).
#   - In mcp-server/, run: npm install && npm run build
#   - Wire dist/index.js into Claude Desktop / Cursor MCP config (see mcp-server/README.md).

$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "[1/6] Removing stale git index lock (if present) ..." -ForegroundColor Cyan
if (Test-Path ".git\index.lock") {
    Remove-Item ".git\index.lock" -Force
    Write-Host "      removed."
} else {
    Write-Host "      (no lock present)"
}

Write-Host "[2/6] What's changed in tracked + untracked files:" -ForegroundColor Cyan
git status --short

Write-Host ""
Write-Host "[3/6] Staging bridge fix + MCP server ..." -ForegroundColor Cyan

# Bridge fix (only stages if files actually changed)
$bridgeFiles = @(
    "Dockerfile.openclaw",
    ".dockerignore",
    "render.yaml",
    "scripts/openclaw-local-server.mjs"
)
foreach ($f in $bridgeFiles) {
    if (Test-Path $f) {
        git add -- $f
        Write-Host "      staged: $f"
    }
}

# MCP server (entire subtree)
if (Test-Path "mcp-server") {
    git add -- "mcp-server/"
    Write-Host "      staged: mcp-server/"
}

Write-Host ""
Write-Host "[4/6] Diff summary:" -ForegroundColor Cyan
git diff --cached --stat

if (-not (git diff --cached --quiet)) {
    Write-Host ""
    Write-Host "[5/6] Committing ..." -ForegroundColor Cyan
    git commit -m "Fix bridge container, add API auth, ship PBK MCP server

Bridge container fix:
- Dockerfile.openclaw was COPY'ing only the .mjs file with no npm install,
  so @sparticuz/chromium and puppeteer-core never resolved at runtime and
  the Render container crashed on boot. Rewrite to node:22-slim, apt-get
  Chrome runtime libs, npm install --no-save the two pinned deps.
- .dockerignore: keep node_modules / dist / src / public / .git out of
  the build context.
- scripts/openclaw-local-server.mjs: add PBK_BRIDGE_API_KEY env. When
  set, all non-/health endpoints require Authorization: Bearer <key>.
  /health stays open so Render's healthCheckPath keeps working. Bumps
  BUILD_REVISION to 2026-04-26-bridge-auth-v3 and surfaces
  features.authRequired in /health so the frontend can detect the gate.
- render.yaml: declare PBK_BRIDGE_API_KEY (sync:false, set in dashboard).

PBK MCP server (mcp-server/):
- New TypeScript MCP server that wraps the bridge so any MCP client
  (Claude Desktop, Cursor, custom agents) can call OpenClaw tools
  natively.
- 16 tools registered: pbk_health, pbk_list_tools, pbk_get_state,
  pbk_analyze_deal, pbk_lead_intake, pbk_create_approval,
  pbk_decide_approval, pbk_list_approvals, pbk_get_brain_state,
  pbk_ingest_research_doc, pbk_check_dnc, pbk_send_sms, pbk_make_call,
  pbk_send_contract, pbk_skip_trace, pbk_slack_notify.
- All tools use Zod with .strict() schemas, return both content text
  and structuredContent, set readOnly/destructive/idempotent/openWorld
  hints.
- Stdio transport for Claude Desktop / Cursor; HTTP support trivial
  to add later.
- Configured via PBK_BRIDGE_ENDPOINT and PBK_BRIDGE_API_KEY env vars
  (no secrets in repo).

Verified locally:
- node --check on bridge passes.
- Bridge boots in --public mode with new revision; auth gate works
  (401 without key, 200 with).
- MCP server compiles clean with strict TypeScript.
- Smoke tested via JSON-RPC stdio: tools/list returns 16 tools,
  pbk_health returns full bridge state with structuredContent."

    Write-Host ""
    Write-Host "[6/6] Pushing to origin/main ..." -ForegroundColor Cyan
    git push origin main

    Write-Host ""
    Write-Host "Done." -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Set PBK_BRIDGE_API_KEY in Render dashboard for pbk-openclaw-bridge."
    Write-Host "     Generate a long random string. Watch Render Deploys for build to go green."
    Write-Host ""
    Write-Host "  2. Verify the bridge:"
    Write-Host "     curl https://pbk-openclaw-bridge.onrender.com/health"
    Write-Host "     should show:"
    Write-Host "       revision: 2026-04-26-bridge-auth-v3"
    Write-Host "       features.authRequired: true"
    Write-Host ""
    Write-Host "  3. Create the n8n credential:"
    Write-Host "     https://probonokeyrealty1.app.n8n.cloud/home/credentials"
    Write-Host "     New -> Bearer Auth -> name: PBK Bridge Bearer -> value: same key as Render"
    Write-Host ""
    Write-Host "  4. Build the MCP server locally:"
    Write-Host "     cd mcp-server"
    Write-Host "     npm install"
    Write-Host "     npm run build"
    Write-Host ""
    Write-Host "  5. Wire into Claude Desktop:"
    Write-Host "     Edit %APPDATA%\Claude\claude_desktop_config.json"
    Write-Host "     Add the snippet from mcp-server/README.md."
    Write-Host "     Restart Claude Desktop."
    Write-Host ""
    Write-Host "  6. Frontend Settings:"
    Write-Host "     pbkcommandcenter.netlify.app -> Settings -> OpenClaw"
    Write-Host "     endpoint: https://pbk-openclaw-bridge.onrender.com"
    Write-Host "     api key: same value from step 1"
} else {
    Write-Host ""
    Write-Host "Nothing to commit. Working tree is clean against HEAD." -ForegroundColor Yellow
}
