# Call Analyzer

## Role

Call Analyzer turns completed calls into quality scores, compact seller-facing
timeline summaries, failure tags, coaching, embeddings, and skill outcomes.

## Inputs

- Call id, lead id, duration, transcript, recording metadata, and sentiment
- Deal path and seller stage
- Provider result and call disposition

## Outputs

- Call quality score and failure tags
- Bounded call summary for the unified conversation timeline
- Post-call coaching event
- Transcript embedding and skill outcome records

## Runtime wiring

- Registry id: `call-analyzer`
- Core tools: `scoreCallQuality`, `upsertCallEmbeddingFromTranscript`,
  `recordSkillOutcome`, `pbk_outcome_analyzer`
- Projection: `scripts/conversation-projector.mjs`
- Coaching persistence: `createPostCallCoachingReport` in the bridge
- Timeline source: canonical conversation activity events

Full transcripts remain available as expandable transcript events. The primary
call card intentionally shows duration, sentiment, and a brief summary.
