import { writeFileSync } from 'node:fs';

const base = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020';
const zctaCodes = ['91401', '91403', '91405', '91406', '91411', '91423'];

async function query(layer, codes, tolerance) {
  const url = new URL(`${base}/${layer}/query`);
  url.search = new URLSearchParams({
    f: 'geojson',
    where: `GEOID IN (${codes.map((code) => `'${code}'`).join(',')})`,
    outFields: 'GEOID,INTPTLON,INTPTLAT',
    outSR: '4326',
    geometryPrecision: '5',
    maxAllowableOffset: String(tolerance),
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Census returned HTTP ${response.status} for ${layer}.`);
  const data = await response.json();
  if (data.type !== 'FeatureCollection' || data.features.length !== codes.length) {
    throw new Error(`Unexpected Census boundary response for ${layer}.`);
  }
  const byCode = new Map(data.features.map((feature) => [feature.properties?.GEOID, feature]));
  return codes.map((code) => {
    const feature = byCode.get(code);
    const geometry = feature?.geometry;
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type) || !geometry.coordinates.length) {
      throw new Error(`Census polygon missing for ${code}.`);
    }
    const labelPoint = [Number(feature.properties.INTPTLON), Number(feature.properties.INTPTLAT)];
    if (!labelPoint.every(Number.isFinite))
      throw new Error(`Census interior point missing for ${code}.`);
    return { type: 'Feature', id: code, properties: { code, labelPoint }, geometry };
  });
}

const zcta = await query('tigerWMS_Census2020/MapServer/84', zctaCodes, 0.00025);
const county = await query('State_County/MapServer/1', ['06037'], 0.009);
const collection = (features) => ({ type: 'FeatureCollection', features });
writeFileSync(
  new URL('../src/app/data/van-nuys-market-boundaries.json', import.meta.url),
  JSON.stringify({ zcta: collection(zcta), county: collection(county) }) + '\n'
);
console.log(
  `Bundled ${zcta.length} Census ZCTAs and ${county.length} county boundary (2020 vintage).`
);
