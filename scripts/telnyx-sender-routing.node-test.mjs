import assert from 'node:assert/strict';
import test from 'node:test';
import { getTelnyxSmsDefault, isTelnyxSmsSenderHeld } from './telnyx-sender-routing.mjs';

const voiceNumber = '+12025550101';
const smsNumber = '+12025550102';

test('an explicit SMS default takes precedence over the voice default', () => {
  assert.equal(getTelnyxSmsDefault('(202) 555-0102', voiceNumber), smsNumber);
  assert.equal(getTelnyxSmsDefault('', voiceNumber), voiceNumber);
  assert.equal(getTelnyxSmsDefault('invalid', voiceNumber), '');
});

test('the hold blocks a held sender regardless of formatting, without blocking other lines', () => {
  const hold = '202-555-0101, +12025550103';
  assert.equal(isTelnyxSmsSenderHeld(voiceNumber, hold), true);
  assert.equal(isTelnyxSmsSenderHeld(smsNumber, hold), false);
  assert.equal(isTelnyxSmsSenderHeld(voiceNumber, ''), false);
});
