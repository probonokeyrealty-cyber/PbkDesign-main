import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPbkReadOnlyMcpServer } from '../runtime/pbk-readonly-mcp.mjs';
import { bridgeRequest } from './client.js';
import { registerDealTools } from './tools/deals.js';
import { registerApprovalTools } from './tools/approvals.js';
import { registerBrainTools } from './tools/brain.js';
import { registerCommsTools } from './tools/comms.js';
import { registerAdminTools } from './tools/admin.js';
import { registerMetaTools } from './tools/meta.js';

export function createPbkMcpServer({ readOnly = false }: { readOnly?: boolean } = {}): McpServer {
  if (readOnly) {
    return createPbkReadOnlyMcpServer({
      readStatus: async (kind) => {
        if (kind === 'registry') return bridgeRequest({ path: '/api/agents/registry' });
        if (kind === 'health') return bridgeRequest({ path: '/health' });
        const response = await bridgeRequest<{ tooling?: { composio?: Record<string, unknown> } }>({
          path: '/api/tooling/status',
        });
        return response.tooling?.composio || {};
      },
    });
  }
  const server = new McpServer({ name: 'pbk-openclaw-mcp-server', version: '0.1.0' });
  registerMetaTools(server);
  registerDealTools(server);
  registerApprovalTools(server);
  registerBrainTools(server);
  registerCommsTools(server);
  registerAdminTools(server);
  return server;
}
