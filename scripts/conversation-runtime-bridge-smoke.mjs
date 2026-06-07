import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/utils/runtimeBridge.ts'),
  'utf8'
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const helpers = [
  'fetchConversationsRequest',
  'fetchConversationRequest',
  'fetchConversationTimelineRequest',
  'patchConversationRequest',
  'sendConversationMessageRequest',
  'fetchSenderIdentitiesRequest',
  'syncSenderIdentitiesRequest',
  'patchSenderIdentityRequest',
  'requestSenderReleaseRequest',
  'fetchSenderRecommendationRequest',
  'refineConversationDraftRequest',
  'patchConversationEventRequest',
  'restoreConversationEventRequest',
  'reportConversationEventSpamRequest',
  'searchLeadsRequest',
  'mergeConversationThreadsRequest',
];

function helperFunctionSource(helper) {
  const start = source.indexOf(`export async function ${helper}`);
  assert(start >= 0, `runtimeBridge.ts must export ${helper}.`);
  const next = source.indexOf('export async function ', start + 1);
  return source.slice(start, next >= 0 ? next : source.length);
}

for (const helper of helpers) {
  assert(
    new RegExp(`export async function ${helper}\\b`).test(source),
    `runtimeBridge.ts must export ${helper}.`
  );
}

const helperContracts = [
  ['fetchConversationsRequest', 'GET', '/api/conversations${suffix}'],
  [
    'fetchConversationRequest',
    'GET',
    '/api/conversations/${encodeURIComponent(threadId)}',
  ],
  [
    'fetchConversationTimelineRequest',
    'GET',
    '/api/conversations/${encodeURIComponent(threadId)}/timeline${suffix}',
  ],
  [
    'patchConversationRequest',
    'PATCH',
    '/api/conversations/${encodeURIComponent(threadId)}',
  ],
  [
    'sendConversationMessageRequest',
    'POST',
    '/api/conversations/${encodeURIComponent(threadId)}/messages',
  ],
  ['fetchSenderIdentitiesRequest', 'GET', '/api/communication-identities${suffix}'],
  ['syncSenderIdentitiesRequest', 'POST', '/api/communication-identities/sync'],
  [
    'patchSenderIdentityRequest',
    'PATCH',
    '/api/communication-identities/${encodeURIComponent(identityId)}',
  ],
  [
    'requestSenderReleaseRequest',
    'POST',
    '/api/communication-identities/${encodeURIComponent(identityId)}/release-request',
  ],
  [
    'fetchSenderRecommendationRequest',
    'POST',
    '/api/conversations/${encodeURIComponent(threadId)}/sender-recommendation',
  ],
  [
    'refineConversationDraftRequest',
    'POST',
    '/api/conversations/${encodeURIComponent(threadId)}/refine-draft',
  ],
  [
    'patchConversationEventRequest',
    'PATCH',
    '/api/conversation-events/${encodeURIComponent(eventId)}',
  ],
  [
    'restoreConversationEventRequest',
    'POST',
    '/api/conversation-events/${encodeURIComponent(eventId)}/restore',
  ],
  [
    'reportConversationEventSpamRequest',
    'POST',
    '/api/conversation-events/${encodeURIComponent(eventId)}/report-spam',
  ],
  ['searchLeadsRequest', 'GET', '/api/leads/search?${params.toString()}'],
  [
    'mergeConversationThreadsRequest',
    'POST',
    '/api/conversations/${encodeURIComponent(canonicalThreadId)}/merge',
  ],
];

for (const [helper, method, path] of helperContracts) {
  const block = helperFunctionSource(helper);
  assert(block.includes(path), `${helper} must target ${path}.`);
  if (method === 'GET') {
    assert(!/\bmethod:/.test(block), `${helper} must use bridgeRequest's GET default.`);
  } else {
    assert(
      block.includes(`method: '${method}'`),
      `${helper} must use the ${method} method.`
    );
  }
}

for (const typeName of [
  'ConversationThreadIdentity',
  'ConversationThread',
  'ConversationEvent',
  'CommunicationSenderIdentity',
]) {
  assert(
    new RegExp(`export type ${typeName}\\s*=`).test(source),
    `runtimeBridge.ts must export the ${typeName} type.`
  );
}

const helperStart = source.indexOf('export async function fetchConversationsRequest');
const helperBlockStart = source.indexOf('function conversationSearchSuffix');
assert(helperStart >= 0, 'Conversation helper block is missing.');
assert(helperBlockStart >= 0, 'Conversation query builder is missing.');
const helperSource = source.slice(helperBlockStart);
assert(
  !/\bfetch\s*\(/.test(helperSource),
  'Conversation helpers must use bridgeRequest instead of direct fetch.'
);
assert(
  /new URLSearchParams/.test(helperSource),
  'Conversation list and timeline filters must use URLSearchParams.'
);
assert(
  /function hasLocalDevProxyAuth\(\)/.test(source) &&
    /if \(hasLocalDevProxyAuth\(\)\) return;/.test(source),
  'Protected local development requests must be allowed through the authenticated Vite proxy.'
);
assert(
  /PBK bridge request timed out after 15 seconds\./.test(source),
  'Bridge timeouts must surface an operator-readable error instead of a raw AbortSignal message.'
);
assert(
  /\['activity', activity\]/.test(helperFunctionSource('fetchConversationsRequest')),
  'Conversation lists must send server-side live and approval activity filters.'
);

for (const pathPattern of [
  '/api/conversations',
  '/api/communication-identities',
  '/api/conversation-events/',
  '/sender-recommendation',
  '/refine-draft',
  '/report-spam',
  '/restore',
]) {
  assert(
    helperSource.includes(pathPattern),
    `Conversation helpers must target ${pathPattern}.`
  );
}

assert(
  /encodeURIComponent\(threadId\)/.test(helperSource) &&
    /encodeURIComponent\(identityId\)/.test(helperSource) &&
    /encodeURIComponent\(eventId\)/.test(helperSource),
  'Conversation path identifiers must be URL encoded.'
);

const sendHelperSource = source.slice(
  source.indexOf('export async function sendConversationMessageRequest'),
  source.indexOf('export async function fetchSenderIdentitiesRequest')
);
assert(
  !/\brequestId\??:/.test(sendHelperSource),
  'Conversation send helper must not advertise requestId because the route rejects it.'
);
assert(
  /requestedBy\?: string/.test(sendHelperSource),
  'Conversation send helper must expose the server requestedBy field.'
);
for (const responseField of [
  'scheduled?: boolean',
  'message?: MessageRecord',
  'approval?: ApprovalRecord',
  'qaValidation?:',
  'safetyValidation?:',
]) {
  assert(
    sendHelperSource.includes(responseField),
    `Conversation send response must type ${responseField}.`
  );
}

const eventPatchSource = source.slice(
  source.indexOf('export async function patchConversationEventRequest'),
  source.indexOf('export async function restoreConversationEventRequest')
);
assert(
  /important\?: boolean/.test(eventPatchSource),
  'Conversation event patch helper must support the server important action.'
);

console.log('conversation-runtime-bridge-smoke: ok');
