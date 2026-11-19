import { describe, expect, test } from "bun:test";

import { securityHeaders } from "./security-headers";

describe("security headers", () => {
  test("clickjacking: frame-ancestors none plus X-Frame-Options DENY", () => {
    expect(securityHeaders["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(securityHeaders["X-Frame-Options"]).toBe("DENY");
  });

  test("XSS: scripts locked to self (no foreign origins), plugins and base hijack off", () => {
    const csp = securityHeaders["Content-Security-Policy"];
    const directive = (name: string) => csp.split("; ").find((d) => d.startsWith(name)) ?? "";
    expect(directive("default-src")).toBe("default-src 'self'");
    expect(directive("script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
  });

  test("referrer: origins only cross-origin, never full URLs", () => {
    expect(securityHeaders["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("images: self and the blob storage host (member photos), nothing else", () => {
    const csp = securityHeaders["Content-Security-Policy"];
    expect(csp).toContain("img-src 'self' data: https://*.blob.vercel-storage.com");
  });

  test("companion hardening: nosniff, permissions locked, connect-src self (SSE stays same-origin)", () => {
    expect(securityHeaders["X-Content-Type-Options"]).toBe("nosniff");
    expect(securityHeaders["Permissions-Policy"]).toContain("camera=()");
    expect(securityHeaders["Content-Security-Policy"]).toContain("connect-src 'self'");
  });
});
