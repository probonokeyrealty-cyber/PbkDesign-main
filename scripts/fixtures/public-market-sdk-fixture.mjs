import assert from 'node:assert/strict';
import { buildPublicMarketBrief } from './public-market-program.mjs';
export class Sandbox {
  static async create(template, options) {
    assert.equal(template, 'base');
    assert.equal(options.allowInternetAccess, false);
    assert.equal(options.timeoutMs, 60000);
    let payload;
    return {
      files: {
        write: async (path, value) => {
          if (path.endsWith('.json')) payload = JSON.parse(value);
        },
      },
      commands: {
        run: async () => ({ exitCode: 0, stdout: JSON.stringify(buildPublicMarketBrief(payload)) }),
      },
      kill: async () => true,
    };
  }
}
