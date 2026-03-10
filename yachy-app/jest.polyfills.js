/**
 * Polyfills/stubs for Jest - must run before jest-expo setup.
 * Prevents Expo Winter runtime from failing in Node test environment.
 * Pre-define structuredClone so expo winter's lazy getter is never triggered.
 */
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone =
    globalThis.structuredClone || (obj => JSON.parse(JSON.stringify(obj)));
}
if (typeof globalThis.__ExpoImportMetaRegistry === 'undefined') {
  globalThis.__ExpoImportMetaRegistry = {
    get url() {
      return 'file:///jest';
    },
  };
}
