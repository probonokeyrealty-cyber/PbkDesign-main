export interface County {
  fips: string;
  name: string;
  state: string;
}

export interface Parcel {
  ain: string;
  address: string;
  use: string;
  rollYear: string;
}

interface CountySource {
  publisher: string;
  localCsv: boolean;
  links: Array<{ label: string; type: string; href: string; detail: string }>;
}

interface SearchResult<Item> {
  items: Item[];
  total: number;
}

export const COUNTY_DIRECTORY_URL: string;
export const COUNTY_CSV_MAX_BYTES: number;
export const countyStates: string[];
export function findCounties(query: string, state?: string): SearchResult<County>;
export function getCountySource(fips: string): CountySource | null;
export function makeCountyResearchBrief(county: County): string;
export function parseCountyParcelCsv(input: string, fips: string): Parcel[];
export function searchCountyParcels(rows: Parcel[], query: string): SearchResult<Parcel>;
