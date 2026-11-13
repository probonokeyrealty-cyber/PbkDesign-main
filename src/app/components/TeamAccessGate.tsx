import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  authenticateTeamSessionRequest,
  fetchTeamAuthStatusRequest,
  getRuntimeTeamSession,
  isRuntimeTeamAuthRequired,
  RUNTIME_ACCESS_ERROR_EVENT,
  RUNTIME_TEAM_SESSION_KEY,
  RuntimeBridgeError,
  verifyRuntimeTeamSessionRequest,
} from '../utils/runtimeBridge';

type TeamAccessGateProps = {
  children: ReactNode;
  onAuthenticated?: () => void | Promise<void>;
};

type GateState = 'checking' | 'locked' | 'unavailable' | 'authorized';

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
  const [privateAccessExpired, setPrivateAccessExpired] = useState(false);
  const authorized = useRef(!required);
  const pendingRef = useRef(false);
  const recoveryNeeded = useRef(false);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const authenticatedCallback = useRef(onAuthenticated);
  authenticatedCallback.current = onAuthenticated;

  const showAccessFailure = useCallback((failure: unknown) => {
    recoveryNeeded.current = true;
    setPrivateAccessExpired(failure instanceof RuntimeBridgeError && failure.code === 'private_site_auth_required');
    setError(getTeamAccessErrorMessage(failure, 'PBK access could not be verified. Your saved session has been kept.'));
    if (!authorized.current) setGateState('unavailable');
  }, []);

  const checkAccess = useCallback(async () => {
    const version = ++requestVersion.current;
    pendingRef.current = true;
    setPending(true);
    try {
      const session = getRuntimeTeamSession();
      if (!session) {
        authorized.current = false;
        setGateState('locked');
      }
      if (session) {
        const verified = await verifyRuntimeTeamSessionRequest();
        if (!mounted.current || version !== requestVersion.current) return;
        if (verified) {
          authorized.current = true;
          recoveryNeeded.current = false;
          setGateState('authorized');
          setError('');
          setPrivateAccessExpired(false);
          try {
            await authenticatedCallback.current?.();
          } catch (refreshError) {
            if (mounted.current && version === requestVersion.current) showAccessFailure(refreshError);
          }
          return;
        }
        authorized.current = false;
        setGateState('locked');
      }
      const status = await fetchTeamAuthStatusRequest();
      if (!mounted.current || version !== requestVersion.current) return;
      setConfigured(status.configured !== false);
      authorized.current = false;
      recoveryNeeded.current = false;
      setGateState('locked');
      setError('');
      setPrivateAccessExpired(false);
    } catch (failure) {
      if (mounted.current && version === requestVersion.current) showAccessFailure(failure);
    } finally {
      if (mounted.current && version === requestVersion.current) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }, [showAccessFailure]);

  useEffect(() => {
    mounted.current = true;
    if (!required) {
      setGateState('authorized');
      return () => { mounted.current = false; };
    }
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage || (event.key !== null && event.key !== RUNTIME_TEAM_SESSION_KEY)) return;
      if (!getRuntimeTeamSession()) {
        authorized.current = false;
        setGateState('locked');
      }
      void checkAccess();
    };
    const onFocus = () => {
      if (!pendingRef.current && (!authorized.current || recoveryNeeded.current)) void checkAccess();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') onFocus(); };
    const onAccessError = (event: Event) => {
      const detail = (event as CustomEvent<{ code?: string; message?: string; sessionWasCurrent?: boolean }>).detail;
      if (detail?.code === 'private_site_auth_required') {
        showAccessFailure(new RuntimeBridgeError(detail.message || 'Private-site access is required.', 401, detail.code));
      } else if (detail?.code === 'team_session_rejected') {
        if (detail.sessionWasCurrent === false && pendingRef.current) return;
        requestVersion.current++;
        authorized.current = false;
        recoveryNeeded.current = false;
        pendingRef.current = false;
        setPending(false);
        setPrivateAccessExpired(false);
        setGateState('locked');
        setError('Your PBK team session expired or was rejected. Sign in again.');
      }
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(RUNTIME_ACCESS_ERROR_EVENT, onAccessError);
    void checkAccess();
    return () => {
      mounted.current = false;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(RUNTIME_ACCESS_ERROR_EVENT, onAccessError);
    };
  }, [required, checkAccess, showAccessFailure]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passcode.trim() || pendingRef.current) return;
    const version = ++requestVersion.current;
    pendingRef.current = true;
    setPending(true);
    setError('');
    try {
      await authenticateTeamSessionRequest({
        passcode: passcode.trim(),
        actor: 'PBK Command Center operator',
      }, () => mounted.current && version === requestVersion.current);
      if (!mounted.current || version !== requestVersion.current) return;
      setPasscode('');
      authorized.current = true;
      recoveryNeeded.current = false;
      setPrivateAccessExpired(false);
      setGateState('authorized');
      try {
        await authenticatedCallback.current?.();
      } catch (refreshError) {
        if (mounted.current && version === requestVersion.current) showAccessFailure(refreshError);
      }
    } catch (authError) {
      if (mounted.current && version === requestVersion.current) {
        if (authError instanceof RuntimeBridgeError && authError.code === 'private_site_auth_required') showAccessFailure(authError);
        else setError(getTeamAccessErrorMessage(authError, 'The team passcode was not accepted.'));
      }
    } finally {
      if (mounted.current && version === requestVersion.current) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  };

  const accessRecovery = error ? (
    <div className="pbk-team-access-error" role="alert">
      <p>{error}</p>
      <div className="pbk-team-access-recovery-actions">
        {privateAccessExpired && (
          <a href="/api/auth/team/status" target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />Restore private-site access
          </a>
        )}
        <button type="button" onClick={() => void checkAccess()} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
          Verify access again
        </button>
      </div>
    </div>
  ) : null;

  if (gateState === 'authorized') return <>{accessRecovery && <aside className="pbk-team-access-recovery">{accessRecovery}</aside>}{children}</>;

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
        ) : gateState === 'locked' ? (
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
        ) : null}

        {!configured && (
          <div className="pbk-team-access-error" role="alert">
            PBK_TEAM_PASSCODE is not configured on the Render bridge.
          </div>
        )}
        {accessRecovery}
        <small>
          The passcode is exchanged for an expiring signed session. The bridge API key remains
          server-side.
        </small>
      </section>
    </main>
  );
}
