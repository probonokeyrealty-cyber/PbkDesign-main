import { createReadStream } from 'node:fs';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  DEFAULT_BRAIN_DIR,
  metadataFor,
  parseArgs,
  readKnowledgeUnits,
  resolveCliPath,
} from './pbk-brain-lib.mjs';

const args = parseArgs();
const brainDir = resolveCliPath(args.brain || args.b || DEFAULT_BRAIN_DIR);
const outputDir = resolveCliPath(args.output || args.o || path.join(brainDir, 'cloud-export'));
const send = Boolean(args.send);
const dryRun = !send || Boolean(args['dry-run']);
const ingestUrl = String(process.env.SUPERMEMORY_INGEST_URL || '').trim();
const apiKey = String(process.env.SUPERMEMORY_API_KEY || '').trim();
const cloudApproved = String(process.env.PBK_BRAIN_CLOUD_APPROVED || '').trim() === '1';

const units = await readKnowledgeUnits(brainDir);
await mkdir(outputDir, { recursive: true });

const exportPath = path.join(outputDir, 'supermemory-upload.jsonl');
const rows = units.map((unit) => ({
  id: unit.id,
  content: unit.text,
  metadata: {
    ...metadataFor(unit),
    app: 'PBK Wholesale Paradise',
    sourceType: 'conversation-memory',
    privacy: 'redacted-local-export',
  },
}));
await writeFile(exportPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    mode: 'dry-run',
    note: 'No cloud upload performed. Review the JSONL first, then run with --send plus SUPERMEMORY_INGEST_URL, SUPERMEMORY_API_KEY, and PBK_BRAIN_CLOUD_APPROVED=1.',
    exportPath,
    units: rows.length,
  }, null, 2));
  process.exit(0);
}

if (!cloudApproved) {
  throw new Error('Refusing cloud upload. Set PBK_BRAIN_CLOUD_APPROVED=1 after you approve this specific upload.');
}
if (!ingestUrl) {
  throw new Error('SUPERMEMORY_INGEST_URL is required because Supermemory API paths can vary by account/version.');
}
if (!apiKey) {
  throw new Error('SUPERMEMORY_API_KEY is required for --send.');
}

const response = await fetch(ingestUrl, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/x-ndjson',
  },
  body: createReadStream(exportPath),
  duplex: 'half',
});

const body = await response.text();
if (!response.ok) {
  throw new Error(`Supermemory ingest failed: ${response.status} ${response.statusText}\n${body}`);
}

console.log(JSON.stringify({
  ok: true,
  mode: 'uploaded',
  ingestUrl,
  units: rows.length,
  response: safeBody(body),
}, null, 2));

function safeBody(value) {
  const text = String(value || '');
  return text.length > 1200 ? `${text.slice(0, 1200)}...` : text;
}
