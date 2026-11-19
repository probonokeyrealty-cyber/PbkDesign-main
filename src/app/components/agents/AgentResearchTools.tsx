import { useEffect, useRef, useState } from 'react';
import { invokeRuntimeTool } from '../../utils/runtimeBridge';
import '../../../styles/agent-research-tools.css';

type CatalogStatus =
  | 'matched'
  | 'not_configured'
  | 'disabled'
  | 'authorization_failed'
  | 'rate_limited'
  | 'timed_out'
  | 'unavailable'
  | 'not_found';

type ResearchTool = {
  slug: 'COMPOSIO_SEARCH_WEB';
  name: string;
  version: '20261119_00';
  inputFields: string[];
  scope: 'public_web';
  runnable: false;
};

type ResearchDiscovery = {
  matches?: Array<{ toolName: string; risk?: string; source?: string }>;
  composio?: {
    source: 'composio';
    status: CatalogStatus;
    discoveryOnly: true;
    checkedAt?: string;
    tools: ResearchTool[];
  };
};

const STATUS_LABELS: Record<CatalogStatus, string> = {
  matched: 'Catalog matched',
  not_configured: 'Not configured',
  disabled: 'Disabled',
  authorization_failed: 'Authorization failed',
  rate_limited: 'Rate limited',
  timed_out: 'Timed out',
  unavailable: 'Unavailable',
  not_found: 'No catalog match',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

// The inspector consumes a bounded projection, never arbitrary provider prose or schemas.
function projectDiscovery(value: unknown): ResearchDiscovery {
  const root = isRecord(value) ? value : {};
  const matches = (Array.isArray(root.matches) ? root.matches.slice(0, 5) : []).flatMap((match) => {
    if (
      !isRecord(match) ||
      typeof match.toolName !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(match.toolName)
    )
      return [];
    return [
      {
        toolName: match.toolName,
        risk:
          typeof match.risk === 'string' &&
          ['read', 'readonly', 'low', 'medium', 'high'].includes(match.risk)
            ? match.risk
            : 'Unspecified',
        source: 'pbk-local-tool-universe',
      },
    ];
  });
  const raw = root.composio;
  if (
    !isRecord(raw) ||
    raw.source !== 'composio' ||
    raw.discoveryOnly !== true ||
    typeof raw.status !== 'string' ||
    !Object.hasOwn(STATUS_LABELS, raw.status) ||
    !Array.isArray(raw.tools)
  )
    return { matches };
  const status = raw.status as CatalogStatus;
  const tools: ResearchTool[] = raw.tools
    .slice(0, 5)
    .some(
      (item) =>
        isRecord(item) &&
        item.slug === 'COMPOSIO_SEARCH_WEB' &&
        item.version === '20261119_00' &&
        item.scope === 'public_web' &&
        item.runnable === false &&
        Array.isArray(item.inputFields) &&
        item.inputFields.length === 1 &&
        item.inputFields[0] === 'query'
    )
    ? [
        {
          slug: 'COMPOSIO_SEARCH_WEB',
          name: 'Public web research',
          version: '20261119_00',
          scope: 'public_web',
          runnable: false,
          inputFields: ['query'],
        },
      ]
    : [];
  if (status === 'matched' && !tools.length) return { matches };
  const checkedAt =
    status !== 'not_configured' &&
    status !== 'disabled' &&
    typeof raw.checkedAt === 'string' &&
    raw.checkedAt.length <= 64 &&
    Number.isFinite(Date.parse(raw.checkedAt))
      ? raw.checkedAt
      : undefined;
  return {
    matches,
    composio: { source: 'composio', status, discoveryOnly: true, checkedAt, tools },
  };
}

export function AgentResearchTools({
  agentId,
  agentName,
  leadId,
}: {
  agentId: string;
  agentName: string;
  leadId?: string;
}) {
  const identity = JSON.stringify([agentId, leadId || '']);
  const generation = useRef(0);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResearchDiscovery | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setBusy(false);
    setResult(null);
    setError('');
    return () => {
      generation.current += 1;
      pending.current = false;
    };
  }, [identity]);

  async function findResearchTools() {
    if (pending.current) return;
    pending.current = true;
    const requestGeneration = generation.current;
    setBusy(true);
    setError('');
    try {
      const discovery = await invokeRuntimeTool<unknown>('discoverExternalTool', {
        query: 'public web research',
        includeComposio: true,
      });
      if (generation.current === requestGeneration) setResult(projectDiscovery(discovery));
    } catch {
      if (generation.current === requestGeneration) {
        setError('Research tool inspection failed. Try again.');
      }
    } finally {
      if (generation.current === requestGeneration) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  const catalog = result?.composio;
  const status = catalog ? STATUS_LABELS[catalog.status] : undefined;
  const checkedAt =
    catalog?.checkedAt && Number.isFinite(Date.parse(catalog.checkedAt))
      ? catalog.checkedAt
      : undefined;
  const tool =
    catalog?.source === 'composio' && catalog.discoveryOnly === true && catalog.status === 'matched'
      ? catalog.tools?.find(
          (item) =>
            item.slug === 'COMPOSIO_SEARCH_WEB' &&
            item.version === '20261119_00' &&
            item.scope === 'public_web' &&
            item.runnable === false
        )
      : undefined;

  return (
    <details className="pbk-agent-research">
      <summary>Research tools</summary>
      <div className="pbk-agent-research-body">
        <p>
          Inspect advisory research options for {agentName}. Ava supervises PBK work; Rex research
          stays in Brain. Use the existing call and message controls for follow-up.
        </p>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void findResearchTools()}
        >
          {busy ? 'Finding research tools…' : 'Find research tools'}
        </button>
        <div role="status" aria-live="polite" aria-atomic="true">
          {error && <p className="pbk-agent-research-warning">{error}</p>}
          {(busy || error) && result && <p>Showing the previous inspection for this selection.</p>}
          <section className="pbk-agent-research-catalog" aria-label="Composio catalog metadata">
            <h4>Composio catalog</h4>
            <span className="pbk-agent-research-state">
              {status || (result ? 'Catalog metadata unavailable' : 'Not inspected')}
            </span>
            <p className="pbk-agent-research-mono">
              {checkedAt ? <time dateTime={checkedAt}>{checkedAt}</time> : 'Never checked'}
            </p>
            <p>
              Catalog metadata only. Account access, agent readiness and execution are unverified.
            </p>
          </section>
          {result && (
            <section aria-label="Local PBK advisory matches">
              <h4>Local PBK advisory matches</h4>
              {result.matches?.length ? (
                <ul>
                  {result.matches.map((match, index) => (
                    <li key={`${match.toolName}:${index}`}>
                      <span className="pbk-agent-research-mono">{match.toolName}</span>
                      <p>Risk: {match.risk || 'Unspecified'}</p>
                      <p className="pbk-agent-research-mono">
                        {match.source || 'PBK local discovery'}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No local advisory matches returned.</p>
              )}
              <p>
                These are PBK aliases, separate from the Composio catalog. This inspector executes
                neither.
              </p>
            </section>
          )}
        </div>
        {tool && (
          <details className="pbk-agent-research-preview">
            <summary>Preview public web research</summary>
            <dl>
              <dt>Tool</dt>
              <dd>COMPOSIO_SEARCH_WEB</dd>
              <dt>Version</dt>
              <dd>20261119_00</dd>
              <dt>Scope</dt>
              <dd>Public web</dd>
              <dt>Input field names</dt>
              <dd>query</dd>
              <dt>Execution</dt>
              <dd>Execution unavailable in this inspector</dd>
            </dl>
            <p>Read-only preview. No research query is submitted here.</p>
          </details>
        )}
      </div>
    </details>
  );
}
