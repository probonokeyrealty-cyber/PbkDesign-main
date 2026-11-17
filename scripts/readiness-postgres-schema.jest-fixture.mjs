import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { expect } from '@jest/globals';
import pg from 'pg';
import { createReadinessFixtureQuery } from './readiness-timing-postgres-fixture.mjs';

// Installed only by the guarded qualification runner, never by runtime or ordinary Jest.
const schema = JSON.parse(process.env.PBK_QUALIFICATION_SCHEMA_MAP || '{}')[basename(expect.getState().testPath)];
assert.match(schema || '', /^pbk_proof_[a-f0-9]{32}$/);
assert.equal(process.env.PBK_TEST_DATABASE_URL, process.env.PBK_EVAL_DATABASE_URL);
assert(!process.env.PBK_DATABASE_URL && !process.env.DATABASE_URL);
pg.Client.prototype.query = createReadinessFixtureQuery(pg.Client.prototype.query, schema);
