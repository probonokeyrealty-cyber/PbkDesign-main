import type { Handler } from '@netlify/functions';

const BRIDGE_URL = String(
  process.env.PBK_BRIDGE_URL
    || process.env.PBK_PUBLIC_BRIDGE_URL
    || 'https://pbk-openclaw-bridge.onrender.com',
).replace(/\/+$/g, '');

const PUBLIC_AVA_CHAT_KEY = String(
  process.env.PUBLIC_AVA_CHAT_KEY
    || process.env.PBK_PUBLIC_AVA_CHAT_KEY
    || '',
).trim();

const corsHeaders = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Public-Ava-Key, X-Public-Key',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

function json(payload: unknown, statusCode = 200, headers: Record<string, string> = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      ...headers,
    },
    body: JSON.stringify(payload),
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  try {
    const response = await fetch(`${BRIDGE_URL}/api/public/ava-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PUBLIC_AVA_CHAT_KEY ? { 'X-Public-Ava-Key': PUBLIC_AVA_CHAT_KEY } : {}),
      },
      body: JSON.stringify({
        ...body,
        source: body.source || 'netlify-public-ava-chat',
      }),
    });

    const payload = await response.json().catch(() => ({
      ok: false,
      error: `Bridge returned ${response.status}`,
    }));

    return json(payload, response.status, {
      'X-PBK-Bridge': BRIDGE_URL,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        error: 'Ava public chat could not reach the PBK bridge.',
        message: error instanceof Error ? error.message : 'Unknown bridge error',
      },
      502,
    );
  }
};
