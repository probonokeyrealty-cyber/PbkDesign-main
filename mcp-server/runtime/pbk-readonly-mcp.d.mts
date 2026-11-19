import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export function createPbkReadOnlyMcpServer(options: {
  readStatus: (kind: string) => Promise<unknown>;
  onRead?: (name?: string) => void;
}): McpServer;
