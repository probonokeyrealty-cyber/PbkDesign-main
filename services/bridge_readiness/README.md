# PBK bridge readiness pilot

FastAPI checks the existing OpenClaw bridge on Render and the configured Supabase Storage endpoint. The pilot has no operator or provider actions. Render Postgres remains the bridge's operational store. The gateway check uses the bridge's existing heartbeat or direct probe result.

| Route | Behavior |
| --- | --- |
| GET /live | Returns 200 when the FastAPI process can serve requests. Makes no upstream calls. |
| GET /ready | Makes bounded, parallel GET requests to bridge health and configured Supabase Storage status. Returns 503 when any required check is unavailable. Reports only fixed status labels. |

A Supabase Storage status response verifies endpoint reachability. It does not validate access to private buckets or recordings.

## Local run

From the repository root, install the pinned requirements in a Python 3.12 virtual environment:

~~~sh
python -m pip install -r services/bridge_readiness/requirements.txt
python -m unittest discover -s services/bridge_readiness -p 'test_*.py'
python -m uvicorn services.bridge_readiness.app:app --host 127.0.0.1 --port 8100
~~~

Set the following on the service before starting it:

| Variable | Value |
| --- | --- |
| PBK_BRIDGE_URL | Existing HTTPS Render staging bridge origin. |
| PBK_SUPABASE_URL | HTTPS origin of the intended staging Supabase project. |
| PBK_SUPABASE_PUBLISHABLE_KEY | That project's publishable key. |
| PBK_REQUIRE_OPENCLAW_GATEWAY | Defaults to true. Set to false for a staging environment that intentionally uses standby. |
| PBK_REQUIRE_SUPABASE_STORAGE | Defaults to true. Set to false for a staging environment that intentionally omits Storage. |

Postgres, bridge availability, and state restoration are always required. Disabled requirements still appear in the report. To exercise the startup boundary, run against a staging bridge whose HTTP health endpoint is reachable while its state or gateway reports degraded status. Compare the component labels and confirm that the pilot returns 503 for an unavailable required dependency.

## Render staging

Run this as a private Python service in the staging workspace. Use Python 3.12, the repository root, and these commands:

~~~sh
python -m pip install -r services/bridge_readiness/requirements.txt
python -m uvicorn services.bridge_readiness.app:app --host 0.0.0.0 --port "$PORT"
~~~

Render private services use TCP health checks. Query /ready separately from the private network or the service shell. A readiness failure is diagnostic and does not restart the OpenClaw bridge. Keep production traffic routed directly to the existing bridge.
