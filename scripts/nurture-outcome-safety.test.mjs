import { describe, expect, jest, test } from '@jest/globals';
import * as nurtureAgent from './nurture-agent.mjs';

import {
  executeApprovedSequence,
  pauseNurtureForPhoneStop,
  processDueNurtureInstances,
  processNurtureInstance,
  startNurtureSequenceCore,
} from './nurture-agent.mjs';

describe('nurture child provider approval params', () => {
  test.each([
    { approvalId: 'fixture-sequence-approval' },
    { approval_id: 'fixture-sequence-approval' },
    { approvalId: 'fixture-sequence-approval', approval_id: 'fixture-alias' },
  ])('moves parent approval authority to trace metadata: %j', (approvalParams) => {
    expect(nurtureAgent.buildNurtureProviderParams).toEqual(expect.any(Function));
    const metadata = Object.freeze({ nurtureInstanceId: 'fixture-nurture', stepIndex: 1 });
    const params = Object.freeze({
      ...approvalParams, leadId: 'fixture-lead', to: 'fixture@example.test',
      body: 'Fixture follow-up', source: 'nurture-agent', forceApproval: false, metadata,
    });
    const result = nurtureAgent.buildNurtureProviderParams(params);
    expect(result).toEqual({
      leadId: 'fixture-lead', to: 'fixture@example.test', body: 'Fixture follow-up',
      source: 'nurture-agent', forceApproval: true,
      metadata: { ...metadata, nurtureSequenceApprovalId: 'fixture-sequence-approval' },
    });
    expect(result).not.toHaveProperty('approvalId');
    expect(result).not.toHaveProperty('approval_id');
    expect(result.metadata).not.toBe(metadata);
    expect(params).toMatchObject({ ...approvalParams, forceApproval: false });
    expect(metadata).not.toHaveProperty('nurtureSequenceApprovalId');
  });

  test('repeated wrapping preserves trace and still requires child approval', () => {
    expect(nurtureAgent.buildNurtureProviderParams).toEqual(expect.any(Function));
    const once = nurtureAgent.buildNurtureProviderParams({ approvalId: 'fixture-sequence-approval', body: 'Fixture' });
    expect(nurtureAgent.buildNurtureProviderParams(once)).toEqual(once);
    expect(once).toEqual({
      body: 'Fixture', forceApproval: true, metadata: { nurtureSequenceApprovalId: 'fixture-sequence-approval' },
    });
  });

  test('missing parent approval never invents authority or a trace ID', () => {
    expect(nurtureAgent.buildNurtureProviderParams).toEqual(expect.any(Function));
    expect(nurtureAgent.buildNurtureProviderParams()).toEqual({ forceApproval: true, metadata: {} });
    expect(nurtureAgent.buildNurtureProviderParams({ approvalId: '', approval_id: '' }))
      .toEqual({ forceApproval: true, metadata: {} });
  });

  test.each([null, 'invalid', []])('normalizes non-object metadata: %j', (metadata) => {
    expect(nurtureAgent.buildNurtureProviderParams).toEqual(expect.any(Function));
    expect(nurtureAgent.buildNurtureProviderParams({ approval_id: 'fixture-sequence-approval', metadata }))
      .toEqual({ forceApproval: true, metadata: { nurtureSequenceApprovalId: 'fixture-sequence-approval' } });
  });
});

const steps = [
  { channel: 'sms', template: 'Hi {name}, checking on {address}.' },
  { channel: 'email', template: 'Following up with {name}.', delay_hours: 48 },
];
const lead = {
  id: 'fixture-lead', first_name: 'Fixture', phone: '+15555550123',
  email: 'fixture@example.test', address: 'Fixture property',
};

// Only the nurture SQL seam is simulated. No bridge, database, provider, or env loading.
function fakePool(initial = {}) {
  const state = structuredClone({
    instance: {
      id: 'fixture-nurture', lead_id: lead.id, current_step: 0, status: 'active',
      pause_reason: '', next_step_at: '2020-01-01T00:00:00.000Z', steps,
    },
    logs: [],
    createdInstances: [],
    ...initial,
  });
  return {
    controlled: true,
    state,
    failLogWrites: false,
    async query(sql, params = []) {
      const query = sql.replace(/\s+/g, ' ').trim();
      const instance = state.instance;
      if (query.startsWith('SELECT ni.*, nst.steps')) {
        return { rows: instance?.id === params[0] ? [structuredClone(instance)] : [] };
      }
      if (query.startsWith('SELECT id, lead_name, first_name, email, phone, address')) {
        return { rows: [structuredClone(lead)] };
      }
      if (query.startsWith('SELECT id FROM public.lead_profiles WHERE regexp_replace')) {
        return { rows: params[0] === lead.phone ? [{ id: lead.id }] : [] };
      }
      if (query.startsWith('SELECT COUNT(*)::int AS sent_today')) {
        return { rows: [{ sent_today: this.sentToday || 0 }] };
      }
      if (query.startsWith('INSERT INTO public.lead_profiles')) return { rows: [] };
      if (query.startsWith('SELECT * FROM public.nurture_sequence_templates WHERE id')) {
        return { rows: [{ id: 'fixture-template', steps: structuredClone(steps) }] };
      }
      if (/^SELECT id(?:, status, pause_reason)? FROM public.nurture_instances/.test(query)) {
        if (query.includes('lead_id = $1')) {
          const statuses = query.includes("status IN ('active','paused')") ? ['active', 'paused'] : ['active'];
          return { rows: instance.lead_id === params[0] && statuses.includes(instance.status) ? [structuredClone(instance)] : [] };
        }
        return { rows: instance.status === 'active' && instance.next_step_at &&
          new Date(instance.next_step_at) <= new Date() ? [{ id: instance.id }] : [] };
      }
      if (query.startsWith('INSERT INTO public.nurture_instances')) {
        state.instance = {
          ...instance, id: 'fixture-created', lead_id: params[1], current_step: 0,
          status: 'active', pause_reason: '', next_step_at: '2020-01-01T00:00:00.000Z',
        };
        state.createdInstances.push(state.instance.id);
        return { rows: [structuredClone(state.instance)], rowCount: 1 };
      }
      if (query.startsWith('SELECT') && query.includes('FROM public.nurture_step_logs')) {
        const logs = state.logs.filter((log) => log.nurture_instance_id === params[0] &&
          log.step_index === params[1] && !log.status.startsWith('deferred_'));
        return { rows: structuredClone(logs.slice(-1)) };
      }
      if (query.startsWith('INSERT INTO public.nurture_step_logs')) {
        if (this.failLogWrites) throw new Error('fixture log persistence failed');
        const deferred = query.includes("NULL,$7,'',$8::jsonb");
        state.logs.push({
          nurture_instance_id: params[1], lead_id: params[2], step_index: params[3],
          channel: params[4], message_sent: params[5], status: params[6],
          error: deferred ? '' : params[7], result: JSON.parse(params[deferred ? 7 : 8]),
          sent_at: query.includes('NOW(),$7') ? 'fixture-dispatch-time' : params[9] || null,
        });
        return { rows: [], rowCount: 1 };
      }
      if (query.startsWith('UPDATE public.nurture_instances')) {
        const where = query.slice(query.indexOf(' WHERE ') + 7);
        const stepMatch = where.match(/current_step = \$(\d+)/);
        const statusMatch = where.match(/(?:^|AND )status = '([^']+)'/);
        const statuses = where.match(/status IN \(([^)]+)\)/)?.[1].split(',').map((value) => value.trim().slice(1, -1));
        const reasonMatch = where.match(/pause_reason = '([^']+)'/);
        if ((/\bid = \$1/.test(where) && instance.id !== params[0]) ||
            (where.includes('lead_id = $1') && instance.lead_id !== params[0]) ||
            (stepMatch && instance.current_step !== params[Number(stepMatch[1]) - 1]) ||
            (statusMatch && instance.status !== statusMatch[1]) ||
            (statuses && !statuses.includes(instance.status)) ||
            (reasonMatch && instance.pause_reason !== reasonMatch[1])) {
          return { rows: [], rowCount: 0 };
        }
        const set = query.slice(query.indexOf(' SET ') + 5, query.indexOf(' WHERE '));
        for (const column of ['current_step', 'status', 'next_step_at', 'pause_reason']) {
          const value = set.match(new RegExp(`(?:^|, )${column} = (\\$\\d+|'[^']*'|NULL)`))?.[1];
          if (!value) continue;
          instance[column] = value.startsWith('$') ? params[Number(value.slice(1)) - 1] :
            value === 'NULL' ? null : value.slice(1, -1);
        }
        return { rows: [{ id: instance.id }], rowCount: 1 };
      }
      throw new Error(`Unexpected fixture SQL: ${query}`);
    },
  };
}

const options = { ensureSchema: false, skipPolicy: true };
const run = (pool, invokeTool, overrides = {}) => processNurtureInstance(
  pool, pool.state.instance.id, { ...options, invokeTool, ...overrides },
);

const deliveredSms = () => ({
  ok: true,
  message: { provider: 'Telnyx', providerMessageId: 'fixture-sms', status: 'delivered', deliveryStatus: 'delivered' },
  telnyx: { live: true },
});

describe('nurture payload and terminal proof', () => {
  test('SMS uses the bridge body contract and retains approval/source/lead binding', async () => {
    const pool = fakePool();
    const invokeTool = jest.fn(async () => deliveredSms());
    await run(pool, invokeTool, { approvalId: 'fixture-approval' });
    expect(invokeTool).toHaveBeenCalledWith('telnyx_sms', {
      leadId: lead.id, to: lead.phone, body: 'Hi Fixture, checking on Fixture property.',
      source: 'nurture-agent', approvalId: 'fixture-approval',
    });
  });

  test.each([
    ['sms', deliveredSms()],
    ['email', { ok: true, result: 'live', delivery: { id: 'fixture-email', live: true, status: 'delivered' } }],
    ['call', { ok: true, call: { telnyxCallControlId: 'fixture-call', status: 'completed' }, telnyx: { live: true } }],
  ])('%s advances once only on terminal success with provider identity', async (channel, outcome) => {
    const pool = fakePool();
    pool.state.instance.steps[0].channel = channel;
    const result = await run(pool, async () => outcome);
    expect(result).toMatchObject({ ok: true, result: 'step_processed', status: channel === 'call' ? 'completed' : 'delivered' });
    expect(pool.state.instance).toMatchObject({ current_step: 1, status: 'active' });
    expect(new Date(pool.state.instance.next_step_at).getTime()).toBeGreaterThan(Date.now());
    expect(pool.state.logs[0]).toMatchObject({ step_index: 0, result: outcome });
    expect(pool.state.logs[0].sent_at).not.toBeNull();
  });

  test('final proven step completes and cannot be sent again after restart', async () => {
    const pool = fakePool();
    pool.state.instance.steps = [steps[0]];
    const invokeTool = jest.fn(async () => deliveredSms());
    expect(await run(pool, invokeTool)).toMatchObject({ ok: true, result: 'completed', status: 'delivered' });
    expect(pool.state.instance).toMatchObject({ current_step: 1, status: 'completed', next_step_at: null });
    await run(fakePool(pool.state), invokeTool);
    expect(invokeTool).toHaveBeenCalledTimes(1);
  });
});

describe('nonterminal outcomes fail closed', () => {
  test.each([
    ['transient rejection', { ok: false, error: 'fixture rate limit', retryable: true }, 'failed'],
    ['permanent rejection', { ok: false, error: 'fixture invalid destination', retryable: false }, 'failed'],
    ['DNC block', { ok: false, blocked: true, reason: 'seller_opt_out', dnc: { reason: 'seller_opt_out' } }, 'failed'],
    ['provider missing', { ok: false, result: 'provider_missing' }, 'failed'],
    ['pending approval', { ok: false, result: 'queued_for_approval', approval: { id: 'fixture-approval' } }, 'queued_for_approval'],
    ['ok pending approval', { ok: true, result: 'queued_for_approval' }, 'queued_for_approval'],
    ['approval flag', { ok: true, requiresApproval: true }, 'queued_for_approval'],
    ['approval_required', { ok: true, outcome: 'approval_required' }, 'queued_for_approval'],
    ['absent result', undefined, 'unknown'],
    ['null result', null, 'unknown'],
    ['empty result', {}, 'unknown'],
    ['bare ok', { ok: true }, 'unknown'],
    ['bare sent', { ok: true, result: 'sent' }, 'unknown'],
    ['unidentified delivery', { ok: true, result: 'delivered' }, 'unknown'],
    ['malformed provider identity', { ok: true, message: { providerMessageId: {}, status: 'delivered' } }, 'unknown'],
    ['identity without outcome', { ok: true, message: { providerMessageId: 'fixture-sms' } }, 'unknown'],
    ['unknown with identity', { ok: true, message: { providerMessageId: 'fixture-sms', status: 'unknown' } }, 'unknown'],
    ['SMS acceptance', { ok: true, message: { providerMessageId: 'fixture-sms', status: 'queued' }, telnyx: { live: true, status: 202 } }, 'accepted'],
    ['sent is not delivered', { ok: true, message: { providerMessageId: 'fixture-sms', status: 'sent' }, telnyx: { live: true } }, 'accepted'],
    ['email acceptance', { ok: true, result: 'live', delivery: { id: 'fixture-email', ok: true, live: true }, message: { status: 'sent' } }, 'accepted', 'email'],
    ['call started', { ok: true, call: { telnyxCallControlId: 'fixture-call', status: 'queued' }, telnyx: { live: true } }, 'accepted', 'call'],
    ['delivery failure', { ok: true, message: { providerMessageId: 'fixture-sms', deliveryStatus: 'undelivered' } }, 'failed'],
    ['nested provider failure', { ok: true, delivery: { ok: false, error: 'fixture bounced' } }, 'failed', 'email'],
    ['conflicting proof', { ...deliveredSms(), result: 'failed' }, 'failed'],
    ['pending approval record overrides delivery', { ...deliveredSms(), approval: { id: 'fixture-approval', status: 'pending' } }, 'queued_for_approval'],
    ['explicit unknown overrides stale delivery', { ...deliveredSms(), result: 'unknown' }, 'unknown'],
    ['explicit pending overrides stale delivery', { ...deliveredSms(), status: 'pending' }, 'unknown'],
    ['error overrides stale delivery', { ...deliveredSms(), error: 'fixture provider failure' }, 'failed'],
    ['sending_failed overrides stale delivery', { ...deliveredSms(), message: { ...deliveredSms().message, deliveryStatus: 'sending_failed' } }, 'failed'],
    ['bounced email', { ok: true, result: 'live', delivery: { id: 'fixture-email', ok: true, live: true, status: 'bounced' } }, 'failed', 'email'],
    ['simulated delivery', { ...deliveredSms(), telnyx: { live: false, simulated: true } }, 'failed'],
    ['dry-run delivery', { ...deliveredSms(), dryRun: true }, 'failed'],
  ])('%s never advances, including final step, scheduler/restart and approval replay', async (_label, outcome, status, channel = 'sms') => {
    const pool = fakePool();
    pool.state.instance.steps = [{ ...steps[0], channel }];
    const invokeTool = jest.fn(async () => outcome);
    const result = await run(pool, invokeTool);
    expect(result).toMatchObject({ ok: false, status, stepIndex: 0 });
    expect(pool.state.instance).toMatchObject({ current_step: 0, status: 'paused', next_step_at: null });
    expect(pool.state.instance.pause_reason).toContain('nurture_');
    expect(pool.state.logs).toHaveLength(1);
    expect(pool.state.logs[0]).toMatchObject({ status, step_index: 0 });
    if (['failed', 'unknown', 'queued_for_approval'].includes(status)) expect(pool.state.logs[0].sent_at).toBeNull();
    const restarted = fakePool(pool.state);
    await run(restarted, invokeTool);
    expect((await processDueNurtureInstances(restarted, { ...options, invokeTool })).processed).toBe(0);
    const replay = await executeApprovedSequence(restarted, {
      nurtureInstanceId: restarted.state.instance.id, approvalId: 'fixture-approved-now',
    }, { ...options, invokeTool });
    expect(replay.ok).toBe(false);
    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(restarted.state.instance.current_step).toBe(0);
    expect(restarted.state.logs).toHaveLength(1);
  });

  test('missing invoke adapter records failure without progression', async () => {
    const pool = fakePool();
    expect(await run(pool)).toMatchObject({ ok: false, status: 'failed' });
    expect(pool.state.logs[0].error).toMatch(/invoke|adapter/i);
    expect(pool.state.instance).toMatchObject({ current_step: 0, status: 'paused', next_step_at: null });
  });

  test('exception after possible acceptance is unknown, not a retryable send', async () => {
    const pool = fakePool();
    const invokeTool = jest.fn(async () => { throw new Error('fixture connection lost after submit'); });
    expect(await run(pool, invokeTool)).toMatchObject({ ok: false, status: 'unknown' });
    expect(pool.state.logs[0].error).toContain('connection lost');
    await run(fakePool(pool.state), invokeTool);
    expect(invokeTool).toHaveBeenCalledTimes(1);
  });

  test('unsupported channel does not silently skip a step', async () => {
    const pool = fakePool();
    pool.state.instance.steps[0].channel = 'unsupported';
    const invokeTool = jest.fn();
    expect(await run(pool, invokeTool)).toMatchObject({ ok: false, status: 'failed' });
    expect(pool.state.instance.current_step).toBe(0);
    expect(invokeTool).not.toHaveBeenCalled();
  });
});

describe('durable attempt and existing policy paths', () => {
  test('concurrent workers cannot both invoke the same step', async () => {
    const pool = fakePool();
    const invokeTool = jest.fn(async () => deliveredSms());
    await Promise.all([run(pool, invokeTool), run(pool, invokeTool)]);
    expect(invokeTool).toHaveBeenCalledTimes(1);
    expect(pool.state.logs).toHaveLength(1);
    expect(pool.state.instance.current_step).toBe(1);
  });

  test('log persistence failure after acceptance leaves the durable claim blocked', async () => {
    const pool = fakePool();
    pool.failLogWrites = true;
    const invokeTool = jest.fn(async () => ({ ok: true, accepted: true }));
    await expect(run(pool, invokeTool)).rejects.toThrow('fixture log persistence failed');
    expect(pool.state.instance).toMatchObject({ current_step: 0, status: 'paused', next_step_at: null });
    await run(fakePool(pool.state), invokeTool);
    expect(invokeTool).toHaveBeenCalledTimes(1);
  });

  test.each([false, true])('starting again (force=%s) cannot replace a paused, unresolved sequence', async (force) => {
    const pool = fakePool();
    const invokeTool = jest.fn(async () => ({ ok: true, accepted: true }));
    await run(pool, invokeTool);
    expect(await startNurtureSequenceCore(pool, {
      leadId: lead.id, templateId: 'fixture-template', processFirstStep: false, force,
    }, { ...options, invokeTool })).toMatchObject({ ok: false, result: 'blocked', nurtureInstanceId: 'fixture-nurture' });
    expect(pool.state.createdInstances).toHaveLength(0);
    expect(invokeTool).toHaveBeenCalledTimes(1);
  });

  test('starter reports a blocked first step honestly', async () => {
    const pool = fakePool();
    pool.state.instance.status = 'completed';
    const invokeTool = jest.fn(async () => ({ ok: true, result: 'queued_for_approval' }));
    expect(await startNurtureSequenceCore(pool, {
      leadId: lead.id, templateId: 'fixture-template',
    }, { ...options, invokeTool })).toMatchObject({
      ok: false, result: 'blocked', firstStep: { ok: false, status: 'queued_for_approval' },
    });
    expect(pool.state.instance).toMatchObject({ current_step: 0, status: 'paused' });
  });

  test.each(['queued_for_approval', 'accepted', 'unknown', 'failed', 'sent', 'delivered'])(
    'reactivating a step with an existing %s log cannot resend', async (status) => {
      const pool = fakePool({ logs: [{
        nurture_instance_id: 'fixture-nurture', step_index: 0, status,
        result: { approval: { id: 'fixture-original-approval' } },
      }] });
      const invokeTool = jest.fn(async () => deliveredSms());
      expect((await run(pool, invokeTool)).ok).toBe(false);
      expect(invokeTool).not.toHaveBeenCalled();
      expect(pool.state.instance).toMatchObject({ current_step: 0, status: 'paused', next_step_at: null });
      expect(pool.state.logs).toHaveLength(1);
    },
  );

  test('quiet hours defer without claiming, and a later allowed run can send', async () => {
    const pool = fakePool();
    const invokeTool = jest.fn(async () => deliveredSms());
    const policy = { skipPolicy: false, quietHours: { startHour: 21, endHour: 8 } };
    expect(await run(pool, invokeTool, { ...policy, now: new Date(2026, 10, 15, 23) }))
      .toMatchObject({ ok: true, result: 'deferred', status: 'deferred_quiet_hours' });
    expect(pool.state.instance).toMatchObject({ current_step: 0, status: 'active' });
    expect(invokeTool).not.toHaveBeenCalled();
    expect(await run(pool, invokeTool, { ...policy, now: new Date(2026, 10, 16, 12) }))
      .toMatchObject({ ok: true, result: 'step_processed' });
    expect(invokeTool).toHaveBeenCalledTimes(1);
  });

  test('daily throttle remains a no-send deferral', async () => {
    const pool = fakePool();
    pool.sentToday = 3;
    const invokeTool = jest.fn();
    expect(await run(pool, invokeTool, { skipPolicy: false, now: new Date(2026, 10, 15, 12) }))
      .toMatchObject({ ok: true, status: 'deferred_daily_throttle' });
    expect(pool.state.instance).toMatchObject({ current_step: 0, status: 'active' });
    expect(invokeTool).not.toHaveBeenCalled();
  });

  test('STOP still pauses active sequences before any dispatch', async () => {
    const pool = fakePool();
    expect(await pauseNurtureForPhoneStop(pool, { from: lead.phone, body: 'STOP' }))
      .toMatchObject({ ok: true, result: 'paused', paused: 1 });
    const invokeTool = jest.fn();
    await run(pool, invokeTool);
    expect(invokeTool).not.toHaveBeenCalled();
    expect(pool.state.instance.pause_reason).toBe('seller_reply_stop');
  });

  test('STOP received during dispatch cannot be overwritten by terminal success', async () => {
    const pool = fakePool();
    const invokeTool = jest.fn(async () => {
      expect(pool.state.instance.status).toBe('paused');
      await pauseNurtureForPhoneStop(pool, { from: lead.phone, body: 'unsubscribe' });
      return deliveredSms();
    });
    expect((await run(pool, invokeTool)).ok).toBe(false);
    expect(pool.state.instance).toMatchObject({ current_step: 0, status: 'paused', pause_reason: 'seller_reply_stop' });
  });
});
