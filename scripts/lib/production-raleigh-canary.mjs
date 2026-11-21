export const RALEIGH_CANARY_MARKET = 'Raleigh, NC';
export const RALEIGH_CANARY_CLAIM = 'production-raleigh-canary-v1';

export function isRaleighCanaryArmed(env, now = Date.now()) {
  const expiresAt = Date.parse(env.PBK_PRODUCTION_RALEIGH_CANARY_EXPIRES_AT ?? '');
  return env.PBK_PRODUCTION_RALEIGH_CANARY_ENABLED === 'true' &&
    Number.isFinite(expiresAt) && expiresAt > now && expiresAt - now <= 20 * 60_000;
}

export function isRaleighCanaryRequest(params) {
  return params && Object.keys(params).sort().join(',') === 'agentId,cloudResearchOperation,market' &&
    params.agentId === 'rex' && params.cloudResearchOperation === 'prepare-market-brief' &&
    params.market === RALEIGH_CANARY_MARKET;
}

export function isFreshRaleighApproval(task, env, now = Date.now()) {
  const createdAt = Date.parse(task?.createdAt ?? '');
  return isRaleighCanaryArmed(env, now) && task?.payload?.market === RALEIGH_CANARY_MARKET &&
    Number.isFinite(createdAt) && createdAt <= now && now - createdAt <= 5 * 60_000;
}

export function createRaleighClaim(claim, isArmed) {
  return () => isArmed() ? claim(RALEIGH_CANARY_CLAIM) : false;
}
