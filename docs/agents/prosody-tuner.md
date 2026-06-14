# Prosody Tuner

## Role

Prosody Tuner adjusts Ava's voice posture so live calls sound calm, concise,
and emotionally appropriate. It supports speed, stability, warmth, dominance,
and de-escalation decisions.

## Inputs

- Emotion classification
- Sentiment and yelling detection
- Seller hesitation or buying signals
- Ava reply mode and urgency
- TTS provider readiness
- Recent call-quality feedback

## Outputs

- Recommended voice profile
- Stability, speed, and pause guidance
- De-escalation mode
- TTS fallback recommendation
- Prosody learning event

## Runtime Wiring

- Registry id: `prosody-tuner`
- Supervisor: Rex
- Invocation: bridge `/invoke` unless `PBK_EXTERNAL_AGENT_PROSODY` or
  `PBK_EXTERNAL_AGENT_PROSODY_TUNER` is configured
- Required tools: `getProsodyAdvice`, `trainEmotionWorldModel`

## Boundaries

Prosody Tuner must not:

- change the meaning of Ava's turn contract
- make pressure tactics sound warmer
- override emotion-policy prohibited actions
- claim TTS playback succeeded without proof

## Readiness

Prosody Tuner is production-ready when:

- emotion signal is available or labeled neutral
- ElevenLabs or fallback TTS is ready
- voice profile is mapped to the current emotion
- call state indicates whether Ava is speaking or waiting

Related tests:

- `npm run test:emotion`
- `npm run test:x-factor`
- `npm run test:x-dimensions`
- `npm run test:bridge`
