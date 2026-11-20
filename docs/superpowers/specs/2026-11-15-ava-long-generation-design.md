# Ava Long Generation

The user explicitly requested fixing the remaining 30-second/4,096-token cutoffs so detailed chat replies and speech can finish. Keep the existing chat, voice service, completed-only context, staff authentication, and approval pipeline.

## Approach

Increasing only the model limits leaves Netlify's 60-second execution ceiling and the client's 45-second abort in place. A resumable background job would add a second delivery lifecycle and durable job machinery. Instead, use the already-supported authenticated Render chat route directly for Netlify chat streams, with the existing team-session header and existing direct-team permission checks. All other operations retain their existing routing. Never replay a POST after transport failure or expose the bridge master key.

Engineering choices: chat generation gets 32,768 output tokens and a ten-minute shared retry deadline; other provider/phone calls retain their limits. Provider streams use a 90-second inactivity watchdog within that deadline. The browser allows eleven minutes for transport and final persistence. These are generous operational safeguards, not an unlimited-token promise. Provider length/content filtering remains an explicit incomplete response, never completed history.

Increase complete assistant-reply preservation from 64,000 to 256,000 characters, and give provider JSON parsing enough bounded headroom. Keep user-input and other lanes unchanged. No changes to voice chunking or playback duration: speech already runs independently until its queue finishes or the operator stops it.

Primary references checked: [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) supports output above 4,096 tokens; [Netlify Functions](https://docs.netlify.com/build/functions/api/) documents a 60-second streaming ceiling; [Render request duration](https://render.com/docs/render-vs-vercel-comparison) supports long-lived responses within this chat budget.

Review ruling: both proxy and direct Render chat use one shared chat-intent permission classifier. This preserves the existing SMS, email, call, and provider-approval restrictions before a model or workflow runs. Canonical PBK staff origins and recognized HTTPS Netlify deployment hostnames derived from explicitly trusted sites can send the existing team-session header; unrelated Netlify sites, lookalikes, nonstandard ports, and HTTP previews remain excluded. No wildcard Netlify origin or credentialed-cookie CORS was added.

Live-test ruling: the model sometimes claimed an unsupported shorter channel limit. The chat contract now receives the actual output budget and instructs Ava to honor requested depth within it, without inventing a smaller cap or asking for a redundant "begin". This does not authorize actions, bypass a safety rewrite, or require unnecessary verbosity. Browser playback verification was handed back to the user at their request after active speech was observed.

Guard ruling: a 72-second live reply reached the final controller but was paused for `signature_before_authority`. Unit reproduction confirmed ordinary descriptive wording such as "is a sign of attention" was classified as signing. Preserve the original signature pattern, and distinguish only a bounded copular noun phrase with a lowercase article and a known communication-cue noun or finite explanatory clause from an imperative. Unknown/ambiguous uses remain conservative. Real signing, signing-of, sign-off, DocuSign, mixed-clause actions, and option-letter review counterexamples remain blocked; provider approval rules are unchanged.

## Acceptance

- Requests above 4,096 output tokens and 30/45/60 seconds can complete through the staff chat stream.
- No new credentials, access grants, provider writes, routes, or visual redesign.
- Stop cancels an in-flight long response and queued/active speech; failed/cancelled text does not become completed context.
- Complete text and its final tail survive parsing, sanitizing, rendering, and follow-up history.
- Stalled or incomplete provider streams fail explicitly without automatic action replay.
- Targeted regressions, release gates, and authenticated Chrome checks verify the behavior before reporting completion.
