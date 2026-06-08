# PBK Command Intent Router

PBK uses a deterministic fast lane for explicit, read-only runtime checks. It
does not run a second language model and it never handles seller work or
provider mutations.

## Fast routes

| Intent            | Real source                           |  Cache TTL |
| ----------------- | ------------------------------------- | ---------: |
| Bridge health     | Live bridge state snapshot            |  5 seconds |
| OpenClaw gateway  | HTTP and WebSocket gateway probes     |  5 seconds |
| Desktop sidecar   | Connected sidecar socket registry     |  5 seconds |
| Tooling readiness | Bridge tooling status builder         | 20 seconds |
| Provider quotas   | Live provider/runtime quota snapshot  | 15 seconds |
| Vector memory     | Postgres and pgvector capacity status | 20 seconds |

Every other command stays on the existing PBK routing path. Commands that
mention writes, deployment, restarts, sellers, leads, deals, contracts,
messages, or backfills are not eligible for the fast lane.

## Cache behavior

The current process keeps a short-lived in-memory copy. When the configured
Redis connection is already open, PBK also reads and writes the same result
through the shared Redis namespace. Redis remains optional and the router
fails open to the live status builder.

## Why PBK does not run Phi-3 on Render Starter

The official Ollama `phi3:mini` artifact is about 2.2 GB. Render documents
Starter compute at 512 MB RAM and 0.5 CPU. Adding that model would exceed the
service's memory budget before PBK's bridge, Chromium, Python property tooling,
and local embedding model are considered.

The deterministic lane is faster, cheaper, auditable, and exact for the small
set of status intents. Ava and Rex continue to use DeepSeek for conversational
reasoning and ambiguous requests.
