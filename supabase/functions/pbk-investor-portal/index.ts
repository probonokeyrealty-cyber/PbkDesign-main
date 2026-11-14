import { createPortalHandler } from '../pbk-investor-staging/server.ts';
import { portalProfile } from '../pbk-investor-staging/releaseProfile.mjs';
Deno.serve(createPortalHandler(portalProfile('live')));
