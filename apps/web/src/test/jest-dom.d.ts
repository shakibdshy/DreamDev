import type matchers = require("@testing-library/jest-dom/matchers");

declare module "bun:test" {
  interface Matchers<T = unknown> extends matchers.TestingLibraryMatchers<T, void> {}
  interface AsymmetricMatchers extends matchers.TestingLibraryMatchers<any, any> {}
}
