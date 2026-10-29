import type { RoundingMethod } from "@/lib/erpnext-tax";
import { type DocumentTotals, documentTotals, fromCents, toCents } from "@/lib/money";

import type { CartLine } from "./db";
import type { BusinessCustomer, CatalogItem, PaymentMode, Receipt, SalePayload } from "./types";

export interface Cart {
  lines: CartLine[];
  /** Percent applied to every line on top of its own discount. */
  cartDiscount: number;
  /** Set when a company buys: the sale becomes an invoice with its name and ICE. */
  customer?: BusinessCustomer | null;
}

export const emptyCart = (): Cart => ({ lines: [], cartDiscount: 0, customer: null });

export function addItem(cart: Cart, item: CatalogItem, qty = 1): Cart {
  const existing = cart.lines.find((l) => l.item_code === item.item_code);
  if (existing) return setQty(cart, item.item_code, existing.qty + qty);
  return {
    ...cart,
    lines: [
      ...cart.lines,
      {
        item_code: item.item_code,
        item_name: item.item_name,
        qty,
        price: item.price ?? 0,
        vat_rate: item.vat_rate ?? 0,
        discount: 0,
      },
    ],
  };
}

export function setQty(cart: Cart, itemCode: string, qty: number): Cart {
  if (qty <= 0) return removeLine(cart, itemCode);
  return { ...cart, lines: cart.lines.map((l) => (l.item_code === itemCode ? { ...l, qty } : l)) };
}

export function setLineDiscount(cart: Cart, itemCode: string, discount: number): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.item_code === itemCode ? { ...l, discount } : l)) };
}

export function removeLine(cart: Cart, itemCode: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.item_code !== itemCode) };
}

/** Line and cart discounts compound: 10 % on the line then 5 % on the cart = 14.5 %. */
export function effectiveDiscount(line: CartLine, cartDiscount: number): number {
  return 100 * (1 - (1 - line.discount / 100) * (1 - cartDiscount / 100));
}

export function cartTotals(cart: Cart, taxRows: number[], method: RoundingMethod): DocumentTotals {
  return documentTotals(
    cart.lines.map((l) => ({
      unitTtc: toCents(l.price),
      qty: l.qty,
      vatRate: l.vat_rate,
      discountPercent: effectiveDiscount(l, cart.cartDiscount),
    })),
    taxRows,
    method,
  );
}

export interface Tender {
  /** Cash handed over by the customer, may exceed what is due. */
  cash: number;
  card: number;
}

export function buildSale(args: {
  cart: Cart;
  totals: DocumentTotals;
  tender: Tender;
  modes: PaymentMode[];
  clientId: string;
  posProfile: string;
  soldAt: Date;
}): SalePayload {
  const { cart, totals, tender, modes } = args;
  const cashMode = modes.find((m) => m.type === "Cash")?.mode_of_payment;
  const cardMode = modes.find((m) => m.type === "Bank")?.mode_of_payment;
  const payments = [
    ...(tender.cash > 0 && cashMode ? [{ mode_of_payment: cashMode, amount: tender.cash }] : []),
    ...(tender.card > 0 && cardMode ? [{ mode_of_payment: cardMode, amount: tender.card }] : []),
  ];
  return {
    client_id: args.clientId,
    pos_profile: args.posProfile,
    sold_at: args.soldAt.toISOString(),
    ...(cart.customer && { customer: cart.customer.name }),
    lines: cart.lines.map((l, i) => ({
      item_code: l.item_code,
      qty: l.qty,
      price: l.price,
      rate: fromCents(totals.lines[i].rate),
    })),
    payments,
  };
}

/** The receipt printed before ERPNext has the sale: same figures ERPNext will book. */
export function localReceipt(args: {
  sale: SalePayload;
  cart: Cart;
  totals: DocumentTotals;
  cashier: string;
  company: Receipt["company"];
}): Receipt {
  const { sale, cart, totals } = args;
  const paid = sale.payments.reduce((s, p) => s + toCents(p.amount), 0);
  const soldAt = new Date(sale.sold_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    name: null,
    client_id: sale.client_id,
    posting_date: `${soldAt.getFullYear()}-${pad(soldAt.getMonth() + 1)}-${pad(soldAt.getDate())}`,
    posting_time: `${pad(soldAt.getHours())}:${pad(soldAt.getMinutes())}:${pad(soldAt.getSeconds())}`,
    cashier: args.cashier,
    pos_profile: sale.pos_profile,
    is_return: 0,
    company: args.company,
    customer: cart.customer ? { name: cart.customer.customer_name, ice: cart.customer.pp_ice } : null,
    lines: cart.lines.map((l, i) => ({
      item_code: l.item_code,
      item_name: l.item_name,
      qty: l.qty,
      price: l.price,
      rate: fromCents(totals.lines[i].rate),
      discount_percent: effectiveDiscount(l, cart.cartDiscount),
      amount: fromCents(totals.lines[i].amount),
    })),
    vat_by_rate: totals.byRate.map((r) => ({ rate: r.vatRate, ht: fromCents(r.ht), vat: fromCents(r.vat) })),
    totals: {
      ttc: fromCents(totals.ttc),
      ht: fromCents(totals.ht),
      vat: fromCents(totals.vat),
      discount: fromCents(
        cart.lines.reduce((s, l, i) => s + (toCents(l.price) - totals.lines[i].rate) * l.qty, 0),
      ),
    },
    payments: sale.payments,
    paid: fromCents(paid),
    change: fromCents(Math.max(0, paid - totals.ttc)),
  };
}
