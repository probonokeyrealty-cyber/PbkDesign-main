import { Check, ChevronDown, Mail, MessageSquare, ShieldAlert, Sparkles } from 'lucide-react';
import { PbkDataSource } from '../../../components/pbk/index';
import type { CommunicationSenderIdentity } from '../../utils/runtimeBridge';
import { getSenderRestrictionReason } from '../../routes/conversationRuntimeLogic.js';

type SenderIdentitySelectProps = {
  identities: CommunicationSenderIdentity[];
  selectedId: string;
  recommendedId?: string;
  loading?: boolean;
  disabled?: boolean;
  onChange: (identityId: string) => void;
};

function providerLabel(provider = '') {
  const normalized = provider.toLowerCase();
  if (normalized === 'telnyx') return 'Telnyx';
  if (normalized === 'instantly') return 'Instantly';
  return provider || 'Provider';
}

export function SenderIdentitySelect({
  identities,
  selectedId,
  recommendedId = '',
  loading = false,
  disabled = false,
  onChange,
}: SenderIdentitySelectProps) {
  const selected = identities.find((identity) => identity.id === selectedId) || null;
  const selectedRestriction = selected ? getSenderRestrictionReason(selected) : '';
  const senderLabel = selected
    ? `Outbound sender: ${selected.label || selected.address}`
    : 'Choose outbound sender identity';

  return (
    <div className="pbk-sender-select">
      <span className="pbk-sender-select-label">From</span>
      <label
        className={`pbk-sender-select-control ${selectedRestriction ? 'restricted' : ''}`}
        title={selectedRestriction || senderLabel}
      >
        <span className="pbk-sender-provider-icon" aria-hidden="true">
          {selected?.channel === 'email' ? <Mail size={14} /> : <MessageSquare size={14} />}
        </span>
        <span className="pbk-sender-select-copy">
          <strong>
            {loading
              ? 'Loading senders'
              : selected?.label || selected?.address || 'Choose a sender'}
          </strong>
          <small>
            {selected
              ? `${providerLabel(selected.provider)} - ${
                  selectedRestriction || selected.healthStatus || 'health unknown'
                }`
              : 'Telnyx numbers or Instantly email accounts'}
          </small>
        </span>
        <span className="pbk-sender-select-badges" aria-hidden="true">
          {selected?.id === recommendedId && (
            <span title="Recommended for this conversation">
              <Sparkles size={12} />
              Recommended
            </span>
          )}
          {selected?.isWorkspaceDefault && <span>Default</span>}
          {selectedRestriction ? <ShieldAlert size={14} /> : selected ? <Check size={14} /> : null}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
        <select
          aria-label={senderLabel}
          value={selectedId}
          disabled={disabled || loading}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {loading
              ? 'Loading connected senders'
              : identities.length
                ? 'Choose a sender'
                : 'No connected sender identities'}
          </option>
          {identities.map((identity) => {
            const restriction = getSenderRestrictionReason(identity);
            const recommended = identity.id === recommendedId;
            return (
              <option key={identity.id} value={identity.id} disabled={Boolean(restriction)}>
                {recommended ? 'Recommended - ' : ''}
                {identity.label || identity.address} - {providerLabel(identity.provider)}
                {restriction ? ` - ${restriction}` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <PbkDataSource
        endpoint="GET /api/communication-identities"
        status="ships"
        note="inventory; POST /api/conversations/:threadId/sender-recommendation ranks the default"
      />
    </div>
  );
}
