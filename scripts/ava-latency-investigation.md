# Ava Latency Investigation

Base: `53ecb51`. This investigation does not establish production readiness.

## Metric Provenance

`buildProductionAgentLatencySamples` gathers agent decisions, tasks, and Rex
decisions. `getMeasurementLatencySamples` additionally accepts probe latency
fields. Therefore the supplied seven samples must not automatically be described
as seven phone turns or even seven operator requests.

`recordAvaAssistantPlanOps` labels a request by its planned tool but measures
`Date.now() - startedAt` across the full internal assistant handler. A failed
`findLead` measurement is not a measurement of lookup execution alone.

Phone latency is separate: `recordPbkTurnLatency` updates
`avaResponseLatencySamples` and the `pbk_turn_latency` table.

## Critical Path

The internal findLead route reads the body, awaits Redis-backed session read,
runs intake/planned controllers, performs a synchronous local lead lookup,
runs final controller(s), and awaits Redis-backed session write. The controller
implementation has no network awaits. Redis defaults allow 1500ms for connection
and 1500ms per command. Session I/O is a suspect, not a measured production cause.
Do not skip shared session reads or governance to improve a number.

## Local Evidence

- `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.mjs --runTestsByPath scripts/ava-request-timing.test.mjs --runInBand`: 4/4 pass.
- `node scripts/ava-assistant-chat-smoke.mjs`: pass.
- `node scripts/redis-command-deadline-smoke.mjs`: pass, including socket cleanup,
  cooldown, recovery, late-completion isolation, and no ambiguous-write retries.
- Actual matching/controller functions, seven local runs with 10,000 fabricated
  leads and an absent query, including cold sample: lookup milliseconds
  `[302.47,147.80,136.50,153.65,165.84,140.05,139.59]`; three controller passes
  combined `[40.58,17.30,12.43,15.67,12.09,11.92,11.39]`.
  Corresponding p95 values: 302.47ms and 40.58ms. These are synthetic local
  profiling results, NOT production measurements or end-to-end latency.

## Bridge Integration For Owner Review

Import `createAvaRequestTiming` from `./ava-request-timing.mjs`. Instantiate at
the start of `handleInternalAvaAssistantChatRequest`. Wrap existing operations
without reordering or changing arguments:

```js
const requestTiming = createAvaRequestTiming();
const body = await requestTiming.measure('body_read', () => readBody(request));
const priorAssistantSession = await requestTiming.measure('session_read', () =>
  readPublicAvaAssistantSession(sessionId)
);
// Wrap each existing controller call, preserving its full input object:
// controller_intake, controller_planned, controller_final, controller_final_recheck.
const lead = requestTiming.measureSync('lead_lookup', () =>
  findInternalAssistantLead(assistantPlan.toolPlan.params?.query || '')
);
await requestTiming.measure('session_write', () =>
  writePublicAvaAssistantSession(sessionId, assistantSession)
);
```

Pass `requestTiming.snapshot()` to the existing internal
`recordAvaAssistantPlanOps` call; add an optional `requestTiming = null` parameter
to that recorder and retain it in its metadata. Also preserve
`params.metadata?.requestTiming || null` in `mirrorAgentOpsMeasurementToState`
metadata, which currently drops custom metadata. Return the snapshot only in
the authenticated internal response. Keep existing total latency, success
criteria, approvals, failure samples, and phone metrics unchanged.

`returned` in a stage means the operation returned, NOT that a lookup or provider
action succeeded. Error identity and cancellation pass through unchanged. The
helper does not implement cancellation, retry, deadline, cache, or execution
policy. It records only allowlisted labels, durations, and outcomes.

No production API writes, customer communications, or provider inference were
performed. Production 6544ms attribution remains unresolved until stage data is
collected. No monolith changes were made by this investigation owner.
