import type { ParcelFeature } from './phoneDialerApi';

const storageKey = 'pbk:parcel-prospecting:v1';
export const prospectLimit = 50;

export type ParcelProspect = {
  parcelId: string;
  label: string;
  source: string;
  reviewed: boolean;
};

export function readParcelProspects(): ParcelProspect[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter((item): item is ParcelProspect =>
      item && typeof item.parcelId === 'string' && Boolean(item.parcelId) &&
      typeof item.label === 'string' && typeof item.source === 'string' &&
      typeof item.reviewed === 'boolean',
    ).slice(0, prospectLimit);
  } catch {
    return [];
  }
}

export function saveParcelProspects(items: ParcelProspect[]) {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

export function parcelProspect({ properties }: ParcelFeature, source: string): ParcelProspect {
  const { parcelId, situs } = properties;
  const locality = [situs.city, situs.state].filter(Boolean).join(', ');
  return { parcelId, label: [situs.line1, locality].filter(Boolean).join(' · '), source, reviewed: false };
}
