"""Read-only readiness checks for the existing PBK bridge."""

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse


logger = logging.getLogger("uvicorn.error")
DEPENDENCY_TIMEOUT = 2.5
NO_CACHE = {"Cache-Control": "no-store"}


def origin(value: str, name: str) -> str:
    if not value:
        return ""
    parsed = urlsplit(value)
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        not parsed.hostname
        or (parsed.scheme != "https" and not local_http)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"{name} must be an HTTPS origin or a loopback HTTP origin")
    return value.rstrip("/")


@dataclass(frozen=True)
class Settings:
    bridge_url: str
    supabase_url: str = ""
    supabase_key: str = field(default="", repr=False)
    require_gateway: bool = True
    require_storage: bool = True

    def __post_init__(self):
        object.__setattr__(self, "bridge_url", origin(self.bridge_url, "PBK_BRIDGE_URL"))
        object.__setattr__(self, "supabase_url", origin(self.supabase_url, "PBK_SUPABASE_URL"))

    @classmethod
    def from_env(cls):
        return cls(
            bridge_url=os.getenv("PBK_BRIDGE_URL", "").strip(),
            supabase_url=os.getenv("PBK_SUPABASE_URL", "").strip(),
            supabase_key=os.getenv("PBK_SUPABASE_PUBLISHABLE_KEY", "").strip(),
            require_gateway=os.getenv("PBK_REQUIRE_OPENCLAW_GATEWAY", "true") != "false",
            require_storage=os.getenv("PBK_REQUIRE_SUPABASE_STORAGE", "true") != "false",
        )


async def get(client: httpx.AsyncClient, url: str, **kwargs):
    try:
        async with asyncio.timeout(DEPENDENCY_TIMEOUT):
            response = await client.get(url, **kwargs)
    except (TimeoutError, httpx.TimeoutException):
        return "timed_out", None
    except httpx.RequestError:
        return "unreachable", None
    if response.status_code in (401, 403):
        return "access_denied", None
    return ("up", response) if response.is_success else ("upstream_error", None)


def record(value):
    return value if isinstance(value, dict) else {}


async def check_bridge(client: httpx.AsyncClient, settings: Settings) -> dict[str, str]:
    checks = {
        "bridge": "not_configured",
        "state_bootstrap": "unknown",
        "postgres": "unknown",
        "openclaw_gateway": "unknown",
    }
    if not settings.bridge_url:
        return checks

    checks["bridge"], response = await get(client, settings.bridge_url + "/health")
    if response is None:
        return checks
    try:
        health = record(response.json())
    except ValueError:
        health = {}
    if health.get("service") != "pbk-local-openclaw":
        return dict(checks, bridge="invalid_response")

    components = record(health.get("components"))
    runtime = record(health.get("runtime"))
    postgres = record(runtime.get("postgresHealth"))
    gateway = record(health.get("openClawGateway"))
    checks["bridge"] = (
        "up" if health.get("ok") is True and record(components.get("bridge")).get("ready") is True
        else "degraded"
    )
    checks["state_bootstrap"] = "up" if record(components.get("stateBootstrap")).get("ready") is True else "degraded"
    checks["postgres"] = (
        "up" if runtime.get("stateBackend") == "postgres" and postgres.get("status") == "up"
        else "degraded"
    )
    if gateway.get("ready") is True and gateway.get("status") == "up":
        checks["openclaw_gateway"] = "up"
    elif gateway.get("status") == "standby":
        checks["openclaw_gateway"] = "standby"
    elif gateway:
        checks["openclaw_gateway"] = "degraded"
    return checks


async def check_storage(client: httpx.AsyncClient, settings: Settings) -> str:
    if not settings.supabase_url or not settings.supabase_key:
        return "not_configured"
    status, _ = await get(
        client,
        settings.supabase_url + "/storage/v1/status",
        headers={"apikey": settings.supabase_key},
    )
    return status


def create_app(settings: Settings | None = None, *, transport=None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        application.state.settings = settings if settings is not None else Settings.from_env()
        async with httpx.AsyncClient(
            timeout=DEPENDENCY_TIMEOUT,
            transport=transport,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            application.state.client = client
            yield

    application = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @application.get("/live")
    async def live():
        return JSONResponse({"status": "alive"}, headers=NO_CACHE)

    @application.get("/ready")
    async def ready():
        cfg = application.state.settings
        client = application.state.client
        checks, storage = await asyncio.gather(check_bridge(client, cfg), check_storage(client, cfg))
        checks["supabase_storage"] = storage
        required = ["bridge", "state_bootstrap", "postgres"]
        if cfg.require_gateway:
            required.append("openclaw_gateway")
        if cfg.require_storage:
            required.append("supabase_storage")
        ready_now = all(checks[key] == "up" for key in required)
        status = "ready" if ready_now else "degraded"
        logger.info("PBK bridge readiness %s %s", status, checks)
        return JSONResponse(
            {"status": status, "checks": checks, "required": required},
            status_code=200 if ready_now else 503,
            headers=NO_CACHE,
        )

    return application


app = create_app()
