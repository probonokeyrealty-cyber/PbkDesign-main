import Papa from 'papaparse';
import counties from './prospectingCounties2025.json' with { type: 'json' };

/** @typedef {{fips: string, name: string, state: string}} County */
/** @typedef {{ain: string, address: string, use: string, rollYear: string}} Parcel */

export const COUNTY_DIRECTORY_URL =
  'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2025.html';
export const COUNTY_CSV_MAX_BYTES = 8 * 1024 * 1024;
const countyCsvMaxRows = 25_000;
const countyPageSize = 24;
const parcelPageSize = 50;

export const countyStates = [...new Set(counties.map((county) => county.state))].sort();

const laSource = {
  publisher: 'Los Angeles County Office of the Assessor',
  localCsv: true,
  links: [
    {
      label: 'Monthly Parcels',
      type: 'Bulk GIS',
      href: 'https://egis-lacounty.hub.arcgis.com/datasets/parcels',
      detail: 'Parcel boundaries and attributes; geodatabase or shapefile.',
    },
    {
      label: 'Assessor Parcel Roll',
      type: 'Bulk data',
      href: 'https://www.arcgis.com/home/item.html?id=70d93266f45a4080a97b285a471493cd&sublayer=0',
      detail: 'AIN, property location, use, and roll year.',
    },
    {
      label: 'Property Data Sales',
      type: 'Order form',
      href: 'https://res.cloudinary.com/los-angeles-county-assessor/image/upload/v1628093490/Form/Standard_Order_Form.pdf',
      detail: 'Request owner or mailing fields; state intended use before ordering.',
    },
    {
      label: 'County GIS terms',
      type: 'Terms',
      href: 'https://egis-lacounty.hub.arcgis.com/pages/terms-of-use',
      detail: 'Confirm the terms for your intended use.',
    },
  ],
};

/** @param {string} fips */
export function getCountySource(fips) {
  return fips === '06037' ? laSource : null;
}

/** @param {string} value */
const normalize = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const countyIndex = counties.map((county) => {
  const name = normalize(county.name);
  return { county, name, text: name + ' ' + county.state.toLowerCase() };
});

/** @param {string} query @param {string} [state] */
export function findCounties(query, state = '') {
  const input = normalize(query);
  if ((!input || input.length < 2) && !state) return { items: [], total: 0 };
  const parts = input ? input.split(' ') : [];
  const numeric = /^\d+$/.test(input);
  const hits = countyIndex.filter(
    ({ county, text }) =>
      (!state || county.state === state) &&
      (numeric
        ? county.fips.startsWith(input)
        : parts.every((part) => text.split(' ').some((token) => token.startsWith(part))))
  );
  hits.sort((a, b) => {
    const rank = (/** @type {typeof a} */ entry) =>
      entry.county.fips === input || entry.name === input || entry.text === input
        ? 0
        : entry.text.startsWith(input)
          ? 1
          : 2;
    return (
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name) ||
      a.county.state.localeCompare(b.county.state)
    );
  });
  return { items: hits.slice(0, countyPageSize).map((entry) => entry.county), total: hits.length };
}

/** @param {County} county */
export function makeCountyResearchBrief(county) {
  return [
    'Find official parcel and assessment data for ' +
      county.name +
      ', ' +
      county.state +
      ' (FIPS ' +
      county.fips +
      ').',
    'Research publisher documentation only. Find a county bulk export or approved API and cite official sources.',
    'Check available fields, update cadence, access method, commercial use terms, and any required permission.',
    'Do not bypass blocks, CAPTCHAs, or rate limits. Do not query ATTOM, scrape listings, or contact owners.',
    'Return a source recommendation and any unresolved permission questions. Do not import or promote leads.',
  ].join('\n');
}

/** @param {string} value */
const parcelNumber = (value) => {
  const raw = value.trim();
  return /^\d{10}$/.test(raw) || /^\d{4}-\d{3}-\d{3}$/.test(raw) ? raw.replace(/-/g, '') : '';
};

/** @param {string} input @param {string} fips @returns {Parcel[]} */
export function parseCountyParcelCsv(input, fips) {
  if (!getCountySource(fips)?.localCsv)
    throw new Error('CSV preview is not available for this county.');
  if (new TextEncoder().encode(input).byteLength > COUNTY_CSV_MAX_BYTES)
    throw new Error('Choose a CSV extract of 8 MB or less.');
  const { data, errors } = Papa.parse(input, {
    delimiter: ',',
    skipEmptyLines: 'greedy',
    preview: countyCsvMaxRows + 2,
  });
  if (errors.length) throw new Error('The file is not valid CSV.');
  const [header, ...records] = /** @type {string[][]} */ (data);
  if (records.length > countyCsvMaxRows)
    throw new Error('Choose a CSV extract with no more than 25,000 records.');
  const columns = (header ?? []).map((value) => normalize(value).replace(/ /g, ''));
  const column = (/** @type {string[]} */ aliases) =>
    aliases.map((alias) => columns.indexOf(alias)).find((index) => index >= 0) ?? -1;
  const ain = column(['ain', 'assessoridentificationnumber', 'assessorid']);
  const address = column(['propertylocation', 'situsfulladdress', 'situsaddress', 'siteaddress']);
  const city = column(['situscity', 'siteaddresscity']);
  const zip = column(['situszip', 'situszipcode', 'siteaddresszipcode']);
  const roll = column(['rollyear']);
  const use = column(['usedescription', 'propertyusetype', 'usetype']);
  if (ain < 0 || address < 0 || new Set(columns).size !== columns.length) {
    throw new Error('Expected unique columns including AIN and Property Location or SitusAddress.');
  }
  /** @type {Parcel[]} */
  const rows = [];
  for (const record of records) {
    if (record.length !== columns.length)
      throw new Error('The file is not valid CSV: a row has the wrong column count.');
    const id = parcelNumber(record[ain]);
    const street = record[address].trim();
    if (!id || !street) continue;
    const parts = [street];
    if (['situsaddress', 'siteaddress'].includes(columns[address])) {
      if (city >= 0 && record[city].trim()) parts.push(record[city].trim());
      if (zip >= 0 && record[zip].trim()) parts.push(record[zip].trim());
    }
    const year = record[roll]?.trim() ?? '';
    rows.push({
      ain: id,
      address: parts.join(', ').slice(0, 220),
      use: record[use]?.trim().slice(0, 100) ?? '',
      rollYear: /^\d{4}$/.test(year) ? year : '',
    });
  }
  if (!rows.length) throw new Error('The CSV has no usable parcel rows.');
  return rows;
}

/** @param {Parcel[]} rows @param {string} query @param {{ use?: string, rollYear?: string }} [filters] */
export function searchCountyParcels(rows, query, { use = '', rollYear = '' } = {}) {
  const text = normalize(query);
  if ((!text && !use && !rollYear) || (text && text.length < 3)) return { items: [], total: 0 };
  const number = text.replace(/ /g, '');
  const exact = parcelNumber(query);
  const hits = rows.filter((row) => {
    if ((use && row.use !== use) || (rollYear && row.rollYear !== rollYear)) return false;
    if (!text) return true;
    if (exact) return row.ain === exact;
    return (
      (/^\d+$/.test(number) && row.ain.startsWith(number)) || normalize(row.address).includes(text)
    );
  });
  return { items: hits.slice(0, parcelPageSize), total: hits.length };
}
