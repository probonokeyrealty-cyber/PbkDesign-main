import assert from 'node:assert/strict';

export function observeAnalyzerFixtureStartup(page, origin) {
  const pending = new Map();
  let domReady = false, loaded = false;
  const request = req => {
    const url = new URL(req.url());
    if (url.origin === origin && ['document', 'script', 'stylesheet', 'font', 'image'].includes(req.resourceType())) {
      pending.set(req, url.pathname.slice(0, 160));
    }
  };
  const finished = req => pending.delete(req);
  const dom = () => { domReady = true; }, load = () => { loaded = true; };
  page.on('request', request);
  page.on('requestfinished', finished);
  page.on('requestfailed', finished);
  page.on('domcontentloaded', dom);
  page.on('load', load);
  return {
    snapshot: () => ({ domReady, loaded, pendingCount: pending.size, pendingPaths: [...pending.values()].slice(0, 20) }),
    dispose() {
      page.off('request', request);
      page.off('requestfinished', finished);
      page.off('requestfailed', finished);
      page.off('domcontentloaded', dom);
      page.off('load', load);
      pending.clear();
    },
  };
}

export function analyzerPublicationTrace(enabled) {
  return { name: 'sample-analyzer-publication-trace', enforce: 'pre', transform(source, id) {
    if (!enabled) return;
    const path = id.replaceAll('\\', '/').split('?')[0];
    const inject = (needle, statement) => {
      assert.ok(source.includes(needle), 'Sample publication trace anchor changed');
      source = source.replace(needle, statement + '\n' + needle);
    };
    if (path.endsWith('/src/app/App.tsx')) {
      inject('    // Keep the private copy immediately; shared writes may wait behind another tab.',
        "    const __sampleExpected = draftBaseline.current;\n    const __sampleTraceId = window.__recordDraftPublication?.('start', { version, beds: next.beds, expected: __sampleExpected });");
      inject("      if (mounted.current && version === draftWriteVersion.current && result === 'published') {",
        "      window.__recordDraftPublication?.('end', { traceId: __sampleTraceId, version, beds: next.beds, result, expected: __sampleExpected, currentVersion: draftWriteVersion.current });");
      inject("      if (!mounted.current || version !== draftWriteVersion.current) return 'superseded';",
        "      window.__recordDraftPublication?.('exception', { traceId: __sampleTraceId, version, beds: next.beds, expected: __sampleExpected, currentVersion: draftWriteVersion.current });");
      inject('        draftBaseline.current = event.newValue;',
        "        window.__recordDraftPublication?.('hydrate', { beds: incoming.beds, expected: draftBaseline.current, shared: event.newValue });");
      return source;
    }
    if (path.endsWith('/src/app/utils/analyzerStorage.ts')) {
      inject("                outcome = 'conflict';",
        "                window.__recordDraftPublication?.('conflict', { beds: deal?.beds, expected, shared: local, canonical, force });");
      inject('              store.put({ raw: persistent }, ANALYZER_CURRENT_DEAL_KEY);',
        "              window.__recordDraftPublication?.('compare', { beds: deal?.beds, expected, shared: local, canonical, force });");
      return source;
    }
  } };
}
