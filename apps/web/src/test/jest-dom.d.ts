import type matchers = require("@testing-library/jest-dom/matchers");

declare module "bun:test" {
  interface Matchers<T = unknown> extends matchers.TestingLibraryMatchers<T, void> {}
  // `any` mirrors the unparameterized upstream jest-dom asymmetric matcher declarations.
  interface AsymmetricMatchers extends matchers.TestingLibraryMatchers<any, any> {}
}
