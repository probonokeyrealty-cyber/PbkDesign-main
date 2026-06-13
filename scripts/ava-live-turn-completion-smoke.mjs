import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');

assert.match(
  bridge,
  /TELNYX_BRIDGE_AVA_FINAL_ONLY_REPLY_DELAY_MS/,
  'Telnyx Ava live replies must delay final-only Deepgram chunks before speaking.'
);

assert.ok(
  bridge.includes('how\\s+much\\??$'),
  'Short seller utterances like "How much?" must classify as an offer request.'
);

assert.match(
  bridge,
  /const markTelnyxSellerTranscriptVersion = \(\) =>/,
  'Each seller transcript update must advance a turn version.'
);

assert.ok(
  bridge.includes('const scheduleTelnyxAvaReplyForTranscript = (item = {}) =>') &&
    bridge.includes('if (item.speechFinal)') &&
    bridge.includes('finalOnlyFallback: true') &&
    bridge.includes('TELNYX_BRIDGE_AVA_FINAL_ONLY_REPLY_DELAY_MS'),
  'Ava should speak immediately on speech_final and only delayed on final-only fallback chunks.'
);

assert.match(
  bridge,
  /if \(!session\.callId \|\| !\(item\.speechFinal \|\| item\.finalOnlyFallback\)\) return;/,
  'maybeSpeakTelnyxAvaReply must not answer ordinary transcript_final chunks directly.'
);

assert.match(
  bridge,
  /result: 'stale_seller_turn_superseded'/,
  'Ava must skip a generated reply when fresher seller speech arrives during reasoning.'
);

assert.match(
  bridge,
  /I have your target around \$\{sellerTarget\}, and I am not ignoring it\./,
  'Known seller target prices must dominate the offer-request reply instead of generic priority probes.'
);

assert.ok(
  bridge.includes('function rememberAvaLiveSellerMoney') &&
    bridge.includes('function isAvaLiveSellerMoneyContext') &&
    bridge.includes('rememberAvaLiveSellerMoney(session, transcript, supportTranscript);'),
  'Live calls must remember seller-stated target money without confusing plain street numbers for offers.'
);

assert.ok(
  bridge.includes('function isAvaLiveUrgentSalesIntent') &&
    bridge.includes("session.lastFastLocalReplyMode = 'fast_local_sales_intent'") &&
    bridge.indexOf('if (salesNextMove && isAvaLiveUrgentSalesIntent(sellerIntent))') <
      bridge.indexOf('if (governedSkillReply)'),
  'Urgent live seller facts must beat generic governed-skill phrasing before Ava speaks.'
);

assert.ok(
  bridge.includes('function getAvaSellerTurnFingerprint') &&
    bridge.includes('function hasRecentAvaSellerTurnFingerprint') &&
    bridge.includes('duplicate_seller_turn_revision') &&
    bridge.includes('rememberAvaSellerTurnFingerprint(session, item.transcript || transcriptForReply, session.lastAvaReplyAt)'),
  'Near-duplicate Deepgram seller turn revisions must not trigger repeated Ava answers.'
);

assert.ok(
  bridge.indexOf('applyAvaLiveTurnFacts(session, item.transcript || transcriptForReply);') <
    bridge.indexOf('duplicate_seller_turn_revision'),
  'Duplicate seller-turn skips must still update live call facts before skipping speech.'
);

console.log('ava-live-turn-completion smoke passed');
