import { useState, type FormEvent } from 'react';
import { BookOpen, ExternalLink, ScanSearch } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { webSearchRequest } from '../utils/runtimeBridge';
import { VanNuysDemo } from './VanNuysDemo';
import './Prospecting.css';

type ResearchBrief = {
  market: string;
  question: string;
  answer: string;
  live: boolean;
  completedAt: number;
  sources: Array<{ label: string; href?: string }>;
};

function readSources(values: unknown): ResearchBrief['sources'] {
  if (!Array.isArray(values)) return [];
  const sources = new Map<string, ResearchBrief['sources'][number]>();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const citation = value.trim();
    const link = citation.match(/(?:^| - )(https?:\/\/\S+)$/i);
    if (link) {
      try {
        const url = new URL(link[1]);
        if (url.username || url.password) continue;
        sources.set(url.href, {
          label: citation.slice(0, link.index).trim() || url.hostname,
          href: url.href,
        });
      } catch {
        continue;
      }
    } else {
      sources.set(citation, { label: citation });
    }
  }
  return [...sources.values()].slice(0, 8);
}

export function Prospecting() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'evidence' ? 'evidence' : 'research';
  const [market, setMarket] = useState('');
  const [question, setQuestion] = useState('');
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function runResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const scope = market.trim();
    const topic = question.trim();
    if (pending || !scope || !topic) return;
    setPending(true);
    setError(false);
    setBrief(null);
    try {
      const result = await webSearchRequest({
        query: [
          'Research this property market using public sources. Keep the answer within the supplied market.',
          'Distinguish dated observations from estimates and say what the sources could not establish.',
          'Do not infer seller motivation, contact permission, property value, or deal eligibility.',
          `Market: ${scope}`,
          `Question: ${topic}`,
        ].join('\n'),
        requestedBy: 'rex',
      });
      const answer = typeof result.answer === 'string' ? result.answer.trim() : '';
      if (result.ok !== true || !answer) throw new Error('No research brief returned.');
      setBrief({
        market: scope,
        question: topic,
        answer,
        completedAt: Date.now(),
        live: result.live === true,
        sources: readSources(result.citations),
      });
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pbk-prospecting">
      <header className="pbk-prospecting-heading">
        <div className="pbk-prospecting-icon">
          <ScanSearch size={24} aria-hidden="true" />
        </div>
        <div>
          <h1>Prospecting</h1>
          <p>Research a market with Rex and review the evidence behind the brief.</p>
        </div>
      </header>

      <Tabs
        value={view}
        onValueChange={(next) => setParams(next === 'evidence' ? { view: next } : {})}
      >
        <TabsList aria-label="Prospecting views" className="pbk-prospecting-tabs">
          <TabsTrigger value="research">
            <ScanSearch aria-hidden="true" /> Research
          </TabsTrigger>
          <TabsTrigger value="evidence">
            <BookOpen aria-hidden="true" /> Saved evidence
          </TabsTrigger>
        </TabsList>

        <TabsContent value="research">
          <div className="pbk-prospecting-workspace">
            <form
              onSubmit={runResearch}
              className="pbk-prospecting-panel pbk-prospecting-form"
              aria-labelledby="prospecting-scope"
            >
              <h2 id="prospecting-scope">Research scope</h2>
              <label htmlFor="prospecting-market">Market</label>
              <input
                id="prospecting-market"
                required
                maxLength={100}
                value={market}
                onChange={(event) => setMarket(event.target.value)}
                placeholder="e.g. Van Nuys, CA"
              />
              <label htmlFor="prospecting-question">Research question</label>
              <textarea
                id="prospecting-question"
                required
                maxLength={480}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="e.g. What do recent public reports say about listing inventory?"
                rows={4}
                aria-describedby="prospecting-scope-help"
              />
              <p id="prospecting-scope-help">
                Use public market details only. A brief is advisory and stays in this tab.
              </p>
              <button
                type="submit"
                className="pbk-btn pbk-btn-primary"
                disabled={pending || !market.trim() || !question.trim()}
              >
                <ScanSearch size={17} aria-hidden="true" />{' '}
                {pending ? 'Researching…' : 'Run research'}
              </button>
            </form>

            <section
              className="pbk-prospecting-panel pbk-prospecting-result"
              aria-labelledby="prospecting-brief"
              aria-busy={pending}
            >
              <h2 id="prospecting-brief">Rex research brief</h2>
              <p role="status">
                {pending
                  ? 'Rex is checking public sources.'
                  : brief
                    ? brief.live
                      ? 'Live web research'
                      : 'Saved knowledge fallback'
                    : 'No brief yet'}
              </p>
              {error && (
                <p className="pbk-prospecting-error" role="alert">
                  Research could not complete. Review your scope and try again.
                </p>
              )}
              {!pending && !brief && !error && <p>Enter a market and question to start a brief.</p>}
              {brief && (
                <>
                  <div className="pbk-prospecting-run">
                    <strong>{brief.market}</strong>
                    <time dateTime={new Date(brief.completedAt).toISOString()}>
                      {new Date(brief.completedAt).toLocaleString()}
                    </time>
                    <p>{brief.question}</p>
                  </div>
                  <h3>Advisory findings</h3>
                  <p className="pbk-prospecting-answer">{brief.answer}</p>
                  <h3>Sources</h3>
                  <p>
                    {brief.live
                      ? 'Check the original sources before acting on these findings.'
                      : 'Live evidence was unavailable for this brief.'}
                  </p>
                  {brief.sources.length ? (
                    <ul className="pbk-prospecting-sources">
                      {brief.sources.map(({ label, href }) => (
                        <li key={href || label}>
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              {label} <ExternalLink size={14} aria-hidden="true" />
                            </a>
                          ) : (
                            label
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No citations were returned.</p>
                  )}
                </>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="evidence">
          <VanNuysDemo />
        </TabsContent>
      </Tabs>
    </div>
  );
}
