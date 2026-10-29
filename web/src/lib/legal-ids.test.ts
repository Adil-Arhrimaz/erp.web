import { describe, expect, it } from "vitest";

import { isAcceptableBarcode, isValidEan13, isValidIce, normalizeIce } from "./legal-ids";

describe("ICE", () => {
  it("accepts exactly 15 digits", () => {
    expect(isValidIce("001234567000089")).toBe(true);
    expect(isValidIce("00123456700008")).toBe(false);
    expect(isValidIce("0012345670000890")).toBe(false);
    expect(isValidIce("00123456700008A")).toBe(false);
  });

  it("ignores spaces and dots typed from paper", () => {
    expect(normalizeIce("001 234 567 000 089")).toBe("001234567000089");
    expect(isValidIce("001.234.567.000.089")).toBe(true);
  });
});

describe("EAN-13", () => {
  it("checks the check digit", () => {
    expect(isValidEan13("6111000000014")).toBe(true);
    expect(isValidEan13("6111000000017")).toBe(false);
    expect(isValidEan13("3401560000000".slice(0, 12) + "1")).toBe(false);
  });

  it("accepts non-EAN internal codes", () => {
    expect(isAcceptableBarcode("INT-42")).toBe(true);
    expect(isAcceptableBarcode("6111000000017")).toBe(false);
    expect(isAcceptableBarcode("  ")).toBe(false);
  });
});
