/**
 * HTTP client for the PBK OpenClaw bridge.
 * Centralizes auth, error formatting, and JSON parsing so tool handlers
 * stay focused on shape mapping.
 */

const DEFAULT_ENDPOINT = "https://pbk-openclaw-bridge.onrender.com";
const REQUEST_TIMEOUT_MS = 30_000;

export interface BridgeRequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override per-request timeout. Defaults to 30s. */
  timeoutMs?: number;
}

export class BridgeError extends Error {
  constructor(
    public status: number,
    public path: string,
    public bodyPreview: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

function getEndpoint(): string {
  return (process.env.PBK_BRIDGE_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, "");
}

function getApiKey(): string {
  return (process.env.PBK_BRIDGE_API_KEY || "").trim();
}

function buildUrl(path: string, query?: BridgeRequestOptions["query"]): string {
  const url = new URL(`${getEndpoint()}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function bridgeRequest<T = unknown>(
  options: BridgeRequestOptions,
): Promise<T> {
  const { method = "GET", path, body, query, timeoutMs = REQUEST_TIMEOUT_MS } = options;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const apiKey = getApiKey();
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const init: RequestInit = { method, headers };
  if (body !== undefined && method !== "GET" && method !== "DELETE") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), init);
  } catch (error) {
    clearTimeout(timer);
    if ((error as Error).name === "AbortError") {
      throw new BridgeError(0, path, "", `Bridge request to ${path} timed out after ${timeoutMs}ms`);
    }
    throw new BridgeError(0, path, "", `Bridge request to ${path} failed: ${(error as Error).message}`);
  }
  clearTimeout(timer);

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }

  if (!response.ok) {
    const preview = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
    throw new BridgeError(
      response.status,
      path,
      preview.slice(0, 500),
      bridgeStatusMessage(response.status, path, preview),
    );
  }
  return parsed as T;
}

function bridgeStatusMessage(status: number, path: string, preview: string): string {
  switch (status) {
    case 401:
      return `Unauthorized on ${path}. Set PBK_BRIDGE_API_KEY to the same value the bridge has, or remove auth on the bridge for local dev.`;
    case 404:
      return `Bridge has no route for ${path}. The bridge may be on an older revision — check GET /health 'revision' field.`;
    case 429:
      return `Bridge rate-limited the request to ${path}. Slow down and retry.`;
    case 500:
      return `Bridge returned 500 on ${path}: ${preview.slice(0, 200)}`;
    default:
      return `Bridge returned ${status} on ${path}: ${preview.slice(0, 200)}`;
  }
}

export async function bridgeInvoke<T = unknown>(
  toolName: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return bridgeRequest<T>({
    method: "POST",
    path: "/invoke",
    body: { toolName, params },
  });
}

/** Format an error from the client into a string the LLM can read. */
export function formatBridgeError(error: unknown): string {
  if (error instanceof BridgeError) return error.message;
  if (error instanceof Error) return `Unexpected error: ${error.message}`;
  return `Unexpected error: ${String(error)}`;
}

/**
 * Helper used by tools that want to return both the raw bridge result and
 * a markdown summary in a single content payload.
 */
export function jsonText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}
