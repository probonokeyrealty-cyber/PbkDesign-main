import { portalProfile } from './releaseProfile.mjs';
const staging = portalProfile('staging');
export const PUBLIC_INVESTOR_ORIGIN = staging.publicOrigin;
const investorCommands = new Set([
  'authStart',
  'authVerify',
  'authCallback',
  'session',
  'list',
  'property',
  'file',
  'saved',
  'toggleSaved',
  'inquiries',
  'inquire',
  'logout',
]);
export const isAllowedOrigin = (origin, profile = staging) =>
  [profile.publicOrigin, profile.staffOrigin, ...profile.extraOrigins].includes(origin);
export function assertEntryCommand(origin, command, profile = staging) {
  if (origin === profile.publicOrigin && !investorCommands.has(command))
    throw Object.assign(Error('Use the staff property log for this action.'), { status: 403 });
}
export function assertEntryMember(origin, member, profile = staging) {
  if (origin === profile.publicOrigin && (member?.role !== 'investor' || !member?.approved))
    throw Object.assign(Error('Use an approved investor identity on this entry.'), { status: 403 });
}
