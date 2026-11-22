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

export function matchProspectingParcel(parcelId: string) {
  return bridgeRequest<{ record: ProspectingParcel; match: ProspectingMatch }>({
    method: 'POST',
    path: '/api/prospecting/parcels/match',
    body: { parcelId },
  });
}
