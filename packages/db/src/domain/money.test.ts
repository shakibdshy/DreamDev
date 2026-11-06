import { describe, expect, test } from "bun:test";

import { formatTaka } from "./money";

describe("formatTaka", () => {
  test("formats whole taka with Bangladeshi grouping", () => {
    expect(formatTaka(5000)).toBe("৳5,000");
    expect(formatTaka(15000)).toBe("৳15,000");
    expect(formatTaka(150000)).toBe("৳1,50,000");
    expect(formatTaka(1200000)).toBe("৳12,00,000");
  });

  test("formats zero and negative amounts (Advance shown as negative)", () => {
    expect(formatTaka(0)).toBe("৳0");
    expect(formatTaka(-1500)).toBe("-৳1,500");
  });
});
