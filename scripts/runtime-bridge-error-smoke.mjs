import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const runtimeBridge = readFileSync(resolve(root, 'src/app/utils/runtimeBridge.ts'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /function extractBridgeErrorMessage\(parsed:\s*unknown,\s*status:\s*number\)/.test(
    runtimeBridge
  ),
  'runtimeBridge must centralize bridge error extraction.'
);

for (const token of [
  'providerResult',
  'safetyValidation',
  'qaValidation',
  'eventPayload',
  'provider_delivery_unknown',
  'reconciliation_required',
  'Verify provider delivery before retrying',
]) {
  assert(runtimeBridge.includes(token), `Bridge error extraction must handle ${token}.`);
}

assert(
  /bridgeResponseError\(response, payload, requestUrl,/.test(runtimeBridge) &&
    /bridgeResponseError\(response, parsed, requestUrl,/.test(runtimeBridge) &&
    /extractBridgeErrorMessage\(parsed,\s*response\.status\)/.test(runtimeBridge),
  'Both blob and JSON requests must use the shared auth-aware error builder and bridge error extractor.'
);

assert(
  !/typeof parsed === 'object' && parsed && 'error' in/.test(runtimeBridge),
  'JSON bridge errors must not collapse structured non-error payloads into bare status codes.'
);

console.log('runtime-bridge-error-smoke: ok');
