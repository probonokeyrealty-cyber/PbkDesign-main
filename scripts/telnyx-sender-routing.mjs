import { normalizeConversationPhone } from './conversation-identity.mjs';

export function getTelnyxSmsDefault(configuredSmsNumber, voiceNumber) {
  const configured = String(configuredSmsNumber || '').trim();
  return configured ? normalizeConversationPhone(configured) : voiceNumber;
}

export function isTelnyxSmsSenderHeld(sender, configuredHold) {
  const number = normalizeConversationPhone(sender);
  return Boolean(number) && String(configuredHold || '').split(',').some(
    (entry) => normalizeConversationPhone(entry) === number,
  );
}
