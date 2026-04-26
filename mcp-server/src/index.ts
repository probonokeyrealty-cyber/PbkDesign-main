#!/usr/bin/env node
/**
 * PBK OpenClaw MCP Server.
 *
 * Wraps the PBK OpenClaw bridge (https://pbk-openclaw-bridge.onrender.com or local
 * http://127.0.0.1:8788) so any MCP client can call the same tools the live PBK
 * Paradise frontend uses: deal analysis, approvals lifecycle, brain queries,
 * Telnyx SMS / call, DocuSign contracts, DNC, skip-trace, Slack notify.
 *
 * Configuration via environment variables:
 *   PBK_BRIDGE_ENDPOINT  Default: https://pbk-openclaw-bridge.onrender.com
 *   PBK_BRIDGE_API_KEY   Set to the bearer token the bridge requires (or leave
 *                        empty for an open local bridge).
 *
 * Transport: stdio. Configure in Claude Desktop / Cursor / etc:
 *
 *   {
 *     "mcpServers": {
 *       "pbk-openclaw": {
 *         "command": "node",
 *         "args": ["/abs/path/to/dist/index.js"],
 *         "env": {
 *           "PBK_BRIDGE_ENDPOINT": "https://pbk-openclaw-bridge.onrender.com",
 *           "PBK_BRIDGE_API_KEY": "<same as Render PBK_BRIDGE_API_KEY>"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerDealTools } from "./tools/deals.js";
import { registerApprovalTools } from "./tools/approvals.js";
import { registerBrainTools } from "./tools/brain.js";
import { registerCommsTools } from "./tools/comms.js";
import { registerMetaTools } from "./tools/meta.js";

const SERVER_NAME = "pbk-openclaw-mcp-server";
const SERVER_VERSION = "0.1.0";

async function main(): Promise<void> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerMetaTools(server);
  registerDealTools(server);
  registerApprovalTools(server);
  registerBrainTools(server);
  registerCommsTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // McpServer never returns from connect under stdio; this log goes to stderr
  // so it doesn't pollute the JSON-RPC channel on stdout.
  // eslint-disable-next-line no-console
  console.error(
    `[${SERVER_NAME} v${SERVER_VERSION}] connected via stdio. ` +
      `Bridge endpoint: ${process.env.PBK_BRIDGE_ENDPOINT || "https://pbk-openclaw-bridge.onrender.com"}. ` +
      `Auth: ${process.env.PBK_BRIDGE_API_KEY ? "enabled" : "open (no PBK_BRIDGE_API_KEY set)"}.`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[${SERVER_NAME}] fatal:`, error);
  process.exit(1);
});
