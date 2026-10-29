/**
 * Money and VAT arithmetic, in integer centimes so results match ERPNext to the centime.
 *
 * Prices are VAT-included (TTC) everywhere. HT and VAT come from erpnext-tax.ts, a step-by-step copy
 * of ERPNext's own calculation, so a receipt printed offline shows what ERPNext will book.
 */

import { type RoundingMethod, computeInvoiceTaxes, flt } from "./erpnext-tax";

export type Cents = number;

/** Round half away from zero, so a return (negative amount) mirrors its sale exactly. */
function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** DH to centimes. toPrecision absorbs binary float noise such as 1.005 * 100 = 100.4999… */
export function toCents(amount: number): Cents {
  return roundHalfAway(Number.parseFloat((amount * 100).toPrecision(12)));
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

export interface VatSplit {
  ttc: Cents;
  ht: Cents;
  vat: Cents;
}

/** Sales taxes template rows (TVA 20 %, TVA 10 %): every item sets its own rate on one of them. */
export const DEFAULT_TAX_ROWS = [20, 10];

/** HT and VAT of one TTC amount, exactly as ERPNext computes a single invoice line. */
export function splitTtc(ttc: Cents, ratePercent: number): VatSplit {
  const r = computeInvoiceTaxes([{ rate: fromCents(ttc), qty: 1, vatRate: ratePercent }], DEFAULT_TAX_ROWS);
  return { ttc, ht: toCents(r.netTotal), vat: toCents(r.totalTaxes) };
}

export function ttcFromHt(ht: Cents, ratePercent: number): Cents {
  return roundHalfAway(ht * (1 + ratePercent / 100));
}

/** Unit price after a line discount, rounded to the centime: the rate ERPNext records on the line. */
export function discountedRate(
  unitTtc: Cents,
  discountPercent: number,
  method: RoundingMethod = "Commercial Rounding",
): Cents {
  if (!discountPercent) return unitTtc;
  return toCents(flt(fromCents(unitTtc) * (1 - discountPercent / 100), 2, method));
}

export interface LineInput {
  /** Unit price TTC in centimes, before discount. */
  unitTtc: Cents;
  qty: number;
  vatRate: number;
  /** Line discount in percent, 0–100. */
  discountPercent?: number;
}

export interface DocumentTotals {
  ttc: Cents;
  ht: Cents;
  vat: Cents;
  /** ERPNext books HT + VAT − TTC (±0.01) as a rounding adjustment. */
  roundingDiff: Cents;
  /** Total rounded to the dirham minus TTC, when the shop rounds sales totals; otherwise 0. */
  rounding: Cents;
  /** What the customer pays: TTC, or TTC rounded to the dirham. */
  due: Cents;
  /** One entry per VAT rate, as invoices must show (CGI art. 145): HT base, rate, VAT. */
  byRate: { vatRate: number; ht: Cents; vat: Cents }[];
  lines: { rate: Cents; amount: Cents; ht: Cents; vat: Cents }[];
}

/** Totals of a sale, identical to the Sales Invoice ERPNext will create from it. */
export function documentTotals(
  lines: LineInput[],
  taxRows: number[] = DEFAULT_TAX_ROWS,
  method: RoundingMethod = "Commercial Rounding",
  roundTotal = false,
): DocumentTotals {
  const rates = lines.map((l) => discountedRate(l.unitTtc, l.discountPercent ?? 0, method));
  const r = computeInvoiceTaxes(
    lines.map((l, i) => ({ rate: fromCents(rates[i]), qty: l.qty, vatRate: l.vatRate })),
    taxRows,
    method,
  );
  const byRate = new Map<number, { ht: number; vat: number }>();
  lines.forEach((l, i) => {
    const bucket = byRate.get(l.vatRate) ?? { ht: 0, vat: 0 };
    bucket.ht += r.lines[i].netAmount;
    byRate.set(l.vatRate, bucket);
  });
  for (const row of r.taxRows) {
    const bucket = byRate.get(row.rate);
    if (bucket) bucket.vat += row.taxAmount;
  }
  // frappe round_based_on_smallest_currency_fraction: MAD has no smallest fraction, so whole dirhams.
  const due = roundTotal ? flt(flt(r.grandTotal, 0, method), 2, method) : r.grandTotal;
  return {
    ttc: toCents(r.grandTotal),
    rounding: toCents(due) - toCents(r.grandTotal),
    due: toCents(due),
    ht: toCents(r.netTotal),
    vat: toCents(r.totalTaxes),
    roundingDiff: toCents(r.roundingDiff),
    byRate: [...byRate.entries()]
      .sort(([a], [b]) => b - a)
      .map(([vatRate, v]) => ({ vatRate, ht: toCents(flt(v.ht, 2, method)), vat: toCents(flt(v.vat, 2, method)) })),
    lines: r.lines.map((l, i) => ({
      rate: rates[i],
      amount: toCents(l.amount),
      ht: toCents(l.netAmount),
      vat: toCents(l.vatAmount),
    })),
  };
}

export interface Margin {
  sellingHt: Cents;
  costHt: Cents;
  /** Margin in centimes, on HT amounts: VAT is not income. */
  margin: Cents;
  /** (Selling HT − Cost HT) / Selling HT. */
  marginRate: number | null;
  /** (Selling HT − Cost HT) / Cost HT. */
  markupRate: number | null;
}

export function margin(sellingTtc: Cents, costHt: Cents, vatRate: number): Margin {
  const sellingHt = splitTtc(sellingTtc, vatRate).ht;
  const m = sellingHt - costHt;
  return {
    sellingHt,
    costHt,
    margin: m,
    marginRate: sellingHt ? m / sellingHt : null,
    markupRate: costHt ? m / costHt : null,
  };
}

/** "1 234,50 DH" in French, "1,234.50 DH" in English. */
export function formatMoney(cents: Cents, locale: string): string {
  return `${formatAmount(cents, locale)} DH`;
}

export function formatAmount(cents: Cents, locale: string): string {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(fromCents(cents));
}

export function formatPercent(rate: number | null, locale: string, digits = 1): string {
  if (rate === null) return "–";
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rate);
}
