import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});

const { window } = dom;

for (const key of Object.getOwnPropertyNames(window)) {
  if (key === "window" || key === "document" || key === "navigator") continue;
  // Bun's own globals (Event, Blob, TextEncoder, …) are deliberately kept:
  // the component tests below pass with them, and replacing the constructors
  // can break React 19's event dispatch with instanceof mismatches.
  if (key in globalThis) continue;
  const descriptor = Object.getOwnPropertyDescriptor(window, key);
  if (descriptor) Object.defineProperty(globalThis, key, descriptor);
}

Object.defineProperty(globalThis, "window", { value: window, configurable: true });
Object.defineProperty(globalThis, "document", { value: window.document, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

// Loaded after the DOM globals exist so Testing Library sees the jsdom globals.
const { afterEach, expect } = await import("bun:test");
const matchers = await import("@testing-library/jest-dom/matchers");
const { cleanup } = await import("@testing-library/react");

// jest-dom v8 ships CJS declarations; the namespace import carries an extra `default`.
expect.extend(matchers as unknown as Parameters<typeof expect.extend>[0]);
afterEach(cleanup);
