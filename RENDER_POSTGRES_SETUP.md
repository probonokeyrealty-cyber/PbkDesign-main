# Render Postgres setup for the OpenClaw bridge

The bridge already supports Postgres state — it switches modes based on the `PBK_DATABASE_URL` env var. This doc is the runbook to flip the live Render service from file-mode to Postgres-mode without losing the founder workflow.

## Why this matters

Render free web services don't have persistent disks. Today the bridge's state (`approvals`, `activity`, `brainDocs`, `leadImports`, `analyzerRuns`, `dncEntries`, `calls`, `messages`, `contracts`) is written to `/app/.pbk-local/openclaw-state.json` inside the container. Every cold start, restart, or redeploy wipes that file. Approvals you queued an hour ago can disappear.

With Postgres mode, the bridge persists everything to a single `bridge_state` row (one JSONB column) in a Render-managed database. State survives every kind of bounce.

## What the bridge does on startup

```
PBK_DATABASE_URL set?
  ├─ yes → ensure 'bridge_state' table exists
  │        → SELECT data FROM bridge_state WHERE id = 'singleton'
  │        → if found, hydrate state from JSONB
  │        → if missing, seed defaults + INSERT
  └─ no  → fall back to .pbk-local/openclaw-state.json
```

`/health.features.stateBackend` reports `"postgres"` or `"file"`.

## One-time setup steps

### 1. Provision Postgres in Render

1. Open the Render dashboard.
2. **New → Postgres**.
3. Settings:
   - **Name**: `pbk-openclaw-db`
   - **Region**: same as the bridge service (likely Ohio).
   - **Plan**: Free.
   - **PostgreSQL version**: 16 (default).
   - **Database**: `pbk_openclaw` (lowercase, no spaces).
   - **User**: `pbk_openclaw_user` (or accept Render's default).
4. Click **Create Database**.
5. Wait for status `available` (usually 2–3 minutes).

> Free Postgres on Render is **deleted after 90 days**. If you keep using it, set a calendar reminder around day 80 to upgrade or back up the JSONB row. We're using a single row so a dump is one query.

### 2. Wire the connection string into the bridge service

Render's "Add From Database" pattern injects the right string automatically — don't paste it manually.

1. Open the `pbk-openclaw-bridge` web service.
2. **Environment** tab → **Add Environment Variable**.
3. Choose **Add From Database**.
4. Select:
   - **Database**: `pbk-openclaw-db`
   - **Property**: `Connection String` (this is the `Internal Database URL` — same private network, no SSL surprises).
5. Set **Key** to `PBK_DATABASE_URL`.
6. **Save**.
7. Render will redeploy the bridge automatically.

> If you must paste the URL manually instead, use the **Internal Connection String** from the database's Info tab. The external (public) URL works too but adds a TLS hop the bridge already handles via its `ssl: { rejectUnauthorized: false }` setting.

### 3. Verify the flip

After the redeploy goes Live:

```bash
curl -s https://pbk-openclaw-bridge.onrender.com/health | jq .features
```

Expected:

```json
{
  "documentsPdf": true,
  "approvals": true,
  "contracts": true,
  "analyzerBridge": true,
  "authRequired": true,
  "stateBackend": "postgres"
}
```

The change you're confirming is `"stateBackend": "postgres"`. If it still says `"file"`, the env var didn't reach the running container — re-check step 2 and trigger another deploy.

### 4. Sanity check the state survives a restart

```bash
# Note current approval count
curl -s -H "Authorization: Bearer $PBK_BRIDGE_API_KEY" \
  https://pbk-openclaw-bridge.onrender.com/state \
  | jq '.approvals | length'

# Force a redeploy in Render → Manual Deploy → Clear build cache & deploy

# After it goes Live, count again
curl -s -H "Authorization: Bearer $PBK_BRIDGE_API_KEY" \
  https://pbk-openclaw-bridge.onrender.com/state \
  | jq '.approvals | length'
```

The two numbers must match. If the approval count drops to 3 after a redeploy, you're still on file mode — the seeded defaults are 3 approvals.

### 5. Backup pattern (one query)

Whenever you want a snapshot:

```bash
# In Render dashboard → pbk-openclaw-db → "Connect" → psql command
psql $PBK_DATABASE_URL -c "\\COPY (SELECT data FROM bridge_state WHERE id = 'singleton') TO 'pbk-state-backup-$(date +%F).json'"
```

Restore:

```bash
psql $PBK_DATABASE_URL -c "INSERT INTO bridge_state (id, data, updated_at) VALUES ('singleton', '$(cat pbk-state-backup-2026-04-26.json)'::jsonb, NOW()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()"
```

## What this does NOT cover

- Multi-instance scale (the JSONB row is a single-writer model).
- Per-record SQL queries (state is opaque blob from Postgres' perspective).
- Schema migrations beyond `bridge_state` itself.

If/when PBK outgrows the single-row model, the path forward is a normalized schema (one table per state collection: `approvals`, `activity`, etc.) and migration scripts that read the JSONB blob and split it out. The bridge code already has clean array boundaries (each top-level state key is independent) so this would be a focused refactor, not a rewrite.

## Troubleshooting

**`/health.features.stateBackend` still says `"file"`**
- Env var didn't get injected. Verify in the bridge service's Environment tab that `PBK_DATABASE_URL` exists. Trigger Manual Deploy.

**Bridge boots but logs `pg pool error`**
- Check the connection string is the **Internal** one (not external) when bridge and DB are on the same Render account.
- If using external URL, ensure SSL is acceptable. The bridge already sets `ssl: { rejectUnauthorized: false }` for non-localhost URLs — Render's self-signed managed Postgres certs work fine with that.

**`relation "bridge_state" does not exist`**
- The bridge's `ensurePgSchema()` runs on first boot. If you see this, the bridge crashed before the schema bootstrap. Check the Render logs for an earlier error (usually a connection refused or auth failure) and fix that first.

**Want to wipe state and reseed defaults**
- Set the env var `PBK_OPENCLAW_RESET=1` once, redeploy. **Note**: the bridge's CLI flag `--reset` won't work in production because Render's CMD is fixed. Either use the env var pattern, or `psql` and `DELETE FROM bridge_state;` then redeploy.
