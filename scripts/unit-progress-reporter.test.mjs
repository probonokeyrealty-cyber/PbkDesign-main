import { createRequire } from 'node:module';
import { jest, test, expect } from '@jest/globals';
import config from '../jest.config.mjs';

const require = createRequire(import.meta.url);

test('unit progress is visible before fixture setup and reports completion without replacing default failures', () => {
  const Reporter = require('./unit-progress-reporter.cjs');
  expect(config.reporters).toEqual(['default', '<rootDir>/scripts/unit-progress-reporter.cjs']);
  const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    const reporter = new Reporter();
    const spec = { path: 'C:/sample/scripts/slow-fixture.test.mjs' };
    reporter.onTestStart(spec);
    expect(write).toHaveBeenLastCalledWith('[unit] START slow-fixture.test.mjs\n');
    reporter.onTestResult(spec, { numPassingTests: 5, numFailingTests: 1, perfStats: { runtime: 1234 } });
    expect(write).toHaveBeenLastCalledWith('[unit] END slow-fixture.test.mjs: 5 passed, 1 failed (1.2s)\n');
  } finally { write.mockRestore(); }
});
