import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TeamAccessGate } from '../../src/app/components/TeamAccessGate';
import { bridgeRequest } from '../../src/app/utils/runtimeBridge';
import '../../src/styles/index.css';

function Fixture() {
  const [refreshes, setRefreshes] = useState(0);
  const [connectionResult, setConnectionResult] = useState('idle');
  return <div data-qa-connection-result={connectionResult}><TeamAccessGate onAuthenticated={async () => {
    setRefreshes(value => value + 1);
    if (new URL(location.href).searchParams.has('protected-refresh')) await bridgeRequest({ path: '/api/leads' });
  }}>
    <main>
      <h1>Fixture workspace</h1>
      <output aria-label="Authenticated refreshes">{refreshes}</output>
      <output aria-label="Fixture connection result">{connectionResult}</output>
      <label>
        Unsaved operator draft
        <input aria-label="Unsaved operator draft" defaultValue="Sample draft" />
      </label>
      <button onClick={async () => {
        try {
          await bridgeRequest({ path: '/api/leads' });
          setConnectionResult('ready');
        } catch {
          setConnectionResult('failed');
        }
      }}>
        Check fixture connection
      </button>
    </main>
  </TeamAccessGate></div>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
