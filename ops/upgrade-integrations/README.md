# PBK Upgrade Integrations

This folder stages Ava/Rex brain, memory, data, and voice-resilience upgrades before they become live dependencies.

## Operating Rule

Everything in `pbk-upgrade-integrations.json` is setup-gated. It can appear in Settings as a candidate or "Needs one more step", but it must not be treated as production-ready until a sandbox or local round trip succeeds.

## Install Order

1. HomeHarvest: start here for structured listings and comps because it has the lowest operational complexity.
2. Scrapling MCP: add after HomeHarvest for on-demand fallback research and hard-to-parse public pages.
3. InsulaCRM: deploy only after PBK lead/activity sync rules are finalized, because this touches long-term CRM memory.
4. MOSS-TTS or ZeroVOX: add only as a fallback endpoint after Telnyx/Deepgram is stable.
5. ClickUi: keep as Jordan's local sidecar, not a production dependency.
6. RealtorsPal: research-only until primary API documentation and terms are verified.

## Readiness Checks

- Property facts must include a source URL and confidence.
- External CRM data must not overwrite PBK canonical lead, deal, script, or activity records without explicit sync logic.
- TTS fallback must pass a local audio round trip before Ava can use it on calls.
- Scraping must respect source rules, avoid restricted areas, and never bypass authentication or paywalls.

## Operator Commands

Do not run these automatically. Use them only after confirming the target environment.

```powershell
python -m pip install -U homeharvest
python -m pip install -U scrapling
scrapling mcp
```

## Local Verification Commands

When installed in the repo-local `.venv`, verify with:

```powershell
npm run property-data:smoke
npm run property-data:endpoint-smoke
.\.venv\Scripts\python.exe -m pip show homeharvest scrapling
.\.venv\Scripts\scrapling.exe --help
.\.venv\Scripts\scrapling.exe mcp --help
```

The smoke test writes `local-property-data-status.json`, which the bridge reads for Settings and Command Center readiness. It only fetches `https://example.com`; do not run real property scraping until the target source and compliance rules are confirmed.

## Bridge/Agent Tools

The local bridge now exposes two agent-facing tools:

- `scrape_property`: fetches property data through the local adapter. Use `provider=homeharvest` for zip/listing imports or `provider=scrapling` for an approved public URL.
- `import_leads`: imports normalized lead records and caches analyzer-ready property data.

HTTP routes:

```powershell
GET  /api/property-data/scrape?provider=homeharvest&location=43215&listingType=for_sale&limit=5
POST /api/property-data/scrape
POST /api/property-data/import
```

Local CLI:

```powershell
npm run property-data:homeharvest
npm run property-data:scrapling
```

Imported HomeHarvest leads are marked `needs_review` and `dncStatus=needs_review`. Do not use them for outreach until contact/compliance review is complete.

When `PBK_DATABASE_URL` is configured, `import_leads` also attempts normalized Supabase upserts into:

- `public.lead_profiles`
- `public.property_cache`

Without `PBK_DATABASE_URL`, imports remain in local bridge state only.
