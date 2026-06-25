export type InboxRecord = Record<string, unknown>;

export type SmsSegmentInfo = {
  encoding: 'gsm-7' | 'ucs-2';
  units: number;
  segments: number;
  perSegment: number;
};

export type ComposeLeadMetric = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
};

export type ComposeRequest = {
  path: '/api/messages' | '/api/lead/send-message';
  body: Record<string, unknown>;
};

export type ReplyDraftMetric = {
  channel: 'sms' | 'email';
  recipient: string;
  leadId: string;
  message: string;
  sendLater: false;
  sendAt: string;
};

export function getSmsSegmentInfo(message?: string): SmsSegmentInfo;
export function normalizeComposeLead(record?: InboxRecord, index?: number): ComposeLeadMetric;
export function normalizeComposeLeads(records?: InboxRecord[]): ComposeLeadMetric[];
export function buildComposeRequest(draft?: InboxRecord, lead?: InboxRecord): ComposeRequest;
export function isGenericApprovalCopy(value?: unknown): boolean;
export function getApprovalFriendlySummary(approval?: InboxRecord): string;
export function getApprovalPreview(approval?: InboxRecord): string;
export function isContractApproval(approval?: InboxRecord): boolean;
export function getApprovalResolutionKeys(approval?: InboxRecord): string[];
export function getPendingApprovals(approvals?: InboxRecord[]): InboxRecord[];
export function getPendingApprovalCount(snapshot?: { approvals?: InboxRecord[] }): number;
export function getMessageTimestamp(message?: InboxRecord): string;
export function sortMessagesNewest(messages?: InboxRecord[]): InboxRecord[];
export function isUnreadMessage(message?: InboxRecord): boolean;
export function buildReplyDraftFromMessage(message?: InboxRecord): ReplyDraftMetric;
