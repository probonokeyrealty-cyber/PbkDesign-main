# Ava Quality Gates

This layer keeps Ava's sales intelligence measurable. It prevents PBK from promoting good-sounding scripts into permanent behavior without outcomes.

## Tools

- `pbk_knowledge_verifier`: Checks a proposed rule before it enters durable PBK knowledge. Blocks unsafe rules around AI identity, approval bypass, MAO bypass, contracts, DNC/TCPA, or kill switch behavior.
- `pbk_script_test`: Creates A/B script tests, assigns a variant during a call, records outcomes, and reports winner statistics.
- `pbk_outcome_analyzer`: Reviews recent feedback, intent events, strategist requests, and script test outcomes.
- `pbk_suggestion_engine`: Converts outcome analysis into testable improvements with evidence, a success metric, and rollback condition.

## Standard Weekly Loop

1. Run `pbk_outcome_analyzer` for the last 7 days.
2. Run `pbk_suggestion_engine` from that analysis.
3. Verify any proposed strategic rule with `pbk_knowledge_verifier`.
4. Create or update challenger scripts with `pbk_script_test`.
5. Keep winners only after enough measured outcomes. If data is thin, keep collecting.

## Rule

No single call becomes doctrine. Ava can learn from a single call as a memory, but strategic PBK behavior needs verification, approval/passcode when required, and measurable outcomes.

