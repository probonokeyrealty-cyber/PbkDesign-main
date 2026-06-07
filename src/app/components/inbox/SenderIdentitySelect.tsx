import { Check, ChevronDown, Mail, MessageSquare, ShieldAlert, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
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

  return (
    <div className="pbk-sender-select">
      <span className="pbk-sender-select-label">From</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled || loading}>
          <button
            type="button"
            className="pbk-sender-select-trigger"
            aria-label="Choose outbound sender identity"
          >
            <span className="pbk-sender-provider-icon" aria-hidden="true">
              {selected?.channel === 'email' ? <Mail size={14} /> : <MessageSquare size={14} />}
            </span>
            <span>
              <strong>
                {loading
                  ? 'Loading senders'
                  : selected?.label || selected?.address || 'Choose a sender'}
              </strong>
              <small>
                {selected
                  ? `${providerLabel(selected.provider)} · ${
                      selectedRestriction || selected.healthStatus || 'health unknown'
                    }`
                  : 'Telnyx numbers or Instantly email accounts'}
              </small>
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="pbk-sender-select-menu"
          aria-label="Available sender identities"
        >
          <DropdownMenuLabel>Available sender identities</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {identities.map((identity) => {
            const restriction = getSenderRestrictionReason(identity);
            const recommended = identity.id === recommendedId;
            const active = identity.id === selectedId;
            return (
              <DropdownMenuItem
                key={identity.id}
                disabled={Boolean(restriction)}
                onSelect={() => onChange(identity.id)}
                className="pbk-sender-select-item"
              >
                <span className="pbk-sender-provider-icon" aria-hidden="true">
                  {identity.channel === 'email' ? (
                    <Mail size={14} />
                  ) : (
                    <MessageSquare size={14} />
                  )}
                </span>
                <span>
                  <strong>{identity.label || identity.address}</strong>
                  <small>
                    {providerLabel(identity.provider)} · {identity.address}
                  </small>
                  <small className={restriction ? 'restricted' : ''}>
                    {restriction || identity.healthStatus || 'health unknown'}
                  </small>
                </span>
                <span className="pbk-sender-select-badges">
                  {recommended && (
                    <span title="Recommended for this conversation">
                      <Sparkles size={12} />
                      Recommended
                    </span>
                  )}
                  {identity.isWorkspaceDefault && <span>Default</span>}
                  {restriction ? <ShieldAlert size={14} /> : active ? <Check size={14} /> : null}
                </span>
              </DropdownMenuItem>
            );
          })}
          {!identities.length && (
            <DropdownMenuItem disabled>No connected sender identities</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <PbkDataSource
        endpoint="GET /api/communication-identities"
        status="ships"
        note="inventory; POST /api/conversations/:threadId/sender-recommendation ranks the default"
      />
    </div>
  );
}
