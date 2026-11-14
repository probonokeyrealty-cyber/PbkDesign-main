import { createPortalHandler } from './server.ts';
import { portalProfile } from './releaseProfile.mjs';
Deno.serve(createPortalHandler(portalProfile('staging')));
