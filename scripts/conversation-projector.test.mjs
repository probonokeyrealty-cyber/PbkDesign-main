import { describe, expect, test } from '@jest/globals';
import {
  projectActivityEvent,
  projectApprovalEvent,
  projectCallEvent,
  projectContractEvent,
  projectMessageEvent,
} from './conversation-projector.mjs';

describe('message projection', () => {
  test('projects an SMS without losing provider identity or context', () => {
    const event = projectMessageEvent({
      id: 'sms-1',
      workspaceId: 'workspace-1',
      leadId: 'lead-1',
      channel: 'sms',
      direction: 'outbound',
      fromPhone: '+16145550101',
      toPhone: '+16145550199',
      provider: 'telnyx',
      providerMessageId: 'telnyx-message-1',
      senderIdentityId: 'sender-1',
      body: 'Hello',
      status: 'sent',
      sentAt: '2026-06-06T12:00:00.000Z',
      payload: {
        campaignId: 'campaign-1',
        ignored: undefined,
      },
    });

    expect(event).toMatchObject({
      workspaceId: 'workspace-1',
      leadId: 'lead-1',
      eventType: 'message.sms',
      channel: 'sms',
      direction: 'outbound',
      sourceTable: 'unified_messages',
      sourceId: 'sms-1',
      sourceKey: 'unified_messages:sms-1:message.sms',
      provider: 'telnyx',
      senderAddress: '+16145550101',
      recipientAddress: '+16145550199',
      body: 'Hello',
      status: 'sent',
      occurredAt: '2026-06-06T12:00:00.000Z',
      payload: {
        campaignId: 'campaign-1',
        providerMessageId: 'telnyx-message-1',
        senderIdentityId: 'sender-1',
      },
    });
    expect(event.payload).not.toHaveProperty('ignored');
    expect(event.payload).not.toHaveProperty('body');
  });

  test.each([
    [
      'inbound',
      {
        fromPhone: '+16145550199',
        toPhone: '+16145550101',
      },
      '+16145550199',
      '+16145550101',
      'seller',
      'Sam Seller',
    ],
    [
      'outbound',
      {
        fromPhone: '+16145550101',
        toPhone: '+16145550199',
      },
      '+16145550101',
      '+16145550199',
      'agent',
      'Ava',
    ],
  ])(
    'preserves %s SMS sender and recipient direction',
    (direction, addresses, senderAddress, recipientAddress, actorType, senderName) => {
      expect(
        projectMessageEvent({
          id: `sms-${direction}`,
          channel: 'sms',
          direction,
          senderName,
          ...addresses,
        })
      ).toMatchObject({
        direction,
        senderAddress,
        recipientAddress,
        actorType,
        actorName: senderName,
      });
    }
  );

  test('projects email addresses, subject, body, and updated timestamp', () => {
    expect(
      projectMessageEvent({
        id: 'email-1',
        leadId: 'lead-1',
        channel: 'EMAIL',
        direction: 'inbound',
        fromEmail: 'seller@example.com',
        toEmail: 'offers@pbk.example',
        senderName: 'Taylor Seller',
        subject: 'Re: offer',
        body: 'I have a question.',
        status: 'received',
        updatedAt: '2026-06-06T13:00:00.000Z',
      })
    ).toMatchObject({
      eventType: 'message.email',
      channel: 'email',
      direction: 'inbound',
      senderAddress: 'seller@example.com',
      recipientAddress: 'offers@pbk.example',
      actorType: 'seller',
      actorName: 'Taylor Seller',
      subject: 'Re: offer',
      body: 'I have a question.',
      occurredAt: '2026-06-06T13:00:00.000Z',
    });
  });

  test.each(['call', 'recording', 'voice', '', undefined])(
    'rejects unsupported message channel %p',
    (channel) => {
      expect(() => projectMessageEvent({ id: 'message-1', channel })).toThrow(
        /supported message channel/i
      );
    }
  );
});

describe('call projection', () => {
  test('projects an explicitly started call', () => {
    expect(
      projectCallEvent(
        {
          id: 'call-1',
          leadId: 'lead-1',
          direction: 'outbound',
          provider: 'telnyx',
          fromNumber: '+16145550101',
          phone: '+16145550199',
          status: 'ringing',
          startedAt: '2026-06-06T14:00:00.000Z',
          telnyxCallControlId: 'control-1',
        },
        'started'
      )
    ).toMatchObject({
      eventType: 'call.started',
      channel: 'call',
      direction: 'outbound',
      sourceTable: 'calls',
      sourceId: 'call-1',
      sourceKey: 'calls:call-1:call.started',
      provider: 'telnyx',
      senderAddress: '+16145550101',
      recipientAddress: '+16145550199',
      status: 'ringing',
      occurredAt: '2026-06-06T14:00:00.000Z',
      payload: {
        telnyxCallControlId: 'control-1',
      },
    });
  });

  test('infers a transcript event and uses only the current transcript chunk as body', () => {
    const event = projectCallEvent({
      id: 'call-2',
      status: 'live',
      transcript: [{ text: 'Earlier words' }],
      transcriptChunk: {
        speaker: 'seller',
        text: 'Current words',
        confidence: 0.94,
      },
      updatedAt: '2026-06-06T14:01:00.000Z',
    });

    expect(event).toMatchObject({
      eventType: 'call.transcript',
      body: 'Current words',
      occurredAt: '2026-06-06T14:01:00.000Z',
      payload: {
        speaker: 'seller',
        confidence: 0.94,
      },
    });
    expect(event.body).not.toContain('Earlier words');
    expect(event.payload).not.toHaveProperty('transcript');
    expect(event.payload).not.toHaveProperty('transcriptChunk');
  });

  test('infers a recording event and carries recording details in payload', () => {
    expect(
      projectCallEvent({
        id: 'call-3',
        recordingUrl: 'https://recordings.example/call-3.mp3',
        storagePath: 'calls/call-3.mp3',
        durationSeconds: 82,
        updatedAt: '2026-06-06T14:03:00.000Z',
      })
    ).toMatchObject({
      eventType: 'call.recording',
      body: '',
      payload: {
        recordingUrl: 'https://recordings.example/call-3.mp3',
        storagePath: 'calls/call-3.mp3',
        durationSeconds: 82,
      },
    });
  });

  test('infers a completed event from final status', () => {
    expect(
      projectCallEvent({
        id: 'call-4',
        direction: 'inbound',
        phone: '+16145550199',
        fromNumber: '+16145550101',
        status: 'completed',
        endedAt: '2026-06-06T14:05:00.000Z',
      })
    ).toMatchObject({
      eventType: 'call.completed',
      direction: 'inbound',
      senderAddress: '+16145550199',
      recipientAddress: '+16145550101',
      status: 'completed',
      occurredAt: '2026-06-06T14:05:00.000Z',
    });
  });

  test('accepts full event names as explicit call kinds', () => {
    expect(
      projectCallEvent({ id: 'call-5', transcriptText: 'Hello' }, 'call.transcript')
    ).toMatchObject({
      eventType: 'call.transcript',
      body: 'Hello',
    });
  });

  test('rejects an unknown explicit call kind', () => {
    expect(() => projectCallEvent({ id: 'call-6' }, 'paused')).toThrow(/call kind/i);
  });

  test('does not invent call direction when the source omits it', () => {
    expect(projectCallEvent({ id: 'call-7' }, 'started')).toMatchObject({
      direction: 'internal',
      actorType: 'system',
      senderAddress: '',
      recipientAddress: '',
    });
  });
});

describe('contract projection', () => {
  test('projects DocuSign viewed as a timeline event', () => {
    expect(
      projectContractEvent({
        id: 'contract-1',
        leadId: 'lead-1',
        status: 'viewed',
        envelopeId: 'envelope-1',
        documentTitle: 'Probate Contract',
        templateId: 'template-1',
        updatedAt: '2026-06-06T15:00:00.000Z',
      })
    ).toMatchObject({
      eventType: 'contract.viewed',
      sourceTable: 'contracts',
      sourceId: 'contract-1',
      sourceKey: 'contracts:contract-1:contract.viewed',
      provider: 'docusign',
      subject: 'Probate Contract',
      status: 'viewed',
      payload: {
        envelopeId: 'envelope-1',
        documentTitle: 'Probate Contract',
        template: 'template-1',
        status: 'viewed',
      },
    });
  });

  test.each([
    ['sent', 'contract.sent'],
    ['viewed', 'contract.viewed'],
    ['signed', 'contract.completed'],
    ['completed', 'contract.completed'],
    ['draft', 'system'],
    ['unexpected', 'system'],
  ])('maps contract status %s to %s', (status, eventType) => {
    expect(projectContractEvent({ id: `contract-${status}`, status })).toMatchObject({
      eventType,
      status,
    });
  });

  test('does not invent a DocuSign provider without provider evidence', () => {
    expect(projectContractEvent({ id: 'contract-no-provider', status: 'draft' }).provider).toBe('');
    expect(
      projectContractEvent({
        id: 'contract-explicit-provider',
        status: 'sent',
        provider: 'pandadoc',
      }).provider
    ).toBe('pandadoc');
  });
});

describe('approval projection', () => {
  test.each([
    ['pending', 'approval.created'],
    ['created', 'approval.created'],
    ['requested', 'approval.created'],
    ['approved', 'approval.decided'],
    ['declined', 'approval.decided'],
    ['rejected', 'approval.decided'],
    ['decided', 'approval.decided'],
  ])('maps approval status %s to %s', (status, eventType) => {
    expect(
      projectApprovalEvent({
        id: `approval-${status}`,
        type: 'offer',
        action: 'review',
        decision: status === 'decided' ? 'approved' : undefined,
        status,
      })
    ).toMatchObject({
      eventType,
      channel: 'system',
      direction: 'internal',
      sourceTable: 'approvals',
      payload: {
        approvalType: 'offer',
        action: 'review',
        ...(status === 'decided' ? { decision: 'approved' } : {}),
      },
    });
  });

  test('uses decision time and preserves approval actor and summary', () => {
    expect(
      projectApprovalEvent({
        id: 'approval-1',
        status: 'approved',
        requestedBy: 'Rex',
        decidedBy: 'Morgan',
        summary: 'Approve offer at $120,000',
        decidedAt: '2026-06-06T16:00:00.000Z',
      })
    ).toMatchObject({
      eventType: 'approval.decided',
      actorType: 'agent',
      actorName: 'Morgan',
      body: 'Approve offer at $120,000',
      occurredAt: '2026-06-06T16:00:00.000Z',
      payload: {
        decision: 'approved',
      },
    });
  });
});

describe('activity projection', () => {
  test.each([
    [{ category: 'NOTE', text: 'Seller prefers mornings.' }, 'lead.note'],
    [{ category: 'lead update', text: 'Updated seller phone.' }, 'lead.updated'],
    [{ action: 'edit', text: 'Edited lead record.' }, 'lead.updated'],
    [{ category: 'PDF', text: 'Generated a document.' }, 'system'],
  ])('maps activity %p to %s', (activity, eventType) => {
    expect(projectActivityEvent({ id: `activity-${eventType}`, ...activity })).toMatchObject({
      eventType,
      channel: 'system',
      direction: 'internal',
      sourceTable: 'activity',
      body: activity.text,
    });
  });

  test('preserves nonduplicated activity context', () => {
    expect(
      projectActivityEvent({
        id: 'activity-1',
        actor: 'Ava',
        category: 'INFO',
        status: 'success',
        text: 'CRM sync finished.',
        target: 'lead-1',
        source: 'runtime',
        metadata: {
          crmId: 'crm-1',
          ignored: undefined,
        },
      })
    ).toMatchObject({
      actorType: 'agent',
      actorName: 'Ava',
      payload: {
        category: 'INFO',
        target: 'lead-1',
        source: 'runtime',
        metadata: {
          crmId: 'crm-1',
        },
      },
    });
  });
});

describe('projection validation and purity', () => {
  const projectors = [
    ['message', projectMessageEvent, { channel: 'sms' }],
    ['call', projectCallEvent, {}],
    ['contract', projectContractEvent, {}],
    ['approval', projectApprovalEvent, {}],
    ['activity', projectActivityEvent, {}],
  ];

  test.each(projectors)('%s requires a stable source id', (_name, projector, baseRecord) => {
    expect(() => projector(baseRecord)).toThrow(/id is required/i);
    expect(() => projector({ ...baseRecord, id: '   ' })).toThrow(/id is required/i);
  });

  test.each(projectors)('%s rejects non-object input', (_name, projector) => {
    expect(() => projector(null)).toThrow(/record must be an object/i);
    expect(() => projector([])).toThrow(/record must be an object/i);
  });

  test('returns the common shape with deterministic safe defaults', () => {
    const first = projectActivityEvent({ id: 'activity-safe' });
    const second = projectActivityEvent({ id: 'activity-safe' });

    expect(first).toEqual(second);
    expect(first).toEqual({
      workspaceId: 'pbk',
      leadId: null,
      eventType: 'system',
      channel: 'system',
      direction: 'internal',
      sourceTable: 'activity',
      sourceId: 'activity-safe',
      sourceKey: 'activity:activity-safe:system',
      provider: '',
      senderAddress: '',
      recipientAddress: '',
      actorType: 'system',
      actorName: '',
      subject: '',
      body: '',
      status: '',
      occurredAt: null,
      payload: {},
    });
  });

  test('does not mutate frozen source records or nested payloads', () => {
    const record = Object.freeze({
      id: 'call-frozen',
      transcriptChunk: Object.freeze({
        speaker: 'seller',
        text: 'Frozen words',
      }),
      payload: Object.freeze({
        nested: Object.freeze({
          value: 'kept',
          ignored: undefined,
        }),
      }),
    });

    const event = projectCallEvent(record, 'transcript');

    expect(event.body).toBe('Frozen words');
    expect(event.payload).toMatchObject({
      nested: {
        value: 'kept',
      },
      speaker: 'seller',
    });
    expect(record.transcriptChunk.text).toBe('Frozen words');
    expect(record.payload.nested).toHaveProperty('ignored');
  });
});
