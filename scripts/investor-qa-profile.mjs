import { portalProfile } from '../supabase/functions/pbk-investor-staging/releaseProfile.mjs';
// Live QA is explicit, uses only reserved synthetic identities, and never resets real data.
export const qaLive = process.argv.includes('--live');
export const qaProfile = portalProfile(qaLive ? 'live' : 'staging');
export const qaStem = qaLive ? 'pbk.qa.live.20261114' : 'pbk.qa.portal.20261113';
export const qaFile = (name) => `.pbk-local/${qaLive ? 'live-' : ''}${name}`;
