import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildAssistantPrompt } from './ava-assistant-chat.mjs';
import { buildAvaDecisionMessages, isAvaCompactDecisionSafe } from './ava-decision-messages.mjs';
import { buildBenchmarkPlan, summarizeLatency } from './ava-latency-benchmark.mjs';

if (!process.argv.includes('--run')) throw new Error('Explicit --run required');
const key = process.env.PBK_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
if (!key) throw new Error('Configured provider credential required');
const source = readFileSync(new URL('./openclaw-local-server.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const context = vm.createContext({});
const start = source.indexOf('function buildInternalAssistantDeepSeekContext(');
const end = source.indexOf('\nfunction buildAvaDeepSeekDecisionTools', start);
vm.runInContext(source.slice(start, end), context);
const cases = buildBenchmarkPlan(24).filter(({ id }) => id === 'model_chat');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex < 0) throw new Error('--output required');
const samples = [];
for (const [index, scenario] of cases.entries()) {
  const prompt = buildAssistantPrompt({}, { extraContext: context.buildInternalAssistantDeepSeekContext({ source: 'ava-latency-diagnostic' }) });
  const request = {
    model: process.env.PBK_DEEPSEEK_LIVE_MODEL || 'deepseek-v4-flash',
    messages: buildAvaDecisionMessages(prompt, scenario.message),
    temperature: 0.45, max_tokens: 700, thinking: { type: 'disabled' }, response_format: { type: 'json_object' },
  };
  const started = performance.now();
  let sample;
  try {
    const response = await fetch(`${process.env.PBK_DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(8000),
    });
    const headersMs = performance.now() - started;
    const payload = await response.json();
    const elapsedMs = performance.now() - started;
    const choice = payload.choices?.[0];
    let decision;
    try { decision = JSON.parse(choice?.message?.content || ''); } catch {}
    const validContract = isAvaCompactDecisionSafe(choice?.message?.content || '');
    sample = { index, elapsedMs, headersMs, status: response.status, model: payload.model || '',
      finishReason: choice?.finish_reason || '', validContract,
      noToolProposal: decision?.toolIntent === null || !decision?.toolIntent?.name,
      needsApproval: decision?.needsApproval ?? null,
      replyWords: decision?.reply?.split(/\s+/).length || 0,
      promptTokens: payload.usage?.prompt_tokens ?? null, completionTokens: payload.usage?.completion_tokens ?? null,
      reasoningLength: choice?.message?.reasoning_content?.length || 0,
      withinProductionDeadline: elapsedMs < 1400, below2500: elapsedMs < 2500 };
  } catch (error) {
    sample = { index, elapsedMs: performance.now() - started, errorType: error.name, validContract: false };
  }
  samples.push(sample);
  console.log(JSON.stringify(sample));
}
const report = { diagnostic: true, organicReadinessEligible: false, nativeProviderOnly: true, productionDeadlineUnchangedMs: 1400,
  observationDeadlineMs: 8000, modelLatency: summarizeLatency(samples.map(({ elapsedMs }) => elapsedMs)), samples };
await writeFile(process.argv[outputIndex + 1], JSON.stringify(report, null, 2));
