# Local Bridge Smoke Safety

Run `npm run test:bridge` for isolation regressions followed by the existing bridge assertions, or `npm run test:bridge-isolation` for the guard tests alone.

The smoke runtime requires Node 22.15 or newer with synchronous module hooks and the permission model. Unsupported runtimes fail closed; there is no unguarded fallback.

## Boundaries
- Fresh, randomly named OS-temporary state and home directories for every run. No `--reset`, inherited provider/database credentials, working runtime env file, fixed port or reused bridge key.
- Node filesystem write permission only for the allocated temporary root. Workers, native addons, SQLite, subprocesses and filesystem links are disabled.
- Windows user-environment hydration is replaced with an empty fixture before application imports.
- Outbound fetch, HTTP(S), HTTP2, TCP/TLS, WebSocket transport, DNS (including Resolver instances) and UDP are blocked before any provider connection.
- Test requests use only the child-owned loopback origin after its nonce-bearing IPC readiness event. Redirects fail. Exit, expiry and stop invalidate authority and abort outstanding requests, including if another listener reuses that port.
- Normal completion, test failure and handled interrupts await child termination before deleting the exact allocated root. Parent loss also has a child-side watchdog. An uncatchable process-tree kill or machine shutdown can leave disposable temporary files; it cannot grant access to working state or providers.

The PDF renderer is an explicitly labelled offline synthetic fixture. The smoke suite still checks real bridge routing, authorization, response headers and the PDF transport signature, but it does not certify Chromium rendering or real provider delivery. Those need separately approved integration tests.

Isolation tests use only synthetic records, an outside-root disposable sentinel, and loopback HTTP/UDP canaries. They verify blocked writes, zero canary traffic, environment poisoning, startup failure, port collisions, expiry, request cancellation and interrupts. The suite must never require real credentials.

These controls protect this trusted test runner from accidental ambient configuration and provider access. They are not an OS sandbox for arbitrary malicious code.
