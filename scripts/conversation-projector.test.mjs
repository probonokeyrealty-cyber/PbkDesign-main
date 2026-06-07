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

  test.each([
    ['inbound', 'seller@example.com', 'seller@example.com', ''],
    ['outbound', 'seller@example.com', '', 'seller@example.com'],
  ])(
    'uses the seller email fallback for %s provider records',
    (direction, email, senderAddress, recipientAddress) => {
      expect(
        projectMessageEvent({
          id: `email-fallback-${direction}`,
          channel: 'email',
          direction,
          email,
        })
      ).toMatchObject({
        senderAddress,
        recipientAddress,
      });
    }
  );

  test('projects a native unified-message recording row', () => {
    expect(
      projectMessageEvent({
        id: 'recording-message-1',
        workspace_id: 'workspace-1',
        lead_id: 'lead-1',
        channel: 'call',
        direction: 'recording',
        provider: 'telnyx',
        from_phone: '+16145550101',
        to_phone: '+16145550199',
        storage_path: 'calls/recording-message-1.mp3',
        storage_bucket: 'call-recordings',
        audio_content_type: 'audio/mpeg',
        duration_seconds: 47,
        recording_url: 'https://recordings.example/recording-message-1.mp3',
        provider_id: 'provider-recording-1',
        payload: {
          callDirection: 'inbound',
        },
        created_at: '2026-06-06T13:30:00.000Z',
      })
    ).toMatchObject({
      workspaceId: 'workspace-1',
      leadId: 'lead-1',
      eventType: 'call.recording',
      channel: 'call',
      direction: 'internal',
      sourceTable: 'unified_messages',
      sourceId: 'recording-message-1',
      sourceKey: 'unified_messages:recording-message-1:call.recording',
      provider: 'telnyx',
      senderAddress: '+16145550101',
      recipientAddress: '+16145550199',
      occurredAt: '2026-06-06T13:30:00.000Z',
      payload: {
        storagePath: 'calls/recording-message-1.mp3',
        storageBucket: 'call-recordings',
        audioContentType: 'audio/mpeg',
        durationSeconds: 47,
        recordingUrl: 'https://recordings.example/recording-message-1.mp3',
        providerId: 'provider-recording-1',
        callDirection: 'inbound',
      },
    });
  });

  test('projects a native unified-message transcript row', () => {
    expect(
      projectMessageEvent({
        id: 'transcript-message-1',
        workspaceId: 'workspace-1',
        leadId: 'lead-1',
        channel: 'call',
        direction: 'transcription',
        provider: 'deepgram',
        body: 'Seller: Friday works for me.',
        status: 'complete',
        payload: {
          callDirection: 'inbound',
          callId: 'call-1',
        },
        createdAt: '2026-06-06T13:40:00.000Z',
      })
    ).toMatchObject({
      workspaceId: 'workspace-1',
      leadId: 'lead-1',
      eventType: 'call.transcript',
      channel: 'call',
      direction: 'inbound',
      sourceTable: 'unified_messages',
      sourceId: 'transcript-message-1',
      sourceKey:
        'unified_messages:transcript-message-1:call.transcript',
      provider: 'deepgram',
      body: 'Seller: Friday works for me.',
      occurredAt: '2026-06-06T13:40:00.000Z',
      payload: {
        callDirection: 'inbound',
        callId: 'call-1',
      },
    });
  });

  test('projects recording metadata from the unified-message persistence fallback payload', () => {
    const payload = Object.freeze({
      recordingUrl: 'https://recordings.example/recording-message-fallback.mp3',
      storagePath: 'calls/recording-message-fallback.mp3',
      storageBucket: 'call-recordings',
      audioContentType: 'audio/mpeg',
      durationSeconds: 58,
      callId: 'call-persistence-fallback',
    });
    const record = Object.freeze({
      id: 'recording-message-fallback',
      workspace_id: 'workspace-1',
      lead_id: 'lead-1',
      channel: 'call',
      direction: 'recording',
      provider: 'telnyx',
      payload,
      created_at: '2026-06-06T13:45:00.000Z',
    });

    const event = projectMessageEvent(record);

    expect(event).toMatchObject({
      eventType: 'call.recording',
      sourceTable: 'unified_messages',
      sourceId: 'recording-message-fallback',
      sourceKey: 'unified_messages:recording-message-fallback:call.recording',
      occurredAt: '2026-06-06T13:45:00.000Z',
      payload: {
        recordingUrl: 'https://recordings.example/recording-message-fallback.mp3',
        storagePath: 'calls/recording-message-fallback.mp3',
        storageBucket: 'call-recordings',
        audioContentType: 'audio/mpeg',
        durationSeconds: 58,
        callId: 'call-persistence-fallback',
      },
    });
    expect(event.payload).not.toBe(payload);
    expect(record.payload).toEqual(payload);
  });

  test.each(['recording', 'voice', '', undefined])(
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
    expect(event.payload).toMatchObject({
      transcript: [{ text: 'Earlier words' }],
    });
    expect(event.payload).not.toHaveProperty('transcriptChunk');
  });

  test('projects persisted transcript arrays with deterministic speaker text and full payload', () => {
    const transcript = Object.freeze([
      Object.freeze({ speaker: 'seller', text: 'I can close Friday.' }),
      Object.freeze({ speaker: 'agent', text: 'Friday works.' }),
    ]);

    const event = projectCallEvent({
      id: 'call-transcript-array',
      state: 'transcript',
      transcript,
      updated_at: '2026-06-06T14:02:00.000Z',
    });

    expect(event).toMatchObject({
      eventType: 'call.transcript',
      body: 'seller: I can close Friday.\nagent: Friday works.',
      occurredAt: '2026-06-06T14:02:00.000Z',
      payload: { transcript },
    });
    expect(event.payload.transcript).not.toBe(transcript);
    expect(transcript[0]).toEqual({ speaker: 'seller', text: 'I can close Friday.' });
  });

  test('infers a recording event and carries recording details in payload', () => {
    expect(
      projectCallEvent({
        id: 'call-3',
        direction: 'inbound',
        recordingUrl: 'https://recordings.example/call-3.mp3',
        storagePath: 'calls/call-3.mp3',
        durationSeconds: '',
        duration: 0,
        updatedAt: '2026-06-06T14:03:00.000Z',
      })
    ).toMatchObject({
      eventType: 'call.recording',
      body: '',
      payload: {
        recordingUrl: 'https://recordings.example/call-3.mp3',
        storagePath: 'calls/call-3.mp3',
        durationSeconds: 0,
        callDirection: 'inbound',
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

  test('projects a compact call summary, duration, and sentiment for the unified timeline', () => {
    expect(
      projectCallEvent({
        id: 'call-summary-1',
        direction: 'outbound',
        status: 'completed',
        duration_seconds: 347,
        call_summary: 'Seller is hesitant on price but agreed to review the repair estimate.',
        sentiment_score: 0.72,
        ended_at: '2026-06-06T14:06:00.000Z',
      })
    ).toMatchObject({
      eventType: 'call.completed',
      body: 'Seller is hesitant on price but agreed to review the repair estimate.',
      payload: {
        durationSeconds: 347,
        summary: 'Seller is hesitant on price but agreed to review the repair estimate.',
        sentiment: 0.72,
      },
    });
  });

  test('derives a bounded call summary from recent transcript turns when no summary exists', () => {
    const event = projectCallEvent({
      id: 'call-summary-fallback',
      status: 'completed',
      transcript: [
        { speaker: 'agent', text: 'Old setup that should not dominate.' },
        { speaker: 'seller', text: 'The roof is my main concern.' },
        { speaker: 'agent', text: 'We can account for that in the repair estimate.' },
      ],
    });

    expect(event.payload.summary).toContain('The roof is my main concern.');
    expect(event.payload.summary.length).toBeLessThanOrEqual(420);
  });

  test('uses explicit kind before recording and completion evidence', () => {
    expect(
      projectCallEvent(
        {
          id: 'call-explicit-completed',
          status: 'completed',
          recordingUrl: 'https://recordings.example/call-explicit-completed.mp3',
          transcript: [{ speaker: 'seller', text: 'Done.' }],
        },
        'transcript'
      )
    ).toMatchObject({
      eventType: 'call.transcript',
      body: 'seller: Done.',
    });
  });

  test('uses recording evidence before completed status', () => {
    expect(
      projectCallEvent({
        id: 'call-recording-completed',
        status: 'completed',
        recordingUrl: 'https://recordings.example/call-recording-completed.mp3',
        transcript: [{ speaker: 'seller', text: 'Done.' }],
      })
    ).toMatchObject({
      eventType: 'call.recording',
    });
  });

  test('uses completed status before transcript arrays', () => {
    expect(
      projectCallEvent({
        id: 'call-completed-transcript',
        status: 'completed',
        transcript: [{ speaker: 'seller', text: 'Done.' }],
      })
    ).toMatchObject({
      eventType: 'call.completed',
    });
  });

  test('uses completed status before a transcript-like state', () => {
    expect(
      projectCallEvent({
        id: 'call-completed-transcript-state',
        state: 'transcript',
        status: 'completed',
        transcript: [{ speaker: 'seller', text: 'Done.' }],
      })
    ).toMatchObject({
      eventType: 'call.completed',
    });
  });

  test('falls through empty transcript chunk timestamps', () => {
    expect(
      projectCallEvent(
        {
          id: 'call-transcript-time',
          transcriptChunk: {
            text: 'Timestamped.',
            occurredAt: '',
            timestamp: '2026-06-06T14:04:00.000Z',
          },
        },
        'transcript'
      )
    ).toMatchObject({
      occurredAt: '2026-06-06T14:04:00.000Z',
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
    ['delivered', 'contract.viewed'],
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

  test('falls through an empty completed timestamp to signed timestamp', () => {
    expect(
      projectContractEvent({
        id: 'contract-completed-time',
        status: 'completed',
        completedAt: '',
        signedAt: '2026-06-06T15:30:00.000Z',
      })
    ).toMatchObject({
      occurredAt: '2026-06-06T15:30:00.000Z',
    });
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
    ['needs_revision', 'approval.decided'],
    ['cancelled', 'approval.decided'],
    ['canceled', 'approval.decided'],
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

  test.each(['cancelled', 'canceled'])(
    'uses acted and decided timestamp precedence for %s approvals',
    (status) => {
      expect(
        projectApprovalEvent({
          id: `approval-${status}-time`,
          status,
          actedAt: '2026-06-06T16:05:00.000Z',
          decidedAt: '2026-06-06T16:04:00.000Z',
          updatedAt: '2026-06-06T16:03:00.000Z',
          createdAt: '2026-06-06T16:02:00.000Z',
        })
      ).toMatchObject({
        eventType: 'approval.decided',
        occurredAt: '2026-06-06T16:05:00.000Z',
        payload: {
          decision: status,
        },
      });
    }
  );

  test('does not invent a concrete decision from generic decided status', () => {
    const payload = Object.freeze({ auditId: 'approval-audit-1' });
    const record = Object.freeze({
      id: 'approval-generic-decided',
      status: 'decided',
      payload,
    });

    const event = projectApprovalEvent(record);

    expect(event).toMatchObject({
      eventType: 'approval.decided',
      payload: {
        auditId: 'approval-audit-1',
      },
    });
    expect(event.payload).not.toHaveProperty('decision');
    expect(event.payload).not.toBe(payload);
    expect(record.payload).toEqual(payload);
  });

  test('uses an explicit outcome as the decision for generic decided status', () => {
    expect(
      projectApprovalEvent({
        id: 'approval-explicit-outcome',
        status: 'decided',
        outcome: 'declined',
      })
    ).toMatchObject({
      eventType: 'approval.decided',
      payload: {
        outcome: 'declined',
        decision: 'declined',
      },
    });
  });

  test('falls through an empty acted timestamp to decided timestamp', () => {
    expect(
      projectApprovalEvent({
        id: 'approval-decided-time',
        status: 'approved',
        actedAt: '',
        decidedAt: '2026-06-06T16:30:00.000Z',
      })
    ).toMatchObject({
      occurredAt: '2026-06-06T16:30:00.000Z',
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

  test('uses native runtime at deterministically across retries', () => {
    const record = Object.freeze({
      id: 'activity-at',
      category: 'NOTE',
      text: 'Retry-stable note.',
      at: '2026-06-06T16:45:00.000Z',
    });

    const first = projectActivityEvent(record);
    const retry = projectActivityEvent(record);

    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      eventType: 'lead.note',
      occurredAt: '2026-06-06T16:45:00.000Z',
    });
    expect(record.at).toBe('2026-06-06T16:45:00.000Z');
  });
});

describe('persisted snake_case records', () => {
  test('projects a persisted message row', () => {
    expect(
      projectMessageEvent({
        source_id: 'message-db',
        workspace_id: 'workspace-db',
        lead_id: 'lead-db',
        channel: 'sms',
        direction: 'inbound',
        from_phone: '+16145550199',
        to_phone: '+16145550101',
        provider_message_id: 'provider-message-db',
        created_at: '2026-06-06T17:00:00.000Z',
      })
    ).toMatchObject({
      workspaceId: 'workspace-db',
      leadId: 'lead-db',
      sourceId: 'message-db',
      senderAddress: '+16145550199',
      recipientAddress: '+16145550101',
      occurredAt: '2026-06-06T17:00:00.000Z',
      payload: { providerMessageId: 'provider-message-db' },
    });
  });

  test('projects a persisted call row', () => {
    expect(
      projectCallEvent({
        id: 'call-db',
        workspace_id: 'workspace-db',
        lead_id: 'lead-db',
        direction: 'outbound',
        from_number: '+16145550101',
        phone: '+16145550199',
        recording_url: 'https://recordings.example/call-db.mp3',
        storage_path: 'calls/call-db.mp3',
        duration_seconds: 31,
        updated_at: '2026-06-06T17:01:00.000Z',
      })
    ).toMatchObject({
      workspaceId: 'workspace-db',
      leadId: 'lead-db',
      eventType: 'call.recording',
      senderAddress: '+16145550101',
      recipientAddress: '+16145550199',
      occurredAt: '2026-06-06T17:01:00.000Z',
      payload: {
        recordingUrl: 'https://recordings.example/call-db.mp3',
        storagePath: 'calls/call-db.mp3',
        durationSeconds: 31,
      },
    });
  });

  test('projects a persisted contract row', () => {
    expect(
      projectContractEvent({
        id: 'contract-db',
        workspace_id: 'workspace-db',
        lead_id: 'lead-db',
        status: 'viewed',
        envelope_id: 'envelope-db',
        document_title: 'Persisted Contract',
        template_id: 'template-db',
        updated_at: '2026-06-06T17:02:00.000Z',
      })
    ).toMatchObject({
      workspaceId: 'workspace-db',
      leadId: 'lead-db',
      provider: 'docusign',
      subject: 'Persisted Contract',
      occurredAt: '2026-06-06T17:02:00.000Z',
      payload: {
        envelopeId: 'envelope-db',
        documentTitle: 'Persisted Contract',
        template: 'template-db',
      },
    });
  });

  test('projects a persisted approval row with acted timestamp', () => {
    expect(
      projectApprovalEvent({
        id: 'approval-db',
        workspace_id: 'workspace-db',
        lead_id: 'lead-db',
        status: 'needs_revision',
        approval_type: 'offer',
        action: 'revise',
        decision: 'needs_revision',
        actor_name: 'Morgan',
        acted_at: '2026-06-06T17:03:00.000Z',
        created_at: '2026-06-06T16:00:00.000Z',
      })
    ).toMatchObject({
      workspaceId: 'workspace-db',
      leadId: 'lead-db',
      eventType: 'approval.decided',
      actorName: 'Morgan',
      status: 'needs_revision',
      occurredAt: '2026-06-06T17:03:00.000Z',
      payload: {
        approvalType: 'offer',
        action: 'revise',
        decision: 'needs_revision',
      },
    });
  });

  test('projects a persisted activity row', () => {
    expect(
      projectActivityEvent({
        id: 'activity-db',
        workspace_id: 'workspace-db',
        lead_id: 'lead-db',
        actor_type: 'agent',
        actor_name: 'Ava',
        category: 'NOTE',
        text: 'Persisted note',
        occurred_at: '2026-06-06T17:04:00.000Z',
      })
    ).toMatchObject({
      workspaceId: 'workspace-db',
      leadId: 'lead-db',
      eventType: 'lead.note',
      actorType: 'agent',
      actorName: 'Ava',
      body: 'Persisted note',
      occurredAt: '2026-06-06T17:04:00.000Z',
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

describe('provider retry source identities', () => {
  test.each([
    [
      'Telnyx SMS',
      () =>
        projectMessageEvent({
          id: 'telnyx-message-retry',
          channel: 'sms',
          provider: 'telnyx',
        }),
    ],
    [
      'Instantly email',
      () =>
        projectMessageEvent({
          id: 'instantly-message-retry',
          channel: 'email',
          provider: 'instantly',
        }),
    ],
    [
      'Telnyx call transcript',
      () =>
        projectCallEvent(
          {
            id: 'telnyx-call-transcript-retry',
            transcriptText: 'Seller transcript.',
          },
          'transcript'
        ),
    ],
    [
      'DocuSign envelope',
      () =>
        projectContractEvent({
          id: 'docusign-envelope-retry',
          envelopeId: 'envelope-retry',
          status: 'viewed',
        }),
    ],
    [
      'approval decision',
      () =>
        projectApprovalEvent({
          id: 'approval-retry',
          status: 'approved',
        }),
    ],
    [
      'lead note',
      () =>
        projectActivityEvent({
          id: 'lead-note-retry',
          category: 'NOTE',
          text: 'Seller prefers afternoons.',
        }),
    ],
  ])('%s retries produce the same source identity', (_label, project) => {
    const first = project();
    const retry = project();

    expect(first.sourceKey).toBe(retry.sourceKey);
    expect(first.sourceTable).toBe(retry.sourceTable);
    expect(first.sourceId).toBe(retry.sourceId);
    expect(first.eventType).toBe(retry.eventType);
  });
});
