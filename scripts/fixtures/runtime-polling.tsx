import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useRuntimeSnapshot } from '../../src/app/hooks/useRuntimeSnapshot';
import '../../src/styles/index.css';

function Panel({ name, poll }: { name: string; poll: number }) {
  const { snapshot, quotas, tooling, error, refresh } = useRuntimeSnapshot(poll, true);
  return (
    <section aria-label={name}>
      <h2>{name}</h2>
      <output aria-label={`${name} state`}>{snapshot?.status?.lastUpdatedAt || 'loading'}</output>
      <output aria-label={`${name} error`}>{error}</output>
      <output aria-label={`${name} quotas`}>{JSON.stringify(quotas)}</output>
      <output aria-label={`${name} tooling`}>{JSON.stringify(tooling)}</output>
      <button onClick={() => void refresh().catch(() => {})}>Refresh {name}</button>
    </section>
  );
}
function Fixture() {
  const [late, setLate] = useState(false);
  const [draft, setDraft] = useState(
    () => localStorage.getItem('sample-polling-draft') || 'Sample notes and saved comp'
  );
  return (
    <main style={{ padding: 20, overflowWrap: 'anywhere' }}>
      <h1>Runtime polling fixture</h1>
      <label>
        Sample unsaved draft
        <input
          aria-label="Sample unsaved draft"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            localStorage.setItem('sample-polling-draft', event.target.value);
          }}
          style={{ display: 'block', maxWidth: '100%' }}
        />
      </label>
      <Panel name="Workspace" poll={5000} />
      <Panel name="Topbar" poll={10000} />
      <Panel name="Layout" poll={10000} />
      <button onClick={() => setLate(true)}>Mount late panel</button>
      {late && <Panel name="Late" poll={60000} />}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
