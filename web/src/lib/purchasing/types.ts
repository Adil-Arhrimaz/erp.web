/** Shapes returned by parapilot.api.purchasing. */

export interface Supplier {
  name: string;
  supplier_name: string;
  pp_ice: string | null;
  pp_if: string | null;
  pp_min_order_amount: number;
  pp_lead_time_days: number;
  pp_free_unit_terms: string | null;
  disabled: 0 | 1;
  /** Owed on submitted invoices; only for roles that can read invoices. */
  outstanding?: number;
}

export interface Totals {
  ht: number;
  vat: number;
  ttc: number;
  vat_by_rate: { rate: number; ht: number; vat: number }[];
}

export interface PurchaseOrderRow {
  name: string;
  supplier: string;
  supplier_name: string;
  transaction_date: string;
  schedule_date: string | null;
  grand_total: number;
  status: string;
  per_received: number;
  per_billed: number;
  docstatus: 0 | 1 | 2;
}

export interface PurchaseOrder {
  name: string;
  supplier: string;
  supplier_name: string;
  transaction_date: string;
  schedule_date: string | null;
  status: string;
  docstatus: 0 | 1 | 2;
  per_received: number;
  lines: {
    name: string;
    item_code: string;
    item_name: string;
    qty: number;
    received_qty: number;
    rate: number;
    amount: number;
    vat_rate: number | null;
  }[];
  totals: Totals;
  can_submit: boolean;
}

export interface OrderSuggestion {
  item_code: string;
  item_name: string;
  stock: number;
  min_stock: number;
  suggested_qty: number;
  rate: number | null;
  vat_rate: number | null;
}

export interface ReceivingItem {
  item_code: string;
  item_name: string;
  has_batch_no: 0 | 1;
  rate: number | null;
  vat_rate: number | null;
}

export interface ReceiptDraft {
  warehouses: { name: string; role: "shop_floor" | "back_store" }[];
  supplier: string | null;
  supplier_name?: string;
  purchase_order: string | null;
  lines: (ReceivingItem & { purchase_order_item: string; ordered_qty: number; qty: number })[];
}

export interface ReceiptRow {
  name: string;
  supplier: string;
  supplier_name: string;
  supplier_delivery_note: string | null;
  posting_date: string;
  status: string;
  per_billed: number;
  pp_damage_return: string | null;
  grand_total?: number;
}

export interface ReceiptResult {
  name: string;
  damage_return: string | null;
  warnings: { code: "short_expiry"; item_name: string; expiry_date: string }[];
}

export interface InvoiceRow {
  name: string;
  supplier: string;
  supplier_name: string;
  bill_no: string | null;
  bill_date: string | null;
  posting_date: string;
  due_date: string | null;
  grand_total: number;
  outstanding_amount: number;
  status: string;
  docstatus: 0 | 1 | 2;
  pp_company_ice_on_invoice: 0 | 1;
}

export interface InvoiceLine {
  /** Row id on a saved invoice (used by credit notes). */
  row?: string;
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount?: number;
  receipt_rate?: number | null;
  purchase_receipt?: string | null;
  pr_detail?: string | null;
  is_free_item?: 0 | 1;
  vat_rate: number | null;
}

export interface Invoice {
  name: string;
  supplier: string;
  supplier_name: string;
  bill_no: string | null;
  bill_date: string | null;
  posting_date: string;
  due_date: string | null;
  docstatus: 0 | 1 | 2;
  status: string;
  pp_company_ice_on_invoice: 0 | 1;
  receipts: string[];
  lines: InvoiceLine[];
  totals: Totals;
  outstanding: number;
  payments: { name: string; posting_date: string; mode_of_payment: string; amount: number; reference_no: string | null }[];
  warnings: { code: "price_differs"; item_name: string; receipt_rate: number; invoice_rate: number; row: number }[];
  can_submit: boolean;
  can_pay: boolean;
}

export interface CashLimitCheck {
  daily_total: number;
  monthly_total: number;
  daily_limit: number;
  monthly_limit: number;
  over_amount: number;
  vat_at_risk: number;
}

export interface SupplierPaymentMode {
  mode_of_payment: string;
  type: "Cash" | "Bank" | "General" | "Phone";
}

/** Price differences above this share are highlighted on supplier invoices (spec 5.3). */
export const PRICE_TOLERANCE = 0.01;

export function priceDiffers(rate: number, reference: number | null | undefined) {
  return !!reference && Math.abs(rate - reference) / reference > PRICE_TOLERANCE;
}
