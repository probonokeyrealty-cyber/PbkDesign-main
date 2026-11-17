import { AsyncLocalStorage } from 'node:async_hooks';
import { controlledExecution } from './controlled-execution-scope.mjs';

const storage = new AsyncLocalStorage();
const origins = new Set(['operator_chat', 'phone_turn', 'registered_business', 'runtime_circuit', 'diagnostic']);
const unknown = Object.freeze({ origin: 'unknown', classification: 'unknown' });
const controlled = Object.freeze({ origin: 'controlled', classification: 'controlled' });
const diagnostic = Object.freeze({ origin: 'diagnostic', classification: 'diagnostic' });

export function getRuntimeEvidenceContext() {
  return controlledExecution.getStore() !== undefined ? controlled : storage.getStore() || unknown;
}

// Only server entry points establish this context; source/projector/QA writers inherit it.
export function withRuntimeEvidenceContext(origin, operation) {
  const inherited = storage.getStore();
  const context = controlledExecution.getStore() !== undefined ? controlled
    : origin === 'diagnostic' && inherited?.classification === 'operational' ? diagnostic : inherited
    || (origins.has(origin) ? Object.freeze({ origin,
      classification: origin === 'diagnostic' ? 'diagnostic' : 'operational' }) : unknown);
  return storage.run(context, operation);
}
