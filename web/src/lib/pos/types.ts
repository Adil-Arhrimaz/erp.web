/** Shapes returned by parapilot.api.pos. */

import type { RoundingMethod } from "@/lib/erpnext-tax";

export interface PaymentMode {
  mode_of_payment: string;
  type: "Cash" | "Bank" | "General" | "Phone";
  default: 0 | 1;
}

export interface TillStatus {
  tills: { name: string; open_by: string | null }[];
  opening: {
    name: string;
    pos_profile: string;
    period_start_date: string;
    /** Opened another day: ERPNext refuses sales until it is closed. */
    outdated: boolean;
    opening_amounts: Record<string, number>;
    payment_modes: PaymentMode[];
  } | null;
  /** Percent; null for owners and managers. */
  discount_limit: number | null;
}

export interface CatalogItem {
  item_code: string;
  item_name: string;
  brand: string | null;
  item_group: string;
  image: string | null;
  barcodes: string[];
  price: number | null;
  vat_rate: number | null;
  /** Null for non-stock items. */
  stock: number | null;
}

export interface PosCatalog {
  pos_profile: string;
  generated_at: string;
  company: CompanyBlock;
  receipt_language: "fr" | "en";
  rounding_method: RoundingMethod;
  tax_rows: number[];
  payment_modes: PaymentMode[];
  items: CatalogItem[];
}

export interface SaleLine {
  item_code: string;
  qty: number;
  /** Unit price TTC shown at the till. */
  price: number;
  /** Unit price TTC charged after discount, rounded to the centime. */
  rate: number;
}

/** A named customer on a sale: a company (with ICE, the sale becomes an invoice) or a person (phone). */
export interface BusinessCustomer {
  name: string;
  customer_name: string;
  pp_ice: string | null;
  pp_phone?: string | null;
}

export interface SalePayload {
  client_id: string;
  pos_profile: string;
  sold_at: string;
  /** A business customer: the sale becomes an invoice in their name with their ICE. */
  customer?: string;
  lines: SaleLine[];
  payments: { mode_of_payment: string; amount: number }[];
}

export interface CompanyBlock {
  name: string;
  address: string | null;
  phone: string | null;
  ice: string | null;
  if: string | null;
  rc: string | null;
  tp: string | null;
}

export interface Receipt {
  name: string | null;
  /** Null on returns, which are created on the server. */
  client_id: string | null;
  posting_date: string;
  posting_time: string;
  cashier: string;
  pos_profile: string;
  is_return: 0 | 1;
  company: CompanyBlock | null;
  customer: { name: string; ice: string | null; address?: string | null } | null;
  lines: {
    item_code: string;
    item_name: string;
    qty: number;
    price: number;
    rate: number;
    discount_percent: number;
    amount: number;
  }[];
  vat_by_rate: { rate: number; ht: number; vat: number }[];
  totals: { ttc: number; ht: number; vat: number; discount: number };
  payments: { mode_of_payment: string; amount: number }[];
  paid: number;
  change: number;
  price_review?: string | null;
  duplicate?: boolean;
}

export interface CashOut {
  name: string;
  amount: number;
  reason: string;
  by: string;
  at: string;
}

export interface ClosingPreview {
  opening: string;
  pos_profile: string;
  cash_outs: CashOut[];
  tickets: number;
  grand_total: number;
  expected: { mode_of_payment: string; type: PaymentMode["type"]; opening: number; expected: number }[];
}

export interface ZReport {
  name: string;
  pos_profile: string;
  cashier: string;
  period_start: string;
  period_end: string;
  company: CompanyBlock;
  tickets: number;
  grand_total: number;
  net_total: number;
  vat_total: number;
  vat_by_rate: { rate: number; ht: number; vat: number }[];
  returns: { count: number; total: number };
  discounts: number;
  payments: { mode_of_payment: string; opening: number; expected: number; counted: number; difference: number }[];
  price_reviews: string[];
  cash_outs: CashOut[];
}
