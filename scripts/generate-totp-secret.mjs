import { randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toBase32(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, '0');
    output += alphabet[parseInt(chunk, 2)];
  }
  return output;
}

const issuer = process.env.PBK_TOTP_ISSUER || 'PBK Command Center';
const account = process.env.PBK_TOTP_ACCOUNT || 'founder';
const secret = toBase32(randomBytes(20));
const label = `${issuer}:${account}`;
const otpauth = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

console.log(JSON.stringify({
  ok: true,
  warning: 'Store this secret in a password manager and authenticator before setting PBK_TOTP_REQUIRED=true.',
  renderEnv: {
    PBK_TOTP_SECRET: secret,
    PBK_TOTP_REQUIRED: 'false',
  },
  authenticator: {
    issuer,
    account,
    otpauth,
  },
  nextSteps: [
    'Add the otpauth URL to an authenticator app.',
    'Set PBK_TOTP_SECRET in Render.',
    'Redeploy Render with PBK_TOTP_REQUIRED=false.',
    'Verify a 6-digit code against /api/security/totp/verify.',
    'Only then set PBK_TOTP_REQUIRED=true and redeploy.',
  ],
}, null, 2));
