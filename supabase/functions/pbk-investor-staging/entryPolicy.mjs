export const PUBLIC_INVESTOR_ORIGIN = 'https://pbk-investors-staging.netlify.app';
const allowedOrigins = new Set([
  PUBLIC_INVESTOR_ORIGIN,
  'https://pbk-investor-staging--pbkcenter.netlify.app',
  'https://probono-key-realty.webflow.io',
  'http://localhost:5179',
  'http://127.0.0.1:5179',
]);
const investorCommands = new Set([
  'authStart',
  'authVerify',
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
export const isAllowedOrigin = (origin) => allowedOrigins.has(origin);
export function assertEntryCommand(origin, command) {
  if (origin === PUBLIC_INVESTOR_ORIGIN && !investorCommands.has(command))
    throw Object.assign(Error('Use the staff property log for this action.'), { status: 403 });
}
export function assertEntryMember(origin, member) {
  if (origin === PUBLIC_INVESTOR_ORIGIN && (member?.role !== 'investor' || !member?.approved))
    throw Object.assign(Error('Use an approved investor identity on this entry.'), { status: 403 });
}
