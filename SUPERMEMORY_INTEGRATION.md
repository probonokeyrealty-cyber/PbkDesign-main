# Supermemory Integration Notes

Supermemory is a good candidate for PBK's long-term agent memory layer, but it must be scoped only to PBK Wholesale Paradise. Do not connect it as a general coding assistant memory, personal memory, or cross-project memory vault.

The default posture is privacy-first: self-host when possible, otherwise use a strict allowlist and redaction layer before anything is sent to a cloud memory provider.

## Verified Fit

Supermemory provides memory, profile, RAG, MCP, and plugin surfaces for agent workflows. For PBK, the useful targets are:

- Rex remembering admin and infrastructure decisions.
- Ava remembering coach-memory preferences and seller-call lessons.
- Contract Lawyer remembering template/version choices.
- Codex-style coding agents remembering prior implementation decisions.

## Scope Boundary

Allowed scope:

- PBK Wholesale Paradise only.
- PBK Command Center UI rules.
- PBK deal-path strategy patterns.
- PBK agent playbooks, scripts, and non-sensitive runbooks.
- PBK provider setup notes without credentials.

Not allowed:

- General coding history outside PBK.
- Personal assistant memories.
- Raw provider credentials.
- Unredacted seller/homeowner/agent contact data.
- Filled contracts, DocuSign envelopes, PDFs, or banking/financial identifiers.

## Data Allowlist

| Include | Exclude or Transform |
|---|---|
| Call transcript summaries | Raw transcript with seller name, phone, email, or address |
| Anonymized seller ID | Seller name, phone, email |
| Deal analyzer category outputs | Exact property address; use hash or broad market label |
| ARV/MAO pattern ranges | Actual profit numbers or private underwriting thresholds |
| Objection type and winning rebuttal | Full private conversation payload |
| Contract template names and versions | Filled PDFs or signed documents |
| Lead engagement score bucket | Full lead record |
| Agent tone preference | Sensitive personal details |

## Memory Types To Store

- Deal analysis patterns: `low-rate mortgage + tired landlord => consider subto`.
- Successful close patterns: `probate + empathy + quick close => strong response`.
- Objection handling: `seller wants more => show comps, then anchor at walk-away`.
- Agent preferences: `Ava tone = warm, calm, lightly urgent for cash deals`.
- UI preferences: `PBK uses command-center density, baby-blue accents, Fraunces/Geist/JetBrains Mono`.
- Admin lessons: `Render env changes require persistence status check after bridge update`.

## Memory Namespaces

Use isolated container tags:

- `pbk-wholesale`
- `pbk-rex-admin`
- `pbk-ava-coach`
- `pbk-contract-lawyer`
- `pbk-ui-design`
- `pbk-browseros-research`

Never share these namespaces with non-PBK work.

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

## Preferred Architecture

Preferred:

1. Self-host Supermemory or use a local memory layer.
2. Put a PBK redaction adapter in front of memory writes.
3. Store summaries and patterns, not raw records.
4. Query memory by lead type, objection type, deal path, and agent role.

Acceptable cloud path:

1. Use only allowlisted memory payloads.
2. Use PBK-only namespaces.
3. Keep credentials in Render/OpenClaw envs, not source code.
4. Log memory writes in the admin audit trail.

## Recommended Rollout

Phase 1: Design-only memory

- Store non-sensitive implementation decisions.
- Store UI rules from `DESIGN.md` and `PBK_DESIGN.md`.
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

Agent rule to add when enabled:

```markdown
- Before each call, query PBK-scoped memory for memories related to this lead type, objection type, and deal path.
- After a useful outcome, store an anonymized summary with tags like `path:cash`, `objection:price`, `result:won`, or `result:lost`.
- Never store seller names, phone numbers, email addresses, exact property addresses, filled contracts, or provider credentials.
```

## Codex Path

Use repo-native `DESIGN.md`, `PBK_DESIGN.md`, `AGENTS.md`, and `CLAUDE.md` immediately. Add Supermemory as an external memory provider only after approval.
