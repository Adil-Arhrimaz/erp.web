/** Shapes returned by parapilot.api.stock, returns and customers. */

export type LocationRole = "shop_floor" | "back_store" | "quarantine";
export type WriteOffReason = "breakage" | "theft" | "expired" | "tester";

export interface StockRow {
  item_code: string;
  item_name: string;
  brand: string | null;
  item_group: string;
  has_batch_no: 0 | 1;
  min_stock: number;
  shop_floor: number;
  back_store: number;
  quarantine: number;
  low: boolean;
  value?: number;
}

export interface ExpiryBatch {
  item_code: string;
  item_name: string;
  batch_no: string;
  lot: string;
  warehouse: LocationRole;
  expiry_date: string;
  days_left: number;
  bucket: "expired" | "30" | "60" | "90";
  qty: number;
  value?: number;
}

export interface ExpiryBoard {
  batches: ExpiryBatch[];
  totals: Partial<Record<ExpiryBatch["bucket"], { batches: number; qty: number; value: number }>>;
  show_costs: boolean;
}

export interface ItemBatch {
  batch_no: string;
  lot: string;
  expiry_date: string | null;
  qty: number;
}

export interface CountSheetRow {
  item_code: string;
  item_name: string;
  barcodes: string[];
  batch_no: string | null;
  lot?: string;
  expiry_date?: string | null;
}

export interface CountResult {
  name: string | null;
  docstatus?: 0 | 1;
  posting_date?: string;
  warehouse_role?: LocationRole;
  counted_by?: string;
  differences: number;
  difference_amount?: number | null;
  rows?: {
    item_code: string;
    item_name: string;
    lot: string | null;
    expected: number;
    counted: number;
    difference: number;
    amount_difference?: number;
  }[];
  can_approve?: boolean;
}

export interface CountRow {
  name: string;
  posting_date: string;
  set_warehouse: string | null;
  warehouse_role: LocationRole | null;
  docstatus: 0 | 1;
  difference_amount: number;
  owner: string;
}

export interface SaleToReturn {
  name: string;
  client_id: string | null;
  posting_date: string;
  customer_name: string;
  grand_total: number;
  payments: string[];
  pin_threshold: number;
  needs_pin_role: boolean;
  lines: { row: string; item_code: string; item_name: string; qty: number; returnable: number; rate: number }[];
}

export interface SupplierReturnRow {
  name: string;
  supplier_name: string;
  return_against: string;
  posting_date: string;
  docstatus: 0 | 1;
  status: string;
  grand_total?: number;
  lines: { item_name: string; qty: number; rejected_qty: number }[];
}

export interface Customer {
  name: string;
  customer_name: string;
  customer_type: "Individual" | "Company";
  pp_phone: string | null;
  pp_ice: string | null;
  pp_marketing_consent: 0 | 1;
  pp_marketing_consent_on: string | null;
  visits?: number;
  total?: number;
  last_visit?: string | null;
}

export interface CustomerHistory {
  customer: Customer;
  invoices: { name: string; posting_date: string; grand_total: number; is_return: 0 | 1; lines: { item_name: string; qty: number }[] }[];
}
