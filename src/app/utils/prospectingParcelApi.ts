import { bridgeRequest } from './runtimeBridge';

export type ProspectingParcel = {
  parcelId: string;
  line1: string;
  city: string;
  zip: string;
  longitude?: number;
  latitude?: number;
  use: string | null;
  sqft: number | null;
  units: number | null;
  yearBuilt: number | null;
  rollYear: number | null;
};

export type ProspectingMatch = {
  status: 'matched' | 'ambiguous' | 'no_match';
  leadId: string | null;
};

export type ProspectingApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'needs_revision'
  | 'cancelled';

export function matchProspectingParcel(parcelId: string) {
  return bridgeRequest<{ record: ProspectingParcel; match: ProspectingMatch }>({
    method: 'POST',
    path: '/api/prospecting/parcels/match',
    body: { parcelId },
  });
}

export function requestProspectingParcelApproval(parcelId: string) {
  return bridgeRequest<{ approvalId?: string; match?: ProspectingMatch }>({
    method: 'POST',
    path: '/api/prospecting/parcels/approval',
    body: { parcelId },
  });
}

export function saveApprovedProspectingParcel(parcelId: string, approvalId: string) {
  return bridgeRequest<{ leadId: string; created: boolean }>({
    method: 'POST',
    path: '/api/prospecting/parcels/save',
    body: { parcelId, approvalId },
  });
}

export function getProspectingParcelApprovalStatus(parcelId: string, approvalId: string) {
  const query = new URLSearchParams({ parcelId, approvalId });
  return bridgeRequest<{ status: ProspectingApprovalStatus }>({
    path: '/api/prospecting/parcels/approval-status?' + query,
  });
}
