module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/tests/setup.js"],
  testMatch: ["<rootDir>/tests/**/*.test.ts", "<rootDir>/tests/**/*.test.tsx"],
  testTimeout: 15000,
  moduleNameMapper: {
    "^react-native-gifted-charts$": "<rootDir>/tests/fake/gifted_charts_mock.js",
  },
};
