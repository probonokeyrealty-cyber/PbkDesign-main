import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowRight,
  Check,
  Loader2,
  Mail,
  MessageSquare,
  Search,
  UserRoundSearch,
  X,
} from 'lucide-react';
import { PbkDataSource } from '../../../components/pbk/index';
import {
  resolveConversationThreadRequest,
  searchLeadsRequest,
  type ConversationThread,
  type LeadImport,
} from '../../utils/runtimeBridge';

type MessageChannel = 'sms' | 'email';

type NewConversationDialogProps = {
  open: boolean;
  onClose: () => void;
  onResolved: (thread: ConversationThread, channel: MessageChannel) => void;
};

function record(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = '') {
  return String(value ?? fallback).trim();
}

function getLeadId(lead: LeadImport | Record<string, never>) {
  return text(lead.leadId || lead.id);
}

function getLeadName(lead: LeadImport) {
  return text(lead.leadName || lead.name || record(lead.seller).name, 'Unknown seller');
}

function getLeadAddress(lead: LeadImport) {
  return text(lead.address || record(lead.property).address, 'Address not captured');
}

function getLeadPhone(lead: LeadImport) {
  return text(lead.phone || record(lead.seller).phone);
}

function getLeadEmail(lead: LeadImport) {
  return text(lead.email || record(lead.seller).email);
}

function getChannelRecipient(lead: LeadImport, channel: MessageChannel) {
  return channel === 'sms' ? getLeadPhone(lead) : getLeadEmail(lead);
}

export function NewConversationDialog({ open, onClose, onResolved }: NewConversationDialogProps) {
  const [channel, setChannel] = useState<MessageChannel>('sms');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<LeadImport[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadImport | null>(null);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestSequence = useRef(0);

  const selectedRecipient = useMemo(
    () => (selectedLead ? getChannelRecipient(selectedLead, channel) : ''),
    [channel, selectedLead]
  );

  const close = useCallback(() => {
    requestSequence.current += 1;
    onClose();
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setChannel('sms');
    setQuery('');
    setMatches([]);
    setSelectedLead(null);
    setSearching(false);
    setOpening(false);
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close, open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setMatches([]);
      setSearching(false);
      return undefined;
    }
    const requestId = ++requestSequence.current;
    const requestedQuery = query.trim();
    setSearching(true);
    setError('');
    const timer = window.setTimeout(() => {
      void searchLeadsRequest({ query: requestedQuery, limit: 10 })
        .then((response) => {
          if (requestId !== requestSequence.current || requestedQuery !== query.trim()) {
            return;
          }
          setMatches(response.leads || []);
        })
        .catch((searchError) => {
          if (requestId !== requestSequence.current) return;
          setError(
            searchError instanceof Error ? searchError.message : 'Seller search is unavailable.'
          );
        })
        .finally(() => {
          if (requestId === requestSequence.current) setSearching(false);
        });
    }, 260);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const openComposer = async () => {
    const id = selectedLead ? getLeadId(selectedLead) : '';
    if (!id || !selectedRecipient) return;
    setOpening(true);
    setError('');
    try {
      const response = await resolveConversationThreadRequest(id);
      if (!response.thread) {
        throw new Error('The bridge did not return a conversation thread.');
      }
      onResolved(response.thread, channel);
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : 'Unable to open the seller conversation.'
      );
    } finally {
      setOpening(false);
    }
  };

  if (!open) return null;

  return (
    <div className="pbk-conversation-match-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="pbk-conversation-match-dialog pbk-new-conversation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-conversation-title"
      >
        <header>
          <div>
            <div className="pbk-eyebrow">Canonical seller timeline</div>
            <h2 id="new-conversation-title">Start a new message</h2>
            <p>
              Choose an existing PBK lead. The bridge opens one shared seller thread, then Telnyx or
              Instantly handles delivery.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close new message">
            <X size={17} />
          </button>
        </header>

        <div className="pbk-new-conversation-channel" aria-label="Message channel">
          <button
            type="button"
            className={channel === 'sms' ? 'active' : ''}
            aria-pressed={channel === 'sms'}
            onClick={() => {
              setChannel('sms');
              setError('');
            }}
          >
            <MessageSquare size={15} aria-hidden="true" />
            SMS
            <small>Telnyx number</small>
          </button>
          <button
            type="button"
            className={channel === 'email' ? 'active' : ''}
            aria-pressed={channel === 'email'}
            onClick={() => {
              setChannel('email');
              setError('');
            }}
          >
            <Mail size={15} aria-hidden="true" />
            Email
            <small>Instantly mailbox</small>
          </button>
        </div>

        <label className="pbk-conversation-match-search">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search existing PBK leads</span>
          <input
            value={query}
            onChange={(event) => {
              requestSequence.current += 1;
              setQuery(event.target.value);
              setSelectedLead(null);
              setError('');
            }}
            placeholder="Seller, address, phone, email..."
            autoFocus
          />
          <span className="pbk-new-conversation-search-state" aria-live="polite">
            {searching ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <UserRoundSearch size={15} />
            )}
          </span>
        </label>

        {error && (
          <div className="pbk-conversation-match-error" role="alert">
            {error}
          </div>
        )}

        <div className="pbk-conversation-match-results pbk-new-conversation-results">
          {matches.map((lead) => {
            const id = getLeadId(lead);
            const recipient = getChannelRecipient(lead, channel);
            const selected = selectedLead ? getLeadId(selectedLead) === id : false;
            return (
              <button
                key={id || getLeadName(lead)}
                type="button"
                onClick={() => setSelectedLead(lead)}
                disabled={!id || opening}
                aria-pressed={selected}
              >
                <span className="pbk-new-conversation-avatar" aria-hidden="true">
                  {getLeadName(lead).slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{getLeadName(lead)}</strong>
                  <small>{getLeadAddress(lead)}</small>
                  <small className={recipient ? 'available' : 'missing'}>
                    {recipient ||
                      (channel === 'sms'
                        ? 'No phone number on this lead'
                        : 'No email address on this lead')}
                  </small>
                </span>
                {selected && <Check size={16} aria-hidden="true" />}
              </button>
            );
          })}
          {!searching && query.trim().length >= 2 && !matches.length && !error && (
            <div className="pbk-new-conversation-empty">
              <p>No matching PBK leads found.</p>
              <Link to="/leads?new=1" onClick={onClose}>
                Create a new lead
              </Link>
            </div>
          )}
          {query.trim().length < 2 && (
            <div className="pbk-new-conversation-hint">
              <Search size={17} aria-hidden="true" />
              Search the live lead portal to start a seller conversation.
            </div>
          )}
        </div>

        {selectedLead && (
          <div className="pbk-new-conversation-confirm">
            <div>
              <span>To</span>
              <strong>{getLeadName(selectedLead)}</strong>
              <small>
                {selectedRecipient ||
                  `Add a ${
                    channel === 'sms' ? 'phone number' : 'valid email'
                  } in the Lead Portal first.`}
              </small>
              {!selectedRecipient && (
                <Link
                  to={`/leads/${encodeURIComponent(getLeadId(selectedLead))}`}
                  onClick={onClose}
                >
                  Add contact info in Lead Portal
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => void openComposer()}
              disabled={opening || !selectedRecipient}
              aria-describedby={!selectedRecipient ? 'new-conversation-requirement' : undefined}
            >
              {opening ? <Loader2 size={15} className="animate-spin" /> : <ArrowRight size={15} />}
              Open {channel.toUpperCase()} composer
            </button>
            {!selectedRecipient && (
              <span id="new-conversation-requirement" className="sr-only">
                This lead does not have the contact information required for the selected channel.
              </span>
            )}
          </div>
        )}

        <PbkDataSource
          endpoint="POST /api/conversations/resolve"
          status="ships"
          note="canonical lead thread; provider send remains explicit"
        />
      </section>
    </div>
  );
}
