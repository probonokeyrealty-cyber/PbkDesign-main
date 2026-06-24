import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dockerfile = readFileSync(resolve(root, 'Dockerfile.openclaw'), 'utf8');
const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
const renderYaml = readFileSync(resolve(root, 'render.yaml'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function expectIncludes(source, needle, message) {
  assert(source.includes(needle), message);
}

assert.match(
  renderYaml,
  /name:\s*pbk-openclaw-bridge[\s\S]*runtime:\s*docker/,
  'Render bridge must run as a Docker service.'
);
expectIncludes(
  renderYaml,
  'dockerfilePath: ./Dockerfile.openclaw',
  'Render must build Dockerfile.openclaw.'
);
expectIncludes(renderYaml, 'dockerContext: .', 'Render Docker context must be the repo root.');
expectIncludes(renderYaml, 'healthCheckPath: /health', 'Render health check must hit /health.');

assert.match(
  dockerfile,
  /^FROM node:22-slim AS frontend/m,
  'Docker image must build the modern command-center shell in a frontend stage.'
);
assert.match(
  dockerfile,
  /^FROM node:22-slim/m,
  'Docker image must use the Node 22 Debian slim base.'
);
assert.match(
  dockerfile,
  /RUN npm run build --ignore-scripts/,
  'Docker frontend stage must build Vite shell assets without running repo lifecycle hooks.'
);
expectIncludes(
  dockerfile,
  'npm ci --legacy-peer-deps --ignore-scripts',
  'Docker frontend dependency install must skip git-hook prepare scripts that are not copied into the image.'
);
assert.equal(
  packageJson.dependencies?.react,
  '18.3.1',
  'React must be a production dependency so Docker clean installs include react/jsx-runtime.'
);
assert.equal(
  packageJson.dependencies?.['react-dom'],
  '18.3.1',
  'React DOM must be a production dependency so Docker clean installs can build the shell.'
);
expectIncludes(
  dockerfile,
  'ENV PUPPETEER_SKIP_DOWNLOAD=true',
  'Docker image must skip bundled Puppeteer browser downloads.'
);
expectIncludes(
  dockerfile,
  '@sparticuz/chromium@147.0.1',
  'Docker image must install the pinned Sparticuz Chromium runtime.'
);
expectIncludes(
  dockerfile,
  'puppeteer-core@24.41.0',
  'Docker image must install pinned puppeteer-core.'
);
expectIncludes(dockerfile, 'pg@8.13.1', 'Docker image must install the Postgres client.');
expectIncludes(dockerfile, 'redis@5.10.0', 'Docker image must install Redis client support.');
assert(
  !/--loglevel=error/.test(dockerfile),
  'Docker npm install must not force error-level logging for successful build steps.'
);
expectIncludes(
  dockerfile,
  '--loglevel=warn',
  'Docker npm install should use warning-level logging.'
);

expectIncludes(dockerfile, 'ENV PORT=10000', 'Docker image must default PORT to 10000 for Render.');
expectIncludes(dockerfile, 'EXPOSE 10000', 'Docker image must expose Render fallback port 10000.');
expectIncludes(
  dockerfile,
  'CMD ["node", "./scripts/openclaw-local-server.mjs", "--public"]',
  'Docker image must start the hosted bridge in public mode.'
);
expectIncludes(
  dockerfile,
  'COPY --from=frontend /frontend/dist/index.shell.html ./index.shell.html',
  'Docker runtime image must serve the built React command-center shell.'
);
expectIncludes(
  dockerfile,
  'COPY --from=frontend /frontend/dist/assets ./assets',
  'Docker runtime image must include built Vite assets for the shell.'
);

[
  'scripts/openclaw-local-server.mjs',
  'scripts/observability.mjs',
  'scripts/agent-registry.mjs',
  'scripts/nurture-agent.mjs',
  'scripts/onnx-training-worker.mjs',
  'scripts/research-additives.mjs',
  'scripts/property-data-adapter.mjs',
  'index.html',
  'analyzer.html',
  'index.shell.html',
  'public',
  'contracts',
  'wholesale.agent.md',
  'labs/meta-agent/generated',
  'ops/browser-research',
  'ops/monitoring',
  'mcp-servers',
  'n8n-lite/tooling-health-check.json',
  '.github/workflows/tooling-verify.yml',
].forEach((target) => {
  expectIncludes(dockerfile, `COPY ${target}`, `Docker image must copy ${target}.`);
});

[
  '!index.html',
  '!analyzer.html',
  '!index.shell.html',
  '!vite.config.ts',
  '!tsconfig.json',
  '!postcss.config.mjs',
  '!tailwind.pbk.config.ts',
  '!src',
  '!src/**',
  '!public',
  '!public/**',
  '!contracts',
  '!contracts/**',
  '!wholesale.agent.md',
  '!n8n-lite/tooling-health-check.json',
  '!.github/workflows/tooling-verify.yml',
].forEach((pattern) => {
  expectIncludes(dockerignore, pattern, `.dockerignore must keep ${pattern} available to Docker.`);
});

console.log(JSON.stringify({ ok: true, result: 'docker_render_config_ready' }, null, 2));
