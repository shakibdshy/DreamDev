import { describe, expect, test } from "bun:test";

import { IDLE_LIMIT_MS, IDLE_WARNING_LEAD_MS, idlePhase, secondsLeft } from "./idle-logout";

const MIN = 60_000;

describe("idle logout phases", () => {
  test("active until the warning window opens at 13:30", () => {
    expect(idlePhase(0)).toBe("active");
    expect(idlePhase(10 * MIN)).toBe("active");
    expect(idlePhase(IDLE_LIMIT_MS - IDLE_WARNING_LEAD_MS - 1)).toBe("active");
  });

  test("warning for the last 90 seconds", () => {
    expect(idlePhase(IDLE_LIMIT_MS - IDLE_WARNING_LEAD_MS)).toBe("warning");
    expect(idlePhase(14 * MIN)).toBe("warning");
    expect(idlePhase(IDLE_LIMIT_MS - 1)).toBe("warning");
  });

  test("expired at 15 minutes", () => {
    expect(idlePhase(IDLE_LIMIT_MS)).toBe("expired");
    expect(idlePhase(IDLE_LIMIT_MS + 5 * MIN)).toBe("expired");
  });

  test("secondsLeft counts the warning down and floors at zero", () => {
    expect(secondsLeft(IDLE_LIMIT_MS - IDLE_WARNING_LEAD_MS)).toBe(90);
    expect(secondsLeft(IDLE_LIMIT_MS - 60_000)).toBe(60);
    expect(secondsLeft(IDLE_LIMIT_MS)).toBe(0);
    expect(secondsLeft(IDLE_LIMIT_MS + MIN)).toBe(0);
  });

  test("the limit is 15 minutes and the warning leads by 90 seconds", () => {
    expect(IDLE_LIMIT_MS).toBe(15 * MIN);
    expect(IDLE_WARNING_LEAD_MS).toBe(90_000);
  });
});
