// BasicProfile allowlist verified against https://api.developer.attomdata.com/docs.
// Never infer property condition, equity, payoff balances or underwriting from these records.
export const attomExtraRecordFields = Object.freeze(
  [
    {
      key: 'lotDepth',
      label: 'Lot depth',
      group: 'Parcel & location',
      path: 'lot.depth',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'ft',
    },
    {
      key: 'lotFrontage',
      label: 'Lot frontage',
      group: 'Parcel & location',
      path: 'lot.frontage',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'ft',
    },
    {
      key: 'lotNumber',
      label: 'Lot number',
      group: 'Parcel & location',
      path: 'lot.lotNum',
      kind: 'identifier',
    },
    {
      key: 'subdivisionTractNumber',
      label: 'Subdivision tract',
      group: 'Parcel & location',
      path: 'area.subdTractNum',
      kind: 'identifier',
    },
    {
      key: 'censusTractIdentifier',
      label: 'Census tract',
      group: 'Parcel & location',
      path: 'area.censusTractIdent',
      kind: 'identifier',
    },
    {
      key: 'censusBlockGroup',
      label: 'Census block group',
      group: 'Parcel & location',
      path: 'area.censusBlockGroup',
      kind: 'identifier',
    },
    {
      key: 'latitude',
      label: 'Latitude',
      group: 'Parcel & location',
      path: 'location.latitude',
      kind: 'number',
      min: -90,
      max: 90,
    },
    {
      key: 'longitude',
      label: 'Longitude',
      group: 'Parcel & location',
      path: 'location.longitude',
      kind: 'number',
      min: -180,
      max: 180,
    },
    {
      key: 'locationAccuracy',
      label: 'Location accuracy',
      group: 'Parcel & location',
      path: 'location.accuracy',
      kind: 'text',
    },
    {
      key: 'elevation',
      label: 'Elevation',
      group: 'Parcel & location',
      path: 'location.elevation',
      kind: 'number',
      min: -15000,
      max: 100000,
    },
    {
      key: 'propertySubType',
      label: 'Property subtype',
      group: 'Parcel & location',
      path: 'summary.propSubType',
      kind: 'text',
    },
    {
      key: 'propertyLandUse',
      label: 'Property land use',
      group: 'Parcel & location',
      path: 'summary.propLandUse',
      kind: 'text',
    },
    {
      key: 'propertyIndicator',
      label: 'Property indicator',
      group: 'Parcel & location',
      path: 'summary.propIndicator',
      kind: 'text',
    },
    {
      key: 'legalDescription',
      label: 'Legal description',
      group: 'Parcel & location',
      path: 'summary.legal1',
      kind: 'text',
    },
    {
      key: 'grossSqft',
      label: 'Gross area',
      group: 'Building & rooms',
      path: 'building.size.grossSize',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'sqft',
    },
    {
      key: 'adjustedGrossSqft',
      label: 'Adjusted gross area',
      group: 'Building & rooms',
      path: 'building.size.grossSizeAdjusted',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'sqft',
    },
    {
      key: 'groundFloorSqft',
      label: 'Ground floor area',
      group: 'Building & rooms',
      path: 'building.size.groundFloorSize',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'sqft',
    },
    {
      key: 'atticSqft',
      label: 'Attic area',
      group: 'Building & rooms',
      path: 'building.size.atticSize',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'sqft',
    },
    {
      key: 'sizeIndicator',
      label: 'Size indicator',
      group: 'Building & rooms',
      path: 'building.size.sizeInd',
      kind: 'text',
    },
    {
      key: 'fullBaths',
      label: 'Full baths',
      group: 'Building & rooms',
      path: 'building.rooms.bathsFull',
      kind: 'number',
      min: 0,
      max: 10000,
    },
    {
      key: 'partialBaths',
      label: 'Partial baths',
      group: 'Building & rooms',
      path: 'building.rooms.bathsPartial',
      kind: 'number',
      min: 0,
      max: 10000,
    },
    {
      key: 'bathFixtures',
      label: 'Bath fixtures',
      group: 'Building & rooms',
      path: 'building.rooms.bathFixtures',
      kind: 'number',
      min: 0,
      max: 100000,
    },
    {
      key: 'totalRooms',
      label: 'Total rooms',
      group: 'Building & rooms',
      path: 'building.rooms.roomsTotal',
      kind: 'number',
      min: 0,
      max: 100000,
    },
    {
      key: 'basementSqft',
      label: 'Basement area',
      group: 'Building & rooms',
      path: 'building.interior.bsmtSize',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'sqft',
    },
    {
      key: 'basementType',
      label: 'Basement type',
      group: 'Building & rooms',
      path: 'building.interior.bsmttype',
      kind: 'text',
    },
    {
      key: 'basementFinishedPercent',
      label: 'Basement finished',
      group: 'Building & rooms',
      path: 'building.interior.bsmtFinishedPercent',
      kind: 'number',
      min: 0,
      max: 100,
      unit: 'percent',
    },
    {
      key: 'floors',
      label: 'Floors',
      group: 'Building & rooms',
      path: 'building.interior.floors',
      kind: 'text',
    },
    {
      key: 'fireplaceCount',
      label: 'Fireplaces',
      group: 'Building & rooms',
      path: 'building.interior.fplcCount',
      kind: 'number',
      min: 0,
      max: 10000,
    },
    {
      key: 'fireplaceIndicator',
      label: 'Fireplace indicator',
      group: 'Building & rooms',
      path: 'building.interior.fplcInd',
      kind: 'text',
    },
    {
      key: 'fireplaceType',
      label: 'Fireplace type',
      group: 'Building & rooms',
      path: 'building.interior.fplcType',
      kind: 'text',
    },
    {
      key: 'storyDescription',
      label: 'Story description',
      group: 'Building & rooms',
      path: 'building.summary.storyDesc',
      kind: 'text',
    },
    {
      key: 'view',
      label: 'View',
      group: 'Building & rooms',
      path: 'building.summary.view',
      kind: 'text',
    },
    {
      key: 'viewCode',
      label: 'View code',
      group: 'Building & rooms',
      path: 'building.summary.viewCode',
      kind: 'identifier',
    },
    {
      key: 'coolingType',
      label: 'Cooling',
      group: 'Utilities & construction',
      path: 'utilities.coolingType',
      kind: 'text',
    },
    {
      key: 'heatingType',
      label: 'Heating',
      group: 'Utilities & construction',
      path: 'utilities.heatingType',
      kind: 'text',
    },
    {
      key: 'heatingFuel',
      label: 'Heating fuel',
      group: 'Utilities & construction',
      path: 'utilities.heatingFuel',
      kind: 'text',
    },
    {
      key: 'energyType',
      label: 'Energy',
      group: 'Utilities & construction',
      path: 'utilities.energyType',
      kind: 'text',
    },
    {
      key: 'sewerType',
      label: 'Sewer',
      group: 'Utilities & construction',
      path: 'utilities.sewerType',
      kind: 'text',
    },
    {
      key: 'wallType',
      label: 'Walls',
      group: 'Utilities & construction',
      path: 'utilities.wallType',
      kind: 'text',
    },
    {
      key: 'foundationType',
      label: 'Foundation',
      group: 'Utilities & construction',
      path: 'building.construction.foundationType',
      kind: 'text',
    },
    {
      key: 'frameType',
      label: 'Frame',
      group: 'Utilities & construction',
      path: 'building.construction.frameType',
      kind: 'text',
    },
    {
      key: 'buildingShapeType',
      label: 'Building shape type',
      group: 'Utilities & construction',
      path: 'building.construction.buildingShapeType',
      kind: 'text',
    },
    {
      key: 'buildingShapeDescription',
      label: 'Building shape',
      group: 'Utilities & construction',
      path: 'building.construction.buildingShapeDescription',
      kind: 'text',
    },
    {
      key: 'garageType',
      label: 'Garage',
      group: 'Utilities & construction',
      path: 'building.parking.garageType',
      kind: 'text',
    },
    {
      key: 'parkingSqft',
      label: 'Parking area',
      group: 'Utilities & construction',
      path: 'building.parking.prkgSize',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'sqft',
    },
    {
      key: 'parkingType',
      label: 'Parking',
      group: 'Utilities & construction',
      path: 'building.parking.prkgType',
      kind: 'text',
    },
    {
      key: 'assessmentMarketLandValue',
      label: 'Market land value',
      group: 'Assessment & taxes',
      path: 'assessment.market.mktLandValue',
      kind: 'number',
      min: 0,
      max: 1000000000000000.0,
      unit: 'currency',
    },
    {
      key: 'assessmentMarketImprovementValue',
      label: 'Market improvement value',
      group: 'Assessment & taxes',
      path: 'assessment.market.mktImprValue',
      kind: 'number',
      min: 0,
      max: 1000000000000000.0,
      unit: 'currency',
    },
    {
      key: 'taxPerSizeUnit',
      label: 'Tax per sq ft',
      group: 'Assessment & taxes',
      path: 'assessment.tax.taxPerSizeUnit',
      kind: 'number',
      min: 0,
      max: 1000000000.0,
      unit: 'currency-per-sqft',
    },
    {
      key: 'assessmentImprovementPercent',
      label: 'Improvement percent',
      group: 'Assessment & taxes',
      path: 'assessment.improvementPercent',
      kind: 'number',
      min: 0,
      max: 100,
      unit: 'percent',
    },
    {
      key: 'lastQuitClaimDate',
      label: 'Last quitclaim date',
      group: 'Recorded transfer',
      path: 'summary.dateOfLastQuitClaim',
      kind: 'date',
    },
    {
      key: 'saleCode',
      label: 'Sale code',
      group: 'Recorded transfer',
      path: 'sale.saleAmountData.saleCode',
      kind: 'identifier',
    },
    {
      key: 'saleDisclosureType',
      label: 'Sale disclosure',
      group: 'Recorded transfer',
      path: 'sale.saleAmountData.saleDisclosureType',
      kind: 'text',
    },
  ].map(Object.freeze)
);

export function strictAttomDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const date = value.trim();
  const time = Date.parse(date);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === date ? date : null;
}

export function boundedAttomIdentifier(value, fromProvider = false) {
  if (fromProvider && Number.isSafeInteger(value) && value >= 0) value = String(value);
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= 100 && !/[\x00-\x1f\x7f]/.test(result) ? result : null;
}

export function parseAttomRecordValue(field, value, fromProvider = false) {
  if (field.kind === 'date') return strictAttomDate(value);
  if (field.kind === 'number') {
    if (
      typeof value !== 'number' &&
      !(fromProvider && typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value.trim()))
    )
      return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= (field.min ?? 0) && n <= (field.max ?? 1e15) ? n : null;
  }
  if (field.kind === 'identifier') return boundedAttomIdentifier(value, fromProvider);
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= 500 && !/[\x00-\x1f\x7f]/.test(result) ? result : null;
}

export function projectAttomExtraFields(row) {
  return Object.fromEntries(
    attomExtraRecordFields.map((field) => [
      field.key,
      parseAttomRecordValue(
        field,
        field.path.split('.').reduce((value, key) => value?.[key], row),
        true
      ),
    ])
  );
}

export function hydrateAttomExtraFields(facts) {
  return Object.fromEntries(
    attomExtraRecordFields.map((field) => [
      field.key,
      parseAttomRecordValue(field, facts?.[field.key]),
    ])
  );
}
