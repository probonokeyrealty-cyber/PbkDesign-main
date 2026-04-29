# PBK Meta-Agent Lab

This folder is the staging ground for the LangGraph and Pydantic AI layer that will eventually run breeder, simulator, evaluator, and graduate flows for PBK.

What is here now:

- `requirements.txt` with the initial Python packages to install
- `config/bootcamp.example.json` with the scenario/evaluation knobs
- `prompts/evaluator.md` for grading acquisitions behavior
- `generated/latest-scenario.json` produced by `npm run agent:export-scenario`

Recommended flow:

1. Run the local bridge once so `.pbk-local/openclaw-state.json` exists.
2. Run `npm run agent:export-scenario`.
3. Feed `generated/latest-scenario.json` into a LangGraph or Pydantic AI harness outside the production bridge.
4. Keep the live PBK runtime separate from the experimental training loop until score thresholds are proven.
