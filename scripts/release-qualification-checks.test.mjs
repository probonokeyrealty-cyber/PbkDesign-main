import { jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const avaIds = [
  'already-gave-price-no-repeat',
  'repeat-complaint-advance',
  'make-offer-before-facts',
  'make-offer-after-price-address',
  'friday-close-with-price',
  'fast-sale-needs-price',
  'fast-sale-known-price-and-timeline',
  'competing-offer-terms',
  'price-too-low-net-question',
  'need-to-think-specific-hesitation',
  'spouse-decision-maker',
  'trust-scam-proof',
  'probate-handoff',
  'attorney-review-handoff',
  'trustee-bankruptcy-handoff',
  'stop-contact-no-question',
  'seller-max-net-rbp',
  'subject-to-path-signal',
  'seller-finance-path-signal',
  'land-path-signal',
  'caller-is-agent',
  'agent-top-dollar-not-cash-default',
  'partial-address-needs-canonical-address',
  'full-facts-advance-to-timeline',
  'tenant-pain-do-not-jump-offer',
  'emotional-loss-handoff',
  'ambiguous-yes-clarifies',
  'send-contract-confirm-before-action',
  'agent-cash-does-not-work',
  'governed-trust-skill-cockpit',
];
const behaviorIds = [
  'conversation_identity_and_sender_ranking',
  'manual_message_bridge_contract',
  'ava_intent_router_behavior',
  'ava_turn_contract_behavior',
  'pbk_intelligence_context_and_fleet_readiness',
  'behavior_suite_release_gate',
];
const policyIds = [
  'critical_public_database_exposure',
  'provider_delivery_unknown',
  'labeled_pdf_fallback',
  'stale_runtime_truth',
  'governance_report_blockers',
  'silent_error_policy_release_gate',
];
const suites = [
  ['ava-real-call-eval-pack.mjs', 'runAvaRealCallQualification', 'AVA_REAL_CALL_EVAL_SCENARIO_IDS', avaIds],
  ['behavior-tests.mjs', 'runBehaviorQualification', 'BEHAVIOR_QUALIFICATION_CASE_IDS', behaviorIds],
  ['silent-error-governance-smoke.mjs', 'runSilentErrorPolicyQualification', 'SILENT_ERROR_POLICY_CASE_IDS', policyIds],
];

function expectReport(report, ids, failedIds = []) {
  expect(report).toMatchObject({
    ok: failedIds.length === 0,
    total: ids.length,
    passed: ids.length - failedIds.length,
    failed: failedIds.length,
  });
  expect(report.results.map((row) => row.id)).toEqual(ids);
  for (const row of report.results) {
    expect(row).toMatchObject({ executed: true, passed: !failedIds.includes(row.id) });
    expect(Object.keys(row).sort()).toEqual(['executed', 'id', 'passed', 'reason']);
    expect(typeof row.reason).toBe('string');
    expect(row.reason.length).toBeGreaterThan(0);
  }
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.unstable_unmockModule('./ava-live-turn-contract.mjs');
  jest.unstable_unmockModule('./conversation-identity.mjs');
  jest.unstable_unmockModule('./silent-error-governance.mjs');
  jest.resetModules();
});

describe('Fixed release qualification checks', () => {
  test.each(suites)('%s imports quietly without executing assertions or reading check inputs', (file) => {
    const url = new URL(file, import.meta.url).href;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import assert from 'node:assert/strict';
      import { syncBuiltinESMExports } from 'node:module';
      const read = fs.readFileSync;
      fs.readFileSync = (path, ...args) => {
        if (/openclaw-local-server\\.mjs|package\\.json/.test(String(path))) {
          throw new Error('Import executed a qualification input read');
        }
        return read(path, ...args);
      };
      assert.equal = () => { throw new Error('Import executed a check'); };
      globalThis.fetch = () => { throw new Error('Import attempted network access'); };
      syncBuiltinESMExports();
      await import(${JSON.stringify(url)});
    `], { cwd: tmpdir(), encoding: 'utf8', timeout: 15_000 });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.stdout).toBe('');
    expect(child.status).toBe(0);
  });

  test.each(suites)('%s exports immutable exact coverage and executes only local checks', async (file, runner, constant, ids) => {
    const previousHosted = process.env.PBK_BEHAVIOR_HOSTED;
    process.env.PBK_BEHAVIOR_HOSTED = '1';
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Fixed runners must never access hosted services');
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const module = await import(`./${file}`);
      expect(module[constant]).toEqual(ids);
      expect(Object.isFrozen(module[constant])).toBe(true);
      expect(() => module[constant].push('caller-added-case')).toThrow(TypeError);
      expect(typeof module[runner]).toBe('function');
      const report = await module[runner]();
      expectReport(report, ids);
      // A caller mutating a previous response must not alter the next execution.
      report.results[0].passed = false;
      report.results.pop();
      expectReport(await module[runner](), ids);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      if (previousHosted === undefined) delete process.env.PBK_BEHAVIOR_HOSTED;
      else process.env.PBK_BEHAVIOR_HOSTED = previousHosted;
    }
  });

  test('Ava records an actual assertion failure and continues all thirty scenarios', async () => {
    const actual = await import('./ava-live-turn-contract.mjs');
    jest.unstable_mockModule('./ava-live-turn-contract.mjs', () => ({
      ...actual,
      buildAvaLiveTurnContract(input) {
        const contract = actual.buildAvaLiveTurnContract(input);
        if (input.transcript === 'I already told you I want 300k.') contract.intent = 'unknown';
        return contract;
      },
    }));
    const module = await import('./ava-real-call-eval-pack.mjs');
    expect(typeof module.runAvaRealCallQualification).toBe('function');
    const report = await module.runAvaRealCallQualification();
    expectReport(report, avaIds, ['already-gave-price-no-repeat']);
    expect(report.results[0].reason).toContain('already-gave-price-no-repeat');
  });

  test('Ava includes the original cockpit assertions in qualification', async () => {
    const actual = await import('./ava-live-turn-contract.mjs');
    jest.unstable_mockModule('./ava-live-turn-contract.mjs', () => ({
      ...actual,
      buildAvaLiveCockpitSnapshot(input) {
        return { ...actual.buildAvaLiveCockpitSnapshot(input), turnContractEnforced: false };
      },
    }));
    const module = await import('./ava-real-call-eval-pack.mjs');
    expect(typeof module.runAvaRealCallQualification).toBe('function');
    expectReport(await module.runAvaRealCallQualification(), avaIds, ['governed-trust-skill-cockpit']);
  });

  test('behavior reports a real local failure instead of substituting hosted health or aborting', async () => {
    const actual = await import('./conversation-identity.mjs');
    jest.unstable_mockModule('./conversation-identity.mjs', () => ({
      ...actual,
      normalizeConversationPhone: () => '',
    }));
    const module = await import('./behavior-tests.mjs');
    expect(typeof module.runBehaviorQualification).toBe('function');
    expectReport(await module.runBehaviorQualification(), behaviorIds, ['conversation_identity_and_sender_ranking']);
  });

  test('silent-error policy executes regressions and records a failed classification', async () => {
    const actual = await import('./silent-error-governance.mjs');
    jest.unstable_mockModule('./silent-error-governance.mjs', () => ({
      ...actual,
      classifySilentErrorFinding(input) {
        const finding = actual.classifySilentErrorFinding(input);
        return input.code === 'rls_disabled_public_dml' ? { ...finding, launchBlocker: false } : finding;
      },
    }));
    const module = await import('./silent-error-governance-smoke.mjs');
    expect(typeof module.runSilentErrorPolicyQualification).toBe('function');
    const report = await module.runSilentErrorPolicyQualification();
    expectReport(report, policyIds, ['critical_public_database_exposure']);
    expect(report.results[0].reason).toContain('critical_public_database_exposure');
  });

  test.each([
    [suites[0], './ava-live-turn-contract.mjs', 'buildAvaLiveTurnContract', avaIds],
    [suites[1], './conversation-identity.mjs', 'normalizeConversationPhone', [behaviorIds[0]]],
    [suites[2], './silent-error-governance.mjs', 'classifySilentErrorFinding', policyIds.slice(0, 5)],
  ])('%s returns only safe reasons when a dependency throws an assertion containing private details', async ([file, runner, , ids], dependency, method, failedIds) => {
    const actual = await import(dependency);
    const { default: assert } = await import('node:assert/strict');
    jest.unstable_mockModule(dependency, () => ({
      ...actual,
      [method]() {
        throw new assert.AssertionError({ message: 'private-runtime-detail', actual: false, expected: true, operator: 'strictEqual' });
      },
    }));
    const module = await import(`./${file}`);
    const report = await module[runner]();
    expectReport(report, ids, failedIds);
    expect(JSON.stringify(report)).not.toContain('private-runtime-detail');
    expect(JSON.stringify(report)).not.toContain('stack');
  });

  test('silent-error policy never claims actual operational absence of errors', async () => {
    const module = await import('./silent-error-governance-smoke.mjs');
    expect(typeof module.runSilentErrorPolicyQualification).toBe('function');
    const report = await module.runSilentErrorPolicyQualification();
    expect(report).toMatchObject({ scope: 'controlled_policy_regression', operationalEvidence: false });
    expect(report.reason).toMatch(/not.*operational/i);
  });

  test('all fixed runners resolve local check inputs independently of the working directory', () => {
    const modules = suites.map(([file, runner]) => [new URL(file, import.meta.url).href, runner]);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const reports = [];
      for (const [url, runner] of ${JSON.stringify(modules)}) {
        const module = await import(url);
        reports.push(await module[runner]());
      }
      console.log(JSON.stringify(reports));
    `], { cwd: tmpdir(), encoding: 'utf8', timeout: 15_000 });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    const reports = JSON.parse(child.stdout);
    reports.forEach((report, index) => expectReport(report, suites[index][3]));
  });

  test.each(suites)('%s preserves its original standalone CLI result', (file) => {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      env: { ...process.env, PBK_BEHAVIOR_HOSTED: '0' },
    });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    if (file === 'silent-error-governance-smoke.mjs') {
      expect(child.stdout).toBe('silent-error-governance-smoke: ok\n');
    } else if (file === 'ava-real-call-eval-pack.mjs') {
      expect(JSON.parse(child.stdout)).toMatchObject({ ok: true, result: 'ava_real_call_eval_pack_passed', scenarios: 30 });
    } else {
      expect(JSON.parse(child.stdout)).toMatchObject({
        ok: true,
        result: 'pbk_behavioral_unison_ready',
        mutationSafe: true,
        hostedChecksEnabled: false,
        tests: [...behaviorIds.map((name) => ({ name, ok: true })), { name: 'hosted_bridge_health', ok: true, skipped: true }],
      });
    }
  });

  test.each(suites)('%s exits nonzero and retains complete results when a local source check fails', (file, _runner, _constant, ids) => {
    const url = new URL(file, import.meta.url);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const read = fs.readFileSync;
      fs.readFileSync = (path, ...args) => {
        if (/openclaw-local-server\\.mjs/.test(String(path))) return '';
        if (/package\\.json/.test(String(path))) return '{}';
        return read(path, ...args);
      };
      syncBuiltinESMExports();
      process.argv[1] = ${JSON.stringify(fileURLToPath(url))};
      await import(${JSON.stringify(url.href)});
    `], { cwd: root, encoding: 'utf8', timeout: 15_000, env: { ...process.env, PBK_BEHAVIOR_HOSTED: '0' } });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.status).toBe(1);
    const failedIds = file === 'ava-real-call-eval-pack.mjs'
      ? ['governed-trust-skill-cockpit']
      : file === 'behavior-tests.mjs'
        ? ['manual_message_bridge_contract', 'behavior_suite_release_gate']
        : ['silent_error_policy_release_gate'];
    expectReport(JSON.parse(child.stdout), ids, failedIds);
  });
});
