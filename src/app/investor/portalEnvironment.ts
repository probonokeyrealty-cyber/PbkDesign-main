import { portalProfile } from '../../../supabase/functions/pbk-investor-staging/releaseProfile.mjs';
declare const __PBK_PORTAL_ENV__: 'live' | 'staging';
export const PORTAL_PROFILE = portalProfile(__PBK_PORTAL_ENV__);
export const PORTAL_IS_STAGING = PORTAL_PROFILE.environment === 'staging';
