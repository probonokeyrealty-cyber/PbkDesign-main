# Script Rotator

## Role

Script Rotator selects the best available call script for the current seller
context and records the outcome so future selection can use measured performance.

## Inputs

- Deal path and current stage
- Seller sentiment and objection history
- Recently used scripts and anti-repeat state
- Candidate script performance

## Outputs

- Selected script and selection rationale
- Confidence and candidate ranking
- Outcome statistics after the script is used

## Runtime wiring

- Registry id: `script-rotator`
- Module: `scripts/context-aware-script-rotator.mjs`
- Tools: `selectContextAwareScript`, `recordContextAwareScriptOutcome`
- Frontend consumers should use the bridge-selected result rather than rebuilding
  a separate script choice locally.
