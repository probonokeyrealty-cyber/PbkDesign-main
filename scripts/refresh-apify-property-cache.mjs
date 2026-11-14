import { execFile, spawn } from 'node:child_process';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(repo, '.pbk-local');
const statusPath = path.join(local, 'apify-90210-refresh.json');
const lockPath = path.join(local, 'apify-90210-refresh.lock');
const bridge = 'https://pbk-openclaw-bridge.onrender.com';
const actor = 'tri_angle/real-estate-aggregator';
const zip = '90210';
const providers = ['realtor', 'zillow', 'redfin'];
const fields = 'address.street,address.city,address.state,address.zip,price.value,price.currency,propertyType,source.url,source.provider,offerType,bedrooms,bathrooms,livingArea,landArea,areaUnit,extras.yearBuilt,extras.daysOnMarket,pictures';
const minRunIntervalMs = 6 * 24 * 60 * 60 * 1000;
const args = process.argv.slice(2);
const checkId = args[0] === '--check-run' && args.length === 2 ? args[1] : '';
const refresh = args.length === 1 && args[0] === '--refresh';
const resume = args.length === 1 && args[0] === '--resume';
const backfill = args.length === 1 && args[0] === '--backfill-listing-details';
const apply = refresh || resume || backfill;

async function connectApify() {
  const child = spawn('codex', ['app-server', '--stdio'], {
    cwd: repo, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  const requests = new Map();
  let id = 0;
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  const close = () => { lines.close(); child.stdin.end(); child.kill(); };
  const fail = (error) => {
    for (const request of requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    requests.clear();
  };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Codex app-server exited.')));
  child.stdin.on('error', fail);
  lines.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method && message.id !== undefined) {
      send({ id: message.id, error: { code: -32601, message: 'Interactive requests are not approved by this runner.' } });
      return;
    }
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(`Codex request failed: ${request.method}.`));
    else request.resolve(message.result);
  });
  function rpc(method, params) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(requestId);
        reject(new Error(`Codex request timed out: ${method}.`));
      }, 90_000);
      requests.set(requestId, { method, resolve, reject, timer });
      send({ id: requestId, method, params });
    });
  }
  try {
    await rpc('initialize', {
      clientInfo: { name: 'pbk-apify-refresh', version: '1.0.0' }, capabilities: { experimentalApi: true },
    });
    send({ method: 'initialized' });
    const status = await rpc('mcpServerStatus/list', { serverName: 'apify', detail: 'toolsAndAuthOnly' });
    const entry = status.data?.find((server) => server.name === 'apify');
    if (entry?.authStatus !== 'oAuth') throw new Error('Apify OAuth is not connected on this machine.');
    const required = ['call-actor', 'get-actor-run', 'get-dataset-items'];
    if (!required.every((name) => Object.values(entry.tools || {}).some((tool) => tool.name === name))) {
      throw new Error('The configured Apify connection does not expose the required tools.');
    }
    const { thread } = await rpc('thread/start', { cwd: repo, ephemeral: true });
    return {
      close,
      async call(tool, input) {
        const response = await rpc('mcpServer/tool/call', {
          threadId: thread.id, server: 'apify', tool, arguments: input,
        });
        if (response.isError || !response.structuredContent) {
          const details = response.content?.find((block) => block.type === 'text')?.text || '';
          const reason = /approve.*permission|full access/i.test(details) ? ' Actor permission approval is required in Apify.' : '';
          throw new Error(`Apify ${tool} failed.${reason}`);
        }
        return response.structuredContent;
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

async function readStatus() {
  try { return JSON.parse(await readFile(statusPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function saveStatus(status) {
  await writeFile(statusPath, JSON.stringify(status, null, 2) + '\n');
}

async function main() {
  if (!apply && !/^[a-zA-Z0-9]+$/.test(checkId)) {
    throw new Error('Use --check-run RUN_ID, --refresh, --resume, or --backfill-listing-details.');
  }
  if (apply && !process.env.PBK_BRIDGE_API_KEY) {
    throw new Error('PBK_BRIDGE_API_KEY is missing. No Actor run started.');
  }
  await mkdir(local, { recursive: true });
  const lock = await open(lockPath, 'wx');
  let apify;
  let reservation;
  let exportPath;
  try {
    const previous = await readStatus();
    if (refresh && Date.now() - Date.parse(previous.attemptedAt || '') < minRunIntervalMs) {
      console.log(JSON.stringify({ status: 'not-due', lastAttempt: previous.attemptedAt }));
      return;
    }
    if (resume && (previous.status !== 'failed' || !/^[a-zA-Z0-9]+$/.test(previous.runId || ''))) {
      throw new Error('There is no failed refresh with a saved Actor run to resume.');
    }
    if (backfill && (previous.status !== 'complete' || !/^[a-zA-Z0-9]+$/.test(previous.runId || ''))) {
      throw new Error('There is no completed refresh to backfill.');
    }
    if (apply) {
      const probe = await fetch(`${bridge}/state`, {
        headers: { Authorization: `Bearer ${process.env.PBK_BRIDGE_API_KEY}` },
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if (!probe.ok || !Number.isInteger((await probe.json()).status?.propertyCacheCount)) {
        throw new Error('Bridge preflight failed. No Actor run started.');
      }
    }
    apify = await connectApify();
    let run;
    if (refresh) {
      // Reserve the window before starting a billable run, including ambiguous network failures.
      reservation = { attemptedAt: new Date().toISOString(), status: 'starting' };
      await saveStatus(reservation);
      run = await apify.call('call-actor', {
        actor,
        input: { location: zip, offerType: 'sale', providers, maxResults: 100, includeDetails: false, deduplicateResults: false, units: 'imperial' },
        waitSecs: 45, callOptions: { timeout: 180, maxTotalChargeUsd: 1 },
      });
      reservation.runId = run.runId;
      await saveStatus(reservation);
      if (!/^[a-zA-Z0-9]+$/.test(run.runId || '')) throw new Error('Actor run ID was not returned.');
    } else {
      if (resume) reservation = previous;
      run = await apify.call('get-actor-run', { runId: resume || backfill ? previous.runId : checkId, waitSecs: 0 });
    }
    for (let i = 0; refresh && ['READY', 'RUNNING'].includes(run.status) && i < 4; i++) {
      run = await apify.call('get-actor-run', { runId: run.runId, waitSecs: 45 });
    }
    const dataset = run.storages?.datasets?.default;
    if (run.actorName !== actor || run.status !== 'SUCCEEDED' || !/^[a-zA-Z0-9]+$/.test(dataset?.id || '') || !Number.isFinite(Date.parse(run.finishedAt))) {
      throw new Error(`No completed listing dataset was available (status: ${run.status || 'unknown'}).`);
    }
    if (!Number.isInteger(dataset.itemCount) || dataset.itemCount < 1 || dataset.itemCount > 300) {
      throw new Error('Apify returned an empty or oversized dataset; cached listings were not changed.');
    }
    const { items } = await apify.call('get-dataset-items', { datasetId: dataset.id, limit: 300, fields });
    if (!Array.isArray(items) || items.length !== dataset.itemCount) throw new Error('Incomplete Apify dataset.');
    const inZip = items.filter((item) => item['address.zip'] === zip && item.offerType === 'sale');
    const returned = new Set(inZip.map((item) => item['source.provider']));
    if (!providers.every((provider) => returned.has(provider))) throw new Error('At least one listing provider returned no 90210 results; cache was not changed.');

    exportPath = path.join(local, `apify-90210-${dataset.id}.json`);
    await writeFile(exportPath, JSON.stringify(items));
    const reference = path.resolve(repo, '../90210-apify-listings-deduplicated.csv');
    const command = [
      '-NoProfile', '-File', path.join(repo, 'scripts/sync-apify-property-cache.ps1'),
      '-Zip', zip, '-DatasetId', dataset.id, '-CapturedAt', run.finishedAt,
      '-DatasetJsonPath', exportPath, '-AddressReferenceCsv', reference,
    ];
    if (apply) command.push('-BridgeUrl', bridge, '-KeepExistingAtCapacity', '-Apply');
    if (backfill) command.push('-ExistingDatasetOnly');
    let stdout;
    try {
      ({ stdout } = await exec('pwsh', command, { cwd: repo, windowsHide: true, timeout: 900_000, maxBuffer: 256 * 1024 }));
    } catch (error) {
      const message = error.stderr?.match(/PBK sync (?:lookup|write|snapshot) failed[^\r\n]*/)?.[0];
      throw new Error(message || `Property cache sync failed (exit: ${error.code ?? error.signal ?? 'unknown'}).`);
    }
    const summary = JSON.parse(stdout.slice(stdout.indexOf('{')));
    const result = { status: apply ? 'complete' : 'preview', runId: run.runId, ...summary };
    if (reservation) await saveStatus({ ...reservation, ...result });
    console.log(JSON.stringify(result));
  } catch (error) {
    if (reservation) await saveStatus({ ...reservation, status: 'failed' });
    throw error;
  } finally {
    apify?.close();
    if (exportPath) await unlink(exportPath).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
