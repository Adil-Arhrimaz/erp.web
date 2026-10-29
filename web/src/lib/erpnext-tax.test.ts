import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/erpnext_tax_fixture.json";
import { computeInvoiceTaxes, flt, pyRound } from "./erpnext-tax";

describe("pyRound (Python round)", () => {
  it("rounds the exact binary value, ties to even", () => {
    expect(pyRound(0.125, 2)).toBe(0.12); // exact tie
    expect(pyRound(0.375, 2)).toBe(0.38); // exact tie
    expect(pyRound(2.675, 2)).toBe(2.67); // 2.67499999… in binary
    expect(pyRound(-0.125, 2)).toBe(-0.12);
  });
});

describe("flt (frappe commercial rounding)", () => {
  it("rounds half away from zero, like an invoice", () => {
    expect(flt(0.125, 2)).toBe(0.13);
    expect(flt(-0.125, 2)).toBe(-0.13);
    expect(flt(2.675, 2)).toBe(2.68);
    // 369.87 / 1.2 in floating point; values checked against frappe.utils.data in ERPNext 16.52.1.
    expect(flt(308.22499999999997, 2)).toBe(308.23);
    expect(flt(308.22499999999997, 2, "Banker's Rounding")).toBe(308.22);
  });
});

describe("computeInvoiceTaxes", () => {
  it(`matches ERPNext ${fixture.meta.erpnext} on ${fixture.cases.length} random baskets`, () => {
    expect(fixture.meta.rounding_method).toBe("Commercial Rounding");
    for (const c of fixture.cases) {
      const r = computeInvoiceTaxes(
        c.lines.map((l) => ({ rate: l.rate, qty: l.qty, vatRate: l.vat_rate })),
        c.tax_rows,
      );
      const e = c.expected;
      expect(r.lines.map((l) => l.amount)).toEqual(e.amounts);
      expect(r.lines.map((l) => l.netAmount)).toEqual(e.net_amounts);
      expect(r.total).toBe(e.total);
      expect(r.netTotal).toBe(e.net_total);
      expect(r.taxRows.map((t) => t.taxAmount)).toEqual(e.tax_amounts);
      expect(r.totalTaxes).toBe(e.total_taxes_and_charges);
      expect(r.grandTotal).toBe(e.grand_total);
    }
  });

  it("gives the spec example: 189.00 TTC at 20% = 157.50 HT + 31.50 VAT", () => {
    const r = computeInvoiceTaxes([{ rate: 189, qty: 1, vatRate: 20 }], [20, 10]);
    expect(r.netTotal).toBe(157.5);
    expect(r.totalTaxes).toBe(31.5);
    expect(r.grandTotal).toBe(189);
  });
});
