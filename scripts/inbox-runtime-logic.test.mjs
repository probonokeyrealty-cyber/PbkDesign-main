import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const helperPath = resolve(root, 'src/app/routes/inboxRuntimeLogic.js');
const runtimeBridgePath = resolve(root, 'src/app/utils/runtimeBridge.ts');
const inboxPath = resolve(root, 'src/app/routes/Inbox.tsx');
const bridgeServerPath = resolve(root, 'scripts/openclaw-local-server.mjs');

async function loadHelper() {
  try {
    return await import(new URL(`file:///${helperPath.replace(/\\/g, '/')}`));
  } catch {
    return null;
  }
}

describe('Inbox runtime logic', () => {
  test('counts unicode SMS segments with UCS-2 limits instead of 160-char ASCII math', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();

    expect(helper.getSmsSegmentInfo('a'.repeat(160))).toMatchObject({
      encoding: 'gsm-7',
      segments: 1,
      perSegment: 160,
    });
    expect(helper.getSmsSegmentInfo(`Thanks ${'a'.repeat(64)}🙂`)).toMatchObject({
      encoding: 'ucs-2',
      segments: 2,
      perSegment: 67,
    });
  });

  test('normalizes live bridge lead records for compose search without mock fallbacks', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();

    const leads = helper.normalizeComposeLeads([
      {
        leadId: 'lead-real-1',
        seller: { name: 'Real Seller', phone: '+16145551212', email: 'real@example.com' },
        property: { address: '19 Actual Ave' },
      },
    ]);

    expect(leads).toEqual([
      {
        id: 'lead-real-1',
        name: 'Real Seller',
        phone: '+16145551212',
        email: 'real@example.com',
        address: '19 Actual Ave',
      },
    ]);
    expect(helper.normalizeComposeLeads([])).toEqual([]);
  });

  test('builds immediate and scheduled compose requests for bridge APIs', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();

    const baseDraft = {
      channel: 'sms',
      recipient: '+16145551212',
      leadId: 'lead-real-1',
      message: 'Can we talk today?',
      sendLater: false,
      sendAt: '',
    };

    expect(helper.buildComposeRequest(baseDraft, { name: 'Real Seller', address: '19 Actual Ave' })).toMatchObject({
      path: '/api/lead/send-message',
      body: {
        channel: 'sms',
        leadId: 'lead-real-1',
        phone: '+16145551212',
        message: 'Can we talk today?',
      },
    });

    expect(
      helper.buildComposeRequest(
        { ...baseDraft, sendLater: true, sendAt: '2026-06-04T09:30' },
        { name: 'Real Seller', address: '19 Actual Ave' }
      )
    ).toMatchObject({
      path: '/api/messages',
      body: {
        channel: 'sms',
        status: 'scheduled',
        scheduledFor: '2026-06-04T09:30',
        body: 'Can we talk today?',
      },
    });
  });

  test('extracts approval payload preview text before approve buttons', async () => {
    const helper = await loadHelper();
    expect(helper).not.toBeNull();

    expect(
      helper.getApprovalPreview({
        type: 'sms',
        payload: { body: 'Seller-facing SMS body' },
      })
    ).toBe('Seller-facing SMS body');

    expect(
      helper.getApprovalPreview({
        type: 'contract',
        contractBody: 'DocuSign contract packet terms',
      })
    ).toBe('DocuSign contract packet terms');
  });
});

describe('Inbox bridge wiring', () => {
  test('runtime bridge exposes live message APIs for compose and scheduling', () => {
    const runtimeBridge = readFileSync(runtimeBridgePath, 'utf8');
    expect(runtimeBridge).toMatch(/sendMessageRequest/);
    expect(runtimeBridge).toMatch(/scheduleMessageRequest/);
    expect(runtimeBridge).toMatch(/fetchLeadsRequest/);
    expect(runtimeBridge).toMatch(/\/api\/lead\/send-message/);
    expect(runtimeBridge).toMatch(/\/api\/messages/);
  });

  test('Inbox no longer contains hardcoded demo send copy or mock people', () => {
    const inbox = readFileSync(inboxPath, 'utf8');
    expect(inbox).not.toMatch(/sendDemo/);
    expect(inbox).not.toMatch(/No real send occurred/);
    expect(inbox).not.toMatch(/MOCK_COMPOSE_LEADS|Diane Kowalski|Marco Hill|Lena Brooks/);
  });

  test('bridge stores scheduled outbound messages instead of firing providers immediately', () => {
    const bridge = readFileSync(bridgeServerPath, 'utf8');
    expect(bridge).toMatch(/scheduledFor/);
    expect(bridge).toMatch(/status:\s*'scheduled'/);
    expect(bridge).toMatch(/Outbound .* scheduled/);
  });
});
