import { useState } from 'react';
import { ChevronDown, Database, Search } from 'lucide-react';
import {
  attomMcpDatasetDefinitions,
  hydrateAttomMcpSections,
  type AttomMcpSection,
} from '../../utils/attomMcpSections.mjs';

const statusLabels: Record<string, string> = {
  ok: 'Captured',
  partial: 'Partial response',
  not_entitled: 'Not included in access',
  not_available: 'No records returned',
  unavailable: 'Unavailable',
  timed_out: 'Timed out',
  unsupported: 'Not supported',
  authorization_failed: 'Access unavailable',
  rate_limited: 'Request limited',
  not_found: 'No records returned',
};
function formatValue(value: string | number | boolean, unit?: string) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value !== 'number') return value;
  if (unit === 'USD/sq ft' || unit === '$/sq ft')
    return (
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value) + ' / sq ft'
    );
  if (unit === 'USD' || unit === 'money' || unit === 'currency')
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  return `${value.toLocaleString('en-US')}${unit ? ` ${unit}` : ''}`;
}
function SourceTime({ label, value }: { label: string; value?: string }) {
  return value && Number.isFinite(Date.parse(value)) ? (
    <span>
      {label} <time dateTime={value}>{new Date(value).toLocaleString()}</time>
    </span>
  ) : null;
}
export function AttomRecordDatasets({ sections: input }: { sections?: AttomMcpSection[] }) {
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('all');
  const sections = hydrateAttomMcpSections(input);
  const groups = [
    ...new Set(
      attomMcpDatasetDefinitions
        .filter((definition) => sections.some((section) => section.id === definition.id))
        .map((definition) => definition.group)
    ),
  ];
  const query = search.trim().toLowerCase();
  const visible = sections.flatMap((section) => {
    const definition = attomMcpDatasetDefinitions.find((candidate) => candidate.id === section.id);
    if (!definition || (group !== 'all' && group !== definition.group)) return [];
    const searchText = [
      section.id,
      definition.title,
      definition.group,
      definition.note,
      ...definition.fields.map((field) => field.label),
      ...definition.columns.map((column) => column.label),
      ...Object.values(section.facts),
      ...section.rows.flatMap((row) => Object.values(row)),
      ...section.caveats,
    ]
      .join(' ')
      .toLowerCase();
    return query && !searchText.includes(query) ? [] : [{ section, definition }];
  });
  return (
    <section
      className="pbk-attom-record-groups pbk-record-datasets"
      aria-label="Saved property datasets"
    >
      <div className="pbk-record-dataset-heading">
        <Database size={16} aria-hidden />
        <h4>Captured datasets</h4>
        <span>{sections.length} saved</span>
      </div>
      <p className="pbk-property-evidence-note">
        Saved evidence from the latest explicit lookup. Estimates do not change ARV, MAO, or agreed
        terms.
      </p>
      {!!sections.length && (
        <div className="pbk-record-dataset-tools">
          <label className="pbk-record-search">
            <Search size={14} aria-hidden />
            <span className="sr-only">Search saved datasets</span>
            <input
              type="search"
              aria-label="Search saved datasets"
              value={search}
              placeholder="Search datasets, values, or documents"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="pbk-record-group-filter">
            Group
            <select
              aria-label="Filter saved dataset group"
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              <option value="all">All groups</option>
              {groups.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className="pbk-record-search-result" role="status">
        {sections.length
          ? `${visible.length} of ${sections.length} saved datasets`
          : 'No additional datasets saved yet.'}
      </p>
      {!!sections.length && !visible.length && (
        <p className="pbk-property-evidence-note">No saved datasets match these filters.</p>
      )}
      {visible.map(({ section, definition }) => {
        const fields = definition.fields.filter((field) => section.facts[field.key] != null);
        const columns = definition.columns.filter((column) =>
          section.rows.some((row) => row[column.key] != null)
        );
        const isComparables = /comparab/i.test(section.id);
        const retained = section.refreshStatus != null;
        return (
          <details
            className="pbk-attom-record-details"
            key={`${section.id}:${query}:${group}`}
            data-status={section.status}
            open={query ? true : undefined}
          >
            <summary>
              <Database size={15} aria-hidden />
              <span>{definition.title}</span>
              <small>
                {retained ? 'Retained snapshot' : (statusLabels[section.status] ?? 'Unavailable')}
                {section.rows.length ? ` | ${section.rows.length} records` : ''}
              </small>
              <ChevronDown className="pbk-record-chevron" size={14} aria-hidden />
            </summary>
            <div className="pbk-record-dataset-times">
              <SourceTime label="Checked" value={section.checkedAt} />
              <SourceTime label="Captured" value={section.retrievedAt} />
              <SourceTime label="Source generated" value={section.sourceGeneratedAt} />
            </div>
            {retained && (
              <p className="pbk-property-evidence-note pbk-record-retained">
                Latest attempt: {statusLabels[section.refreshStatus!.status] ?? 'Unavailable'}.
                Earlier evidence retained; capture time unchanged.{' '}
                <SourceTime label="Attempted" value={section.refreshStatus!.checkedAt} />
              </p>
            )}
            {section.truncated && section.sourceRowCount != null && (
              <p className="pbk-property-evidence-note">
                Showing {section.rows.length} of {section.sourceRowCount} source records; additional
                records are not included in this saved snapshot.
              </p>
            )}
            {definition.note && <p className="pbk-property-evidence-note">{definition.note}</p>}
            {section.caveats
              .filter((note) => note !== definition.note)
              .map((note, index) => (
                <p className="pbk-property-evidence-note" key={index}>
                  {note}
                </p>
              ))}
            {!!fields.length && (
              <dl className="pbk-attom-facts">
                {fields.map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>
                      <strong>{formatValue(section.facts[field.key], field.unit)}</strong>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {isComparables ? (
              <p className="pbk-property-evidence-note">
                Review and compare saved candidates in the Comps tab.
              </p>
            ) : (
              !!section.rows.length &&
              !!columns.length && (
                <div
                  className="pbk-record-dataset-table"
                  role="region"
                  aria-label={`${definition.title} records`}
                  tabIndex={0}
                >
                  <table>
                    <caption className="sr-only">{definition.title} saved records</caption>
                    <thead>
                      <tr>
                        {columns.map((column) => (
                          <th key={column.key} scope="col">
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, index) => (
                        <tr key={index}>
                          {columns.map((column) => (
                            <td key={column.key}>
                              {row[column.key] == null
                                ? 'Not provided'
                                : formatValue(row[column.key], column.unit)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {!fields.length && !section.rows.length && (
              <p className="pbk-property-evidence-note">
                {section.status === 'ok'
                  ? 'No usable records captured.'
                  : `${statusLabels[section.status] ?? 'Unavailable'}.`}{' '}
                Missing records do not establish the absence of debt, liens, or distress.
              </p>
            )}
          </details>
        );
      })}
    </section>
  );
}
