export default {
  testEnvironment: 'node',
  reporters: ['default', '<rootDir>/scripts/unit-progress-reporter.cjs'],
  // Keep the absolute worktree path out of the glob on Windows.
  roots: ['<rootDir>/scripts'],
  testMatch: ['**/*.test.mjs'],
  modulePathIgnorePatterns: [
    '<rootDir>/.pbk-local/',
    '<rootDir>/.venv/',
    '<rootDir>/PBK_React_Preview_Code_20260423-015455/',
    '<rootDir>/node_modules/',
  ],
  transform: {},
};
