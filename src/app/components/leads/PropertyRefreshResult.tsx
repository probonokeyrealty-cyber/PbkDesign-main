import { AlertCircle, CheckCircle2, Lock } from 'lucide-react';
import { attomMcpDatasetDefinitions } from '../../utils/attomMcpSections.mjs';
import { reviewedCompIds } from '../../utils/leadComps.mjs';
import { photoLinks, type readPropertyEvidence } from '../../utils/propertyEvidence';
import type { PropertyIntelligenceResult, RecentSalesResult } from '../../utils/runtimeBridge';

type Evidence = ReturnType<typeof readPropertyEvidence> & { sales: RecentSalesResult | null };
type RefreshResult = { updated: string[]; kept: string[]; gaps: string[] };

const sourceStatus: Readonly<Record<string, string>> = {
  not_entitled: 'Outside account access',
  not_available: 'No records returned',
  not_found: 'No records returned',
  not_configured: 'Connection unavailable',
  authorization_failed: 'Access unavailable',
  rate_limited: 'Request limited',
  timed_out: 'Timed out',
  ambiguous: 'Property match could not be verified',
  invalid_address: 'Address could not be verified',
  partial: 'Partial data returned',
  unsupported: 'Source does not support this lookup',
};
const reason = (status: string) => sourceStatus[status] ?? 'Result unavailable';
const count = (amount: number, noun: string) => `${amount} ${noun}${amount === 1 ? '' : 's'}`;
const comparableValues = (result: RecentSalesResult | null) =>
  (result?.sales ?? []).filter(Boolean).map(({ photoEvidence, ...sale }) => ({
    ...sale,
    photos: photoEvidence?.photoUrls ?? [],
  }));

function contentChanged(left: unknown, right: unknown) {
  const serialize = (value: unknown) =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.keys(item)
              .sort()
              .map((key) => [key, item[key]])
          )
        : item
    );
  return serialize(left) !== serialize(right);
}

export function describePropertyRefresh(
  response: PropertyIntelligenceResult,
  before: Evidence,
  saved: Evidence
): RefreshResult {
  const updated: string[] = [],
    kept: string[] = [],
    gaps: string[] = [];
  const sections = response.records.sections ?? [];
  const beforeSections = new Map(before.records?.sections?.map((section) => [section.id, section]));
  const savedSections = new Map(saved.records?.sections?.map((section) => [section.id, section]));
  if (response.records.status === 'matched' && saved.records) {
    const previousFacts = new Map(Object.entries(before.records?.facts ?? {}));
    const facts = Object.entries(saved.records.facts).filter(
      ([key, value]) => value != null && !Object.is(value, previousFacts.get(key))
    ).length;
    const datasets = (saved.records.sections ?? []).filter((section) => {
      if (section.status !== 'ok' && section.status !== 'partial') return false;
      const previous = beforeSections.get(section.id);
      return contentChanged([previous?.facts, previous?.rows], [section.facts, section.rows]);
    }).length;
    const returned = sections.filter(
      (section) => section.status === 'ok' || section.status === 'partial'
    ).length;
    const coverage = sections.length
      ? ` ATTOM returned data for ${returned} of ${sections.length} sections.`
      : '';
    const changes = [
      facts && count(facts, 'saved field'),
      datasets && count(datasets, 'dataset'),
    ].filter(Boolean);
    if (changes.length)
      updated.push(`Property record · ${changes.join(' and ')} changed.${coverage}`);
    else kept.push(`Property record checked · saved values stayed the same.${coverage}`);
    if (response.records.partial && !sections.some((section) => section.status !== 'ok')) {
      gaps.push('ATTOM property record · Some details were not returned.');
    }
  } else {
    if (saved.records) kept.push('Previously saved property record kept.');
    gaps.push(`ATTOM property record · ${reason(response.records.status)}.`);
  }
  const sectionIssues = new Map<string, string[]>();
  const retainedSections = [];
  for (const { id, status } of sections) {
    const name = attomMcpDatasetDefinitions.find((definition) => definition.id === id)?.title;
    if (status === 'ok' || !name) continue;
    const label = reason(status);
    sectionIssues.set(label, [...(sectionIssues.get(label) ?? []), name]);
    const previous = beforeSections.get(id);
    const current = savedSections.get(id);
    if (
      previous?.retrievedAt &&
      current?.retrievedAt === previous.retrievedAt &&
      current.refreshStatus
    ) {
      retainedSections.push(name);
    }
  }
  for (const [label, names] of sectionIssues) gaps.push(`${names.join(', ')} · ${label}.`);
  if (retainedSections.length)
    kept.push(`${retainedSections.join(', ')} · Previous evidence kept.`);

  const selected = reviewedCompIds(saved.sales);
  const sameSelection =
    selected.length > 0 && !contentChanged(reviewedCompIds(before.sales), selected);
  const savedSaleCount = saved.sales?.sales?.length ?? 0;
  const usableSales = response.sales.status === 'matched' && Boolean(response.sales.sales?.length);
  if (sameSelection) kept.push(`${count(selected.length, 'reviewed comp')} kept.`);
  const salesChanged =
    usableSales &&
    savedSaleCount &&
    contentChanged(comparableValues(before.sales), comparableValues(saved.sales));
  if (salesChanged)
    updated.push(
      sameSelection
        ? 'Saved comp details updated.'
        : `Comparable sales · ${count(savedSaleCount, 'sale')} now on file.`
    );
  else if (!sameSelection && savedSaleCount)
    kept.push(`${count(savedSaleCount, 'comparable sale')} kept.`);
  if (response.sales.status !== 'matched')
    gaps.push(`ATTOM comparable sales · ${reason(response.sales.status)}.`);
  else if (!usableSales) gaps.push('ATTOM comparable sales · No usable sales returned.');
  else if (response.sales.partial)
    gaps.push('ATTOM comparable sales · Search coverage was limited.');

  const savedPhotos = saved.listing?.photoUrls ?? [];
  const listing = response.listing?.propertyData;
  const cachedPhotos =
    response.listing?.cache?.hit === true && listing?.source === 'apify-for-sale'
      ? photoLinks(listing.data?.photoUrls)
      : [];
  const savedFromCache = cachedPhotos.some((photo) => savedPhotos.includes(photo));
  if (savedFromCache && contentChanged(before.listing?.photoUrls ?? [], savedPhotos)) {
    updated.push(`Listing photos · ${count(savedPhotos.length, 'photo')} saved from cache.`);
  } else if (savedPhotos.length) {
    kept.push(`${count(savedPhotos.length, 'listing photo')} kept.`);
  }
  if (!savedFromCache) {
    gaps.push('Listing photos · No matching photos returned from the listing cache.');
  }
  return { updated, kept, gaps };
}

export function PropertyRefreshResult({ result }: { result: RefreshResult }) {
  const groups = [
    { label: 'Updated', entries: result.updated, Icon: CheckCircle2, tone: 'updated' },
    { label: 'Kept on file', entries: result.kept, Icon: Lock, tone: 'kept' },
    { label: 'Unavailable or incomplete', entries: result.gaps, Icon: AlertCircle, tone: 'gap' },
  ];
  return (
    <section className="pbk-property-refresh-result" aria-label="Property refresh result">
      <h3 role="status">
        {result.gaps.length ? 'Property refresh finished with gaps' : 'Property refresh complete'}
      </h3>
      <div className="pbk-property-refresh-groups">
        {groups
          .filter((group) => group.entries.length > 0)
          .map(({ label, entries, Icon, tone }) => (
            <div
              className={`pbk-property-refresh-group pbk-property-refresh-group--${tone}`}
              key={tone}
            >
              <h4>
                <Icon size={14} aria-hidden="true" /> {label}
              </h4>
              <ul role="list" aria-label={label}>
                {entries.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </section>
  );
}
