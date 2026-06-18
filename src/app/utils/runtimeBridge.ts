import { DealData } from '../types';
import { buildAgentDealContext, type AgentDealContext } from './agentDealContext';
import {
  createPbkSnnWorker,
  injectSearchCognition,
  type SearchCognitionResult,
} from './snnWorkerBridge';

type RuntimeConfig = {
  endpoint?: string;
  apiKey?: string;
};

export type RuntimeTeamSession = {
  token: string;
  role: string;
  actor: string;
  expiresAt: string;
  permissions?: Record<string, unknown>;
};

const DEFAULT_HOSTED_BRIDGE_ENDPOINT = 'https://pbk-openclaw-bridge.onrender.com';
const RUNTIME_TEAM_SESSION_KEY = 'pbk:team-session:v1';
let avaSnnWorker: Worker | null = null;
let rexSnnWorker: Worker | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    avaSnnWorker?.terminate();
    rexSnnWorker?.terminate();
    avaSnnWorker = null;
    rexSnnWorker = null;
  });
}

export type ApprovalRecord = {
  id: string;
  type?: string;
  status?: string;
  leadId?: string;
  leadName?: string;
  address?: string;
  offerPrice?: number;
  mao?: number;
  notes?: string;
  message?: string;
  body?: string;
  text?: string;
  content?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  approvalAction?: string;
  action?: string;
  actor?: string;
  createdAt?: string;
  actedAt?: string;
};

export type ActivityRecord = {
  id: string;
  type?: string;
  leadId?: string;
  leadName?: string;
  address?: string;
  summary?: string;
  createdAt?: string;
  at?: string;
  actor?: string;
  text?: string;
  category?: string;
};

export type BrainDoc = {
  id: string;
  title?: string;
  source?: string;
  kind?: string;
  topic?: string;
  excerpt?: string;
  summary?: string;
  tags?: string[];
  createdAt?: string;
};

export type LeadImport = {
  id: string;
  leadId?: string;
  leadName?: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  source?: string;
  status?: string;
  seller?: Record<string, unknown>;
  property?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  createdAt?: string;
};

export type AnalyzerRun = {
  id: string;
  address?: string;
  type?: string;
  arv?: number;
  mao?: number;
  targetOffer?: number;
  repairs?: number;
  summary?: string;
  createdAt?: string;
};

export type CallRecord = {
  id: string;
  leadId?: string;
  leadName?: string;
  to?: string;
  from?: string;
  status?: string;
  createdAt?: string;
};

export type MessageRecord = {
  id: string;
  leadId?: string;
  leadName?: string;
  channel?: string;
  direction?: string;
  to?: string;
  from?: string;
  phone?: string;
  email?: string;
  address?: string;
  subject?: string;
  body?: string;
  status?: string;
  at?: string;
  updatedAt?: string;
  scheduledFor?: string;
  sendAt?: string;
  readAt?: string;
  archivedAt?: string;
  unread?: boolean;
  isUnread?: boolean;
  createdAt?: string;
};

export type ConversationThreadIdentity = {
  id?: string;
  threadId?: string;
  identityType?: 'phone' | 'email' | string;
  value?: string;
  normalizedValue?: string;
  displayValue?: string;
  isPrimary?: boolean;
  source?: string;
  createdAt?: string;
};

export type ConversationEvent = {
  id: string;
  threadId: string;
  leadId?: string | null;
  eventType: string;
  channel?: string;
  direction?: string;
  provider?: string;
  senderIdentityId?: string | null;
  actorType?: string;
  actorName?: string;
  senderAddress?: string;
  recipientAddress?: string;
  subject?: string;
  body?: string;
  status?: string;
  occurredAt: string;
  readAt?: string | null;
  hiddenAt?: string | null;
  spamReportedAt?: string | null;
  payload?: Record<string, unknown>;
};

export type ConversationThread = {
  id: string;
  leadId?: string | null;
  title?: string;
  status?: string;
  assignedAgent?: string;
  lastEventAt?: string | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  unreadCount?: number;
  pinned?: boolean;
  archivedAt?: string | null;
  mergedIntoThreadId?: string | null;
  seller?: Record<string, unknown>;
  property?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  identities?: ConversationThreadIdentity[];
  latestEvent?: ConversationEvent | null;
};

export type CommunicationSenderIdentity = {
  id: string;
  provider: 'telnyx' | 'instantly' | string;
  channel: 'sms' | 'email' | 'call';
  address: string;
  normalizedAddress?: string;
  label?: string;
  region?: string;
  lifecycleStatus: string;
  healthStatus?: string;
  healthScore?: number | null;
  isWorkspaceDefault?: boolean;
  inboundGraceUntil?: string | null;
  retiredAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type ContractRecord = {
  id: string;
  leadName?: string;
  address?: string;
  amount?: number;
  status?: string;
  envelopeId?: string;
  createdAt?: string;
};

export type AdminTask = {
  id: string;
  command?: string;
  provider?: string;
  status?: string;
  actor?: string;
  createdAt?: string;
  action?: string;
  summary?: string;
};

export type RuntimeSnapshot = {
  status?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  approvals?: ApprovalRecord[];
  activity?: ActivityRecord[];
  brainDocs?: BrainDoc[];
  leadImports?: LeadImport[];
  analyzerRuns?: AnalyzerRun[];
  calls?: CallRecord[];
  messages?: MessageRecord[];
  contracts?: ContractRecord[];
  documentDeliveries?: Array<Record<string, unknown>>;
  callQaScores?: Array<Record<string, unknown>>;
  skillOutcomes?: Array<Record<string, unknown>>;
  adminTasks?: AdminTask[];
  adminAudit?: Array<Record<string, unknown>>;
  campaigns?: CampaignRecord[];
  campaignLeads?: CampaignLeadRecord[];
  campaignEvents?: CampaignEventRecord[];
  campaignLeadSources?: CampaignLeadSource[];
  campaignExecutions?: Array<Record<string, unknown>>;
};

export type RuntimeQuotas = {
  instantly?: Record<string, unknown>;
  telnyx?: Record<string, unknown>;
  docs?: Record<string, unknown>;
};

export type RuntimeToolingStatus = {
  metaAgent?: Record<string, unknown>;
  browserOs?: Record<string, unknown>;
  agentReach?: Record<string, unknown>;
  browserResearch?: Record<string, unknown>;
  context7?: Record<string, unknown>;
  workflowOps?: Record<string, unknown>;
  observability?: Record<string, unknown>;
  github?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  propertyData?: Record<string, unknown>;
  pipelineMemory?: Record<string, unknown>;
  voiceFallback?: Record<string, unknown>;
  desktopCopilot?: Record<string, unknown>;
};

export type AgentHealthProbe = {
  id?: string;
  name?: string;
  status?: string;
  activity?: string;
  present?: boolean;
  ready?: boolean;
  providerReady?: boolean;
  missingTools?: string[];
  healthProbe?: string;
  lastSeen?: string;
  source?: string;
};

export type AgentHealthResponse = {
  ok: boolean;
  result?: string;
  agents?: AgentHealthProbe[];
  registry?: Record<string, unknown>;
  agentRegistry?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  safety?: Record<string, unknown>;
};

export type AgentRegistryRecord = {
  id?: string;
  agentId?: string;
  name?: string;
  initial?: string;
  role?: string;
  description?: string;
  capabilities?: string[];
  status?: string;
  version?: string;
  endpoint?: string;
  healthCheckedAt?: string;
  health_checked_at?: string;
  lastError?: string;
  last_error?: string;
  metadata?: Record<string, unknown>;
};

export type AgentRegistrySnapshot = {
  ok?: boolean;
  result?: string;
  generatedAt?: string;
  count?: number;
  agents?: AgentRegistryRecord[];
  capabilities?: string[];
  required?: Record<string, unknown>;
  degraded?: Array<Record<string, unknown>>;
};

export type AgentRegistryResponse = {
  ok: boolean;
  result?: string;
  loadedAt?: string;
  source?: string;
  capability?: string;
  matches?: AgentRegistryRecord[];
  registry?: AgentRegistrySnapshot;
};

export type DesktopSidecarStatusResponse = {
  ok: boolean;
  result?: string;
  connected?: boolean;
  connectedCount?: number;
  pendingCommands?: number;
  sidecars?: Array<Record<string, unknown>>;
  recentEvents?: Array<Record<string, unknown>>;
};

export type LocalCommandRecord = {
  id: string;
  tenantId?: string;
  command?: string;
  action?: string;
  params?: Record<string, unknown>;
  requestedBy?: string;
  source?: string;
  status?: string;
  riskLevel?: 'low' | 'medium' | 'high' | string;
  riskReason?: string;
  requiresApproval?: boolean;
  approvalId?: string;
  sidecarId?: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt?: string;
  approvedAt?: string | null;
  dispatchedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string;
};

export type LocalCommandsResponse = {
  ok: boolean;
  result?: string;
  count?: number;
  commands?: LocalCommandRecord[];
  command?: LocalCommandRecord;
  commandId?: string;
  message?: string;
  approval?: ApprovalRecord | null;
  sidecarStatus?: DesktopSidecarStatusResponse;
  state?: RuntimeSnapshot;
  error?: string;
};

export type GlobalSearchResult = {
  id?: string;
  recordId?: string;
  recordKind?: string;
  routeContext?: string;
  leadId?: string;
  threadId?: string;
  kind?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  target?: string;
  page?: string;
  createdAt?: string;
  tags?: string[];
};

export type GlobalSearchResponse = {
  ok: boolean;
  result?: string;
  query?: string;
  count?: number;
  results?: GlobalSearchResult[];
  source?: string;
};

export type FounderWorkQueueItem = {
  id: string;
  tag?: string;
  body?: string;
  when?: string;
  tone?: 'urgent' | 'hot' | 'warm' | 'money';
  score?: number;
  source?: string;
  reason?: string;
  cta?: string;
  pulse?: 'default' | 'amber' | 'sky' | 'lime';
  targetPath?: string;
  recordKind?: string;
  recordId?: string;
};

export type FounderWorkQueueResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  count?: number;
  items?: FounderWorkQueueItem[];
  summary?: Record<string, unknown>;
};

export type IntelligenceStreamItem = {
  id?: string;
  kind?: string;
  actor?: string;
  title?: string;
  text?: string;
  category?: string;
  source?: string;
  status?: string;
  at?: string;
  createdAt?: string;
  confidence?: number | null;
  leadId?: string;
  callId?: string;
  metadata?: Record<string, unknown>;
};

export type IntelligenceStreamResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  count?: number;
  items?: IntelligenceStreamItem[];
  summary?: Record<string, unknown>;
};

export type SystemSourceLabel = {
  id: string;
  label: string;
  endpoint: string;
  category?: string;
  status?: 'live' | 'fallback' | 'offline' | 'needs-wiring';
  readiness?: 'ready' | 'degraded' | 'unavailable';
  source?: string;
  dataState?: 'fresh' | 'aging' | 'stale' | 'empty' | 'unknown';
  stalenessMs?: number | null;
  lastCheckedAt?: string;
  lastDataAt?: string;
  lastUpdatedAt?: string;
  fallbackReason?: string;
  degradedReason?: string;
  recordCount?: number;
  note?: string;
};

export type SystemSourceLabelsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  count?: number;
  items?: SystemSourceLabel[];
  summary?: Record<string, unknown>;
};

export type ReleaseStatusComponent = {
  id: string;
  label: string;
  status?: 'ready' | 'configured' | 'missing' | 'unknown' | 'degraded';
  ready?: boolean;
  configured?: boolean;
  detail?: string;
  source?: string;
};

export type ReleaseStatusResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  release?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  components?: ReleaseStatusComponent[];
  warnings?: string[];
};

export type ProductionGapLabel = {
  id: string;
  label: string;
  category?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status?: string;
  source?: string;
  endpoint?: string;
  detail?: string;
  operatorAction?: string;
  optional?: boolean;
  blocking?: boolean;
  controlLive?: boolean;
  metadata?: Record<string, unknown>;
};

export type PrimaryPathControl = {
  id: string;
  label: string;
  category?: string;
  status?: string;
  severity?: string;
  primaryAttempt?: string;
  allowPrimaryAttempt?: boolean;
  blocking?: boolean;
  optional?: boolean;
  preflightRequired?: boolean;
  retryBeforeFallback?: number;
  retryBackoffMs?: number;
  timeoutMs?: number;
  timeoutEventRequired?: boolean;
  fallbackPolicy?: string;
  reason?: string;
  operatorAction?: string;
};

export type PrimaryPathReliabilityReport = {
  ok: boolean;
  result?: string;
  revision?: string;
  generatedAt?: string;
  fallbackSloTargetPercent?: number;
  summary?: {
    primaryAllowed?: boolean;
    totalControls?: number;
    allowedPrimary?: number;
    blocking?: number;
    disabledOptional?: number;
    retryBeforeFallback?: number;
    timeoutEventsRequired?: number;
    providerPolicies?: number;
  };
  controls?: PrimaryPathControl[];
  providerRetryPolicies?: Array<Record<string, unknown>>;
  nextActions?: Array<Record<string, unknown>>;
};

export type ProductionGapsResponse = {
  ok: boolean;
  result?: string;
  generatedAt?: string;
  summary?: {
    total?: number;
    blocking?: number;
    notLive?: number;
    optional?: number;
    bySeverity?: Record<string, number>;
    byCategory?: Record<string, number>;
  };
  gaps?: ProductionGapLabel[];
  primaryPath?: PrimaryPathReliabilityReport;
};

export type VectorCapacityTable = {
  id: string;
  label?: string;
  exists?: boolean;
  estimatedRowCount?: number;
  estimatedEmbeddedCount?: number;
  dimensions?: number;
  tableBytes?: number;
  indexBytes?: number;
  totalBytes?: number;
  statsUpdatedAt?: string | null;
  vectorIndexMethod?: string;
  indexNames?: string[];
  infrastructureReady?: boolean;
  populated?: boolean;
  status?: 'needs_setup' | 'awaiting_data' | 'ready';
  ready?: boolean;
};

export type VectorCapacityStatusResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  backend?: string;
  s3Role?: string;
  mastraRequired?: boolean;
  embeddingProvider?: {
    configured?: boolean;
    ready?: boolean;
    requestedProvider?: string;
    provider?: string;
    mode?: string;
    model?: string;
    nativeModel?: string;
    nativeDimensions?: number;
    dimensions?: number;
    projection?: string;
    fallbackReason?: string;
    deepSeekEmbeddingsSupported?: boolean;
    result?: string;
    error?: string;
    validatedAt?: string | null;
  };
  tables?: VectorCapacityTable[];
  summary?: {
    estimatedRows?: number;
    estimatedEmbeddedRows?: number;
    totalBytes?: number;
    vectorTableCount?: number;
    rexResearchReady?: boolean;
  };
  rexResearch?: {
    ready?: boolean;
    schemaReady?: boolean;
    embeddingsReady?: boolean;
    indexReady?: boolean;
    provider?: VectorCapacityStatusResponse['embeddingProvider'];
    canary?: {
      ok?: boolean;
      fresh?: boolean;
      result?: string;
      latencyMs?: number;
      embeddingModel?: string;
      dimensions?: number;
      matchedId?: string;
      error?: string;
      createdAt?: string | null;
    };
  };
  recommendation?: {
    action?: string;
    label?: string;
    detail?: string;
  };
  warnings?: string[];
};

export type RuntimeScriptCandidate = {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  pathKey?: string;
  allowedRoles?: string[];
  metadata?: Record<string, unknown>;
  embedding?: number[];
  learnedWeight?: number;
};

export type CurrentScriptResponse = {
  ok: boolean;
  result?: string;
  selectedScript?: RuntimeScriptCandidate | null;
  selected?: RuntimeScriptCandidate | null;
  score?: number;
  reasonCodes?: string[];
  scoredScripts?: Array<Record<string, unknown>>;
  rotationRule?: string;
  source?: string;
};

export type AnalyticsLead = {
  id: string;
  name?: string;
  address?: string;
  stage?: string;
  stageLabel?: string;
  revenue?: number;
  updatedAt?: string;
};

export type LeadStagesResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  stages?: Array<{
    stage: string;
    label?: string;
    total?: number;
    revenue?: number;
    leads?: AnalyticsLead[];
  }>;
  warning?: string;
};

export type DealTimelineResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  days?: Array<{
    day: string;
    count?: number;
    revenue?: number;
    leads?: AnalyticsLead[];
  }>;
  warning?: string;
};

export type AiMetricsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  metrics?: Record<string, unknown>;
  warning?: string;
};

export type SkillOutcomesResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  skills?: Array<Record<string, unknown>>;
  warning?: string;
};

export type SkillGovernanceItem = {
  versionId: string;
  definitionId?: string;
  slug?: string;
  name: string;
  riskClass?: 'low' | 'medium' | 'high' | 'critical' | string;
  source?: string;
  versionNumber?: number;
  lifecycleState: string;
  contentHash: string;
  instructions?: string;
  triggerPolicy?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolAllowlist?: string[];
  sourceProvenance?: Record<string, unknown>;
  safetyScan?: Record<string, unknown>;
  createdBy?: string;
  createdAt?: string | null;
  approvalId?: string | null;
  approvedBy?: string;
  approvedAt?: string | null;
  activationId?: string | null;
  activationStatus?: string;
  rolloutMode?: string;
  rolloutPercent?: number;
  activatedAt?: string | null;
  agentId?: string;
  scope?: Record<string, unknown>;
  priority?: number;
};

export type SkillGovernanceStatusResponse = {
  ok: boolean;
  result?: string;
  authority?: string;
  failClosed?: boolean;
  candidates?: number;
  approvedInactive?: number;
  canary?: number;
  active?: number;
  paused?: number;
  staleApprovals?: number;
  outbox?: {
    pending?: number;
    retrying?: number;
    deadLettered?: number;
    oldestPendingAt?: string | null;
  };
  snapshot?: {
    available?: boolean;
    source?: string;
    generatedAt?: string | null;
    ageSeconds?: number | null;
  };
  error?: string;
};

export type SkillGovernanceRepositoryResponse = {
  ok: boolean;
  result?: string;
  authority?: string;
  count?: number;
  items?: SkillGovernanceItem[];
  error?: string;
};

export type SkillTrendsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  skillId?: string;
  skillName?: string;
  points?: Array<Record<string, unknown>>;
  warning?: string;
};

export type ActiveExperimentsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  experiments?: Array<Record<string, unknown>>;
  tests?: Array<Record<string, unknown>>;
  warning?: string;
};

export type MemoryEventRecord = {
  id: string;
  type?: string;
  title?: string;
  summary?: string;
  source?: string;
  agentId?: string;
  agentName?: string;
  skillId?: string;
  skillName?: string;
  success?: boolean | null;
  score?: number | null;
  createdAt?: string;
  metadata?: Record<string, unknown>;
};

export type MemoryEventsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  count?: number;
  events?: MemoryEventRecord[];
  warning?: string;
};

export type ObservabilityStatusResponse = {
  ok: boolean;
  enabled?: boolean;
  initialized?: boolean;
  otelReady?: boolean;
  serviceName?: string;
  lastError?: string;
  metrics?: Record<string, unknown>;
  alerts?: Array<Record<string, unknown>>;
  eventBus?: Record<string, unknown>;
};

export type CampaignRecord = {
  id: string;
  name?: string;
  channel?: string;
  provider?: string;
  status?: string;
  templateId?: string;
  leadSource?: string;
  leadFilter?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  sequence?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  approvalId?: string;
  approvalStatus?: string;
  pendingAction?: string;
  leadCount?: number;
  eventCount?: number;
  conflictCount?: number;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CampaignLeadRecord = {
  id: string;
  campaignId?: string;
  leadId?: string;
  leadName?: string;
  address?: string;
  email?: string;
  phone?: string;
  tags?: string[];
  status?: string;
  touchIndex?: number;
  lastTouchAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CampaignEventRecord = {
  id: string;
  campaignId?: string;
  campaignLeadId?: string;
  leadId?: string;
  eventType?: string;
  channel?: string;
  provider?: string;
  providerEventId?: string;
  providerStatus?: string;
  occurredAt?: string;
  createdAt?: string;
  payload?: Record<string, unknown>;
};

export type CampaignLeadSource = {
  id: string;
  label?: string;
  count?: number;
  source?: string;
  note?: string;
};

export type CampaignDrilldownRow = {
  id?: string;
  campaignId?: string;
  campaignName?: string;
  campaignStatus?: string;
  channel?: string;
  provider?: string;
  leadId?: string;
  leadName?: string;
  address?: string;
  source?: string;
  email?: string;
  phone?: string;
  leadStatus?: string;
  tags?: string[];
  events?: number;
  sent?: boolean;
  opened?: boolean;
  replied?: boolean;
  connected?: boolean;
  dnc?: boolean;
  lastEventType?: string;
  lastEventAt?: string;
  updatedAt?: string;
  routeContext?: string;
  [key: string]: unknown;
};

export type CampaignDrilldownSummary = {
  campaigns?: number;
  leads?: number;
  sent?: number;
  opened?: number;
  replied?: number;
  connected?: number;
  dnc?: number;
  estimatedCost?: number;
  replyRate?: number;
  connectRate?: number;
  [key: string]: unknown;
};

export type CampaignDrilldownResponse = {
  ok: boolean;
  result?: string;
  range?: string;
  generatedAt?: string;
  source?: string;
  filters?: Record<string, unknown>;
  summary?: CampaignDrilldownSummary;
  campaigns?: Array<Record<string, unknown>>;
  sources?: string[];
  rows?: CampaignDrilldownRow[];
  warning?: string;
  error?: string;
};

export type CampaignsResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  fallbackReason?: string;
  provenance?: {
    configuredSource?: string;
    source?: string;
    loadedFrom?: string;
    fallbackReason?: string;
    lastLoadAt?: string;
    lastPersistAt?: string;
  };
  generatedAt?: string;
  summary?: {
    dataState?: 'populated' | 'empty';
    campaigns?: number;
    leads?: number;
    events?: number;
  };
  campaigns?: CampaignRecord[];
  leads?: CampaignLeadRecord[];
  events?: CampaignEventRecord[];
  sources?: CampaignLeadSource[];
  state?: RuntimeSnapshot;
  verbiage?: string;
  error?: string;
};

export type ReplyTemplateRecord = {
  templateKey?: string;
  templateVersion?: string;
  channel?: string;
  subject?: string;
  text?: string;
  html?: string;
  [key: string]: unknown;
};

export type ReplyTemplatesResponse = {
  ok: boolean;
  reply?: Record<string, unknown>;
  calendarEvent?: Record<string, unknown> | null;
  selected?: ReplyTemplateRecord;
  templates?: Record<string, ReplyTemplateRecord>;
  error?: string;
};

export type CampaignRankedTemplatesResponse = {
  ok: boolean;
  result?: string;
  source?: string;
  generatedAt?: string;
  channel?: string;
  leadSource?: string;
  templates?: Record<string, ReplyTemplateRecord & { rank?: number; score?: number }>;
  rankedTemplates?: Array<ReplyTemplateRecord & { key?: string; rank?: number; score?: number }>;
  warning?: string;
  error?: string;
};

type BridgeRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  keepalive?: boolean;
};

function getHostPBK(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  const candidates = [window.parent, window.opener].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (
        candidate &&
        candidate !== window &&
        (candidate as Window & { PBK?: Record<string, unknown> }).PBK
      ) {
        return (candidate as Window & { PBK?: Record<string, unknown> }).PBK || null;
      }
    } catch {
      // cross-origin or inaccessible
    }
  }
  return (window as typeof window & { PBK?: Record<string, unknown> }).PBK || null;
}

function buildLocalBridgeFallback() {
  if (typeof window === 'undefined') return null;
  const host = window.location.hostname;
  const isLocalPreview = host === '127.0.0.1' || host === 'localhost';
  if (!isLocalPreview) return null;
  return {
    // Keep local browser traffic on the Vite origin so the dev proxy can
    // attach the private bridge API key without exposing it to frontend JS.
    endpoint: window.location.origin,
  };
}

function getStorageEnvironment() {
  if (typeof window === 'undefined') return 'local';
  const host = String(window.location.hostname || 'local').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return 'local';
  if (host.includes('pbkcommandcenter') || host.endsWith('.netlify.app')) return 'prod';
  return host.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'local';
}

function readRuntimeConfigFromStorage(): RuntimeConfig | null {
  if (typeof window === 'undefined') return null;
  const keys = [`pbk:${getStorageEnvironment()}:openclaw-config`, 'pbk-openclaw-config'];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.endpoint) return parsed;
    } catch {
      // ignore localStorage parsing failure
    }
  }
  return null;
}

function getEnvRuntimeConfig(): RuntimeConfig | null {
  const env = import.meta.env || {};
  const endpoint =
    env.VITE_PBK_BRIDGE_URL || env.VITE_PBK_OPENCLAW_URL || env.VITE_PBK_OPENCLAW_ENDPOINT;
  if (!endpoint) return null;

  const apiKey = env.DEV ? env.VITE_PBK_BRIDGE_API_KEY || env.VITE_PBK_OPENCLAW_API_KEY : undefined;
  return apiKey ? { endpoint, apiKey } : { endpoint };
}

export function getRuntimeTeamSession(): RuntimeTeamSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(RUNTIME_TEAM_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as RuntimeTeamSession;
    if (!session?.token || !session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
      window.localStorage.removeItem(RUNTIME_TEAM_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    window.localStorage.removeItem(RUNTIME_TEAM_SESSION_KEY);
    return null;
  }
}

export function clearRuntimeTeamSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(RUNTIME_TEAM_SESSION_KEY);
}

function saveRuntimeTeamSession(session: RuntimeTeamSession) {
  if (typeof window === 'undefined') return session;
  window.localStorage.setItem(RUNTIME_TEAM_SESSION_KEY, JSON.stringify(session));
  return session;
}

export function isRuntimeTeamAuthRequired() {
  return isHostedRuntimeShell();
}

export function getRuntimeConfig(): RuntimeConfig {
  const hostPBK = getHostPBK();
  const fromHost =
    typeof hostPBK?.openclaw === 'object' &&
    typeof (hostPBK.openclaw as { getConfig?: () => RuntimeConfig }).getConfig === 'function'
      ? (hostPBK.openclaw as { getConfig: () => RuntimeConfig }).getConfig()
      : null;

  if (fromHost?.endpoint) return fromHost;

  if (isHostedRuntimeShell()) {
    // Production and deploy previews should always use the same-origin
    // bridge/proxy first. It keeps the bridge API key server-side and avoids
    // mobile browsers getting stuck on stale localhost/LAN/direct settings.
    return { endpoint: window.location.origin };
  }

  const stored = readRuntimeConfigFromStorage();
  if (stored?.endpoint) {
    const localFallback = buildLocalBridgeFallback();
    if (
      localFallback &&
      !stored.apiKey &&
      String(stored.endpoint) !== String(localFallback.endpoint)
    ) {
      return localFallback;
    }
    return stored;
  }

  const localFallback = buildLocalBridgeFallback();
  if (localFallback) return localFallback;

  const envConfig = getEnvRuntimeConfig();
  if (envConfig?.endpoint) return envConfig;

  return {
    endpoint:
      DEFAULT_HOSTED_BRIDGE_ENDPOINT ||
      (typeof window !== 'undefined' ? window.location.origin : ''),
  };
}

function isAuthOptionalRuntimePath(path = '') {
  const normalized = `/${
    String(path || '')
      .replace(/^\/+/, '')
      .split('?')[0]
  }`;
  return (
    ['/health', '/status', '/api/health', '/api/status'].includes(normalized) ||
    normalized === '/api/scripts/current' ||
    normalized === '/api/v1/scripts/current' ||
    normalized === '/api/observability/ai-metrics' ||
    normalized === '/api/v1/observability/ai-metrics' ||
    normalized === '/api/skills/outcomes' ||
    normalized === '/api/v1/skills/outcomes' ||
    normalized === '/api/skills/trends' ||
    normalized === '/api/v1/skills/trends' ||
    normalized === '/api/auth/team' ||
    normalized === '/api/auth/team/status' ||
    normalized === '/api/auth/team/verify' ||
    normalized.startsWith('/api/public/')
  );
}

function hasServerSideRuntimeAuth() {
  if (typeof window === 'undefined') return false;
  if (!isHostedRuntimeShell()) return false;
  const config = getRuntimeConfig();
  const endpoint = String(config.endpoint || '').replace(/\/+$/g, '');
  const origin = String(window.location.origin || '').replace(/\/+$/g, '');
  return endpoint === origin && Boolean(getRuntimeTeamSession());
}

function hasLocalDevProxyAuth() {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return false;
  const host = String(window.location.hostname || '').toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost') return false;
  const config = getRuntimeConfig();
  const endpoint = String(config.endpoint || '').replace(/\/+$/g, '');
  const origin = String(window.location.origin || '').replace(/\/+$/g, '');
  return endpoint === origin;
}

function assertRuntimeAuthConfigured(path = '') {
  if (isAuthOptionalRuntimePath(path)) return;
  if (hasServerSideRuntimeAuth()) return;
  if (hasLocalDevProxyAuth()) return;
  const config = getRuntimeConfig();
  if (config.apiKey) return;
  throw new Error(
    'PBK bridge API key is not configured. Open Settings and save PBK_BRIDGE_API_KEY before running protected Command Center actions.'
  );
}

function getWebSearchSnnWorkers() {
  if (typeof Worker === 'undefined') return [];
  if (!avaSnnWorker) avaSnnWorker = createPbkSnnWorker('ava', { role: 'acquisitions' });
  if (!rexSnnWorker) rexSnnWorker = createPbkSnnWorker('rex', { role: 'research' });
  return [avaSnnWorker, rexSnnWorker].filter(Boolean) as Worker[];
}

function injectWebSearchCognition(result: SearchCognitionResult) {
  if (!result?.snnSpikeInjection) {
    return { injected: false, reason: 'no_snn_spike_injection', agents: [] };
  }
  const workers = getWebSearchSnnWorkers();
  let injectedCount = 0;
  for (const worker of workers) {
    if (injectSearchCognition(worker, result)) injectedCount += 1;
  }
  return {
    injected: injectedCount > 0,
    injectedCount,
    agents: workers.map(
      (worker) => (worker as Worker & { pbkAgentId?: string }).pbkAgentId || 'unknown'
    ),
  };
}

export function hasRuntimeConnection(): boolean {
  const config = getRuntimeConfig();
  return Boolean(config.endpoint);
}

function buildHeaders(withJson = false) {
  return buildRuntimeHeaders({ json: withJson });
}

export function buildRuntimeHeaders({
  json = false,
  accept = 'application/json',
}: {
  json?: boolean;
  accept?: string;
} = {}) {
  const config = getRuntimeConfig();
  const headers: Record<string, string> = {
    Accept: accept,
  };
  if (json) headers['Content-Type'] = 'application/json';
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const teamSession = getRuntimeTeamSession();
  if (teamSession?.token) headers['X-PBK-Team-Token'] = teamSession.token;
  return headers;
}

function buildUrl(path: string) {
  const config = getRuntimeConfig();
  const endpoint = String(config.endpoint || window.location.origin).replace(/\/+$/g, '');
  return `${endpoint}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildRuntimeUrl(path: string) {
  return buildUrl(path);
}

function bridgeErrorValue(value: unknown) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function humanizeBridgeCode(value = '') {
  return String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function extractBridgeErrorMessage(parsed: unknown, status: number) {
  const fallback = `Bridge request failed (${status})`;
  if (!parsed || typeof parsed !== 'object') {
    const text = bridgeErrorValue(parsed);
    return text || fallback;
  }

  const record = parsed as Record<string, unknown>;
  const providerResult =
    record.providerResult && typeof record.providerResult === 'object'
      ? (record.providerResult as Record<string, unknown>)
      : {};
  const safetyValidation =
    record.safetyValidation && typeof record.safetyValidation === 'object'
      ? (record.safetyValidation as Record<string, unknown>)
      : {};
  const qaValidation =
    record.qaValidation && typeof record.qaValidation === 'object'
      ? (record.qaValidation as Record<string, unknown>)
      : {};
  const event =
    record.event && typeof record.event === 'object'
      ? (record.event as Record<string, unknown>)
      : {};
  const outbox =
    record.outbox && typeof record.outbox === 'object'
      ? (record.outbox as Record<string, unknown>)
      : {};
  const eventPayload =
    event.payload && typeof event.payload === 'object'
      ? (event.payload as Record<string, unknown>)
      : {};

  const result = bridgeErrorValue(record.result || providerResult.result || record.outcome);
  const reason = bridgeErrorValue(
    record.error ||
      record.message ||
      record.reason ||
      record.verbiage ||
      outbox.error ||
      providerResult.error ||
      providerResult.message ||
      providerResult.reason ||
      safetyValidation.error ||
      safetyValidation.message ||
      qaValidation.error ||
      qaValidation.message ||
      eventPayload.reason ||
      eventPayload.result
  );

  if (result === 'provider_delivery_unknown' || result === 'reconciliation_required') {
    return reason
      ? `${reason} Verify provider delivery before retrying.`
      : 'Provider delivery is unknown. Verify Telnyx/Instantly delivery before retrying.';
  }

  if (reason) return reason;
  if (result) return `${fallback}: ${humanizeBridgeCode(result)}.`;
  return fallback;
}

export async function bridgeBlobRequest({
  method = 'GET',
  path,
  body,
  accept = 'application/octet-stream',
  signal,
}: BridgeRequestOptions & { accept?: string; signal?: AbortSignal }): Promise<Blob> {
  assertRuntimeAuthConfigured(path);
  const serializedBody = body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined;
  const timeoutController = new AbortController();
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutId = setTimeout(() => timeoutController.abort(), 15_000);

  try {
    const response = await fetch(buildUrl(path), {
      method,
      headers: buildRuntimeHeaders({
        json: body !== undefined && method !== 'GET',
        accept,
      }),
      body: serializedBody,
      signal: timeoutController.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      let message = `Bridge request failed (${response.status})`;
      try {
        const payload = text ? JSON.parse(text) : null;
        message = extractBridgeErrorMessage(payload, response.status);
      } catch {
        if (text) message = text;
      }
      throw new Error(message);
    }
    return await response.blob();
  } catch (error) {
    if (timeoutController.signal.aborted) {
      if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      throw new Error('PBK bridge request timed out after 15 seconds.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function bridgeRequest<T = unknown>({
  method = 'GET',
  path,
  body,
  keepalive,
}: BridgeRequestOptions): Promise<T> {
  assertRuntimeAuthConfigured(path);
  const serializedBody = body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined;
  const canKeepalive =
    method !== 'GET' && method !== 'DELETE' && (!serializedBody || serializedBody.length < 60000);
  const requestUrl = buildUrl(path);
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 15_000);
  const init = {
    method,
    headers: buildHeaders(body !== undefined && method !== 'GET'),
    body: serializedBody,
    keepalive: keepalive ?? canKeepalive,
    signal: timeoutController.signal,
  };
  let response: Response;
  let parsed: unknown;
  try {
    response = await fetch(requestUrl, init);
    if (await shouldRetryRuntimeViaHosted(response, requestUrl, path)) {
      const fallbackUrl = buildHostedRuntimeFallbackUrl(requestUrl);
      if (fallbackUrl) response = await fetch(fallbackUrl, init);
    }
    const text = await response.text();
    parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error('PBK bridge request timed out after 15 seconds.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(extractBridgeErrorMessage(parsed, response.status));
  }

  return parsed as T;
}

function assertBridgeMutationSucceeded<T>(response: T, action = 'Bridge mutation'): T {
  const record =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : {};
  const statusText = String(
    record.result || record.status || record.outcome || record.reason || ''
  ).toLowerCase();
  const failed =
    record.ok === false ||
    /\b(failed|error|rejected|denied|provider_missing|safety_blocked|missing_[a-z0-9_]*proof)\b/i.test(
      statusText
    );
  if (!failed) return response;
  const message =
    String(record.error || record.message || record.verbiage || '').trim() || `${action} failed.`;
  throw new Error(message);
}

function isNetlifyHostedRuntimeShell() {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host.includes('pbkcommandcenter') || host.endsWith('.netlify.app');
}

function isBridgeHostedRuntimeShell() {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host.includes('pbk-openclaw-bridge') || host.endsWith('.onrender.com');
}

function isHostedRuntimeShell() {
  return isNetlifyHostedRuntimeShell() || isBridgeHostedRuntimeShell();
}

function buildHostedRuntimeFallbackUrl(url = '') {
  if (!isNetlifyHostedRuntimeShell()) return '';
  try {
    const current = new URL(url, window.location.href);
    if (current.origin !== window.location.origin) return '';
    return new URL(
      `${current.pathname}${current.search}`,
      `${DEFAULT_HOSTED_BRIDGE_ENDPOINT}/`
    ).toString();
  } catch {
    return '';
  }
}

async function shouldRetryRuntimeViaHosted(response: Response, url = '', path = '') {
  if (!isAuthOptionalRuntimePath(path)) return false;
  if (!buildHostedRuntimeFallbackUrl(url)) return false;
  if (response.status !== 503) return false;
  const text = await response
    .clone()
    .text()
    .catch(() => '');
  return /usage_exceeded/i.test(text) || /Usage exceeded/i.test(text);
}

export async function fetchTeamAuthStatusRequest() {
  return bridgeRequest<{
    ok: boolean;
    configured: boolean;
    authRequired?: boolean;
    sessionTtlMs?: number;
    permissions?: Record<string, unknown>;
  }>({
    path: '/api/auth/team/status',
  });
}

export async function authenticateTeamSessionRequest(body: { passcode: string; actor?: string }) {
  const response = await bridgeRequest<RuntimeTeamSession & { ok: boolean }>({
    method: 'POST',
    path: '/api/auth/team',
    body,
  });
  if (!response.ok || !response.token) {
    throw new Error('PBK team session could not be created.');
  }
  return saveRuntimeTeamSession({
    token: response.token,
    role: response.role || 'team',
    actor: response.actor || body.actor || 'PBK team',
    expiresAt: response.expiresAt,
    permissions: response.permissions,
  });
}

export async function verifyRuntimeTeamSessionRequest() {
  const session = getRuntimeTeamSession();
  if (!session) return null;
  try {
    const verified = await bridgeRequest<{
      ok: boolean;
      role?: string;
      actor?: string;
      expiresAt?: string;
      permissions?: Record<string, unknown>;
    }>({
      method: 'POST',
      path: '/api/auth/team/verify',
      body: {},
    });
    if (!verified.ok) throw new Error('Team session verification failed.');
    return saveRuntimeTeamSession({
      ...session,
      role: verified.role || session.role,
      actor: verified.actor || session.actor,
      expiresAt: verified.expiresAt || session.expiresAt,
      permissions: verified.permissions || session.permissions,
    });
  } catch {
    clearRuntimeTeamSession();
    return null;
  }
}

export async function invokeRuntimeTool<T = unknown>(
  toolName: string,
  params: Record<string, unknown> = {}
) {
  const envelope = await bridgeRequest<{
    ok?: boolean;
    result?: T;
    error?: string;
    message?: string;
  }>({
    method: 'POST',
    path: '/invoke',
    body: { toolName, params },
  });
  if (envelope?.ok === false) {
    throw new Error(envelope.error || envelope.message || `${toolName} failed.`);
  }
  if (!envelope || !Object.prototype.hasOwnProperty.call(envelope, 'result')) {
    throw new Error(`${toolName} returned an invalid bridge response.`);
  }
  const result = envelope.result;
  if (result && typeof result === 'object' && 'ok' in result && result.ok === false) {
    const failedResult = result as Record<string, unknown>;
    throw new Error(String(failedResult.error || failedResult.message || `${toolName} failed.`));
  }
  return result as T;
}

export async function startLeadCallRequest(body: Record<string, unknown>) {
  return invokeRuntimeTool<Record<string, unknown>>('telnyx_call', {
    ...body,
    manual: body.manual === false ? false : true,
    manualSend: body.manualSend === false ? false : true,
    requestedBy: body.requestedBy || body.requested_by || body.actor || 'PBK operator',
    source: body.source || 'command_center_manual',
  });
}

export async function fetchRuntimeState() {
  return bridgeRequest<RuntimeSnapshot>({
    path: '/state',
  });
}

export async function createRuntimeStateStreamSessionRequest() {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    session?: {
      token?: string;
      wsUrl?: string;
      expiresAt?: string;
      ttlMs?: number;
    };
  }>({
    method: 'POST',
    path: '/api/state/stream/session',
    body: {
      source: 'command-center-runtime-snapshot',
      actor: 'PBK Command Center',
    },
  });
}

export function buildRuntimeWebSocketUrl(path: string) {
  const url = new URL(
    buildUrl(path),
    typeof window !== 'undefined' ? window.location.href : undefined
  );
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export async function fetchRuntimeSettingsRequest() {
  return bridgeRequest<{
    ok: boolean;
    source?: string;
    settings?: Record<string, unknown>;
  }>({
    path: '/api/settings',
  });
}

export async function updateRuntimeSettingsRequest(body: Record<string, unknown>) {
  return bridgeRequest<{
    ok: boolean;
    source?: string;
    settings?: Record<string, unknown>;
    state?: RuntimeSnapshot;
  }>({
    method: 'PATCH',
    path: '/api/settings',
    body,
  });
}

export async function fetchRuntimeQuotas() {
  const response = await bridgeRequest<{ ok: boolean; quotas: RuntimeQuotas }>({
    path: '/api/quotas',
  });
  return response.quotas || {};
}

export async function fetchRuntimeToolingStatus() {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), 10_000);
  const timeout$ = new Promise<never>((_, reject) =>
    controller.signal.addEventListener('abort', () => reject(new Error('tooling_status_timeout')))
  );
  try {
    const response = await Promise.race([
      bridgeRequest<{ ok: boolean; tooling: RuntimeToolingStatus }>({
        path: '/api/tooling/status',
      }),
      timeout$,
    ]);
    return (response as { ok: boolean; tooling: RuntimeToolingStatus }).tooling || {};
  } finally {
    clearTimeout(handle);
  }
}

export async function fetchAgentHealthRequest() {
  return bridgeRequest<AgentHealthResponse>({
    path: '/api/agents/health',
  });
}

export async function fetchAgentRegistryRequest() {
  return bridgeRequest<AgentRegistryResponse>({
    path: '/api/agents/registry',
  });
}

export type QaAuditRecord = {
  id?: string;
  toolName?: string;
  passed?: boolean;
  skipped?: boolean;
  reason?: string;
  validator?: string;
  retryCount?: number;
  source?: string;
  createdAt?: string;
  qa?: Record<string, unknown>;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
};

export async function fetchLatestQaAuditRequest({
  leadId = '',
  limit = 5,
}: {
  leadId?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(50, limit))),
  });
  if (leadId) params.set('leadId', leadId);
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    source?: string;
    leadId?: string;
    count?: number;
    latest?: QaAuditRecord | null;
    audits?: QaAuditRecord[];
    warning?: string;
  }>({
    path: `/api/qa/audit/latest?${params.toString()}`,
  });
}

export async function deployAgentRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/agents/deploy',
    body,
  });
}

export async function fetchAgentSnnStatusRequest() {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    workers?: Array<Record<string, unknown>>;
    frontend?: Record<string, unknown>;
    providers?: Record<string, unknown>;
  }>({
    path: '/api/agents/snn-status',
  });
}

export async function fetchDesktopSidecarStatusRequest() {
  return bridgeRequest<DesktopSidecarStatusResponse>({
    path: '/api/desktop-sidecar/status',
  });
}

export async function fetchLocalCommandsRequest({
  status = 'all',
  limit = 40,
}: {
  status?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams({
    status,
    limit: String(Math.max(1, Math.min(200, limit))),
  });
  return bridgeRequest<LocalCommandsResponse>({
    path: `/api/local/commands?${params.toString()}`,
  });
}

export async function queueLocalCommandRequest(body: Record<string, unknown>) {
  return bridgeRequest<LocalCommandsResponse>({
    method: 'POST',
    path: '/api/local/commands',
    body,
  });
}

export async function executeLocalCommandRequest(body: Record<string, unknown>) {
  return invokeRuntimeTool<LocalCommandsResponse>('executeLocalCommand', body);
}

export async function completeLocalCommandRequest(
  commandId: string,
  body: Record<string, unknown>
) {
  return bridgeRequest<LocalCommandsResponse>({
    method: 'POST',
    path: `/api/local/commands/${encodeURIComponent(commandId)}/result`,
    body,
  });
}

export async function fetchGlobalSearchRequest({
  query = '',
  limit = 8,
}: {
  query?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams();
  params.set('q', query.trim());
  params.set('limit', String(Math.max(1, Math.min(40, limit))));
  return bridgeRequest<GlobalSearchResponse>({
    path: `/api/search?${params.toString()}`,
  });
}

export async function fetchFounderWorkQueueRequest({ limit = 8 }: { limit?: number } = {}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(24, limit))),
  });
  return bridgeRequest<FounderWorkQueueResponse>({
    path: `/api/founder/work-queue?${params.toString()}`,
  });
}

export async function fetchIntelligenceStreamRequest({ limit = 24 }: { limit?: number } = {}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(80, limit))),
  });
  return bridgeRequest<IntelligenceStreamResponse>({
    path: `/api/intelligence/stream?${params.toString()}`,
  });
}

export async function fetchSystemSourceLabelsRequest() {
  return bridgeRequest<SystemSourceLabelsResponse>({
    path: '/api/system/source-labels',
  });
}

export async function fetchReleaseStatusRequest() {
  return bridgeRequest<ReleaseStatusResponse>({
    path: '/api/release/status',
  });
}

export async function fetchProductionGapsRequest() {
  return bridgeRequest<ProductionGapsResponse>({
    path: '/api/production/gaps',
  });
}

export async function fetchObservabilityStatusRequest() {
  return bridgeRequest<ObservabilityStatusResponse>({
    path: '/api/observability/status',
  });
}

export async function fetchVectorCapacityStatusRequest() {
  return bridgeRequest<VectorCapacityStatusResponse>({
    path: '/api/vector/capacity',
  });
}

export function getSnnWorkerStatus(): { ava: boolean; rex: boolean } {
  return { ava: avaSnnWorker !== null, rex: rexSnnWorker !== null };
}

export async function postRuntimeEvent<T = Record<string, unknown>>(
  eventType: string,
  payload: Record<string, unknown>
) {
  return bridgeRequest<T>({
    method: 'POST',
    path: '/events',
    body: { eventType, payload },
  });
}

export async function updateApprovalDecision(approvalId: string, status: string) {
  const response = await bridgeRequest<Record<string, unknown>>({
    method: 'PUT',
    path: `/api/approvals/${encodeURIComponent(approvalId)}`,
    body: {
      status,
      actor: 'PBK React shell',
      actedAt: new Date().toISOString(),
    },
  });
  return assertBridgeMutationSucceeded(response, 'Approval decision');
}

export async function fetchLeadsRequest() {
  const response = await bridgeRequest<{
    ok: boolean;
    leads?: LeadImport[];
    leadImports?: LeadImport[];
  }>({
    path: '/api/leads',
  });
  return response.leads || response.leadImports || [];
}

export async function createLeadRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/leads',
    body,
  });
}

export async function fetchLeadStagesRequest({ limit = 500 } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    groupBy: 'stage',
  });
  return bridgeRequest<LeadStagesResponse>({
    path: `/api/leads/stages?${params.toString()}`,
  });
}

export async function fetchDealTimelineRequest({ days = 30 } = {}) {
  const params = new URLSearchParams({
    days: String(days),
  });
  return bridgeRequest<DealTimelineResponse>({
    path: `/api/deals/timeline?${params.toString()}`,
  });
}

export async function fetchAiMetricsRequest({ days = 30 } = {}) {
  const params = new URLSearchParams({
    days: String(days),
  });
  return bridgeRequest<AiMetricsResponse>({
    path: `/api/observability/ai-metrics?${params.toString()}`,
  });
}

export async function fetchSkillOutcomesRequest() {
  return bridgeRequest<SkillOutcomesResponse>({
    path: '/api/skills/outcomes',
  });
}

export async function fetchSkillGovernanceStatusRequest() {
  return bridgeRequest<SkillGovernanceStatusResponse>({
    path: '/api/skills/governance/status',
  });
}

export async function fetchSkillGovernanceRepositoryRequest({
  lifecycleState = '',
  search = '',
  limit = 100,
}: {
  lifecycleState?: string;
  search?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(200, limit))),
  });
  if (lifecycleState) params.set('lifecycleState', lifecycleState);
  if (search.trim()) params.set('search', search.trim());
  return bridgeRequest<SkillGovernanceRepositoryResponse>({
    path: `/api/skills/governance/repository?${params.toString()}`,
  });
}

export async function createSkillCandidateRequest(body: Record<string, unknown>) {
  return bridgeRequest<
    Record<string, unknown> & {
      ok: boolean;
      version?: SkillGovernanceItem;
    }
  >({
    method: 'POST',
    path: '/api/skills/candidates',
    body,
  });
}

export type SkillIngestResponse = {
  ok: boolean;
  result: string;
  sourceType?: 'youtube';
  sourceUrl?: string;
  agentId?: string;
  createdCount?: number;
  candidates?: Array<{
    name: string;
    riskClass: string;
    confidence: number;
    definitionId: string;
    versionId: string;
    contentHash: string;
    lifecycleState: string;
  }>;
  transcript?: {
    videoId?: string;
    title?: string;
    chars?: number;
    segmentCount?: number;
    source?: string;
    fallbackUsed?: boolean;
  };
  reason?: string;
  retryable?: boolean;
  fallback?: {
    type?: string;
    field?: string;
    minChars?: number;
    available?: boolean;
  };
};

export async function ingestSkillCandidatesRequest(body: {
  sourceType: 'youtube';
  source: string;
  agentId: string;
  maxCandidates?: number;
  manualTranscript?: string;
  audioTranscriptUrl?: string;
}) {
  return bridgeRequest<SkillIngestResponse>({
    method: 'POST',
    path: '/api/skills/ingest',
    body,
  });
}

export async function approveSkillVersionRequest(
  versionId: string,
  body: {
    expectedHash: string;
    decision?: 'approved' | 'rejected';
    evidenceSnapshot?: Record<string, unknown>;
  }
) {
  return bridgeRequest<Record<string, unknown> & { ok: boolean }>({
    method: 'POST',
    path: `/api/skills/versions/${encodeURIComponent(versionId)}/approve`,
    body,
  });
}

export async function activateSkillVersionRequest(
  versionId: string,
  body: {
    agentId: string;
    rolloutMode?: 'canary' | 'full';
    rolloutPercent?: number;
    priority?: number;
    scope?: Record<string, unknown>;
    rollbackThresholds?: Record<string, unknown>;
  }
) {
  return bridgeRequest<Record<string, unknown> & { ok: boolean }>({
    method: 'POST',
    path: `/api/skills/versions/${encodeURIComponent(versionId)}/activate`,
    body,
  });
}

export async function rollbackSkillActivationRequest(
  activationId: string,
  body: { reason: string }
) {
  return bridgeRequest<Record<string, unknown> & { ok: boolean }>({
    method: 'POST',
    path: `/api/skills/activations/${encodeURIComponent(activationId)}/rollback`,
    body,
  });
}

export async function fetchSkillTrendsRequest({
  skillId = '',
  skillName = '',
  days = 30,
}: {
  skillId?: string;
  skillName?: string;
  days?: number;
} = {}) {
  const params = new URLSearchParams({
    days: String(days),
  });
  if (skillId) params.set('skillId', skillId);
  if (skillName) params.set('skillName', skillName);
  return bridgeRequest<SkillTrendsResponse>({
    path: `/api/skills/trends?${params.toString()}`,
  });
}

export async function fetchActiveExperimentsRequest() {
  return bridgeRequest<ActiveExperimentsResponse>({
    path: '/api/emotion/policies/experiments',
  });
}

export async function fetchMemoryEventsRequest({ limit = 40 } = {}) {
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(200, limit))),
  });
  return bridgeRequest<MemoryEventsResponse>({
    path: `/api/memory/events?${params.toString()}`,
  });
}

export async function fetchCampaignsRequest({
  search = '',
  status = 'all',
  channel = 'all',
}: {
  search?: string;
  status?: string;
  channel?: string;
} = {}) {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (status && status !== 'all') params.set('status', status);
  if (channel && channel !== 'all') params.set('channel', channel);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return bridgeRequest<CampaignsResponse>({
    path: `/api/campaigns${suffix}`,
  });
}

export async function fetchCampaignLeadSourcesRequest() {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    sources?: CampaignLeadSource[];
    state?: RuntimeSnapshot;
  }>({
    path: '/api/campaigns/lead-sources',
  });
}

export async function fetchCampaignRankedTemplatesRequest({
  channel = 'email',
  leadSource = 'all-imports',
  campaignId = '',
  limit = 8,
}: {
  channel?: string;
  leadSource?: string;
  campaignId?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams({
    channel,
    leadSource,
    limit: String(Math.max(1, Math.min(24, limit))),
  });
  if (campaignId.trim()) params.set('campaignId', campaignId.trim());
  return bridgeRequest<CampaignRankedTemplatesResponse>({
    path: `/api/campaigns/templates/ranked?${params.toString()}`,
  });
}

export async function fetchCampaignDrilldownRequest({
  range = '30d',
  campaignId = 'all',
  source = 'all',
  channel = 'all',
  status = 'all',
  limit = 120,
}: {
  range?: string;
  campaignId?: string;
  source?: string;
  channel?: string;
  status?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams({
    range,
    campaignId,
    source,
    channel,
    status,
    limit: String(Math.max(1, Math.min(500, limit))),
  });
  return bridgeRequest<CampaignDrilldownResponse>({
    path: `/api/analytics/campaign-drilldown?${params.toString()}`,
  });
}

export async function fetchReplyTemplatesRequest({
  channel = 'email',
  leadName = '',
  address = '',
  body = '',
}: {
  channel?: string;
  leadName?: string;
  address?: string;
  body?: string;
} = {}) {
  const params = new URLSearchParams({
    channel,
  });
  if (leadName.trim()) params.set('leadName', leadName.trim());
  if (address.trim()) params.set('address', address.trim());
  if (body.trim()) params.set('body', body.trim());
  return bridgeRequest<ReplyTemplatesResponse>({
    path: `/api/replies/templates?${params.toString()}`,
  });
}

export async function createCampaignRequest(body: Record<string, unknown>) {
  return bridgeRequest<CampaignsResponse & { campaign?: CampaignRecord }>({
    method: 'POST',
    path: '/api/campaigns',
    body,
  });
}

export async function patchCampaignRequest(campaignId: string, body: Record<string, unknown>) {
  return bridgeRequest<CampaignsResponse & { campaign?: CampaignRecord }>({
    method: 'PATCH',
    path: `/api/campaigns/${encodeURIComponent(campaignId)}`,
    body,
  });
}

export async function requestCampaignApprovalRequest(
  campaignId: string,
  body: Record<string, unknown>
) {
  return bridgeRequest<
    CampaignsResponse & { campaign?: CampaignRecord; approval?: ApprovalRecord }
  >({
    method: 'POST',
    path: `/api/campaigns/${encodeURIComponent(campaignId)}/approval`,
    body,
  });
}

export async function runCampaignActionRequest(campaignId: string, body: Record<string, unknown>) {
  return bridgeRequest<CampaignsResponse & { campaign?: CampaignRecord }>({
    method: 'POST',
    path: `/api/campaigns/${encodeURIComponent(campaignId)}/actions`,
    body,
  });
}

export async function recordCampaignEventRequest(
  campaignId: string,
  body: Record<string, unknown>
) {
  return bridgeRequest<CampaignsResponse & { event?: CampaignEventRecord }>({
    method: 'POST',
    path: `/api/campaigns/${encodeURIComponent(campaignId)}/events`,
    body,
  });
}

export async function fetchMessagesRequest({ limit = 80, offset = 0 } = {}) {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  });
  return bridgeRequest<{
    ok: boolean;
    count?: number;
    limit?: number;
    offset?: number;
    messages?: MessageRecord[];
  }>({
    path: `/api/messages?${params.toString()}`,
  });
}

export async function archiveMessageRequest(messageId: string, body: Record<string, unknown> = {}) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    message?: MessageRecord;
    state?: RuntimeSnapshot;
    error?: string;
  }>({
    method: 'PATCH',
    path: `/api/messages/${encodeURIComponent(messageId)}/archive`,
    body: {
      archived: true,
      actor: 'PBK React shell',
      ...body,
    },
  });
}

export async function sendMessageRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/lead/send-message',
    body: {
      ...body,
      manual: body.manual === false ? false : true,
      manualSend: body.manualSend === false ? false : true,
      requestedBy: body.requestedBy || body.requested_by || body.actor || 'PBK operator',
      source: body.source || 'lead_portal_manual',
    },
  });
}

export async function fetchCurrentScriptRequest(body: Record<string, unknown>) {
  return bridgeRequest<CurrentScriptResponse>({
    method: 'POST',
    path: '/api/scripts/current',
    body,
  });
}

export async function scheduleMessageRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/messages',
    body,
  });
}

export async function scheduleAppointmentRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/appointments',
    body,
  });
}

export async function cancelScheduledCallRequest(
  appointmentId: string,
  body: Record<string, unknown> = {}
) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/appointments',
    body: {
      ...body,
      id: appointmentId,
      status: 'cancelled',
      actor: body.actor || 'PBK React shell',
      notes: body.notes || 'Cancelled from the PBK call floor.',
    },
  });
}

export async function saveLeadNoteRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/leads/add-note',
    body,
  });
}

export async function sendOfferEmailRequest(body: Record<string, unknown>) {
  const response = await bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/cold-email/send',
    body,
  });
  return assertBridgeMutationSucceeded(response, 'Offer email send');
}

export async function updateAdminTaskDecision(taskId: string, status: string) {
  const response = await bridgeRequest<Record<string, unknown>>({
    method: 'PUT',
    path: `/api/admin/tasks/${encodeURIComponent(taskId)}`,
    body: {
      status,
      actor: 'PBK React shell',
      notes: `React shell marked task ${status}.`,
    },
  });
  return assertBridgeMutationSucceeded(response, 'Admin task decision');
}

export async function controlRuntimeCall(
  callId: string,
  action: string,
  extra: Record<string, unknown> = {}
) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: `/api/calls/${encodeURIComponent(callId)}/action`,
    body: {
      action,
      actor: 'PBK React shell',
      ...extra,
    },
  });
}

export async function queryBrainRequest(query: string) {
  return invokeRuntimeTool<Record<string, unknown>>('getBrainState', { query });
}

export async function launchBrowserResearchRequest(body: Record<string, unknown>) {
  return invokeRuntimeTool<Record<string, unknown>>('launchBrowserResearch', body);
}

export async function retrieveClosingIntelligenceRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/brain/retrieve',
    body,
  });
}

export async function getAvaConversationIntelligenceRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/ava/conversation-intelligence',
    body,
  });
}

export async function getProsodyAdviceRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/voice/prosody',
    body,
  });
}

export async function scoreCallQualityRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/calls/qa-score',
    body,
  });
}

export async function recordSkillOutcomeRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/skills/outcomes',
    body,
  });
}

export async function runRexSkillAutopilotRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/rex/skill-autopilot',
    body,
  });
}

export async function requestHumanHandoffRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/handoff/human',
    body,
  });
}

export async function retrieveSimilarDealsRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/deals/similar',
    body,
  });
}

export async function recallConversationMemoryRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/v1/memory/conversation',
    body,
  });
}

export async function webSearchRequest(body: Record<string, unknown>) {
  const result = await bridgeRequest<Record<string, unknown> & SearchCognitionResult>({
    method: 'POST',
    path: '/api/brain/web-search',
    body,
  });
  return {
    ...result,
    snnAdapter: injectWebSearchCognition(result),
  };
}

export async function fetchWebSearchStatusRequest() {
  return bridgeRequest<Record<string, unknown>>({
    path: '/api/brain/web-search/status',
  });
}

export async function sendSellerDocsRequest(body: Record<string, unknown>) {
  const response = await bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/send-seller-docs',
    body,
  });
  return assertBridgeMutationSucceeded(response, 'Seller document send');
}

export async function fetchLeadFullRequest(leadId: string) {
  return bridgeRequest<Record<string, unknown>>({
    path: `/api/leads/${encodeURIComponent(leadId)}/full`,
  });
}

export async function fetchLeadLastCallRequest(leadId: string) {
  return bridgeRequest<Record<string, unknown>>({
    path: `/api/leads/${encodeURIComponent(leadId)}/last-call`,
  });
}

export async function patchLeadRequest(leadId: string, body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'PATCH',
    path: `/api/leads/${encodeURIComponent(leadId)}`,
    body,
  });
}

export async function deleteLeadRequest(leadId: string, body: Record<string, unknown> = {}) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'DELETE',
    path: `/api/leads/${encodeURIComponent(leadId)}`,
    body,
  });
}

export async function sendLeadContractRequest(body: Record<string, unknown>) {
  const response = await bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/contract/send',
    body,
  });
  return assertBridgeMutationSucceeded(response, 'Lead contract send');
}

export async function prepareContractRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/contracts/prepare',
    body,
  });
}

export async function requestAdminActionRequest(body: Record<string, unknown>) {
  return bridgeRequest<Record<string, unknown>>({
    method: 'POST',
    path: '/api/admin/request',
    body,
  });
}

export function buildAnalyzePayload(deal: DealData) {
  const repairsMid = Number(deal.repairs?.mid || 0);
  const selectedPath = deal.selectedPath || '';
  const targetOffer = Number(deal.offer || deal.agreedPrice || deal.mao60 || 0);

  return {
    leadId: deal.leadId,
    lead_id: deal.leadId,
    address: deal.address,
    propertyAddress: deal.address,
    type: deal.type,
    propertyType: deal.type,
    contact: deal.contact === 'realtor' ? 'agent' : deal.contact,
    selectedPath,
    selected_path: selectedPath,
    path: selectedPath,
    sellerName: deal.sellerName,
    leadName: deal.sellerName,
    sellerEmail: deal.sellerEmail,
    email: deal.sellerEmail,
    sellerPhone: deal.sellerPhone,
    phone: deal.sellerPhone,
    price: deal.price,
    askingPrice: deal.price,
    agreedPrice: deal.agreedPrice,
    beds: deal.beds,
    baths: deal.baths,
    sqft: deal.sqft,
    year: deal.year,
    dom: deal.dom,
    lotSize: Number(deal.lotSize || 0),
    repairs: repairsMid,
    repairsMid,
    repairEstimate: repairsMid,
    condition: deal.repairs?.condition || '',
    arv: deal.arv,
    mao: deal.mao60,
    mao60: deal.mao60,
    maoCash: deal.mao60,
    maoRbp: deal.maoRBP,
    maoRBP: deal.maoRBP,
    targetOffer,
    offer: deal.offer,
    offerPrice: targetOffer,
    fee: deal.fee,
    assignmentFee: deal.fee,
    rent: deal.rent,
    balance: deal.balance,
    mortgageBalance: deal.balance,
    rate: deal.rate,
    mortgageRate: deal.rate,
    zipCode: deal.zipCode,
    timeline: deal.timeline,
    motivationScore: deal.motivationScore,
    motivationLevel: deal.motivationLevel,
    vacantStatus: deal.vacantStatus,
    reductions: deal.reductions,
    earnestDeposit: deal.earnestDeposit,
    confirmedTerms: deal.confirmedTerms,
    bant: {
      budget: deal.price || deal.agreedPrice || targetOffer || 0,
      authority: deal.contact,
      need: deal.notes || deal.motivationLevel || '',
      timeline: deal.timeline || '',
      urgency: deal.motivationLevel || '',
    },
    pathTerms: {
      cash: {
        asIs: deal.cashAsIs,
        closePeriod: deal.cashClosePeriod,
      },
      creativeFinance: {
        downPayment: deal.cfDownPayment,
        rate: deal.cfRate,
        term: deal.cfTerm,
        monthlyPayment: deal.cfMonthlyPayment,
        type: deal.cfType,
      },
      mortgageTakeover: {
        upfront: deal.mtUpfront,
        balance: deal.mtBalanceConfirm,
        rate: deal.mtRateConfirm,
        type: deal.mtType,
      },
      rbp: {
        priceConfirm: deal.rbpPriceConfirm,
        buyerType: deal.rbpBuyerType,
        sellerCosts: deal.rbpSellerCosts,
        cashAlternative: deal.rbpCashAlternative,
      },
      land: {
        inputMode: deal.landInputMode,
        priceSqFt: deal.landPriceSqFt,
        lotSizeSqFt: deal.landLotSizeSqFt,
        lotSizeConfirm: deal.landLotSizeConfirm,
        buyerType: deal.landBuyerType,
        sellerCosts: deal.landSellerCosts,
      },
    },
    notes: deal.notes || '',
  };
}

export async function syncDealAnalysis(deal: DealData) {
  return invokeRuntimeTool<Record<string, unknown>>('analyzeDeal', buildAnalyzePayload(deal));
}

export async function sendDealToAgent(
  deal: DealData,
  options: { agentDealContext?: AgentDealContext } = {}
) {
  const leadId = String(
    deal.leadId || (deal as DealData & { lead_id?: string }).lead_id || ''
  ).trim();
  if (!leadId) {
    throw new Error('Create or sync this lead before sending analyzer context to Ava or CRM.');
  }
  const agentDealContext =
    options.agentDealContext ||
    buildAgentDealContext(deal, {
      requestedBy: 'Analyzer runtime bridge',
    });
  return invokeRuntimeTool<Record<string, unknown>>('updateCRM', {
    target: deal.address || deal.sellerName || 'deal',
    leadId,
    lead_id: leadId,
    message: `Analyzer synced ${deal.address || 'deal'} to the runtime for ${deal.selectedPath || 'cash'} follow-up. Agent context includes ${agentDealContext.scriptPath}/${agentDealContext.scriptVariant}/${agentDealContext.activeScriptTab} script.`,
    deal,
    agentDealContext,
  });
}

export type ConversationListResponse = {
  ok: boolean;
  result?: string;
  items?: ConversationThread[];
  nextCursor?: string | null;
  error?: string;
};

export type ConversationDetailResponse = {
  ok: boolean;
  result?: string;
  thread?: ConversationThread | null;
  leadSummary?: Record<string, unknown> | null;
  senderSummary?: Record<string, unknown> | null;
  recipientSummary?: {
    phone?: string;
    email?: string;
  } | null;
  error?: string;
};

export type ConversationTimelineResponse = {
  ok: boolean;
  result?: string;
  items?: ConversationEvent[];
  nextCursor?: string | null;
  error?: string;
};

export type ManualSendOutbox = {
  ok?: boolean;
  result?: string;
  channel?: 'sms' | 'email' | 'call' | string;
  provider?: string;
  status?: 'queued' | 'sending' | 'sent' | 'failed' | string;
  timelineStatus?: string;
  idempotencyKey?: string;
  leadId?: string;
  recipient?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  operatorVisible?: boolean;
  error?: string;
  queuedAt?: string;
  sentAt?: string;
};

export type SenderIdentityListResponse = {
  ok: boolean;
  result?: string;
  items?: CommunicationSenderIdentity[];
  summary?: Record<string, unknown>;
  providers?: Record<string, unknown>;
  synced?: CommunicationSenderIdentity[];
  error?: string;
};

function conversationSearchSuffix(
  entries: Array<[string, string | number | boolean | null | undefined]>
) {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function fetchConversationsRequest({
  cursor = '',
  search = '',
  unread,
  pinned,
  archived,
  channel = '',
  activity = '',
  status = '',
  assignedAgent = '',
  leadId = '',
  limit = 40,
}: {
  cursor?: string;
  search?: string;
  unread?: boolean;
  pinned?: boolean;
  archived?: boolean;
  channel?: string;
  activity?: 'live' | 'approvals' | string;
  status?: string;
  assignedAgent?: string;
  leadId?: string;
  limit?: number;
} = {}) {
  const suffix = conversationSearchSuffix([
    ['cursor', cursor],
    ['search', search.trim()],
    ['unread', unread],
    ['pinned', pinned],
    ['archived', archived],
    ['channel', channel],
    ['activity', activity],
    ['status', status],
    ['assignedAgent', assignedAgent],
    ['leadId', leadId],
    ['limit', Math.max(1, Math.min(100, limit))],
  ]);
  return bridgeRequest<ConversationListResponse>({
    path: `/api/conversations${suffix}`,
  });
}

export async function fetchConversationRequest(threadId: string) {
  return bridgeRequest<ConversationDetailResponse>({
    path: `/api/conversations/${encodeURIComponent(threadId)}`,
  });
}

export async function resolveConversationThreadRequest(leadId: string) {
  return bridgeRequest<ConversationDetailResponse>({
    method: 'POST',
    path: '/api/conversations/resolve',
    body: {
      leadId: leadId.trim(),
    },
  });
}

export async function fetchConversationTimelineRequest(
  threadId: string,
  {
    cursor = '',
    limit = 80,
    includeHidden = false,
  }: {
    cursor?: string;
    limit?: number;
    includeHidden?: boolean;
  } = {}
) {
  const suffix = conversationSearchSuffix([
    ['cursor', cursor],
    ['limit', Math.max(1, Math.min(200, limit))],
    ['includeHidden', includeHidden || undefined],
  ]);
  return bridgeRequest<ConversationTimelineResponse>({
    path: `/api/conversations/${encodeURIComponent(threadId)}/timeline${suffix}`,
  });
}

export async function patchConversationRequest(
  threadId: string,
  body: {
    read?: boolean;
    unread?: boolean;
    pinned?: boolean;
    archived?: boolean;
    assignedAgent?: string;
    spam?: boolean;
  }
) {
  return bridgeRequest<ConversationDetailResponse>({
    method: 'PATCH',
    path: `/api/conversations/${encodeURIComponent(threadId)}`,
    body,
  });
}

export async function sendConversationMessageRequest(
  threadId: string,
  body: {
    channel: 'sms' | 'email';
    senderIdentityId: string;
    body: string;
    subject?: string;
    scheduledFor?: string;
    actor?: string;
    requestedBy?: string;
    source?: string;
    manual?: boolean;
    manualSend?: boolean;
  }
) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    scheduled?: boolean;
    scheduledFor?: string;
    message?: MessageRecord;
    approval?: ApprovalRecord | null;
    providerDeliveryClaimed?: boolean;
    event?: ConversationEvent;
    providerResult?: Record<string, unknown> & {
      approval?: ApprovalRecord | null;
      requiresApproval?: boolean;
      result?: string;
    };
    outbox?: ManualSendOutbox;
    idempotencyKey?: string;
    retryable?: boolean;
    qaValidation?: Record<string, unknown> | null;
    safetyValidation?: Record<string, unknown> | null;
    error?: string;
  }>({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(threadId)}/messages`,
    body,
  });
}

export async function fetchSenderIdentitiesRequest({
  channel = '',
  provider = '',
  lifecycleStatus = '',
}: {
  channel?: string;
  provider?: string;
  lifecycleStatus?: string;
} = {}) {
  const suffix = conversationSearchSuffix([
    ['channel', channel],
    ['provider', provider],
    ['lifecycleStatus', lifecycleStatus],
  ]);
  return bridgeRequest<SenderIdentityListResponse>({
    path: `/api/communication-identities${suffix}`,
  });
}

export async function syncSenderIdentitiesRequest() {
  return bridgeRequest<SenderIdentityListResponse>({
    method: 'POST',
    path: '/api/communication-identities/sync',
    body: {},
  });
}

export async function patchSenderIdentityRequest(
  identityId: string,
  body: {
    lifecycleStatus: string;
    reason?: string;
  }
) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    identity?: CommunicationSenderIdentity | null;
    error?: string;
  }>({
    method: 'PATCH',
    path: `/api/communication-identities/${encodeURIComponent(identityId)}`,
    body,
  });
}

export async function requestSenderReleaseRequest(identityId: string, body: { reason: string }) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    identity?: CommunicationSenderIdentity;
    approval?: ApprovalRecord;
    error?: string;
  }>({
    method: 'POST',
    path: `/api/communication-identities/${encodeURIComponent(identityId)}/release-request`,
    body,
  });
}

export async function fetchSenderRecommendationRequest(threadId: string, channel: 'sms' | 'email') {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    recommended?: CommunicationSenderIdentity | null;
    alternatives?: CommunicationSenderIdentity[];
    reasonCodes?: string[];
    error?: string;
  }>({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(threadId)}/sender-recommendation`,
    body: { channel },
  });
}

export async function refineConversationDraftRequest(
  threadId: string,
  body: {
    channel: 'sms' | 'email';
    draft: string;
    subject?: string;
  }
) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    degraded?: boolean;
    rawDraft?: string;
    refinedDraft?: string;
    contextEventCount?: number;
    error?: string;
  }>({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(threadId)}/refine-draft`,
    body,
  });
}

export async function patchConversationEventRequest(
  eventId: string,
  body: {
    read?: boolean;
    hidden?: boolean;
    important?: boolean;
  }
) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    event?: ConversationEvent;
    error?: string;
  }>({
    method: 'PATCH',
    path: `/api/conversation-events/${encodeURIComponent(eventId)}`,
    body,
  });
}

export async function restoreConversationEventRequest(eventId: string) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    event?: ConversationEvent;
    error?: string;
  }>({
    method: 'POST',
    path: `/api/conversation-events/${encodeURIComponent(eventId)}/restore`,
    body: {},
  });
}

export async function reportConversationEventSpamRequest(
  eventId: string,
  body: {
    reason?: string;
    explicitOptOut?: boolean;
    actor?: string;
  } = {}
) {
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    event?: ConversationEvent;
    explicitOptOut?: boolean;
    dncCreated?: boolean;
    error?: string;
  }>({
    method: 'POST',
    path: `/api/conversation-events/${encodeURIComponent(eventId)}/report-spam`,
    body,
  });
}

export async function searchLeadsRequest({
  query,
  limit = 8,
  threshold = 0.3,
}: {
  query: string;
  limit?: number;
  threshold?: number;
}) {
  const params = new URLSearchParams({
    q: query.trim(),
    limit: String(Math.max(1, Math.min(50, limit))),
    threshold: String(Math.max(0.05, Math.min(1, threshold))),
  });
  return bridgeRequest<{
    ok: boolean;
    result?: string;
    query?: string;
    count?: number;
    leads?: LeadImport[];
    error?: string;
  }>({
    path: `/api/leads/search?${params.toString()}`,
  });
}

export async function mergeConversationThreadsRequest(
  canonicalThreadId: string,
  mergedThreadId: string
) {
  return bridgeRequest<ConversationDetailResponse>({
    method: 'POST',
    path: `/api/conversations/${encodeURIComponent(canonicalThreadId)}/merge`,
    body: {
      canonicalThreadId,
      mergedThreadId,
    },
  });
}
