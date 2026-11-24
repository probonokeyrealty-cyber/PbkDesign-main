import unittest

import httpx

from services.bridge_readiness.app import Settings, create_app


BRIDGE = "https://bridge.example.test"
STORAGE = "https://project.example.test"
KEY = "fixture-publishable-value"


def bridge_health(*, restored=True, database="up", gateway="up"):
    return {
        "ok": True,
        "service": "pbk-local-openclaw",
        "components": {
            "bridge": {"ready": True},
            "stateBootstrap": {"ready": restored},
        },
        "runtime": {
            "stateBackend": "postgres",
            "postgresHealth": {"status": database},
        },
        "openClawGateway": {"status": gateway, "ready": gateway == "up"},
        "note": "upstream details should not be returned",
    }


class ReadinessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.requests = []

    async def request(self, bridge=None, storage=200, **overrides):
        def upstream(request):
            self.requests.append(request)
            if request.url.host == "bridge.example.test":
                return httpx.Response(200, json=bridge if bridge is not None else bridge_health())
            if isinstance(storage, Exception):
                raise storage
            return httpx.Response(storage, text="upstream storage detail")

        settings = Settings(
            bridge_url=BRIDGE,
            supabase_url=STORAGE,
            supabase_key=KEY,
            **overrides,
        )
        app = create_app(settings, transport=httpx.MockTransport(upstream))
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://local.test") as client:
                self.assertEqual((await client.get("/live")).status_code, 200)
                self.assertFalse(self.requests)
                self.assertEqual((await client.post("/ready")).status_code, 405)
                return await client.get("/ready")

    async def test_ready_uses_two_fixed_read_only_upstream_requests(self):
        response = await self.request()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json()["status"], "ready")
        self.assertEqual(
            {(r.method, str(r.url)) for r in self.requests},
            {("GET", BRIDGE + "/health"), ("GET", STORAGE + "/storage/v1/status")},
        )
        self.assertEqual(len(self.requests), 2)
        bridge = next(r for r in self.requests if r.url.host == "bridge.example.test")
        storage = next(r for r in self.requests if r.url.host == "project.example.test")
        self.assertNotIn("apikey", bridge.headers)
        self.assertEqual(storage.headers["apikey"], KEY)
        self.assertNotIn(KEY, response.text)
        self.assertNotIn("upstream", response.text)

    async def test_healthy_http_with_unrestored_state_and_gateway_standby_is_not_ready(self):
        response = await self.request(bridge=bridge_health(restored=False, gateway="standby"))
        self.assertEqual(response.status_code, 503)
        checks = response.json()["checks"]
        self.assertEqual(checks["postgres"], "up")
        self.assertEqual(checks["state_bootstrap"], "degraded")
        self.assertEqual(checks["openclaw_gateway"], "standby")

    async def test_database_failure_and_storage_denial_are_reported_separately(self):
        response = await self.request(bridge=bridge_health(database="down"), storage=403)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["checks"]["postgres"], "degraded")
        self.assertEqual(response.json()["checks"]["supabase_storage"], "access_denied")
        self.assertNotIn("upstream storage detail", response.text)

    async def test_invalid_bridge_response_leaves_dependent_states_unknown(self):
        response = await self.request(bridge={"ok": True, "private": "value"})
        self.assertEqual(response.status_code, 503)
        checks = response.json()["checks"]
        self.assertEqual(checks["bridge"], "invalid_response")
        self.assertEqual(checks["postgres"], "unknown")
        self.assertEqual(checks["supabase_storage"], "up")
        self.assertNotIn("private", response.text)

    async def test_optional_standby_and_unconfigured_storage_stay_visible(self):
        settings = Settings(bridge_url=BRIDGE, require_gateway=False, require_storage=False)
        transport = httpx.MockTransport(
            lambda _: httpx.Response(200, json=bridge_health(gateway="standby"))
        )
        app = create_app(settings, transport=transport)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://local.test") as client:
                response = await client.get("/ready")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["checks"]["openclaw_gateway"], "standby")
        self.assertEqual(response.json()["checks"]["supabase_storage"], "not_configured")

    async def test_storage_timeout_is_bounded_and_classified(self):
        response = await self.request(storage=httpx.ReadTimeout("sensitive details"))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["checks"]["supabase_storage"], "timed_out")
        self.assertNotIn("sensitive details", response.text)


if __name__ == "__main__":
    unittest.main()
