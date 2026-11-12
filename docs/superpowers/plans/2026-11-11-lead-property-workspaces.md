# Lead Property Workspaces Implementation Plan

> **REQUIRED WORKFLOW:** Use superpowers:subagent-driven-development for implementation and independent review. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Claude property workspace and Create Lead concept locally.

**Architecture:** Share the existing read-only ATTOM comparison across the two surfaces. Keep the form and saved lead as independent sources of truth, and keep Zillow navigation in the property workspace without a media fetch.

**Tech Stack:** React, TypeScript, Vite, Radix Tabs, Playwright, PBK design tokens.

**Spec:** [Approved Claude Property Workspace Concept](https://claude.ai/chat/e1e4ff8b-4359-4793-9d1c-6e87cde43d4f?artifact=d2ea7f90-8907-4d4c-b36a-542bbb1fc789).

- [x] Add a failing browser regression for workspace comparison, Zillow link isolation, and draft preservation.
- [x] Update the property workspace, shared ATTOM preview, and Create Lead form styling without changing provider or save handlers.
- [x] Check desktop and mobile with isolated browser fixtures; run build, typecheck, and relevant lead/property tests. Do not deploy.
