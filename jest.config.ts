export default {
  globals: {
    extensionsToTreatAsEsm: ['.ts', '.js'],
    'ts-jest': {
      // without this, you git really frustrating errors.
      useESM: true,
    },
  },

  // this preset is absurdly important and (for me) was really a PITA to discover!
  preset: 'ts-jest/presets/js-with-ts-esm',

  // also important to not have anything in here
  transformIgnorePatterns: [],
  testPathIgnorePatterns: ['/node_modules/', 'lib'],

  silent: true,
  verbose: true,
  bail: true,
  testTimeout: 1000,

  // Coverage configuration
  collectCoverage: true,
  coverageReporters: ['json', 'text', 'lcov', 'clover'],
  collectCoverageFrom: ['./src/s3odm.ts'],
  coverageThreshold: {
    global: {
      statements: 0,
      functions: 0,
      lines: 0,
      branches: 0,
    },
  },
};
