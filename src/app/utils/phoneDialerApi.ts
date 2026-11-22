import { bridgeRequest } from './runtimeBridge';

export type PhoneProvider = 'twilio' | 'telnyx';
export type NumberType = 'local' | 'toll_free';
export type Price = { upfront: number | null; monthly: number | null; currency: string };

export type PhoneLine = {
  id: string;
  provider: PhoneProvider;
  phoneNumber: string;
  display: string;
  last4: string;
  type: NumberType;
  source: string;
  commissioning?: { status: string; verifiedAt?: string | null; routeHash?: string; commissionId?: string; approvalId?: string };
  callerIdEnabled: boolean;
  roles: { defaultCallerId: boolean; avaVoiceEngine: string };
  sms: { registrationStatus: string; sendingAllowed: boolean; note: string };
};

export type PhoneOrder = {
  id: string;
  provider: PhoneProvider;
  phoneNumber: string;
  type: NumberType;
  price: Price;
  status: string;
  approvalId: string;
  attempts: Array<{ at: string; result: string; error?: string }>;
};

export type PhoneInventory = {
  ok: boolean;
  mode: 'mock' | 'live';
  lines: PhoneLine[];
  orders: PhoneOrder[];
  providers: Record<PhoneProvider, { configured: boolean; mock: boolean }>;
  purchasesEnabled: boolean;
  canManage: boolean;
};

export type AvailableNumber = {
  provider: PhoneProvider;
  phoneNumber: string;
  type: NumberType;
  locality: string;
  capabilities: { voice: boolean; sms: boolean };
  price: Price;
};

export type Quote = { id: string; provider: PhoneProvider; phoneNumber: string; type: NumberType; price: Price; expiresAt: string };

export const fetchPhoneInventory = () => bridgeRequest<PhoneInventory>({ path: '/api/phone-numbers' });
export const importOwnedNumber = (provider: PhoneProvider, phoneNumber: string) =>
  bridgeRequest<{ ok: boolean; line: PhoneLine }>({ method: 'POST', path: '/api/phone-numbers/import', body: { provider, phoneNumber } });
export const searchAvailableNumbers = (body: { provider: PhoneProvider; type: NumberType; areaCode?: string; contains?: string }) =>
  bridgeRequest<{ ok: boolean; results: AvailableNumber[] }>({ method: 'POST', path: '/api/phone-numbers/search', body });
export const quoteNumber = (provider: PhoneProvider, phoneNumber: string, type: NumberType) =>
  bridgeRequest<{ ok: boolean; quote: Quote }>({ method: 'POST', path: '/api/phone-numbers/quotes', body: { provider, phoneNumber, type } });
export const confirmQuote = (quote: Quote) =>
  bridgeRequest<{ ok: boolean; order: PhoneOrder; approvalId: string }>({
    method: 'POST',
    path: '/api/phone-numbers/orders',
    body: { quoteId: quote.id, confirmPhoneNumber: quote.phoneNumber, confirmMonthly: quote.price.monthly, confirmUpfront: quote.price.upfront ?? 0 },
  });
export const executeOrder = (orderId: string) =>
  bridgeRequest<{ ok: boolean; order: PhoneOrder; pending?: boolean }>({ method: 'POST', path: `/api/phone-numbers/orders/${encodeURIComponent(orderId)}/execute`, body: {} });
export const requestCommission = (lineId: string) =>
  bridgeRequest<{ ok: boolean; commissionId: string; approvalId: string }>({ method: 'POST', path: `/api/phone-numbers/lines/${encodeURIComponent(lineId)}/commission`, body: {} });
export const executeCommission = (commissionId: string) =>
  bridgeRequest<{ ok: boolean; line: PhoneLine }>({ method: 'POST', path: `/api/phone-numbers/commissions/${encodeURIComponent(commissionId)}/execute`, body: {} });
export const setCallerId = (lineId: string, enabled: boolean) =>
  bridgeRequest<{ ok: boolean; line: PhoneLine }>({ method: 'POST', path: `/api/phone-numbers/lines/${encodeURIComponent(lineId)}/caller-id`, body: { enabled } });
export const decideApproval = (approvalId: string, decision: 'approve' | 'reject') =>
  bridgeRequest<{ ok: boolean }>({ method: 'POST', path: `/api/approvals/${encodeURIComponent(approvalId)}/${decision}`, body: { actor: 'PBK operator' } });

// ------------------------------- Dialer -------------------------------------
export type ParcelFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
  properties: { parcelId: string; situs: { line1: string; city: string; state: string; zip: string }; county?: string; acres?: number; source?: string };
};
export type DialerCoverage = { status: string; licensed: boolean; source: string; regions: string[]; note: string; sourceKind: string; liveCallsEnabled: boolean; mock: boolean; parcelCount?: number };
export type OutboundLine = { id: string; display: string; last4: string; commissioned: boolean; callerIdEnabled: boolean };
export type EligibilityReason = { code: string; message: string };
export type DialerSelection = {
  ok: boolean;
  parcel: ParcelFeature;
  createLeadAvailable?: boolean;
  match: { status: 'matched' | 'no_match' | 'ambiguous'; candidateCount: number; matchedOn: string };
  contact: { id: string; crmLeadId?: string; name: string; address: string; status: string; phoneLast4: string; phoneDisplay: string; synthetic: boolean } | null;
  activity: Array<{ id: string; at: string; status: string; outcome: string; talkSeconds: number | null; lineLast4: string }>;
  eligibility: { eligible: boolean; reasons: EligibilityReason[] };
  pendingRequest: { id: string; approvalId: string; toLast4: string; fromLast4: string; status: string; approvalStatus?: string } | null;
  lines: OutboundLine[];
};
export type DialerCall = { id: string; leadId: string; parcelId: string; status: string; outcome: string; talkSeconds: number | null; toLast4: string; fromLast4: string; createdAt: string; finalizedAt: string | null };

export const fetchDialerCoverage = () =>
  bridgeRequest<{ ok: boolean; coverage: DialerCoverage; lines: OutboundLine[]; canPlaceCalls: boolean }>({ path: '/api/dialer/coverage' });
export const fetchParcels = (bbox?: number[]) =>
  bridgeRequest<{ ok: boolean; features: ParcelFeature[] }>({ path: `/api/dialer/parcels${bbox ? `?bbox=${bbox.join(',')}` : ''}` });
export const selectParcel = (body: { parcelId?: string; address?: string; lineId?: string }) =>
  bridgeRequest<DialerSelection>({ method: 'POST', path: '/api/dialer/select', body });
export type ParcelBrief = {
  ok: true;
  parcelId: string;
  facts: { match: DialerSelection['match']['status']; hasLotSize: boolean; outreachHeld: boolean; phoneMissing: boolean };
  providers: Record<'deepSeek' | 'claude', 'used' | 'unavailable' | 'unconfigured'>;
  steps: Array<{ id: string; title: string; detail: string }>;
};

export const prepareParcelBrief = (parcelId: string) =>
  bridgeRequest<ParcelBrief>({ method: 'POST', path: '/api/dialer/prospecting-brief', body: { parcelId } });
export const createLeadFromParcel = (parcelId: string) =>
  bridgeRequest<{ ok: boolean; leadId: string; created: boolean }>({ method: 'POST', path: '/api/dialer/leads', body: { parcelId } });
export const requestDialerCall = (body: { parcelId: string; leadId: string; lineId: string }) =>
  bridgeRequest<{ ok: boolean; request: { id: string; status: string; approvalId: string; toLast4: string; fromLast4: string }; approvalId: string }>({ method: 'POST', path: '/api/dialer/call-requests', body });
export const dialApprovedRequest = (requestId: string) =>
  bridgeRequest<{ ok: boolean; call: DialerCall }>({ method: 'POST', path: `/api/dialer/call-requests/${encodeURIComponent(requestId)}/dial`, body: {} });
export const fetchDialerCalls = () => bridgeRequest<{ ok: boolean; calls: DialerCall[] }>({ path: '/api/dialer/calls' });
export const simulateDialerCallbacks = (callId: string, outcome: string, talkSeconds: number) =>
  bridgeRequest<{ ok: boolean; call: DialerCall }>({ method: 'POST', path: `/api/dialer/calls/${encodeURIComponent(callId)}/simulate`, body: { outcome, talkSeconds } });

export function formatPrice(price?: Price | null) {
  if (!price || price.monthly == null) return 'price unavailable';
  const upfront = Number(price.upfront || 0);
  return `${upfront ? `$${upfront.toFixed(2)} upfront + ` : ''}$${Number(price.monthly).toFixed(2)}/mo`;
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Request failed.');
}
