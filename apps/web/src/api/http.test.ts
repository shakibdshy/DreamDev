import { describe, expect, test } from "bun:test";

import { assertSameOrigin, HttpError } from "./http";

const APP = "https://dream-dev-ashen.vercel.app";
const post = (headers: Record<string, string> = {}, url = `${APP}/api/members`) =>
  new Request(url, { method: "POST", headers });

describe("assertSameOrigin (CSRF guard)", () => {
  test("safe methods are never checked", () => {
    expect(() => assertSameOrigin(new Request(APP, { headers: { origin: "https://evil.example" } }))).not.toThrow();
  });

  test("same-origin POST passes", () => {
    expect(() => assertSameOrigin(post({ origin: APP }))).not.toThrow();
  });

  test("no Origin/Sec-Fetch-Site at all passes (curl, tests) — auth still gates", () => {
    expect(() => assertSameOrigin(post())).not.toThrow();
  });

  test("foreign Origin is refused 403", () => {
    try {
      assertSameOrigin(post({ origin: "https://evil.example" }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(403);
    }
  });

  test("Origin matching x-forwarded-host passes (proxy in front of the app)", () => {
    const request = new Request("http://internal:3000/api/members", {
      method: "POST",
      headers: { origin: APP, "x-forwarded-host": "dream-dev-ashen.vercel.app" },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  test("x-forwarded-host list takes the first hop", () => {
    const request = new Request("http://internal:3000/api/members", {
      method: "POST",
      headers: { origin: APP, "x-forwarded-host": "dream-dev-ashen.vercel.app, other.internal" },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  test("Sec-Fetch-Site cross-site is refused even without Origin", () => {
    try {
      assertSameOrigin(post({ "sec-fetch-site": "cross-site" }));
      expect.unreachable();
    } catch (error) {
      expect((error as HttpError).status).toBe(403);
    }
  });

  test("Sec-Fetch-Site same-origin passes", () => {
    expect(() => assertSameOrigin(post({ "sec-fetch-site": "same-origin" }))).not.toThrow();
  });
});
