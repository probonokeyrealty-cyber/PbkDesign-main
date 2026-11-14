const profiles = {
  staging: {
    environment: 'staging',
    functionName: 'pbk-investor-staging',
    table: 'pbk_investor_staging_state',
    stateId: 'staging',
    commitRpc: 'pbk_investor_staging_commit',
    bucket: 'pbk-investor-staging',
    publicOrigin: 'https://pbk-investors-staging.netlify.app',
    staffOrigin: 'https://pbk-investor-staging--pbkcenter.netlify.app',
    extraOrigins: [
      'https://probono-key-realty.webflow.io',
      'http://localhost:5179',
      'http://127.0.0.1:5179',
    ],
  },
  live: {
    environment: 'live',
    functionName: 'pbk-investor-portal',
    table: 'pbk_investor_portal_state',
    stateId: 'live',
    commitRpc: 'pbk_investor_portal_commit',
    bucket: 'pbk-investor-portal',
    publicOrigin: 'https://pbk-investors.netlify.app',
    staffOrigin: 'https://pbkcenter.netlify.app',
    extraOrigins: [],
  },
};
export function portalProfile(environment) {
  if (!Object.hasOwn(profiles, environment)) throw Error('Unknown portal environment.');
  return structuredClone(profiles[environment]);
}
export function seedLiveState(staging) {
  const members = Object.fromEntries(
    Object.entries(staging.members || {}).filter(
      ([, m]) =>
        m.approved === true &&
        ['investor', 'editor', 'reviewer'].includes(m.role) &&
        typeof m.email === 'string' &&
        !/^(?:pbk[.+_-])?qa[.+_-]|@example\.(?:com|net|org)$/i.test(m.email)
    )
  );
  return structuredClone({
    members,
    properties: {},
    inquiries: {},
    saved: {},
    sessions: {},
    invitations: {},
    audit: [],
  });
}
