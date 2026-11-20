# Ava Streamed Voice

Approved scope: connect Ava Chat's streamed replies to the existing voice service, add an opt-in speaker control, and make Stop cancel text and speech. Text-only remains the default. The user explicitly approved implementation and deployment.

## Approach

Use the existing authenticated PBK TTS route and existing voice/model configuration. The React shell is a separate entry point from the legacy desktop voice panel, so add a small playback adapter to Ava Chat rather than creating a service, changing providers, or embedding the legacy panel. Waiting for the complete answer fails the requested latency behavior; browser-only synthesis would replace Ava's configured voice.

## Behavior

- Feed only safe displayed answer prefixes to a sentence queue, never reasoning or metadata.
- Start speech on a completed sentence while text is still arriving. Bound individual synthesis requests, not total explanation length.
- Keep playing until the full final answer's remaining text has finished, even after model generation has ended.
- Keep text completion/history independent of audio availability. Surface a plain-language voice error and retain text if playback fails.
- Stop, mute, a new request, microphone capture, and unmount cancel pending synthesis and playback. A changed final answer stops provisional speech instead of speaking stale queued text.
- Preserve PBK styling, approval gates, completed-only follow-up context, staff protection, and secret handling.

## Verification

Test sentence boundaries, long tails, monotonic prefixes, rewrites, network errors, cancellation during synthesis and playback, stale completion events, disabled mode, and cleanup. Verify Chrome speech begins before text completion and reaches the final sentence; check a 390px viewport and the production release.
