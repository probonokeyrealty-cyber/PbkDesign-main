# YouTube Skill Ingestion Design

## Status

Approved for implementation.

## Purpose

Skill Studio needs an explicit YouTube intake path that turns a training video into reviewable PBK skill candidates. It must reuse the existing transcript and DeepSeek infrastructure without bypassing the Render Postgres governance authority.

## User Flow

1. The operator opens **Add skill**.
2. The operator selects **YouTube**, pastes a video URL, chooses a target agent, and starts analysis.
3. The bridge fetches the transcript and title.
4. DeepSeek extracts a bounded set of observable skills with triggers, instructions, risk, and confidence.
5. Each proposal is persisted as an immutable `candidate` version with source provenance.
6. Skill Studio reloads and reports how many candidates were created.
7. Approval and activation remain separate operator actions.

## Safety And Governance

- Imported skills have no tool allowlist.
- Import never approves or activates a skill.
- Every candidate records the source URL, video ID, title, transcript hash, extraction model, and confidence.
- Stable provenance keeps repeated ingestion idempotent through the existing content-hash constraint.
- Invalid transcripts, unavailable DeepSeek configuration, malformed model output, and empty proposals fail closed.
- The prompt forbids fabricated claims and requires explicit behavioral boundaries.

## Runtime Compatibility

The extraction contract includes trigger fields already understood by `ava-governed-skill-router.mjs`:

- `keywords`
- `objections`
- `emotions`
- `stages`
- `paths`
- `intents`

This lets approved candidates participate in Ava's existing cue/jump behavior without adding another routing engine.

## Mobile UX

The existing bottom-sheet dialog remains the container. A segmented Manual/YouTube control sits above the form. The body alone scrolls, while Cancel and the primary action remain sticky above the mobile safe area.
