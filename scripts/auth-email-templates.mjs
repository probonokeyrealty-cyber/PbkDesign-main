// Reviewed copy for the hosted Auth template editors; this module never sends mail.
export const authEmailCopy = {
  'confirm-sign-up': [
    'Confirm your PBK email',
    'Confirm your email address',
    'Confirm this email address for your PBK account. Account access still requires PBK approval.',
    'Confirm my email',
  ],
  'invite-user': [
    'Your PBK account invitation',
    'You are invited to PBK',
    'PBK has invited you to create an account. Accept this invitation only if you expected it. Your assigned permissions determine what you can access.',
    'Accept invitation',
  ],
  'magic-link-or-otp': [
    'Your PBK sign-in',
    'Sign in to PBK',
    'Use this one-time link to sign in to your approved PBK account. Return to the page where you requested access.',
    'Sign in to PBK',
  ],
  'change-email-address': [
    'Confirm your PBK email change',
    'Confirm your email change',
    'A request was made to change the email address on your PBK account. Confirm only if you requested this change.',
    'Confirm email change',
  ],
  'reset-password': [
    'Set or reset your PBK password',
    'Set your PBK password',
    'Return to the PBK tab where you chose Forgot password. Enter this recovery code, then choose and confirm your new password. Use only the newest email; requesting another code replaces the earlier one.',
    null,
    'code',
  ],
  reauthentication: [
    'Verify your PBK account',
    'Verify it is you',
    'Enter this code in PBK to confirm a sensitive account action. Do not send it to another person.',
    null,
    'code',
  ],
  'password-changed': [
    'Your PBK password was changed',
    'Your password was changed',
    'The password for your PBK account was changed. If this was not you, contact PBK through your usual trusted contact and secure your email account.',
    null,
    'notice',
  ],
  'email-address-changed': [
    'Your PBK email address was changed',
    'Your email address was changed',
    'The email address for your PBK account was changed. If this was not you, contact PBK through your usual trusted contact.',
    null,
    'notice',
  ],
  'phone-number-changed': [
    'Your PBK phone number was changed',
    'Your phone number was changed',
    'The phone number for your PBK account was changed. If this was not you, contact PBK through your usual trusted contact.',
    null,
    'notice',
  ],
  'sign-in-method-linked': [
    'A sign-in method was added to PBK',
    'A sign-in method was added',
    'A sign-in method was linked to your PBK account. If you did not authorize this, contact PBK through your usual trusted contact.',
    null,
    'notice',
  ],
  'sign-in-method-removed': [
    'A sign-in method was removed from PBK',
    'A sign-in method was removed',
    'A sign-in method was unlinked from your PBK account. If you did not authorize this, contact PBK through your usual trusted contact.',
    null,
    'notice',
  ],
  'mfa-method-added': [
    'A verification method was added to PBK',
    'A verification method was added',
    'A multi-factor verification method was added to your PBK account. If you did not authorize this, contact PBK through your usual trusted contact.',
    null,
    'notice',
  ],
  'mfa-method-removed': [
    'A verification method was removed from PBK',
    'A verification method was removed',
    'A multi-factor verification method was removed from your PBK account. If you did not authorize this, contact PBK through your usual trusted contact.',
    null,
    'notice',
  ],
};

export function authEmailTemplate(kind) {
  const copy = authEmailCopy[kind];
  if (!copy) throw new Error('Unknown authentication email template.');
  const [subject, title, body, cta, mode] = copy;
  let action =
    mode === 'code'
      ? '<p style="font-size:14px;margin-bottom:8px">Your one-time code</p><p style="font-size:30px;font-weight:bold;line-height:1.5;margin-top:0">{{ .Token }}</p>'
      : mode === 'notice'
        ? ''
        : `<p style="margin:28px 0"><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:16px 24px;background:#102f42;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;line-height:20px">${cta}</a></p><p style="font-size:13px;line-height:1.6">If the button does not open, copy this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:#176c9e;word-break:break-all">{{ .ConfirmationURL }}</a></p>`;
  if (kind === 'magic-link-or-otp')
    action +=
      '<p style="font-size:14px">Or enter this one-time code on the PBK sign-in page:</p><p style="font-family:monospace;font-size:30px;font-weight:bold">{{ .Token }}</p>';
  const security =
    mode === 'notice'
      ? 'PBK will never ask you to send your password or verification code by email.'
      : 'Never share this code or link, or your password. If you did not request this email, you can ignore it.';
  return {
    subject: 'PBK | ' + subject.replace(/ PBK/g, '').replace(/ to$/, ''),
    html: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta charset="utf-8"><title>${subject}</title></head><body style="margin:0;background:#f4f8fb;color:#102f42;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-top:4px solid #3299da"><tr><td style="padding:24px"><p style="font-size:24px;font-weight:bold;margin:0">PBK</p><p style="font-size:13px;margin:6px 0 28px">Probono Key Realty &middot; Account Security</p><h1 style="font-family:Georgia,serif;font-size:28px;line-height:1.25">${title}</h1><p style="font-size:16px;line-height:1.6">${body}</p>${action}<p style="font-size:13px;line-height:1.6;color:#526673">${security}</p><hr style="border:0;border-top:1px solid #dce6ed;margin:28px 0"><p style="font-size:12px;line-height:1.6;color:#526673">PBK &middot; Probono Key Realty<br>This is an automated account-security email, not a property offer. Existing account permissions still apply.</p></td></tr></table></td></tr></table></body></html>`,
  };
}
