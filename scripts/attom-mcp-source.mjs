import { createAttomMcpClient } from './attom-mcp-client.mjs';
import { createAttomMcpPropertyReader } from './attom-mcp-property-records.mjs';

// Configuration is read once per coordinator. Constructing this source performs
// no authentication, discovery or property reads; only explicit enrichment does.
export function createConfiguredAttomMcpReader({
  env = process.env,
  now = () => new Date().toISOString(),
  createClient = createAttomMcpClient,
  createReader = createAttomMcpPropertyReader,
} = {}) {
  if (env.PBK_ATTOM_MCP_ENABLED !== 'true' ||
      typeof env.ATTOM_MCP_CLIENT_ID !== 'string' || !env.ATTOM_MCP_CLIENT_ID.trim() ||
      typeof env.ATTOM_MCP_CLIENT_SECRET !== 'string' || !env.ATTOM_MCP_CLIENT_SECRET.trim()) return null;
  const client = createClient({ env, timeoutMs: 60_000 });
  const reader = createReader({ client, now });
  return Object.assign(reader, { close: () => client.close() });
}
