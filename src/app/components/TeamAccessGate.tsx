import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import {
  authenticateTeamSessionRequest,
  fetchTeamAuthStatusRequest,
  getRuntimeTeamSession,
  isRuntimeTeamAuthRequired,
  verifyRuntimeTeamSessionRequest,
} from '../utils/runtimeBridge';

type TeamAccessGateProps = {
  children: ReactNode;
  onAuthenticated?: () => void | Promise<void>;
};

type GateState = 'checking' | 'locked' | 'authorized';

function getTeamAccessErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error || '');
  const trimmed = message.trim();
  if (
    !trimmed ||
    trimmed.length > 220 ||
    /<!doctype|<html|<head|<body|<style|@font-face|\.pbk-|\.vite|unexpected token/i.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}

export function TeamAccessGate({ children, onAuthenticated }: TeamAccessGateProps) {
  const required = isRuntimeTeamAuthRequired();
  const [gateState, setGateState] = useState<GateState>(required ? 'checking' : 'authorized');
  const [configured, setConfigured] = useState(true);
  const [passcode, setPasscode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!required) {
      setGateState('authorized');
      return;
    }
    let active = true;
    const check = async () => {
      if (getRuntimeTeamSession()) {
        const verified = await verifyRuntimeTeamSessionRequest();
        if (!active) return;
        if (verified) {
          setGateState('authorized');
          return;
        }
      }
      try {
        const status = await fetchTeamAuthStatusRequest();
        if (!active) return;
        setConfigured(status.configured !== false);
      } catch (statusError) {
        if (!active) return;
        setError(
          getTeamAccessErrorMessage(
            statusError,
            'PBK access status is unavailable. Try again in a moment.'
          )
        );
      }
      if (active) setGateState('locked');
    };
    void check();
    return () => {
      active = false;
    };
  }, [required]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passcode.trim() || pending) return;
    setPending(true);
    setError('');
    try {
      await authenticateTeamSessionRequest({
        passcode: passcode.trim(),
        actor: 'PBK Command Center operator',
      });
      setPasscode('');
      setGateState('authorized');
      await onAuthenticated?.();
    } catch (authError) {
      setError(getTeamAccessErrorMessage(authError, 'The team passcode was not accepted.'));
    } finally {
      setPending(false);
    }
  };

  if (gateState === 'authorized') return <>{children}</>;

  return (
    <main className="pbk-team-access-shell">
      <section
        className="pbk-team-access-panel"
        aria-labelledby="pbk-team-access-title"
        aria-busy={gateState === 'checking' || pending}
      >
        <div className="pbk-team-access-mark" aria-hidden="true">
          <ShieldCheck />
        </div>
        <span className="pbk-team-access-eyebrow">Protected operator workspace</span>
        <h1 id="pbk-team-access-title">PBK Command Center</h1>
        <p>
          Use the existing team passcode to open live seller data, approvals, Ava controls, and
          provider actions on this device.
        </p>

        {gateState === 'checking' ? (
          <div className="pbk-team-access-checking" role="status">
            <Loader2 className="animate-spin" />
            Verifying this device session
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="pbk-team-passcode">Team passcode</label>
            <div className="pbk-team-access-input">
              <KeyRound aria-hidden="true" />
              <input
                id="pbk-team-passcode"
                type="password"
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                autoComplete="current-password"
                autoFocus
                disabled={!configured || pending}
                placeholder="Enter PBK team passcode"
              />
            </div>
            <button type="submit" disabled={!configured || !passcode.trim() || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              {pending ? 'Opening workspace' : 'Open command center'}
            </button>
          </form>
        )}

        {!configured && (
          <div className="pbk-team-access-error" role="alert">
            PBK_TEAM_PASSCODE is not configured on the Render bridge.
          </div>
        )}
        {error && (
          <div className="pbk-team-access-error" role="alert">
            {error}
          </div>
        )}
        <small>
          The passcode is exchanged for an expiring signed session. The bridge API key remains
          server-side.
        </small>
      </section>
    </main>
  );
}
