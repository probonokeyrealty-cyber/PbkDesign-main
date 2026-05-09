import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(__filename), '..');

const args = new Set(process.argv.slice(2));
const publish = args.has('--publish') || args.has('--activate');
const activate = args.has('--activate');
const bridgeUrl = String(process.env.PBK_BRIDGE_URL || process.env.PBK_PUBLIC_BASE_URL || 'http://127.0.0.1:8788').replace(/\/+$/g, '');
const bridgeKey = String(process.env.PBK_BRIDGE_API_KEY || '').trim();

const workflows = [
  {
    id: 'rex-strategist',
    file: path.join(ROOT_DIR, 'n8n-lite', 'rex-strategist.workflow.json'),
  },
  {
    id: 'rex-outcome-evaluator',
    file: path.join(ROOT_DIR, 'n8n-lite', 'rex-outcome-evaluator.workflow.json'),
  },
];

function validateWorkflow(workflow, file) {
  const checks = {
    hasName: Boolean(workflow.name),
    hasNodes: Array.isArray(workflow.nodes) && workflow.nodes.length >= 2,
    hasTrigger: Array.isArray(workflow.nodes) && workflow.nodes.some((node) => /trigger/i.test(`${node.type || ''} ${node.name || ''}`)),
    hasHttpRequest: Array.isArray(workflow.nodes) && workflow.nodes.some((node) => String(node.type || '').includes('httpRequest')),
    hasConnections: Boolean(workflow.connections && typeof workflow.connections === 'object' && Object.keys(workflow.connections).length),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    file,
    name: workflow.name || '',
    nodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
    checks,
  };
}

async function postToBridge(pathname, body) {
  const response = await fetch(`${bridgeUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(bridgeKey ? { Authorization: `Bearer ${bridgeKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Bridge returned ${response.status}`);
  }
  return payload;
}

const results = [];
for (const item of workflows) {
  const raw = await readFile(item.file, 'utf8');
  const workflow = JSON.parse(raw);
  const validation = validateWorkflow(workflow, item.file);
  const result = {
    id: item.id,
    validation,
    publish: null,
  };

  if (!validation.ok) {
    result.publish = { ok: false, skipped: true, error: 'Workflow failed local validation.' };
  } else if (publish) {
    result.publish = await postToBridge('/api/workflows/publish', {
      id: item.id,
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings || {},
      activate,
      active: activate,
      forcePublish: true,
      metadata: {
        sourceFile: path.relative(ROOT_DIR, item.file).replace(/\\/g, '/'),
        importedBy: 'scripts/publish-rex-workflows.mjs',
      },
    });
  } else {
    result.publish = { ok: true, dryRun: true, skipped: true };
  }

  results.push(result);
}

console.log(JSON.stringify({
  ok: results.every((result) => result.validation.ok && result.publish?.ok !== false),
  mode: publish ? (activate ? 'publish-and-activate' : 'publish') : 'dry-run',
  bridgeUrl: publish ? bridgeUrl : null,
  results,
}, null, 2));
