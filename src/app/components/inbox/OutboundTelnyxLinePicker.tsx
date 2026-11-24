import { useEffect, useState } from 'react';
import { fetchPhoneInventory, type PhoneLine } from '../../utils/phoneDialerApi';

type OutboundChannel = 'sms' | 'call';

export function useOutboundTelnyxLines(channel: OutboundChannel | '') {
  const [lines, setLines] = useState<PhoneLine[]>([]);
  const [number, select] = useState('');
  const [loadedChannel, setLoadedChannel] = useState<OutboundChannel | ''>('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLoadedChannel('');
    if (!channel) return;

    let active = true;
    setError('');
    fetchPhoneInventory()
      .then(({ lines: inventory, providers }) => {
        if (!active) return;
        const eligible = inventory.filter(
          (line) =>
            line.provider === 'telnyx' &&
            providers.telnyx.configured &&
            (channel === 'call' ? line.callerIdEnabled : line.sms?.sendingAllowed)
        );
        setLines(eligible);
        select(
          eligible.find((line) => line.roles?.defaultCallerId)?.phoneNumber ||
            eligible[0]?.phoneNumber ||
            ''
        );
      })
      .catch(() => {
        if (!active) return;
        setLines([]);
        select('');
        setError('Unable to load outbound numbers.');
      })
      .finally(() => {
        if (active) setLoadedChannel(channel);
      });
    return () => {
      active = false;
    };
  }, [channel]);

  const loading = channel !== loadedChannel;
  return { lines: loading ? [] : lines, number: loading ? '' : number, select, error, loading };
}

export function OutboundTelnyxLinePicker({
  sender,
  channel,
  className,
}: {
  sender: ReturnType<typeof useOutboundTelnyxLines>;
  channel: OutboundChannel;
  className?: string;
}) {
  return (
    <label className="mt-3 grid gap-2 text-xs font-semibold text-slate-400">
      {channel === 'sms' ? 'Text from' : 'Call from'}
      <select
        className={className}
        value={sender.number}
        onChange={(event) => sender.select(event.target.value)}
        disabled={sender.loading || !sender.lines.length}
      >
        {!sender.lines.length && (
          <option value="">
            {sender.loading ? 'Loading numbers...' : sender.error || 'No eligible Telnyx numbers'}
          </option>
        )}
        {sender.lines.map((line) => (
          <option key={line.id} value={line.phoneNumber}>
            {line.display || line.phoneNumber}
          </option>
        ))}
      </select>
    </label>
  );
}
