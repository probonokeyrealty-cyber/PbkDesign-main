import {
  AlertCircle,
  BadgeDollarSign,
  Building2,
  CircleDollarSign,
  ExternalLink,
  HeartHandshake,
  Home,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { PbkDataSource } from '../../../components/pbk/index';
import type { ConversationThread } from '../../utils/runtimeBridge';

type LeadContextInspectorProps = {
  open: boolean;
  thread?: ConversationThread | null;
  lead?: Record<string, unknown> | null;
  loading: boolean;
  error: string;
  onClose: () => void;
};

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = 'Not captured') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function money(value: unknown) {
  const number = Number(String(value ?? '').replace(/[$,]/g, ''));
  if (!Number.isFinite(number) || number === 0) return 'Not captured';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(number);
}

function getLeadRecord(payload: Record<string, unknown> | null | undefined) {
  const root = record(payload);
  return record(root.lead || root.profile || root);
}

function DetailRow({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon?: typeof UserRound;
}) {
  return (
    <div className="pbk-lead-context-row">
      {Icon && (
        <span aria-hidden="true">
          <Icon size={14} />
        </span>
      )}
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

export function LeadContextInspector({
  open,
  thread,
  lead,
  loading,
  error,
  onClose,
}: LeadContextInspectorProps) {
  const profile = getLeadRecord(lead);
  const seller = { ...record(thread?.seller), ...record(profile.seller) };
  const property = { ...record(thread?.property), ...record(profile.property) };
  const compliance = record(profile.compliance);
  const numbers = { ...record(profile.numbers), ...record(profile.underwriting) };
  const tags = Array.isArray(profile.tags)
    ? profile.tags.map((tag) => text(tag, '')).filter(Boolean)
    : text(profile.tags, '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
  const leadId = text(thread?.leadId || profile.leadId || profile.id, '');
  const phone = text(profile.phone || seller.phone || seller.mobile, 'No phone');
  const email = text(profile.email || seller.email, 'No email');
  const address = text(
    profile.address || property.address || property.propertyAddress,
    'Address not captured'
  );

  if (!open) {
    return (
      <aside
        className="pbk-lead-context-inspector"
        aria-label="Seller profile"
        aria-hidden="true"
      />
    );
  }

  return (
    <aside className="pbk-lead-context-inspector open" aria-label="Seller profile">
      <header>
        <div>
          <div className="pbk-eyebrow">Lead portal context</div>
          <h2>
            {text(profile.leadName || profile.name || seller.name || thread?.title, 'Seller')}
          </h2>
          <p>{address}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close seller profile">
          <X size={17} />
        </button>
      </header>

      <div className="pbk-lead-context-scroll">
        {loading && (
          <div className="pbk-lead-context-loading" aria-label="Loading seller context">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}

        {!loading && error && (
          <div className="pbk-conversation-inline-state error" role="alert">
            <AlertCircle size={18} />
            <strong>Seller context unavailable</strong>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && thread && (
          <>
            <section>
              <h3>
                <UserRound size={15} />
                Identity &amp; contactability
              </h3>
              <DetailRow label="Phone" value={phone} Icon={Phone} />
              <DetailRow label="Email" value={email} Icon={Mail} />
              <DetailRow
                label="Preferred channel"
                value={text(profile.preferredChannel || seller.preferredChannel, 'Unknown')}
                Icon={HeartHandshake}
              />
              <DetailRow
                label="Best time"
                value={text(profile.bestTimeToCall || seller.bestTimeToCall, 'Unknown')}
              />
            </section>

            <section>
              <h3>
                <Home size={15} />
                Property
              </h3>
              <DetailRow label="Address" value={address} Icon={MapPin} />
              <DetailRow
                label="Asset"
                value={
                  [
                    property.beds ? `${property.beds} bd` : '',
                    property.baths ? `${property.baths} ba` : '',
                    property.sqft ? `${property.sqft} sq ft` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Not captured'
                }
                Icon={Building2}
              />
              <DetailRow
                label="Condition"
                value={text(profile.condition || property.condition, 'Unknown')}
              />
              <DetailRow
                label="Occupancy"
                value={text(profile.occupancy || property.occupancy, 'Unknown')}
              />
            </section>

            <section>
              <h3>
                <Sparkles size={15} />
                Motivation &amp; path
              </h3>
              <DetailRow label="Motivation" value={text(profile.motivation)} />
              <DetailRow label="Timeline" value={text(profile.timeline, 'Unknown')} />
              <DetailRow
                label="Path"
                value={text(profile.path || profile.selectedPath || profile.dealPath, 'Unassigned')}
              />
              <DetailRow label="Stage" value={text(profile.stage || thread.status, 'New')} />
              <DetailRow
                label="Assigned"
                value={text(profile.assignedAgent || thread.assignedAgent, 'Unassigned')}
              />
            </section>

            <section>
              <h3>
                <CircleDollarSign size={15} />
                Deal numbers
              </h3>
              <div className="pbk-lead-context-money">
                <div>
                  <span>ARV</span>
                  <strong>{money(profile.arv || numbers.arv)}</strong>
                </div>
                <div>
                  <span>MAO</span>
                  <strong>{money(profile.mao || profile.maoRbp || numbers.mao)}</strong>
                </div>
                <div>
                  <span>Repairs</span>
                  <strong>
                    {money(profile.repairs || profile.estimatedRepairs || numbers.repairs)}
                  </strong>
                </div>
                <div>
                  <span>Ask</span>
                  <strong>{money(profile.askingPrice || profile.ask || numbers.ask)}</strong>
                </div>
                <div>
                  <span>Mortgage</span>
                  <strong>{money(profile.mortgageBalance || numbers.mortgageBalance)}</strong>
                </div>
              </div>
            </section>

            <section>
              <h3>
                <ShieldCheck size={15} />
                Compliance
              </h3>
              <DetailRow
                label="TCPA consent"
                value={text(profile.tcpaConsent || compliance.tcpaConsent, 'Unknown')}
              />
              <DetailRow
                label="DNC status"
                value={text(profile.dncStatus || compliance.dncStatus, 'Needs review')}
              />
            </section>

            {tags.length > 0 && (
              <section>
                <h3>Tags</h3>
                <div className="pbk-lead-context-tags">
                  {tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {thread && (
        <footer>
          <Link to={leadId ? `/leads/${encodeURIComponent(leadId)}?edit=1` : '/leads'}>
            <Pencil size={14} />
            Edit lead
          </Link>
          <Link to={leadId ? `/leads/${encodeURIComponent(leadId)}` : '/leads'}>
            <ExternalLink size={14} />
            Full lead portal
          </Link>
          <Link to={leadId ? `/deal/${encodeURIComponent(leadId)}` : '/deal'}>
            <BadgeDollarSign size={14} />
            Deal analyzer
          </Link>
        </footer>
      )}
      <PbkDataSource
        endpoint="GET /api/leads/:id/full"
        status="ships"
        note="canonical seller and property context"
      />
    </aside>
  );
}
