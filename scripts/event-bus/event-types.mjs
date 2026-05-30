export const EventTypes = Object.freeze({
  LEAD_IMPORTED: 'lead.imported',
  LEAD_UPDATED: 'lead.updated',
  LEAD_DNC_ADDED: 'lead.dnc.added',

  CALL_STARTED: 'call.started',
  CALL_COMPLETED: 'call.completed',
  CALL_FAILED: 'call.failed',

  OFFER_GENERATED: 'offer.generated',
  OFFER_APPROVED: 'offer.approved',
  OFFER_REJECTED: 'offer.rejected',
  CONTRACT_SENT: 'contract.sent',
  CONTRACT_SIGNED: 'contract.signed',

  TOOL_INVOKED: 'tool.invoked',
  QA_VALIDATION_FAILED: 'qa.validation.failed',
  SAFETY_VALIDATION_FAILED: 'safety.validation.failed',

  CAMPAIGN_STARTED: 'campaign.started',
  CAMPAIGN_STEP_COMPLETED: 'campaign.step.completed',

  AGENT_TASK_CREATED: 'agent.task.created',
  AGENT_TASK_COMPLETED: 'agent.task.completed',
  AGENT_REGISTRY_REFRESHED: 'agent.registry.refreshed',

  REX_GOALS_PROPOSED: 'rex.goals.proposed',
  REX_PROACTIVE_TRIGGERED: 'rex.proactive.triggered',
  COWORKER_HEARTBEAT_RUN: 'coworker.heartbeat.run',
  SLACK_MENTION_RECEIVED: 'slack.mention.received',
  YOUTUBE_TRAINING_STARTED: 'youtube.training.started',
  YOUTUBE_TRAINING_READY: 'youtube.training.ready',
  TEST_CASE_UPDATED: 'test_case.updated',
  SCRIPT_VARIANT_SELECTED: 'script.variant.selected',
  SCRIPT_OUTCOME_RECORDED: 'script.outcome.recorded',
});
