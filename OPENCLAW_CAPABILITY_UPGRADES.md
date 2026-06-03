# OpenClaw Capability Upgrades: TokenJuice + Human MCP

This repo keeps Ava/Rex production-safe first. Do not add third-party MCP servers to the live OpenClaw runtime unless they can start cleanly with local environment credentials.

## Current Status

- `tokenjuice@0.7.0` is installed globally.
- `@goonnguyen/human-mcp@2.15.1` is installed globally.
- `tokenjuice-mcp` does not exist on npm as of the verification run. TokenJuice is enabled through OpenClaw's bundled plugin instead.
- `@mrgoonie/human-mcp` does not exist on npm. The real package is `@goonnguyen/human-mcp`.
- Human MCP is staged, not active, because this local shell does not currently expose `GOOGLE_GEMINI_API_KEY`, `ZHIPUAI_API_KEY`, `ELEVENLABS_API_KEY`, or `MINIMAX_API_KEY`.

## TokenJuice

TokenJuice is not a separate MCP server. Its own package documentation says OpenClaw support is bundled on the OpenClaw side.

Install:

```powershell
npm.cmd install -g tokenjuice
```

Enable in `C:\Users\Dell\.openclaw\openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "tokenjuice": {
        "enabled": true
      }
    }
  }
}
```

This requires OpenClaw `2026.4.22` or newer. PBK is pinned at `2026.4.23`, so this is compatible.

## Human MCP

Human MCP adds optional multimodal tools for Ava/Rex: image/property-photo analysis, document extraction, TTS fallback, browser screenshots, and reasoning helpers.

Install:

```powershell
npm.cmd install -g @goonnguyen/human-mcp
```

Before activating, set at least one provider key in the environment used to launch OpenClaw:

```powershell
$env:GOOGLE_GEMINI_API_KEY = "..."
# or
$env:ZHIPUAI_API_KEY = "..."
# optional fallback if you want Human MCP to use ElevenLabs directly
$env:ELEVENLABS_API_KEY = "..."
```

Then add this server to `C:\Users\Dell\.openclaw\openclaw.json` under `mcp.servers`:

```json
{
  "human-mcp": {
    "command": "C:\\Users\\Dell\\AppData\\Roaming\\npm\\human-mcp.cmd",
    "args": [],
    "env": {
      "TRANSPORT_TYPE": "stdio",
      "LOG_LEVEL": "info",
      "MCP_TIMEOUT": "30000",
      "VISION_PROVIDER": "gemini",
      "SPEECH_PROVIDER": "elevenlabs",
      "IMAGE_PROVIDER": "gemini"
    }
  }
}
```

Do not hardcode provider API keys in `openclaw.json`. Keep them in the parent process environment or a local secret manager.

## Ava/Rex Use Rules

- Ava can use Human MCP vision for property photos, repair photos, probate PDFs, inspection docs, and seller-shared attachments.
- Rex can use Human MCP document/vision tools for Brain source review and research synthesis.
- Human MCP is supporting evidence, not authority. PBK analyzer math, DNC/TCPA rules, approval mode, and MAO guardrails still win.
- If Human MCP fails, Ava/Rex must fall back to existing PBK tools and say the truth internally: "multimodal helper unavailable."
- Never mention Human MCP, TokenJuice, BrowserOS, or internal provider names to a seller.

## Verification

```powershell
npm.cmd list -g @goonnguyen/human-mcp tokenjuice --depth=0
node -e "JSON.parse(require('fs').readFileSync(process.env.USERPROFILE+'/.openclaw/openclaw.json','utf8')); console.log('openclaw json ok')"
npm.cmd run test:mcp
npm.cmd run test:live-data-audit
```
