import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const STATE_FILE = process.env.PBK_OPENCLAW_STATE_FILE
  ? path.resolve(ROOT_DIR, process.env.PBK_OPENCLAW_STATE_FILE)
  : path.join(ROOT_DIR, '.pbk-local', 'openclaw-state.json');
const OUTPUT_FILE = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(ROOT_DIR, 'labs', 'meta-agent', 'generated', 'latest-scenario.json');

function sliceRecent(items, count = 8) {
  return Array.isArray(items) ? items.slice(0, count) : [];
}

async function main() {
  if (!existsSync(STATE_FILE)) {
    throw new Error(`OpenClaw state file was not found at ${STATE_FILE}. Start the bridge once before exporting a scenario.`);
  }

  const raw = await readFile(STATE_FILE, 'utf8');
  const state = JSON.parse(raw);

  const scenario = {
    exportedAt: new Date().toISOString(),
    source: STATE_FILE,
    runtime: {
      revision: state?.status?.revision || '',
      mode: state?.status?.mode || '',
      pendingApprovals: Array.isArray(state?.approvals) ? state.approvals.filter((item) => item.status === 'pending').length : 0,
      pendingAdminTasks: Array.isArray(state?.adminTasks) ? state.adminTasks.filter((item) => item.status === 'pending').length : 0,
    },
    leads: sliceRecent(state?.leadImports, 6).map((lead) => ({
      leadId: lead.leadId,
      sellerName: lead?.seller?.name || '',
      phone: lead?.seller?.phone || '',
      address: lead?.property?.address || '',
      tags: Array.isArray(lead?.tags) ? lead.tags : [],
      source: lead.source || '',
    })),
    calls: sliceRecent(state?.calls, 4).map((call) => ({
      id: call.id,
      leadId: call.leadId,
      leadName: call.leadName,
      address: call.address,
      status: call.status,
      sentiment: call.sentiment || '',
    })),
    approvals: sliceRecent(state?.approvals, 6).map((approval) => ({
      id: approval.id,
      type: approval.type,
      leadName: approval.leadName,
      address: approval.address,
      offerPrice: approval.offerPrice,
      mao: approval.mao,
      notes: approval.notes,
      status: approval.status,
    })),
    recentMessages: sliceRecent(state?.messages, 8).map((message) => ({
      id: message.id,
      direction: message.direction,
      channel: message.channel,
      leadName: message.leadName,
      body: message.body,
      status: message.status,
    })),
    brainHighlights: sliceRecent(state?.brainDocs, 5).map((doc) => ({
      id: doc.id,
      title: doc.title,
      topic: doc.topic,
      summary: doc.summary || doc.excerpt || '',
      tags: Array.isArray(doc.tags) ? doc.tags : [],
    })),
    evaluationRubric: {
      successSignals: [
        'Recovered seller trust after objection',
        'Held below MAO while moving toward verbal yes',
        'Escalated correctly when approval or underwriting was needed',
      ],
      failureSignals: [
        'Exceeded MAO or ignored DNC/guardrail constraints',
        'Missed admin approval on infrastructure changes',
        'Pushed contract before seller was ready',
      ],
    },
  };

  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(scenario, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, output: OUTPUT_FILE, leads: scenario.leads.length, approvals: scenario.approvals.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed to export meta-agent scenario.');
  process.exitCode = 1;
});
