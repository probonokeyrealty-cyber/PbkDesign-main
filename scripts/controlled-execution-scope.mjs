import { AsyncLocalStorage } from 'node:async_hooks';
import { astMapper, parse, toSql } from 'pgsql-ast-parser';

export const controlledExecution = new AsyncLocalStorage();
const allowedTools = new Set(['runAgentCommand', 'retrieveClosingIntelligence', 'pbk_retrieve_closing_intelligence', 'getBrainState', 'getProsodyAdvice', 'consultNurtureAgent', 'evaluateStoppingAgent', 'getAvaConversationIntelligence', 'pbk_ava_conversation_intelligence']);
const allowedFunctions = new Set(['now', 'coalesce', 'nullif', 'greatest', 'least', 'count', 'max', 'min', 'sum', 'avg', 'lower', 'upper', 'trim', 'btrim', 'length', 'left', 'right', 'substring', 'replace', 'concat', 'concat_ws', 'round', 'abs', 'jsonb_build_object', 'jsonb_build_array', 'jsonb_array_elements', 'jsonb_array_elements_text', 'jsonb_agg', 'jsonb_set', 'array_agg', 'unnest', 'to_char', 'to_jsonb', 'gen_random_uuid', 'to_tsvector', 'plainto_tsquery', 'ts_rank', 'similarity']);
const allowedTypes = new Set(['text', 'varchar', 'character varying', 'integer', 'int', 'int4', 'int8', 'bigint', 'smallint', 'numeric', 'decimal', 'float', 'float4', 'float8', 'double precision', 'real', 'boolean', 'bool', 'json', 'jsonb', 'uuid', 'timestamp', 'timestamptz', 'timestamp with time zone', 'timestamp without time zone', 'date', 'interval']);

export function assertControlledToolAllowed(name) {
  if (controlledExecution.getStore() && !allowedTools.has(name)) throw new Error(`controlled_tool_blocked:${name}`);
}

export function createScopedState(organicState) {
  const current = () => controlledExecution.getStore()?.state || organicState;
  return new Proxy({}, {
    get: (_, key) => Reflect.get(current(), key),
    set: (_, key, value) => Reflect.set(current(), key, value),
    deleteProperty: (_, key) => Reflect.deleteProperty(current(), key),
    has: (_, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(current(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export function remapControlledSql(sql, schema, tables) {
  if (!/^pbk_q_[a-f0-9]+$/.test(schema)) throw new Error('controlled_schema_invalid');
  const statements = parse(sql);
  if (!statements.length || statements.some(x => !['select', 'insert', 'update', 'delete', 'with', 'with recursive'].includes(x.type))) throw new Error('controlled_sql_statement_blocked');
  const mapper = astMapper(map => ({
    cast(cast) {
      const to = map.dataType(cast.to);
      return { ...map.super().cast(cast), to };
    },
    ref(ref) {
      if (!ref.table?.schema) return ref;
      if (!['public', schema].includes(ref.table.schema) || !tables.has(ref.table.name)) throw new Error('controlled_sql_reference_blocked');
      return { ...ref, table: { ...ref.table, schema } };
    },
    dataType(type) {
      if (type.kind === 'array') return { ...type, arrayOf: map.dataType(type.arrayOf) };
      if (type.schema || !allowedTypes.has(String(type.name).toLowerCase())) throw new Error('controlled_sql_type_blocked');
      return type;
    },
    tableRef(ref) {
      if ((ref.schema && !['public', schema].includes(ref.schema)) || !tables.has(ref.name)) throw new Error('controlled_sql_table_blocked');
      return { ...ref, schema };
    },
    call(call) {
      if (call.function.schema || !allowedFunctions.has(call.function.name.toLowerCase())) throw new Error('controlled_sql_function_blocked');
      return map.super().call(call);
    },
    statement(statement) {
      if (!['select', 'insert', 'update', 'delete', 'with', 'with recursive'].includes(statement.type)) throw new Error('controlled_sql_statement_blocked');
      return map.super().statement(statement);
    },
  }));
  return statements.map(statement => toSql.statement(mapper.statement(statement))).join(';');
}

export function createControlledPool(pool, scope) {
  const pending = new Set();
  const query = (sql, values) => {
    if (typeof sql !== 'string') return Promise.reject(new Error('controlled_sql_config_blocked'));
    let mapped;
    try { mapped = remapControlledSql(sql, scope.schema, scope.tables); }
    catch (error) { scope.blockedSql++; return Promise.reject(error); }
    const operation = pool.query(mapped, values);
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };
  return {
    query,
    controlled: true,
    async drain() { while (pending.size) await Promise.allSettled([...pending]); },
    async connect() { return { query, release() {} }; },
  };
}
