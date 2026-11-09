# Apify For-Sale Listing Sync

The sync script sends addressable listings into the PBK bridge's existing
`POST /api/property-data` cache API. The stored records are available through
`GET /api/property-data?address=...` and the existing property-cache lookup
tool. It does not create seller leads, generate comparable sales, or start
new Apify Actor runs.

Every record carries `askingPriceUsd`, `priceBasis: asking_price`, its source
links, capture time, and dataset ID. Do not map the asking price to `price`,
`listPrice`, or `arv`: the existing analyzer interprets those as valuation
inputs. A listing is not enough evidence for underwriting.

## Import a reviewed export

Run the following from the repository. Without `-Apply` it only previews
counts and makes no bridge writes. The date must be the source capture time,
not the date the data is uploaded.

```powershell
pwsh -NoProfile -File scripts/sync-apify-property-cache.ps1 `
  -Zip 90210 -DatasetId NFDSgUBVg6W13hK80 `
  -CapturedAt '2026-11-09T01:54:39.903Z' `
  -CsvPath '../90210-apify-listings-deduplicated.csv'
```

Add `-Apply -BridgeUrl https://pbk-openclaw-bridge.onrender.com` when the
preview is correct. Set `PBK_BRIDGE_API_KEY` in the runner's secret
environment. Do not paste credentials into commands, CSVs, or source files.

## Read an Apify dataset directly

Set the runner secret `PBK_APIFY_API_TOKEN` with access to the dataset,
then omit `-CsvPath`. The script reads the completed dataset via Apify's
dataset-items API. Codex's OAuth connection does not supply a token to
this script or the hosted bridge. Use the OAuth-based runner below for
scheduled refreshes from the existing Codex installation.

Raw input is filtered to USD for-sale rows in the requested ZIP. The
script matches normalized streets, retaining unit numbers and source
links. Review address aliases and missing street addresses in the source
before applying. Unaddressable records are not loaded.

The script skips unrelated cache entries and older snapshots. Replaying
the same data does not refresh the cache age. It refuses imports that
would exceed the bridge's bounded property cache. Entries follow the
bridge's normal expiry rules; the stored capture time is the authoritative
age of the listing evidence.

## Weekly 90210 refresh

The local runner uses the authenticated Apify MCP connection in Codex
to start one for-sale search for ZIP 90210 across Realtor.com, Zillow,
and Redfin. It requests at most 100 rows per provider and passes a
`maxTotalChargeUsd` limit of $1 to Apify for the Actor run. That limit
does not cover unrelated account or infrastructure charges. The runner
validates the completed dataset before writing and reserves at least
six days between paid attempts. It will not start a second run on retry.

```powershell
node scripts/refresh-apify-property-cache.mjs --refresh
node scripts/refresh-apify-property-cache.mjs --check-run <run-id>
node scripts/refresh-apify-property-cache.mjs --resume
node scripts/refresh-apify-property-cache.mjs --backfill-listing-details
```

`--check-run` only previews a completed dataset. `--resume` retries the
import from the last failed refresh's saved run ID without starting an
Actor. Successful rows are idempotent. The runner preserves non-Apify
records and skips new addresses at the cache limit. Listings absent from
the latest capped search are not marked sold or deleted.

`--backfill-listing-details` reuses the last completed run and updates only
existing cache records from that dataset. It does not start a new Actor
run or reset the refresh schedule. Weekly refreshes also retain supported
property facts and up to six Realtor.com photo URLs when supplied.

In the Analyzer, **Look up asking price** reads the listing without
modifying the draft. **Fill empty fields** applies supported listing
facts only. No listing value is used as a sold comp, ARV, agreed price,
or financing assumption.

The scheduled job requires this computer and Codex to be running, the
Apify OAuth connection to stay authenticated, and `PBK_BRIDGE_API_KEY`
to be available to the local runner. Keep the reviewed 90210 CSV in the
parent workspace as the reference for matching previously imported
addresses. The latest attempt is recorded in the ignored `.pbk-local`
directory. No Apify token or schedule is required on Render.

## Storage

The state-backed API persists with the bridge's configured state backend.
On Render this is Postgres-backed bridge state. This path does not depend
on the separate `public.property_cache` projection table and does not run
schema migrations. Check `/api/admin/persistence` and address lookup after
an applied import.
