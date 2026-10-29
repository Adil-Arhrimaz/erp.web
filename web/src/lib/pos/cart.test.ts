import { describe, expect, it } from "vitest";

import { addItem, buildSale, cartTotals, effectiveDiscount, emptyCart, localReceipt, setQty } from "./cart";
import { newClientId } from "./client-id";
import type { CatalogItem, PaymentMode } from "./types";

const item = (code: string, price: number, vat = 20): CatalogItem => ({
  item_code: code,
  item_name: code,
  brand: null,
  item_group: "Visage",
  image: null,
  barcodes: [],
  price,
  vat_rate: vat,
  stock: 10,
});
const modes: PaymentMode[] = [
  { mode_of_payment: "Espèces", type: "Cash", default: 1 },
  { mode_of_payment: "Carte bancaire", type: "Bank", default: 0 },
];

describe("cart", () => {
  it("adds the same product to one line", () => {
    let cart = addItem(emptyCart(), item("A", 189));
    cart = addItem(cart, item("A", 189));
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].qty).toBe(2);
    expect(setQty(cart, "A", 0).lines).toHaveLength(0);
  });

  it("compounds line and cart discounts", () => {
    expect(effectiveDiscount({ discount: 10 } as never, 5)).toBeCloseTo(14.5, 10);
  });

  it("builds the sale ERPNext checked: 3 items, cash with change", () => {
    let cart = addItem(emptyCart(), item("A", 189));
    cart = addItem(cart, item("B", 159.5), 3);
    cart = addItem(cart, item("C", 85));
    const totals = cartTotals(cart, [20, 10], "Commercial Rounding");
    expect(totals.ttc).toBe(75250);
    const sale = buildSale({
      cart,
      totals,
      tender: { cash: 800, card: 0 },
      modes,
      clientId: newClientId(),
      posProfile: "Caisse 1",
      soldAt: new Date(),
    });
    expect(sale.payments).toEqual([{ mode_of_payment: "Espèces", amount: 800 }]);
    expect(sale.lines.map((l) => l.rate)).toEqual([189, 159.5, 85]);
    const receipt = localReceipt({ sale, cart, totals, cashier: "X", company: null });
    expect(receipt.change).toBe(47.5);
    expect(receipt.totals).toEqual({ ttc: 752.5, ht: 627.08, vat: 125.42, discount: 0, rounding: 0, due: 752.5 });
  });

  it("gives change from the total rounded to the dirham when the shop rounds", () => {
    const cart = { ...addItem(emptyCart(), item("A", 159.5), 3), cartDiscount: 7.5 };
    const totals = cartTotals(cart, [20, 10], "Commercial Rounding", true);
    expect(totals).toMatchObject({ ttc: 44262, rounding: 38, due: 44300 });
    const sale = buildSale({
      cart,
      totals,
      tender: { cash: 500, card: 0 },
      modes,
      clientId: newClientId(),
      posProfile: "Caisse 1",
      soldAt: new Date(),
    });
    const receipt = localReceipt({ sale, cart, totals, cashier: "X", company: null });
    expect(receipt.totals).toMatchObject({ ttc: 442.62, rounding: 0.38, due: 443 });
    expect(receipt.change).toBe(57);
  });

  it("sends the discounted unit rate the till computed", () => {
    const cart = { ...addItem(emptyCart(), item("A", 159.5), 3), cartDiscount: 7.5 };
    const totals = cartTotals(cart, [20, 10], "Commercial Rounding");
    expect(totals.lines[0].rate).toBe(14754); // 159.50 − 7.5 % = 147.5375 → 147.54
    expect(totals.ttc).toBe(44262);
  });
});

describe("newClientId", () => {
  it("is unique, sortable by time and accepted by the server", () => {
    const a = newClientId(1_700_000_000_000);
    const b = newClientId(1_700_000_000_001);
    expect(a).toMatch(/^[0-9A-Z]{16}$/);
    expect(a < b).toBe(true);
    expect(new Set(Array.from({ length: 1000 }, () => newClientId())).size).toBe(1000);
  });
});
