import { describe, expect, it } from "vitest";

import { discountedRate, documentTotals, formatMoney, margin, splitTtc, toCents } from "./money";

// Intl uses narrow no-break spaces as French group separators.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("splitTtc", () => {
  it("matches the spec example: 189.00 DH TTC at 20%", () => {
    expect(splitTtc(18900, 20)).toEqual({ ttc: 18900, ht: 15750, vat: 3150 });
  });

  it("rounds per line to the centime like ERPNext (85.00 at 20%)", () => {
    expect(splitTtc(8500, 20)).toEqual({ ttc: 8500, ht: 7083, vat: 1417 });
  });

  it("handles 10% and exempt", () => {
    expect(splitTtc(11000, 10)).toEqual({ ttc: 11000, ht: 10000, vat: 1000 });
    expect(splitTtc(5000, 0)).toEqual({ ttc: 5000, ht: 5000, vat: 0 });
  });

  it("mirrors a sale exactly for a return", () => {
    expect(splitTtc(-8500, 20)).toEqual({ ttc: -8500, ht: -7083, vat: -1417 });
  });
});

describe("toCents", () => {
  it("absorbs float noise", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(159.5)).toBe(15950);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});

describe("documentTotals", () => {
  // Same lines as the invoice checked against ERPNext 16.52.1: 752.50 TTC, 627.08 HT, 125.42 VAT.
  it("matches ERPNext on a mixed basket", () => {
    const totals = documentTotals([
      { unitTtc: 18900, qty: 1, vatRate: 20 },
      { unitTtc: 15950, qty: 3, vatRate: 20 },
      { unitTtc: 8500, qty: 1, vatRate: 20 },
    ]);
    expect(totals.ttc).toBe(75250);
    expect(totals.ht).toBe(62708);
    expect(totals.vat).toBe(12542);
    expect(totals.byRate).toEqual([{ vatRate: 20, ht: 62708, vat: 12542 }]);
    expect(totals.roundingDiff).toBe(0);
  });

  it("breaks VAT down by rate, highest first", () => {
    const totals = documentTotals([
      { unitTtc: 11000, qty: 1, vatRate: 10 },
      { unitTtc: 12000, qty: 1, vatRate: 20 },
    ]);
    expect(totals.byRate).toEqual([
      { vatRate: 20, ht: 10000, vat: 2000 },
      { vatRate: 10, ht: 10000, vat: 1000 },
    ]);
    expect(totals.ttc).toBe(totals.ht + totals.vat);
  });

  it("rounds the discounted unit rate first, as ERPNext records it", () => {
    // 99.00 − 7.5 % = 91.575 → 91.58 per unit; 3 units = 274.74 (not 274.73).
    expect(discountedRate(9900, 7.5)).toBe(9158);
    const totals = documentTotals([{ unitTtc: 9900, qty: 3, vatRate: 20, discountPercent: 7.5 }]);
    expect(totals.ttc).toBe(27474);
    expect(totals.lines[0].rate).toBe(9158);
  });

  it("puts exempt lines in their own VAT line with no VAT", () => {
    const totals = documentTotals([
      { unitTtc: 12000, qty: 1, vatRate: 20 },
      { unitTtc: 5000, qty: 1, vatRate: 0 },
    ]);
    expect(totals.byRate).toEqual([
      { vatRate: 20, ht: 10000, vat: 2000 },
      { vatRate: 0, ht: 5000, vat: 0 },
    ]);
  });
});

describe("margin", () => {
  it("matches the spec example: bought 120.00 TTC, sold 189.00 TTC at 20%", () => {
    const costHt = splitTtc(12000, 20).ht;
    expect(costHt).toBe(10000);
    const m = margin(18900, costHt, 20);
    expect(m.sellingHt).toBe(15750);
    expect(m.margin).toBe(5750);
    expect(m.marginRate).toBeCloseTo(0.365, 3);
    expect(m.markupRate).toBeCloseTo(0.575, 3);
  });
});

describe("formatMoney", () => {
  it("formats French and English as in the spec", () => {
    expect(plain(formatMoney(123450, "fr"))).toBe("1 234,50 DH");
    expect(formatMoney(123450, "en")).toBe("1,234.50 DH");
  });
});
