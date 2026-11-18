const { basename } = require('node:path');

// Emit before hooks run, including long in-memory database fixture setup.
module.exports = class UnitProgressReporter {
  onTestStart(test) {
    process.stderr.write(`[unit] START ${basename(test.path)}\n`);
  }

  onTestResult(test, result) {
    const seconds = ((result.perfStats?.runtime || 0) / 1000).toFixed(1);
    process.stderr.write(`[unit] END ${basename(test.path)}: ${result.numPassingTests} passed, ${result.numFailingTests} failed (${seconds}s)\n`);
  }
};
