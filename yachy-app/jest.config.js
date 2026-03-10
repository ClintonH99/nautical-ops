/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?@?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg))',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    'react-native-worklets/plugin': '<rootDir>/__mocks__/react-native-worklets/plugin.js',
    '@ungap/structured-clone': '<rootDir>/__mocks__/ungap-structured-clone.js',
    '^expo/src/winter$': '<rootDir>/__mocks__/expo-winter.js',
  },
};
