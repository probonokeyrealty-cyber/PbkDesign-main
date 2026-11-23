import { createRoot } from 'react-dom/client';
import { LeadMarketComparison } from './app/components/leads/LeadMarketComparison';
import { readPropertyEvidence } from './app/utils/propertyEvidence';
import './styles/pbk-tokens.css';

const fixtureAddress = 'Fictional QA property, Van Nuys, CA 91411';
const evidence = readPropertyEvidence({
  listingSnapshot: {
    source: 'apify-for-sale',
    address: fixtureAddress,
    retrievedAt: '2026-11-17T12:00:00Z',
    askingPrice: 640000,
    facts: { beds: 3, sqft: 1600, dom: 34 },
  },
}, fixtureAddress);

const root = document.getElementById('root');
if (root && import.meta.env.PBK_MARKET_STAGING_INDICATORS) {
  createRoot(root).render(
    <>
      <header>
        <span className="pbk-market-badge">Preview #111 QA fixture</span>
        <h1>91411 Market Comparison QA</h1>
        <p>Fictional property. Read-only. Census and BLS figures are bundled public snapshots.</p>
      </header>
      <LeadMarketComparison lead={{ zip: '91411', propertyType: 'Single family' }} evidence={evidence} />
    </>
  );
}
