// Kept outside Jest discovery because these checks exercise child processes and workflow YAML.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowsDirectory = path.join(repoRoot, '.github', 'workflows');
const plannerPath = path.join(repoRoot, 'scripts', 'pbk-agent-planner.mjs');

function runPlanner(fetchMode) {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'pbk-ci-hardening-'));
  const preloadPath = path.join(temporaryDirectory, 'mock-fetch.mjs');

  writeFileSync(
    preloadPath,
    `
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.startsWith('https://api.github.com')) {
    if (process.env.PBK_CI_FETCH_MODE === 'github-failure') {
      return new Response('github unavailable', { status: 503 });
    }
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url === 'https://hooks.slack.test/planner') {
    if (process.env.PBK_CI_FETCH_MODE === 'slack-network-failure') {
      throw new Error('socket reset');
    }
    return new Response('temporary Slack outage', { status: 503 });
  }
  throw new Error(\`Unexpected fetch in CI hardening test: \${url}\`);
};
`,
  );

  try {
    return spawnSync(process.execPath, ['--import', pathToFileURL(preloadPath).href, plannerPath, '--dry-run'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REPOSITORY: 'pbk/test-repository',
        GITHUB_TOKEN: 'test-github-token',
        GOOGLE_API_KEY: 'test-google-key',
        PBK_CI_FETCH_MODE: fetchMode,
        PBK_SLACK_WEBHOOK_URL: 'https://hooks.slack.test/planner',
      },
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function getFounderInstallStep() {
  const workflowPath = path.join(workflowsDirectory, 'founder-verify.yml');
  const workflow = parse(readFileSync(workflowPath, 'utf8'));
  return workflow.jobs['founder-verify'].steps.find((step) => step.name === 'Install dependencies with retry');
}

function runFounderInstallScript(mode) {
  const installStep = getFounderInstallStep();
  const fakeCommands = `
export NPM_INSTALL_ATTEMPTS=3
export NPM_INSTALL_RETRY_SECONDS=0
export PBK_CI_NPM_MODE='${mode}'

PBK_TEST_COUNTER="$(mktemp)"
printf '0' > "$PBK_TEST_COUNTER"
trap 'rm -f "$PBK_TEST_COUNTER"' EXIT

npm() {
  local count
  count="$(cat "$PBK_TEST_COUNTER")"
  count="$((count + 1))"
  printf '%s' "$count" > "$PBK_TEST_COUNTER"
  echo "fake npm call \${count}: $*"

  case "$PBK_CI_NPM_MODE" in
    transient-then-success)
      if [ "$count" -eq 1 ]; then
        echo "npm ERR! code ECONNRESET"
        return 43
      fi
      ;;
    persistent-reset)
      echo "npm ERR! code ECONNRESET"
      return 43
      ;;
    non-transient)
      echo "npm ERR! code E404"
      return 42
      ;;
  esac
}

sleep() {
  :
}
`;

  return spawnSync('bash', ['-s'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: `${fakeCommands}\n${installStep.run}\n`,
    env: process.env,
  });
}

test('Agent Planner reports Slack notification failure without failing the planner run', () => {
  const result = runPlanner('slack-failure');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /::warning::Slack notification failed \(503\): temporary Slack outage/);
  assert.match(result.stdout, /"ok": true/);
});

test('Agent Planner identifies lower-level Slack transport failures', () => {
  const result = runPlanner('slack-network-failure');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /::warning::Slack notification failed: socket reset/);
  assert.match(result.stdout, /"ok": true/);
});

test('Agent Planner preserves core GitHub failures as fatal', () => {
  const result = runPlanner('github-failure');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GitHub GET .* failed \(503\): github unavailable/);
  assert.doesNotMatch(result.stdout, /"ok": true/);
});

test('CI workflows use current Node 24 action majors and valid YAML', () => {
  const workflowFiles = readdirSync(workflowsDirectory)
    .filter((fileName) => fileName.endsWith('.yml'))
    .sort();

  assert.ok(workflowFiles.length > 0);

  for (const workflowFile of workflowFiles) {
    const workflowPath = path.join(workflowsDirectory, workflowFile);
    const source = readFileSync(workflowPath, 'utf8');

    assert.doesNotThrow(() => parse(source), `${workflowFile} must contain valid YAML`);

    for (const match of source.matchAll(/uses:\s*actions\/(checkout|setup-node)@([^\s]+)/g)) {
      assert.equal(
        match[2],
        'v6',
        `${workflowFile} must use actions/${match[1]}@v6 for the current Node 24 action runtime`,
      );
    }
  }
});

test('Founder Verify retries only transient ECONNRESET npm installs and preserves final failures', () => {
  const installStep = getFounderInstallStep();

  assert.ok(installStep, 'Founder Verify must define one reusable dependency install step');
  assert.equal(installStep.shell, 'bash');
  assert.equal(Number(installStep.env.NPM_INSTALL_ATTEMPTS), 3);
  assert.match(installStep.run, /npm_ci_with_retry\(\)/);
  assert.match(installStep.run, /grep -qi ['"]ECONNRESET['"]/);
  assert.match(installStep.run, /return "\$status"/);
  assert.match(installStep.run, /npm_ci_with_retry ['"]root dependencies['"] npm ci/);
  assert.match(installStep.run, /npm_ci_with_retry ['"]MCP server dependencies['"] npm ci --prefix \.\/mcp-server/);
});

test('Founder Verify retry shell logic succeeds transiently and fails bounded persistent errors', () => {
  const transient = runFounderInstallScript('transient-then-success');
  assert.equal(transient.status, 0, transient.stderr);
  assert.equal(
    (transient.stdout.match(/fake npm call/g) || []).length,
    3,
    `${transient.stdout}\n${transient.stderr}`,
  );
  assert.match(transient.stdout, /root dependencies hit ECONNRESET; retrying/);

  const persistent = runFounderInstallScript('persistent-reset');
  assert.equal(persistent.status, 43, persistent.stderr);
  assert.equal((persistent.stdout.match(/fake npm call/g) || []).length, 3);
  assert.match(persistent.stdout, /failed after 3 ECONNRESET attempts/);

  const nonTransient = runFounderInstallScript('non-transient');
  assert.equal(nonTransient.status, 42, nonTransient.stderr);
  assert.equal((nonTransient.stdout.match(/fake npm call/g) || []).length, 1);
  assert.match(nonTransient.stdout, /non-transient npm error; not retrying/);
});
