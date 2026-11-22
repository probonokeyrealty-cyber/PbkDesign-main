import { ArrowLeft, CheckCircle2, Download, ScanSearch, ShieldCheck, Workflow } from 'lucide-react';
import { Link } from 'react-router';
import receipt from '../../assets/van-nuys/receipt.json';
import receiptJson from '../../assets/van-nuys/receipt.json?raw';
import receiptText from '../../assets/van-nuys/receipt.txt?raw';
import receiptCsv from '../../assets/van-nuys/receipt.csv?raw';
import receiptPdf from '../../assets/van-nuys/receipt.pdf?inline';
import './VanNuysDemo.css';

const downloadText = (type: string, data: string) => `data:${type};charset=utf-8,${encodeURIComponent(data)}`;
const exports = [
  ['Text', 'txt', downloadText('text/plain', receiptText)],
  ['PDF', 'pdf', receiptPdf],
  ['CSV', 'csv', downloadText('text/csv', receiptCsv)],
  ['JSON', 'json', downloadText('application/json', receiptJson)],
] as const;

const agents = [
  { name: 'Hermes', Icon: ScanSearch, role: 'Ranks the fictional listings.' },
  { name: 'Rex', Icon: ShieldCheck, role: 'Checks freshness, revision, and market.' },
  { name: 'Ava', Icon: Workflow, role: 'Shows only the verified fits.' },
];

export function VanNuysDemo() {
  return (
    <div className="pbk-van-nuys">
      <Link to="/dialer#prospecting-list" className="pbk-van-back"><ArrowLeft size={18} aria-hidden="true" /> Back to Dialer</Link>
      <header className="pbk-van-brief">
        <div>
          <p className="pbk-van-kicker">Prospecting / Read-only demo</p>
          <h1>Van Nuys evidence review</h1>
          <p>See why three listings were held and what Rex verified before Ava added them to the shortlist.</p>
          <p className="pbk-van-scope">Fictional listings. No live feed in this demo, no CRM writes, and no outreach.</p>
        </div>
        <dl className="pbk-van-ledger" aria-label="Saved run overview">
          <div><dt>Verified fits</dt><dd>{receipt.fits.length}</dd></div>
          <div><dt>Evidence rechecks</dt><dd>{receipt.rechecks.length}</dd></div>
          <div><dt>Still held</dt><dd>{receipt.held_count}</dd></div>
        </dl>
      </header>

      <ul className="pbk-van-handoff" aria-label="Agent handoff">
        {agents.map(({ name, Icon, role }) => (
          <li key={name}><Icon size={21} aria-hidden="true" /><div><strong>{name}</strong><p>{role}</p></div></li>
        ))}
      </ul>

      <div className="pbk-van-body">
        <section aria-labelledby="van-evidence-title">
          <h2 id="van-evidence-title">What Rex checked</h2>
          <p>Each first attempt stayed held. Ava added a listing only after Rex verified it.</p>
          <ol className="pbk-van-checks">
            {receipt.rechecks.map((item, index) => (
              <li key={item.label}>
                <details open={index === 0}>
                  <summary><span><strong>{item.label}</strong><small>{item.property}</small></span><span className="pbk-van-verified">Verified on recheck</span></summary>
                  <dl className="pbk-van-attempts">
                    <div><dt>Why Ava held it</dt><dd>{item.first_attempt.reason}</dd></div>
                    <div><dt>What Rex verified</dt><dd>{item.recheck.evidence}<br /><time dateTime={item.recheck.captured_at}>{item.recheck.captured_at.replace('T', ' ').replace('Z', ' UTC')}</time></dd></div>
                  </dl>
                </details>
              </li>
            ))}
          </ol>
        </section>

        <section className="pbk-van-receipt" aria-labelledby="van-receipt-title">
          <p className="pbk-van-kicker">Saved fictional run</p>
          <h2 id="van-receipt-title">Run receipt</h2>
          <p>Opening this page or downloading the receipt does not start a new run.</p>
          <p className="pbk-van-id"><span>Run ID</span><code>{receipt.run_id}</code></p>
          <div className="pbk-van-downloads" aria-label="Receipt downloads" role="group">
            {exports.map(([label, extension, href]) => (
              <a key={extension} href={href} download={`van-nuys-receipt-${receipt.run_id}.${extension}`} aria-label={`Download ${label} receipt`}>
                <Download size={16} aria-hidden="true" />{label}
              </a>
            ))}
          </div>
          <h3>Ava&apos;s verified shortlist</h3>
          <ul className="pbk-van-fits">
            {receipt.fits.map((fit) => (
              <li key={fit.property}><CheckCircle2 size={18} aria-hidden="true" /><span>{fit.property}<small>{fit.verification}</small></span></li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
