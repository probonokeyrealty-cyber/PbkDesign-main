# Rex public-market worker: staging operations

The service `pbk-composio-staging` (`srv-dbvk7tv40ujc73e0d8gg`) is the only
hosted service that can execute this worker. It also requires the dedicated
staging database and staging Exa user. Its search adapter validates the
configured account, current session and pinned tool schema before running
one public search. It never falls back to a different provider on failure.

## Qualification

- Run `npm run test:public-market-worker`, `npm run test:bridge`,
  `npm run test:render-docker-imports`, and the staging build before activation.
- Publish only the staging commit and verify the exact SHA after manual
  deployment. Do not enable automatic deploys or change any production service.
- Set `PBK_E2B_MARKET_FAST_PATH_PERCENT=10` on that service only. The ordinary
  path still selects the batched upload by stable UUID hash. Missing, invalid,
  or out-of-range percentages leave the standard path in use.

## One approved test per arm

Use the existing direct protected administrator authentication. A team or
Netlify proxy session cannot prepare a benchmark task or approve execution.
Never share the server credential with the operator UI or include it in logs.
GET `/api/admin/public-market/benchmark` checks configuration locally without
making provider requests. Require a configured search and worker, with 10% set.

1. POST `/api/admin/public-market/benchmark` with `market` set to `Tampa, FL`
   and `benchmarkArm` set to `standard`. This selects a matching UUID before
   saving one sealed approval request. No provider runs during preparation.
2. Approve the exact returned task via PUT `/api/admin/tasks/:id` and body
   `{"status":"approved"}`. Do not replay an uncertain approval. Read the job
   at `/api/browser-research/jobs/:id` to determine what happened.
3. Require `status: complete`, `cleanupConfirmed: true` and the expected arm.
   Independently check that E2B has no running or paused sandbox with that job's
   metadata. Stop if evidence or cleanup is uncertain.
4. Wait at least five minutes from the first start before approving the exact
   second job. Repeat with `benchmarkArm: batched` and the same public market.
5. Compare search, provisioning, upload, execute, cleanup, and total time from
   each saved `executionMetrics` receipt. Compare two uploads vs. one, and do
   not infer a p95 or a reliable speedup from one pair.

To return to standard only, set the staging percentage to `0` and redeploy
the same commit. To disable the worker rather than just batching, set
`PBK_E2B_MARKET_WORKER_ENABLED=false`. Preserve the permanent claims and saved
receipts; do not delete them to bypass the admission interval.
