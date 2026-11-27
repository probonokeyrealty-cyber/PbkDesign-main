import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { TeamAccessGate } from '../../src/app/components/TeamAccessGate';
import { DealView } from '../../src/app/routes/DealView';
import { ANALYZER_CURRENT_DEAL_KEY, writeAnalyzerStorage, commitAnalyzerDraft, writeAnalyzerSessionDeal } from '../../src/app/utils/analyzerStorage';
import '../../src/styles/index.css';
import { RuntimePollingProbe } from './runtime-polling-probe';

const lead = new URL(location.href).searchParams.get('lead');
// Available only in this isolated fixture to exercise transaction-boundary failures.
Object.assign(window, { __commitSampleDraft: commitAnalyzerDraft, __writeSamplePrivateDraft: writeAnalyzerSessionDeal });
if (new URL(location.href).searchParams.has('sample') && !localStorage.getItem(ANALYZER_CURRENT_DEAL_KEY)) {
  writeAnalyzerStorage(ANALYZER_CURRENT_DEAL_KEY, {
    leadId: 'qa-draft', address: '11 Fixture Avenue', arv: 500000, beds: 4,
    notes: 'Local sample draft - no CRM writes',
  }, ['notes', 'arv', 'beds']);
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[lead ? `/deal/${encodeURIComponent(lead)}` : '/analyzer']}>
    <TeamAccessGate>
      {Reflect.get(window, '__runtimePollingFixture') === true && <RuntimePollingProbe />}
      <Routes>
        <Route path="/analyzer" element={<DealView />} />
        <Route path="/deal/:id" element={<DealView />} />
      </Routes>
    </TeamAccessGate>
  </MemoryRouter>
);
