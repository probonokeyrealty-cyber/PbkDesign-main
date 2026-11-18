import { createHmac } from 'node:crypto';

if (!process.env.PBK_SMOKE_ISOLATION_NONCE || !process.permission?.has('fs.write', process.env.PBK_OPENCLAW_STATE_DIR)) {
  throw new Error('Callback smoke requires the existing isolated bridge harness');
}
const derive = purpose => createHmac('sha256', process.env.PBK_BRIDGE_API_KEY).update(purpose).digest('hex');
process.env.PBK_TEAM_PASSCODE = derive('callback-smoke-team');
process.env.PBK_SLACK_SIGNING_SECRET = derive('callback-smoke-slack');
process.env.PBK_TEAM_APPROVAL_LIMIT = '100000';
process.env.PBK_TEAM_CAN_APPROVE_PROVIDER_ACTIONS = 'false';
await import('../openclaw-local-server.mjs');
