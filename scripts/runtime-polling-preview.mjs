import { createCommandCenterPreview } from './fixtures/command-center-polish-preview.mjs';

// Local static build plus sample GET responses; all provider writes are rejected.
const { origin, server } = await createCommandCenterPreview();
console.log(origin);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
