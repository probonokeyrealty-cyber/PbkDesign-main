# PBK Runtime Add-ons

This folder wires three local infrastructure services into PBK without changing the live bridge defaults:

- Temporal: durable workflow orchestration at `localhost:7233`, UI at `http://127.0.0.1:8233`.
- VoidLLM: privacy-first AI gateway at `http://127.0.0.1:8088`.
- Quartermaster Code Runner: sandboxed code execution API at `http://127.0.0.1:8011`.

## Commands

```powershell
npm run infra:up
npm run infra:check
npm run infra:down
```

`npm run infra:up` creates `.pbk-local/pbk-runtime.env` with local-only secrets, starts the Docker stack, installs Quartermaster into `.pbk-local/quartermaster-venv`, builds the default `code-runner-python` sandbox image, and starts it in the background.

Run `npm run infra:smoke` after startup to verify Temporal UI, VoidLLM health, Quartermaster health, and one real Python sandbox execution.

## PBK integration points

Set these when you want the bridge or agents to call the add-ons:

```env
PBK_TEMPORAL_ADDRESS=127.0.0.1:7233
GOOGLE_API_KEY=<Google AI Studio key used by the VoidLLM default route>
PBK_LLM_PROVIDER=voidllm
PBK_VOIDLLM_BASE_URL=http://127.0.0.1:8088/v1
PBK_VOIDLLM_API_KEY=<VoidLLM user API key>
PBK_VOIDLLM_MODEL=default
PBK_VOIDLLM_USER_ID=pbk-agent-planner
PBK_CODE_RUNNER_URL=http://127.0.0.1:8011
PBK_CODE_RUNNER_API_KEY=<value from .pbk-local/pbk-runtime.env>
PBK_DEEPGRAM_API_KEY=<Deepgram API key>
PBK_DEEPGRAM_MODEL=nova-2
PBK_DEEPGRAM_LIVE_MODEL=nova-2-meeting
PBK_DEEPGRAM_TELNYX_ENCODING=mulaw
PBK_DEEPGRAM_TELNYX_SAMPLE_RATE=8000
PBK_TELNYX_MEDIA_STREAM_TOKEN=<random shared token for Telnyx stream_url>
```

`PBK_LLM_PROVIDER=voidllm` routes PBK's agent planner JSON generation through VoidLLM's OpenAI-compatible `/v1/chat/completions` endpoint. Leave it unset to keep the existing Gemini direct path. The bundled `voidllm.yaml` maps `default` to Gemini through Google's official OpenAI-compatible endpoint, so set `GOOGLE_API_KEY` before starting the stack. Use a VoidLLM user API key (`vl_uk_...`) for `PBK_VOIDLLM_API_KEY`; the admin key is only for administration and is not accepted by `/v1` SDK calls. `npm run llm:smoke` runs a live completion when a local VoidLLM user key is present; `npm run llm:smoke:mock` verifies only the PBK request shape.

`PBK_DEEPGRAM_API_KEY` enables voice sentiment. `npm run deepgram:smoke` transcribes Deepgram's sample WAV through the SDK and returns transcript/sentiment without printing the key. For live Telnyx streams, point Telnyx `stream_url` to `/api/webhooks/telnyx/media?token=<PBK_TELNYX_MEDIA_STREAM_TOKEN>`. Set `PBK_DEEPGRAM_STREAM_CALLS=true` only after the public bridge URL and Telnyx media stream settings are verified.

Keep code execution local-only until the approval and audit policies are fully defined.
