import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyDocuSignConnectSignature({
  headers = {},
  rawBody = Buffer.alloc(0),
  secret = '',
  requireSignature = true,
} = {}) {
  const normalizedSecret = String(secret || '').trim();
  if (!normalizedSecret) {
    return requireSignature
      ? {
          ok: false,
          status: 503,
          error: 'DocuSign Connect webhook signing is not configured.',
        }
      : {
          ok: true,
          skipped: true,
          reason: 'Local development without PBK_DOCUSIGN_CONNECT_HMAC_SECRET.',
        };
  }

  const signatures = Object.entries(headers || {})
    .filter(([name]) => /^x-docusign-signature-\d+$/i.test(String(name)))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (!signatures.length) {
    return {
      ok: false,
      status: 401,
      error: 'DocuSign Connect signature header is missing.',
    };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expected = createHmac('sha256', normalizedSecret).update(body).digest();
  const verified = signatures.some((signature) => {
    try {
      const provided = Buffer.from(signature, 'base64');
      return provided.length === expected.length && timingSafeEqual(provided, expected);
    } catch {
      return false;
    }
  });

  return verified
    ? { ok: true, skipped: false }
    : {
        ok: false,
        status: 401,
        error: 'DocuSign Connect signature verification failed.',
      };
}
