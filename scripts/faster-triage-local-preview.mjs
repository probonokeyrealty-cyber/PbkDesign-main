import { createTriagePreview } from './fixtures/faster-triage-fixture.mjs';

const { server, origin } = await createTriagePreview(Number(process.env.PBK_TRIAGE_PORT || 5198));
console.log(`Read-only fictional-data preview: ${origin}/command-center`);
console.log('All API writes are rejected; no real bridge or provider is connected.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
