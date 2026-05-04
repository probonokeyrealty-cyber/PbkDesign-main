import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const VENV_DIR = path.join(ROOT_DIR, '.venv');
const PYTHON_BIN = process.platform === 'win32'
  ? path.join(VENV_DIR, 'Scripts', 'python.exe')
  : path.join(VENV_DIR, 'bin', 'python');

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function runPython(code, timeout = 180000) {
  if (!existsSync(PYTHON_BIN)) {
    return {
      ok: false,
      error: `Missing local Python environment at ${PYTHON_BIN}`,
    };
  }
  const result = spawnSync(PYTHON_BIN, ['-c', code], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
    },
  });
  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim(),
      error: result.error ? result.error.message : '',
    };
  }
  const stdout = String(result.stdout || '').trim();
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning; libraries may log before JSON.
    }
  }
  return {
    ok: false,
    stdout,
    error: 'Python command did not return JSON.',
  };
}

function toInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  const next = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, next));
}

function pythonString(value) {
  return JSON.stringify(String(value || ''));
}

function pythonBool(value) {
  return value ? 'True' : 'False';
}

function runHomeHarvest() {
  const location = getArg('--location', getArg('--zip', '43215'));
  const listingType = getArg('--listing-type', 'for_sale');
  const limit = toInt(getArg('--limit', '10'), 10, 1, 50);
  const cacheOnly = hasFlag('--cache-only');
  const code = `
from homeharvest import scrape_property
import json, math

location = ${pythonString(location)}
listing_type = ${pythonString(listingType)}
limit = ${limit}

def clean(value):
    try:
        if isinstance(value, float) and math.isnan(value):
            return None
    except Exception:
        pass
    return value

def first_phone(value):
    if isinstance(value, list) and value:
        item = value[0] or {}
        if isinstance(item, dict):
            return item.get("number") or ""
    return ""

def normalize(raw):
    raw = {k: clean(v) for k, v in dict(raw).items()}
    address = raw.get("formatted_address") or ", ".join([x for x in [
        raw.get("full_street_line"),
        raw.get("city"),
        raw.get("state"),
        raw.get("zip_code"),
    ] if x])
    lead_id = "lead-homeharvest-" + str(raw.get("property_id") or raw.get("listing_id") or address).lower().replace(" ", "-")
    property_data = {
        "address": address,
        "city": raw.get("city") or "",
        "state": raw.get("state") or "",
        "zip": raw.get("zip_code") or "",
        "status": raw.get("status") or raw.get("mls_status") or "",
        "propertyUrl": raw.get("property_url") or "",
        "propertyId": raw.get("property_id") or "",
        "listingId": raw.get("listing_id") or "",
        "mls": raw.get("mls") or "",
        "mlsId": raw.get("mls_id") or "",
        "propertyType": raw.get("style") or "",
        "beds": raw.get("beds"),
        "baths": raw.get("full_baths"),
        "sqft": raw.get("sqft"),
        "yearBuilt": raw.get("year_built"),
        "listPrice": raw.get("list_price"),
        "estimatedValue": raw.get("estimated_value"),
        "daysOnMarket": raw.get("days_on_mls"),
        "county": raw.get("county") or "",
        "latitude": raw.get("latitude"),
        "longitude": raw.get("longitude"),
        "sourceUrl": raw.get("property_url") or "",
        "raw": raw,
    }
    lead = {
        "id": lead_id,
        "leadId": lead_id,
        "source": "homeharvest",
        "leadSource": "homeharvest",
        "status": "new",
        "stage": "property-data",
        "seller": {
            "name": raw.get("agent_name") or raw.get("broker_name") or "Listing Agent",
            "phone": first_phone(raw.get("agent_phones")) or first_phone(raw.get("office_phones")),
            "email": raw.get("agent_email") or raw.get("office_email") or "",
            "relationshipToProperty": "listing_agent" if raw.get("agent_name") else "unknown",
        },
        "property": {
            "address": address,
            "city": raw.get("city") or "",
            "state": raw.get("state") or "",
            "zip": raw.get("zip_code") or "",
            "beds": raw.get("beds"),
            "baths": raw.get("full_baths"),
            "sqft": raw.get("sqft"),
            "yearBuilt": raw.get("year_built"),
            "askingPrice": raw.get("list_price"),
            "arv": raw.get("estimated_value"),
        },
        "motivation": {
            "summary": "Imported from active listing data. Human review required before outreach.",
            "timeline": "unknown",
            "askingPrice": raw.get("list_price"),
        },
        "compliance": {
            "consentStatus": "unknown",
            "dncStatus": "needs_review",
        },
        "tags": ["homeharvest", listing_type, "public-listing", "needs-review"],
        "notes": "Imported from HomeHarvest. Verify owner/agent context and compliance before outreach.",
        "propertyData": property_data,
    }
    return {"lead": lead, "propertyData": property_data}

df = scrape_property(location, listing_type=listing_type, return_type="pandas", limit=limit)
records = df.head(limit).to_dict(orient="records") if hasattr(df, "to_dict") else []
items = [normalize(record) for record in records]
print(json.dumps({
    "ok": True,
    "provider": "homeharvest",
    "location": location,
    "listingType": listing_type,
    "count": len(items),
    "leads": [] if ${cacheOnly ? 'True' : 'False'} else [item["lead"] for item in items],
    "propertyCache": [item["propertyData"] for item in items],
}, default=str))
`;
  return runPython(code);
}

function runScrapling() {
  const url = getArg('--url', 'https://example.com');
  const mode = String(getArg('--mode', hasFlag('--stealth') ? 'stealth' : 'auto')).trim().toLowerCase();
  const waitMs = toInt(getArg('--wait', '3000'), 3000, 0, 30000);
  const timeoutMs = toInt(getArg('--timeout', '45000'), 45000, 5000, 180000);
  const proxy = getArg('--proxy', '');
  const realChrome = hasFlag('--real-chrome');
  const solveCloudflare = hasFlag('--solve-cloudflare');
  const headless = !hasFlag('--headed');
  const disableResources = hasFlag('--disable-resources');
  const networkIdle = hasFlag('--network-idle') || mode === 'stealth';
  const hideCanvas = hasFlag('--hide-canvas');
  const blockWebrtc = hasFlag('--block-webrtc');
  const code = `
from scrapling import Fetcher
from scrapling.fetchers import DynamicFetcher, StealthyFetcher
import json, re
url = ${pythonString(url)}
mode = ${pythonString(mode)}
wait_ms = ${waitMs}
timeout_ms = ${timeoutMs}
proxy = ${pythonString(proxy)}
stealth_kwargs = {
    "headless": ${pythonBool(headless)},
    "network_idle": ${pythonBool(networkIdle)},
    "timeout": timeout_ms,
    "wait": wait_ms,
    "real_chrome": ${pythonBool(realChrome)},
    "solve_cloudflare": ${pythonBool(solveCloudflare)},
    "disable_resources": ${pythonBool(disableResources)},
    "hide_canvas": ${pythonBool(hideCanvas)},
    "block_webrtc": ${pythonBool(blockWebrtc)},
}
if proxy:
    stealth_kwargs["proxy"] = proxy

def page_title(page):
    try:
        return page.css("title::text").get(default="") if hasattr(page, "css") else ""
    except Exception:
        return ""

def page_text(page):
    try:
        body = getattr(page, "body", b"") or b""
        if isinstance(body, (bytes, bytearray)):
            html = body[:500000].decode("utf-8", errors="ignore")
        else:
            html = str(body)[:500000]
        html = re.sub(r"(?is)<(script|style|noscript).*?</\\1>", " ", html)
        text = re.sub(r"(?s)<[^>]+>", " ", html)
        return re.sub(r"\\s+", " ", text).strip()
    except Exception:
        try:
            return str(getattr(page, "text", "") or "")
        except Exception:
            return ""

def serialize_page(page, fetch_mode, error=""):
    text = str(page_text(page) or "")
    status = getattr(page, "status", None)
    blocked = status in (401, 403, 407, 408, 409, 423, 425, 429, 451, 503) or any(
        needle in text.lower()
        for needle in [
            "request could not be processed",
            "access denied",
            "captcha",
            "cloudflare",
            "verify you are human",
            "unusual traffic",
            "blocked",
        ]
    )
    return {
        "ok": status == 200 and not blocked,
        "blocked": blocked,
        "provider": "scrapling",
        "mode": fetch_mode,
        "url": getattr(page, "url", url),
        "status": status,
        "title": page_title(page),
        "textSnippet": text[:2000],
        "error": error,
    }

def fetch_basic():
    return serialize_page(Fetcher.get(url), "basic")

def fetch_dynamic():
    return serialize_page(DynamicFetcher.fetch(url, **stealth_kwargs), "dynamic")

def fetch_stealth():
    return serialize_page(StealthyFetcher.fetch(url, **stealth_kwargs), "stealth")

attempts = []
if mode in ("basic", "fetcher", "http"):
    result = fetch_basic()
elif mode in ("dynamic", "browser"):
    result = fetch_dynamic()
elif mode in ("stealth", "stealthy"):
    result = fetch_stealth()
else:
    result = fetch_basic()
    attempts.append(result)
    if result.get("blocked") or result.get("status") in (401, 403, 429, 503):
        try:
            result = fetch_stealth()
        except Exception as exc:
            result = {
                **attempts[-1],
                "ok": False,
                "mode": "auto",
                "error": f"Stealth retry failed: {type(exc).__name__}: {exc}",
            }
    if not attempts or attempts[-1].get("mode") != result.get("mode"):
        attempts.append(result)
safe_attempts = []
for item in attempts or [result]:
    safe_attempts.append({key: value for key, value in item.items() if key != "attempts"})
result["attempts"] = safe_attempts
print(json.dumps({
    **result,
    "stealthOptions": {
        "waitMs": wait_ms,
        "timeoutMs": timeout_ms,
        "networkIdle": ${pythonBool(networkIdle)},
        "realChrome": ${pythonBool(realChrome)},
        "solveCloudflare": ${pythonBool(solveCloudflare)},
        "disableResources": ${pythonBool(disableResources)},
        "proxyConfigured": bool(proxy),
    },
}))
`;
  return runPython(code, Math.max(90000, timeoutMs + waitMs + 30000));
}

const command = String(process.argv[2] || '').trim().toLowerCase();
let result;
if (command === 'homeharvest') {
  result = runHomeHarvest();
} else if (command === 'scrapling') {
  result = runScrapling();
} else {
  result = {
    ok: false,
    error: 'Usage: node scripts/property-data-adapter.mjs <homeharvest|scrapling> [--location 43215] [--listing-type for_sale] [--limit 10] [--url https://example.com] [--mode auto|basic|dynamic|stealth] [--wait 3000] [--timeout 45000]',
  };
}

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;
