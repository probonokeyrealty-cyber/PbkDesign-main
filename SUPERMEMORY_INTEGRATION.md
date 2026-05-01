# Supermemory Integration Notes

Supermemory is a good candidate for PBK's long-term agent memory layer, but it should be introduced as an explicit provider integration rather than silently installed.

## Verified Fit

Supermemory provides memory, profile, RAG, MCP, and plugin surfaces for agent workflows. For PBK, the useful targets are:

- Rex remembering admin and infrastructure decisions.
- Ava remembering coach-memory preferences and seller-call lessons.
- Contract Lawyer remembering template/version choices.
- Codex-style coding agents remembering prior implementation decisions.

## Do Not Install Until

1. A Supermemory account/API key exists.
2. We decide what PBK data is allowed to leave local/Render/Supabase boundaries.
3. We define memory namespaces, such as:
   - `pbk-founder`
   - `pbk-openclaw`
   - `pbk-contracts`
   - `pbk-ui`
4. We add explicit redaction rules for:
   - seller contact info
   - phone numbers
   - contract details
   - API keys and webhook URLs
   - DocuSign envelope data

## Recommended Rollout

Phase 1: Design-only memory

- Store non-sensitive implementation decisions.
- Store UI rules from `DESIGN.md`.
- Store provider setup notes without credentials.

Phase 2: Agent ops memory

- Add Rex admin decisions and non-sensitive runbooks.
- Add contract template names, schema versions, and process rules.

Phase 3: Seller/conversation memory

- Only after explicit privacy rules.
- Prefer summaries over raw transcripts.
- Never store DNC or sensitive contact details unless policy and consent are clear.

## OpenClaw Path

Use the Supermemory OpenClaw plugin or MCP path only after the API key and data policy are approved. Keep it configured as a provider, not as hardcoded code.

## Codex Path

Use repo-native `DESIGN.md`, `AGENTS.md`, and `CLAUDE.md` immediately. Add Supermemory as an external memory provider only after approval.

