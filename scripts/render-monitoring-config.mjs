import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'ops', 'monitoring', 'prometheus', 'generated.prometheus.yml');

const target = process.env.PBK_PROM_TARGET || 'host.docker.internal:8788';
const apiKey = process.env.PBK_PROM_API_KEY || '__SET_PBK_BRIDGE_API_KEY__';

const body = `global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "pbk-openclaw"
    metrics_path: /metrics
    authorization:
      credentials: "${apiKey}"
    static_configs:
      - targets: ["${target}"]
`;

await mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
await writeFile(OUTPUT_FILE, body, 'utf8');
console.log(JSON.stringify({ ok: true, output: OUTPUT_FILE, target }, null, 2));
