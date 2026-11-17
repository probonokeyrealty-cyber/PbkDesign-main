# Hosted Founder Smoke isolation

Despite its historical name, this workflow is now an **isolated, sample-only**
check. It does not test, reset, sign in to, or send requests to production.
No Netlify protection settings are read or changed.

## Local Commands

Use Node 22.15+ (the CI job uses Node 22) and installed dependencies:

```sh
npm run test:hosted-isolation
npm run test:hosted
npm run build
npx playwright install chromium webkit
npm run test:hosted-browser
```

The browser command requires the current build in `dist`. CI installs the browser
system dependencies as well. Installing packages/browsers may access their
registries; application and provider requests are not forwarded.

## Boundaries

- The hosted CLI delegates to the existing isolated bridge suite. It starts its
  own bridge on a random loopback port, using a disposable OS temporary directory
  and synthetic authority. Working ports, state directories, provider keys,
  database URLs, proxies and hosted targets are not inherited by that child.
- The bridge guard denies outbound networking, subprocesses, workers, native
  add-ons and writes outside that temporary directory. PDF rendering uses the
  existing offline fixture. Startup, shutdown, cancellation and orphan cleanup
  remain owned by the shared isolation harness.
- The exported bridge smoke rejects overlapping invocations before starting
  another child. Its ownership guard is released after shutdown or failed startup.
- The browser proof launches new temporary Chromium/WebKit profiles with an empty
  environment. It never attaches to an operator browser or reads its storage.
  It serves built assets directly from disk at a virtual loopback origin; there
  is no preview server or proxy. Every request is fulfilled from a sample fixture
  or blocked. Missing assets, unknown reads and unexpected writes fail the proof.
  API reads use an explicit route/sample-ID fixture map; unmatched endpoints do
  not receive generic empty-success responses.
- Browser service workers and WebSockets are blocked. Chromium also uses offline
  mode. WebKit cannot navigate fulfilled documents in Playwright offline mode, so
  it relies on the same non-forwarding catch-all router and self-only CSP. Remote
  font/preconnect links are removed from the test shell, not from product files.
- POST fixtures are limited to a synthetic stream-session refusal and a sender
  recommendation for the two sample threads. Recommendations always select no
  sender; the inventory contains a disabled sample identity. All business
  mutations, including messages and sender inventory sync, return 403. Deliberate
  write and unknown-read canaries must return 403 and 404 respectively.
- CLI target/profile arguments are rejected. Legacy `PBK_HOSTED_*` targets,
  credentials and mutation flags cannot opt out of isolation. The workflow has
  no application secrets, and checkout does not persist Git credentials.

## Coverage And Limits

The real bridge suite still exercises authentication, approval gates, replay
protection, synthetic leads and contract/PDF routes against disposable state.
Canaries check that inherited working-state/provider settings are unused and
that a working-state sentinel remains byte-for-byte unchanged.

The built UI renders Ava Chat, Leads, Conversations, Analyzer, Campaigns and
Skill Studio with synthetic records at 1440px desktop and 390px Chromium/WebKit
mobile widths. The proof checks visible route content, uncaught exceptions,
horizontal overflow, required assets and blocked writes/external requests.

Reports explicitly use `verificationMode: isolated_offline` and
`providerDeliveryVerified: false`; the browser also reports
`productionVerified: false`. Passing does **not** prove production sign-in,
Netlify access control, hosted database health, provider delivery or real PDF
layout. Live checks require a separate, explicitly approved read-only procedure.
The older `mobile-browser-proof.mjs` is not part of this workflow.
