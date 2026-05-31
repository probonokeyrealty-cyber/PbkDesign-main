export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/scripts/**/*.test.mjs'],
  modulePathIgnorePatterns: [
    '<rootDir>/.pbk-local/',
    '<rootDir>/.venv/',
    '<rootDir>/PBK_React_Preview_Code_20260423-015455/',
    '<rootDir>/node_modules/',
  ],
  transform: {},
};
