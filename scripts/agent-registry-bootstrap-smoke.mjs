import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import {
  buildAgentRegistrySnapshot,
  buildDefaultAgentRegistry,
  mergeAgentRegistryRecords,
  normalizeAgentRegistryRecord,
} from './agent-registry.mjs';

// Extract only registry helpers: no bridge startup, environment loading, or hosted database.
const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8');
const ast = ts.createSourceFile('bridge.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration)
  .map((node) => [node.name.text, node.getText(ast)]));

test('boot preserves operator registry rows, fills missing defaults, and is repeatable', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE public.agent_registry (
      id text PRIMARY KEY, tenant_id text NOT NULL, name text NOT NULL,
      description text, capabilities text[], status text, endpoint text, version text,
      health_checked_at timestamptz, last_error text, metadata jsonb,
      created_at timestamptz DEFAULT now(), updated_at timestamptz
    );
    INSERT INTO public.agent_registry VALUES (
      'ava', 'pbk', 'Operator Ava', 'Operator description', ARRAY['operator-capability'],
      'paused', 'https://operator-override.invalid/invoke', 'operator-pinned-version',
      '2026-01-01T00:00:00Z', 'paused by operator', '{"local":false,"operatorOwned":true}',
      '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    );`);
    const defaults = buildDefaultAgentRegistry({ env: {}, now: Date.parse('2026-02-01T00:00:00Z') });
    let runtimeRegistry;
    const context = vm.createContext({
      console,
      getPgPool: () => db,
      buildDefaultAgentRegistry: () => defaults,
      mergeAgentRegistryRecords,
      normalizeAgentRegistryRecord,
      buildAgentRegistrySnapshot,
      normalizeTenantId: (tenant) => tenant,
      isoNow: () => '2026-02-01T00:00:00Z',
      applyAgentRegistryToRuntime: (registry) => { runtimeRegistry = registry; },
      agentRegistryLoadedAt: '2026-02-01T00:00:00Z',
      persistState: async () => { assert.fail('boot must not persist runtime state'); },
      state: {},
    });
    for (const name of ['upsertAgentRegistryRecordsToPg', 'readAgentRegistryFromPg', 'syncAgentRegistryFromPg']) {
      assert.ok(functions.has(name), `Missing bridge helper: ${name}`);
      vm.runInContext(functions.get(name), context);
    }
    const before = (await db.query("SELECT * FROM public.agent_registry WHERE id = 'ava'")).rows[0];
    const result = await context.syncAgentRegistryFromPg({ seed: true, persist: false });
    const rows = (await db.query('SELECT * FROM public.agent_registry ORDER BY id')).rows;
    assert.deepEqual(rows.find((row) => row.id === 'ava'), before, 'boot must not overwrite any stored operator fields');
    assert.deepEqual(rows.map((row) => row.id), defaults.map((agent) => agent.id).sort(), 'missing defaults must be inserted');
    for (const agent of defaults.filter((agent) => agent.id !== 'ava')) {
      const row = rows.find((entry) => entry.id === agent.id);
      for (const key of ['name', 'description', 'capabilities', 'status', 'endpoint', 'version', 'metadata']) {
        assert.deepEqual(row[key], agent[key], `missing default ${agent.id}.${key} must be populated`);
      }
    }
    for (const registry of [runtimeRegistry, result.registry.agents]) {
      const ava = registry.find((agent) => agent.id === 'ava');
      assert.equal(ava.status, 'paused');
      assert.equal(ava.endpoint, before.endpoint);
      assert.equal(ava.version, before.version);
      assert.equal(ava.metadata.operatorOwned, true);
    }
    assert.equal(result.source, 'postgres');
    assert.equal(result.persistence.ok, true);

    context.isoNow = () => '2026-03-01T00:00:00Z';
    await context.syncAgentRegistryFromPg();
    assert.deepEqual((await db.query('SELECT * FROM public.agent_registry ORDER BY id')).rows, rows,
      'repeated boot must leave every existing row, including timestamps, unchanged');

    await db.query("DELETE FROM public.agent_registry WHERE id = 'max'");
    await context.syncAgentRegistryFromPg({ seed: false });
    assert.equal((await db.query("SELECT * FROM public.agent_registry WHERE id = 'max'")).rows.length, 0,
      'recovery with seed:false must remain read-only');
  } finally {
    await db.close();
  }
});
