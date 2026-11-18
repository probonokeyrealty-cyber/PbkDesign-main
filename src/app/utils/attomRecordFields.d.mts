export type AttomExtraPropertyFacts = {
  lotNumber?: string | null;
  subdivisionTractNumber?: string | null;
  censusTractIdentifier?: string | null;
  censusBlockGroup?: string | null;
  locationAccuracy?: string | null;
  propertySubType?: string | null;
  propertyLandUse?: string | null;
  propertyIndicator?: string | null;
  legalDescription?: string | null;
  sizeIndicator?: string | null;
  basementType?: string | null;
  floors?: string | null;
  fireplaceIndicator?: string | null;
  fireplaceType?: string | null;
  storyDescription?: string | null;
  view?: string | null;
  viewCode?: string | null;
  coolingType?: string | null;
  heatingType?: string | null;
  heatingFuel?: string | null;
  energyType?: string | null;
  sewerType?: string | null;
  wallType?: string | null;
  foundationType?: string | null;
  frameType?: string | null;
  buildingShapeType?: string | null;
  buildingShapeDescription?: string | null;
  garageType?: string | null;
  parkingType?: string | null;
  lastQuitClaimDate?: string | null;
  saleCode?: string | null;
  saleDisclosureType?: string | null;
  lotDepth?: number | null;
  lotFrontage?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  elevation?: number | null;
  grossSqft?: number | null;
  adjustedGrossSqft?: number | null;
  groundFloorSqft?: number | null;
  atticSqft?: number | null;
  fullBaths?: number | null;
  partialBaths?: number | null;
  bathFixtures?: number | null;
  totalRooms?: number | null;
  basementSqft?: number | null;
  basementFinishedPercent?: number | null;
  fireplaceCount?: number | null;
  parkingSqft?: number | null;
  assessmentMarketLandValue?: number | null;
  assessmentMarketImprovementValue?: number | null;
  taxPerSizeUnit?: number | null;
  assessmentImprovementPercent?: number | null;
};
export type AttomRecordField = {
  readonly key: keyof AttomExtraPropertyFacts;
  readonly label: string;
  readonly group: string;
  readonly path: string;
  readonly kind: 'text' | 'identifier' | 'number' | 'date';
  readonly min?: number;
  readonly max?: number;
  readonly unit?: 'sqft' | 'ft' | 'percent' | 'currency' | 'currency-per-sqft';
};
export const attomExtraRecordFields: readonly AttomRecordField[];
export function strictAttomDate(value: unknown): string | null;
export function parseAttomRecordValue(
  field: AttomRecordField,
  value: unknown,
  fromProvider?: boolean
): string | number | null;
export function projectAttomExtraFields(row: unknown): AttomExtraPropertyFacts;
export function hydrateAttomExtraFields(facts: unknown): AttomExtraPropertyFacts;

export function boundedAttomIdentifier(value: unknown, fromProvider?: boolean): string | null;
