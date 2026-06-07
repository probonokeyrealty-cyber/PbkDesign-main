# Memory Policy

Every durable memory must preserve provenance, confidence, and contradiction
behavior. Ava should never treat an inference as verified truth.

```json
{
  "provenance": "seller_stated | provider_verified | operator_entered | ava_inferred",
  "confidence": 0.0,
  "expiresAt": "ISO timestamp or null",
  "contradictionStrategy": "replace | merge | discard",
  "sourceEventId": "conversation event id or null"
}
```

## Provenance rules

- `seller_stated`: directly stated by seller. Default confidence 0.6.
- `provider_verified`: skip trace, title, county, signed contract, or provider
  proof. Default confidence 0.9.
- `operator_entered`: lead portal or operator import. Default confidence 0.8.
- `ava_inferred`: model inference. Default confidence 0.45 and expiration within
  30 days unless refreshed.

## Contradictions

- Provider-verified facts outrank all other facts.
- Operator-entered facts outrank seller-stated facts unless provider proof
  conflicts.
- Seller-stated facts outrank Ava inferences.
- Contradictions should be surfaced as uncertainty rather than silently merged
  when they affect offer, authority, DNC, consent, ownership, or contract terms.

## Retrieval rules

- RAG should weight higher-confidence facts more strongly.
- Ava should disclose uncertainty internally, not to the seller unless it helps
  clarify the next question.
- Expired inferences may be used only as weak context.
