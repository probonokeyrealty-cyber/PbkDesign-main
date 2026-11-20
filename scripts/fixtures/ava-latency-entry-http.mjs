import { createServer } from 'node:http';
import { createLatencyEntryFixture } from '../ava-latency-entry-test-fixture.mjs';

const fixture = createLatencyEntryFixture({ secret: process.env.PBK_BRIDGE_API_KEY });
fixture.context.json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
};
createServer(async (request, response) => {
  try {
    if (request.url === '/health') {
      fixture.context.json(response, 200, { revision: fixture.revision, commit: fixture.revision });
    } else if (request.url === '/api/assistant/chat') {
      const result = await fixture.context.handleInternalAvaAssistantChatRequest(request);
      fixture.context.json(response, result.statusCode, result.body);
    } else {
      await fixture.context.route(request, response);
      if (!response.writableEnded) fixture.context.json(response, 404, { ok: false });
    }
  } catch {
    fixture.context.json(response, 500, { ok: false, result: 'isolated_entry_failed' });
  }
}).listen(Number(process.env.PBK_OPENCLAW_PORT), '127.0.0.1');
