# PBK Ollama And Local Model Notes

PBK production does not depend on Ollama. Production Ava/Rex traffic goes through the PBK bridge using hosted providers such as DeepSeek and OpenAI, with approval guardrails around provider writes.

Use these notes only for local development, fallback experiments, or future edge deployments.

## Known Local Model Failure Patterns

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| vLLM/OpenAI-compatible provider adds an unexpected model prefix | Provider auto-detection rewrites the model name | Use an explicit `custom` provider block |
| Qwen routes to DashScope instead of local Ollama | `auto` provider misclassifies the model | Set provider to `custom`, not `auto` |
| Qwen3.x thinking models return empty content | Model emits reasoning/tool-style output that the client does not parse as final text | Use `qwen2.5:14b` for stable local agent replies |
| First response is very slow | Ollama unloads the model between calls | Set `OLLAMA_KEEP_ALIVE=-1` |

## Working Local Provider Pattern

```json
{
  "agents": {
    "defaults": {
      "model": "qwen2.5:14b",
      "provider": "custom",
      "fallbacks": ["gemini/gemini-2.0-flash"]
    }
  },
  "providers": {
    "custom": {
      "apiKey": "ollama",
      "apiBase": "http://<your-ollama-host>:11434/v1"
    }
  }
}
```

Set the keep-alive value before starting Ollama:

```powershell
$env:OLLAMA_KEEP_ALIVE = "-1"
ollama serve
```

## PBK Usage Guidance

- Do not put Ollama in the production critical path unless there is a specific launch requirement.
- Use local Ollama for Rex/Ava offline tests when you want to avoid hosted model spend.
- Prefer `qwen2.5:14b` over Qwen3 thinking models for local command execution.
- Keep hosted DeepSeek/OpenAI as production providers until local fallback has its own smoke tests.
- Never let local-model experiments bypass PBK approval gates for calls, SMS, email, contracts, deletes, or admin actions.

## Smoke Test

After configuring the local provider, run a harmless text-only prompt:

```powershell
openclaw agent invoke rex "Summarize the Columbus wholesale market in three sentences."
```

Expected behavior:

- Rex answers without hanging.
- Rex synthesizes instead of dumping raw facts.
- No provider writes are triggered.

## Production Relationship

| Lane | Production Requirement |
| --- | --- |
| Live calls | Telnyx plus Deepgram through the PBK bridge |
| Ava/Rex hosted intelligence | DeepSeek/OpenAI through the PBK bridge |
| Local fallback | Optional Ollama custom provider |
| Launch proof | One live Telnyx to Deepgram call with persisted transcript rows |
