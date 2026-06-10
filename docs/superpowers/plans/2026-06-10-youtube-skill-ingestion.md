# YouTube Skill Ingestion Implementation Plan

**Goal:** Add a production-safe YouTube-to-governed-candidate workflow to PBK Skill Studio.

**Architecture:** Reuse the bridge's YouTube transcript and DeepSeek helpers, normalize model output in a focused module, and persist proposals through `createSkillCandidate`. Add a mobile-safe YouTube mode to the existing candidate dialog.

## Tasks

- [ ] Add parser, prompt, provenance, and trigger-policy tests.
- [ ] Add the protected `POST /api/skills/ingest` bridge route.
- [ ] Persist bounded candidates with stable source provenance and no tools.
- [ ] Add the typed runtime bridge client.
- [ ] Add Manual/YouTube modes to Skill Studio.
- [ ] Preserve sticky mobile actions and accessible form behavior.
- [ ] Run focused governance, TypeScript, build, and browser verification.
