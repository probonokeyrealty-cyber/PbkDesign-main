import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { bridgeRequest, formatBridgeError } from "../client.js";

const HealthInput = z.object({}).strict();

export function registerMetaTools(server: McpServer): void {
  server.registerTool(
    "pbk_health",
    {
      title: "Bridge health + revision",
      description: `Hit the bridge's /health endpoint. Tells you the build revision deployed, whether auth is required, and the tools the bridge knows about. Useful as a first call to confirm the bridge is reachable and on the expected revision.

Args:
  (none)

Returns:
  { ok: boolean, service, revision, host, port, tools: string[], features: {documentsPdf, approvals, contracts, analyzerBridge, authRequired}, n8n: {...}, lastUpdatedAt }`,
      inputSchema: HealthInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await bridgeRequest({ method: "GET", path: "/health" });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "pbk_list_tools",
    {
      title: "List bridge tools",
      description: `Return the full list of tool names the bridge's /invoke endpoint accepts. Use this to discover capabilities the MCP doesn't already wrap directly.

Args:
  (none)

Returns:
  { ok: true, revision, features: {...}, tools: string[] }`,
      inputSchema: HealthInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const result = await bridgeRequest({ method: "GET", path: "/api/tools" });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: formatBridgeError(error) }],
          isError: true,
        };
      }
    },
  );
}
