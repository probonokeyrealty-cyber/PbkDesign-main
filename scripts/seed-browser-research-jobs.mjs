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
  : path.join(ROOT_DIR, 'ops', 'browser-research', 'generated-jobs.json');

function inferPriority(tags = []) {
  if (tags.includes('probate') || tags.includes('pre-foreclosure')) return 'high';
  if (tags.includes('high-equity') || tags.includes('vacant')) return 'medium';
  return 'normal';
}

async function main() {
  if (!existsSync(STATE_FILE)) {
    throw new Error(`OpenClaw state file was not found at ${STATE_FILE}. Start the bridge once before seeding browser jobs.`);
  }

  const raw = await readFile(STATE_FILE, 'utf8');
  const state = JSON.parse(raw);
  const leadImports = Array.isArray(state?.leadImports) ? state.leadImports : [];

  const jobs = leadImports.slice(0, 12).map((lead, index) => {
    const tags = Array.isArray(lead?.tags) ? lead.tags : [];
    return {
      id: `browser-job-${index + 1}`,
      leadId: lead.leadId,
      sellerName: lead?.seller?.name || '',
      address: lead?.property?.address || '',
      city: lead?.property?.city || '',
      state: lead?.property?.state || '',
      source: lead.source || '',
      priority: inferPriority(tags),
      tags,
      tasks: [
        'public-records-owner-verify',
        'property-photos-and-condition-pass',
        'distress-signal-scan',
        'recent-listing-and-agent-scan',
      ],
    };
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    source: STATE_FILE,
    jobs,
  };

  await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, output: OUTPUT_FILE, jobs: jobs.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed to seed browser research jobs.');
  process.exitCode = 1;
});
