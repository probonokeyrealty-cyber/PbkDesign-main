const STORAGE_PREFIX = 'pbk:ava-chat:';
const INVALID_SCOPE = Object.freeze({ valid: false });

function decodeFormPart(raw) {
  const decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  // Even an unescaped field can contain an unpaired UTF-16 surrogate.
  if (/[\uD800-\uDFFF]/u.test(decoded)) throw new URIError('Malformed form field');
  return decoded;
}

export function resolveAvaChatScope(rawSearch) {
  if (rawSearch.length > 4000 || (rawSearch !== '' && !rawSearch.startsWith('?'))) {
    return INVALID_SCOPE;
  }

  let leadId;
  try {
    for (const field of rawSearch.slice(1).split('&')) {
      const separator = field.indexOf('=');
      const name = decodeFormPart(separator === -1 ? field : field.slice(0, separator));
      if (name !== 'leadId' && name !== 'lead_id') continue;
      if (leadId !== undefined) return INVALID_SCOPE;

      leadId = decodeFormPart(separator === -1 ? '' : field.slice(separator + 1));
      if (!leadId || leadId.length > 256 || leadId.trim() !== leadId || /\p{Cc}/u.test(leadId)) {
        return INVALID_SCOPE;
      }
    }
  } catch {
    return INVALID_SCOPE;
  }

  const identity = leadId === undefined ? 'general' : `lead:${encodeURIComponent(leadId)}`;
  const prefix = leadId === undefined ? STORAGE_PREFIX : `${STORAGE_PREFIX}${identity}:`;
  return {
    valid: true,
    identity,
    leadId: leadId ?? '',
    storageKeys: {
      operatorMemory: `${prefix}operator-memory`,
      assistantSession: `${prefix}assistant-session`,
      assistantExchanges: `${prefix}assistant-exchanges`,
    },
  };
}
