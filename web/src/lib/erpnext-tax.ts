/**
 * ERPNext's tax-included (TTC) invoice arithmetic, reproduced operation by operation.
 *
 * The till prints receipts before ERPNext has seen the sale (offline mode), so its totals must be the
 * ones ERPNext will book, to the centime. ERPNext computes in IEEE-754 doubles and rounds with
 * frappe.utils.flt; JavaScript numbers are the same doubles, so repeating the same operations in the
 * same order gives the same results. Source: erpnext/controllers/taxes_and_totals.py (v16.52.1) with
 * "Round Tax Amount Row-wise" on. Tested against ERPNext output in erpnext-tax.test.ts.
 */

export type RoundingMethod = "Commercial Rounding" | "Banker's Rounding";

const POW10 = (n: number) => 10n ** BigInt(n);

/** Exact value of a finite double as mantissa * 2^exponent (both integers). */
function decompose(x: number): { mantissa: bigint; exponent: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const rawExponent = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & 0xfffffffffffffn;
  const sign = bits >> 63n ? -1n : 1n;
  if (rawExponent === 0) return { mantissa: sign * fraction, exponent: -1074 };
  return { mantissa: sign * (fraction | (1n << 52n)), exponent: rawExponent - 1075 };
}

/** Python's round(x, ndigits): exact value of the double, ties to even. */
export function pyRound(x: number, ndigits: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const { mantissa, exponent } = decompose(x);
  let scaledNum = mantissa * POW10(ndigits);
  let scaledDen = 1n;
  if (exponent >= 0) scaledNum <<= BigInt(exponent);
  else scaledDen <<= BigInt(-exponent);
  const negative = scaledNum < 0n;
  if (negative) scaledNum = -scaledNum;
  let q = scaledNum / scaledDen;
  const twiceRemainder = (scaledNum % scaledDen) * 2n;
  if (twiceRemainder > scaledDen || (twiceRemainder === scaledDen && q % 2n === 1n)) q += 1n;
  const result = Number(`${negative ? "-" : ""}${q}e-${ndigits}`);
  return result === 0 ? 0 : result;
}

/** Python's math.ulp. */
function ulp(x: number): number {
  const { exponent } = decompose(Math.abs(x));
  return 2 ** Math.max(exponent, -1074);
}

/** frappe.utils.data._round_away_from_zero */
function roundAwayFromZero(num: number, precision: number): number {
  if (num === 0) return 0;
  const epsilon = ulp(Math.abs(num));
  if (Number.isFinite(num) && epsilon >= 10 ** -precision / 4) {
    // Only for numbers beyond any shop amount (> 2^43); exact half-up on the double.
    const { mantissa, exponent } = decompose(num);
    return exponent >= 0 ? num : pyRound(num + Math.sign(Number(mantissa)) * epsilon, precision);
  }
  return pyRound(num + Math.sign(num) * epsilon, precision);
}

/** frappe.utils.data._bankers_rounding */
function bankersRounding(num: number, precision: number): number {
  if (num === 0) return 0;
  const sign = num < 0 ? -1 : 1;
  const multiplier = 10 ** precision;
  let n = pyRound(Math.abs(num) * multiplier, 12);
  if (n === 0) return 0;
  const floor = Math.floor(n);
  const decimalPart = n - floor;
  const epsilon = 2.0 ** (Math.log(n) / Math.log(2) - 52.0);
  if (epsilon < 0.5 && Math.abs(decimalPart - 0.5) < epsilon) n = floor % 2 === 0 ? floor : floor + 1;
  else n = pyRound(n, 0);
  return (sign * n) / multiplier;
}

/** frappe.utils.flt(value, precision) with the site's rounding method. */
export function flt(value: number, precision: number, method: RoundingMethod = "Commercial Rounding"): number {
  return method === "Banker's Rounding" ? bankersRounding(value, precision) : roundAwayFromZero(value, precision);
}

export interface TaxLine {
  /** Unit price TTC actually charged (after any line discount), in DH with 2 decimals. */
  rate: number;
  qty: number;
  /** Rate of the item's VAT category: 20, 10 or 0. */
  vatRate: number;
}

export interface TaxResult {
  lines: { amount: number; netAmount: number; vatAmount: number }[];
  /** Sum of line amounts TTC. */
  total: number;
  netTotal: number;
  /** One per row of the sales taxes template, in template order. */
  taxRows: { rate: number; taxAmount: number }[];
  totalTaxes: number;
  grandTotal: number;
  /** ERPNext's rounding adjustment: grandTotal − (netTotal + totalTaxes). */
  roundingDiff: number;
}

const CURRENCY = 2;
const FLOAT = 3;

/**
 * Sales invoice totals for prices that include VAT.
 *
 * @param taxRowRates rates of the sales taxes template rows, in order (e.g. [20, 10]). Each item's
 * VAT category sets its own rate on the matching row and 0 on the others, as ParaPilot's Item Tax
 * Templates do.
 */
export function computeInvoiceTaxes(
  lines: TaxLine[],
  taxRowRates: number[],
  method: RoundingMethod = "Commercial Rounding",
): TaxResult {
  const f = (v: number, p: number) => flt(v, p, method);
  const rowRateFor = (line: TaxLine, rowRate: number) => f(line.vatRate === rowRate ? rowRate : 0, FLOAT);

  // calculate_item_values + determine_exclusive_rate
  const items = lines.map((line) => {
    const rate = f(line.rate, CURRENCY);
    const qty = f(line.qty, FLOAT);
    const amount = f(rate * qty, CURRENCY);
    let slope = 0;
    for (const rowRate of taxRowRates) slope += rowRateFor(line, rowRate) / 100.0;
    let unroundedNet: number | null = null;
    let netAmount = amount;
    if (qty && slope) {
      unroundedNet = (amount - 0) / (1 + slope);
      netAmount = f(unroundedNet, CURRENCY);
    }
    return { line, amount, netAmount, unroundedNet, vatAmount: 0 };
  });

  // calculate_net_total
  let total = 0;
  let netTotal = 0;
  for (const item of items) {
    total += item.amount;
    netTotal += item.netAmount;
  }
  total = f(total, CURRENCY);
  netTotal = f(netTotal, CURRENCY);

  // calculate_taxes (row-wise rounding)
  const taxAmounts = taxRowRates.map(() => 0);
  for (const item of items) {
    taxRowRates.forEach((rowRate, i) => {
      const rate = rowRateFor(item.line, rowRate);
      const base = item.unroundedNet ?? item.netAmount;
      const current = f((rate / 100.0) * base, CURRENCY);
      taxAmounts[i] += current;
      item.vatAmount += current;
    });
  }
  const taxRows = taxRowRates.map((rate, i) => ({ rate, taxAmount: f(taxAmounts[i], CURRENCY) }));
  let cumulative = netTotal;
  for (const row of taxRows) cumulative = f(cumulative + row.taxAmount, CURRENCY);

  // adjust_grand_total_for_inclusive_tax
  let diff = total + 0 - f(cumulative, CURRENCY);
  diff -= 0;
  diff = f(diff, CURRENCY);
  const roundingDiff = diff && Math.abs(diff) <= 5.0 / 10 ** CURRENCY ? diff : 0;

  // calculate_totals
  const grandTotal = taxRows.length ? f(f(cumulative, CURRENCY) + roundingDiff, CURRENCY) : netTotal;
  const totalTaxes = taxRows.length ? f(grandTotal - netTotal - roundingDiff, CURRENCY) : 0;

  return {
    lines: items.map((i) => ({ amount: i.amount, netAmount: i.netAmount, vatAmount: f(i.vatAmount, CURRENCY) })),
    total,
    netTotal,
    taxRows,
    totalTaxes,
    grandTotal,
    roundingDiff,
  };
}
