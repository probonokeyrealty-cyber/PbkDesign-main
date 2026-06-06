import { Clock3, MessageSquare, ShieldCheck } from 'lucide-react';

export type InboxSignalLane = 'approvals' | 'unread' | 'scheduled';

type InboxSignalLanesProps = {
  approvals: number;
  unread: number;
  scheduled: number;
  onSelect?: (lane: 'approvals' | 'unread' | 'scheduled') => void;
};

const laneDefinitions = [
  {
    key: 'approvals',
    label: 'Approvals',
    note: 'Ava/Rex waiting',
    tone: 'amber',
    Icon: ShieldCheck,
  },
  {
    key: 'unread',
    label: 'Unread',
    note: 'seller replies',
    tone: 'sky',
    Icon: MessageSquare,
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    note: 'send later queue',
    tone: 'lime',
    Icon: Clock3,
  },
] as const;

export function InboxSignalLanes({
  approvals,
  unread,
  scheduled,
  onSelect,
}: InboxSignalLanesProps) {
  const counts: Record<InboxSignalLane, number> = {
    approvals,
    unread,
    scheduled,
  };

  return (
    <div className="rail-lanes" aria-label="Inbox signal lanes">
      {laneDefinitions.map(({ key, label, note, tone, Icon }) => {
        const count = counts[key];
        return (
          <button
            key={key}
            type="button"
            className={`rail-lane ${tone}`}
            aria-label={`${label}: ${count} ${note}`}
            onClick={() => onSelect?.(key)}
          >
            <span className="lane-icon" aria-hidden="true">
              <Icon size={15} />
            </span>
            <span className="lane-body">
              <strong>{label}</strong>
              <span>{note}</span>
            </span>
            <span className="lane-count" aria-hidden="true">
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
