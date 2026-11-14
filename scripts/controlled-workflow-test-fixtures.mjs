// Unit-test outputs only. Hosted proof must come from the actual guarded endpoint.
export function workflowTestOutputs(fixture) {
  const closing = { ok: true, result: 'closing_intelligence', nextBestPhrase: 'We can explain the cash process.', citations: ['fixture'] };
  return {
    'bant-enforcer': { ok: true, result: 'bant_enforcer_status', complete: true, missing: [], bant: fixture.bant },
    max: { ok: true, result: 'max_contract_handoff_ready', closing, safety: { approvalGate: true } },
    'script-rotator': closing,
    'prosody-tuner': { ok: true, result: 'prosody_advice', prosody: { emotion: 'calm', speed: 0.9, stability: 0.6, similarityBoost: 0.8 } },
    'call-analyzer': { ok: true, result: 'call_analysis_complete', analyzed: 1, analyses: [{ id: 'analysis', callId: fixture.callId, status: 'analyzed', score: 72 }] },
    'nurture-agent': { ok: true, result: 'recommendation', lead: { id: fixture.leadId, score: 72 }, recommendation: { channel: 'sms', urgency: 'now', reason: 'Warm lead' } },
    'qa-agent': { ok: true, qa: { ok: true, validator: 'consultNurtureAgent' }, auditRecord: { id: 'audit' }, result: { result: 'recommendation' } },
    rex: { answer: 'The controlled seller needs a relocation deadline plan.', citations: ['fixture'] },
    ava: { ok: true, routedTo: 'agent_brain', response: { ok: true, answer: 'Confirm BANT and explain the process.' } },
    'research-orchestrator': { ok: true, result: 'halt', flags: ['dnc_or_stop_request'], intervention: 'Stop outreach and honor the request.', safety: { canOverrideAva: true, providerWrites: 'blocked_without_approval' } },
    hermes: { ok: true, result: 'hermes_pattern_analysis', provider: 'pbk-local-pattern-analysis', pattern: { workflow: { trigger: 'general_seller', steps: ['Stop outreach and honor the request.'] } }, strategy: 'Stop outreach and honor the request.', safety: { suggestOnly: true, providerWrites: 'blocked' } },
  };
}
