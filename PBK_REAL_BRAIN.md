# PBK Real Brain

This is the private, local memory pipeline for PBK Wholesale Paradise. It turns the exported conversation file into searchable knowledge units without uploading the chat contents to a cloud provider.

## What It Builds

- `.pbk-local/brain/knowledge-units.json` - full redacted knowledge units with local embeddings.
- `.pbk-local/brain/documents.jsonl` - JSONL format for vector database loaders.
- `.pbk-local/brain/index.json` - lightweight local search index.
- `.pbk-local/brain/manifest.json` - counts, source hash, topic distribution, and redaction summary.

The builder also creates focused derived formula units from code snippets so questions like "What is the flip ROI formula?" retrieve the exact implementation lines instead of a large surrounding code block.

`.pbk-local/` is ignored by Git, so the private brain artifacts stay on this machine.

## Build From The Chat Export

```powershell
npm run brain:build-conversation -- --input "C:\Users\Dell\Downloads\conversations.json"
```

The builder ingests user-visible request/response fragments and skips `THINK` fragments by default. It also redacts common secrets and private identifiers before writing the memory files.

## Query Locally

```powershell
npm run brain:query -- "What was the final formula for flip ROI?"
npm run brain:query -- "Why did we keep BrowserOS instead of Playwright?"
npm run brain:query -- "What still needs to be rotated at the provider source?"
```

For machine-readable results:

```powershell
npm run brain:query -- --json --top 5 "Show the contract lawyer handoff design"
```

## Browser Query Page

Open the local page:

```text
public/pbk-brain-query.html
```

Then load:

```text
.pbk-local/brain/knowledge-units.json
```

The page searches in the browser only. It makes no network calls.

## Supermemory / Vector DB Export

Dry-run export:

```powershell
npm run brain:export-supermemory
```

That writes:

```text
.pbk-local/brain/cloud-export/supermemory-upload.jsonl
```

Actual cloud upload is intentionally guarded. To send, you must set all three:

```powershell
$env:SUPERMEMORY_API_KEY="..."
$env:SUPERMEMORY_INGEST_URL="..."
$env:PBK_BRAIN_CLOUD_APPROVED="1"
npm run brain:export-supermemory -- --send
```

The URL is explicit because Supermemory account/API versions can differ. Do not run `--send` until the current redaction rules and destination are approved.

## Future AI Prompt Template

Use this when asking Codex, OpenClaw, or another agent to answer with PBK memory:

```text
You are answering questions about PBK Wholesale Paradise using the local PBK Real Brain.

Load `.pbk-local/brain/knowledge-units.json`.
For each user question:
1. Embed the question with the same local PBK brain embedding method.
2. Retrieve the top 3-5 knowledge units by cosine similarity.
3. Answer from the retrieved units first.
4. Preserve exact formulas, code snippets, implementation status, and decision history.
5. If the retrieved units conflict, prefer units marked "Implemented or verified" and later sequence numbers, while naming older items as history.
6. Never reveal secrets, raw provider credentials, seller PII, or exact property addresses.
7. If the brain does not contain enough evidence, say what is missing instead of guessing.
```

## Privacy Defaults

The builder redacts:

- Slack webhooks.
- OpenAI/API/Telnyx/Google-like keys.
- Bearer tokens and JWTs.
- Emails and phone numbers.
- Street-address-shaped strings.

If you need an unredacted local-only research artifact, create a separate one-off export and keep it outside Git. Do not upload unredacted memory to cloud tools.
