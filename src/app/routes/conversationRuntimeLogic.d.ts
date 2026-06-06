import type {
  CommunicationSenderIdentity,
  ConversationEvent,
  ConversationThread,
} from '../utils/runtimeBridge';

export type ConversationDayGroup = {
  key: string;
  label: string;
  events: ConversationEvent[];
};

export type ConversationMobileState = 'threads' | 'conversation' | 'profile';

export function normalizeConversationThreads(
  threads?: ConversationThread[]
): ConversationThread[];
export function sortConversationThreads(
  threads?: ConversationThread[]
): ConversationThread[];
export function filterVisibleConversationEvents(
  events?: ConversationEvent[],
  options?: { includeHidden?: boolean }
): ConversationEvent[];
export function groupConversationEventsByDay(
  events?: ConversationEvent[],
  options?: { includeHidden?: boolean; timeZone?: string }
): ConversationDayGroup[];
export function filterSenderIdentitiesForChannel(
  identities?: CommunicationSenderIdentity[],
  channel?: string
): CommunicationSenderIdentity[];
export function getSenderRestrictionReason(identity?: CommunicationSenderIdentity): string;
export function getConversationMobileState(options?: {
  threadId?: string;
  selectedThreadId?: string;
  profileOpen?: boolean;
}): ConversationMobileState;
export function getConversationPreview(
  thread?: ConversationThread,
  maxLength?: number
): string;
