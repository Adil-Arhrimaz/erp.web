/** Shapes returned by the parapilot Frappe app (parapilot.api.*). */

export type AppRole = "owner" | "manager" | "accountant" | "stock_clerk" | "cashier" | "ai";
export type Locale = "fr" | "en";
export type ThemePreference = "light" | "dark" | "system";

export interface SessionContext {
  user: string;
  full_name: string;
  image: string | null;
  language: Locale;
  theme: ThemePreference;
  roles: AppRole[];
  company: {
    name: string;
    abbr: string;
    currency: string;
    ice: string | null;
    if: string | null;
    rc: string | null;
    tp: string | null;
  } | null;
  setup_complete: boolean;
  settings: {
    cashier_discount_limit: number;
    return_pin_threshold: number;
    expiry_warning_days: number;
    receipt_language: Locale;
    round_sales_total: 0 | 1;
    vat_period: "Monthly" | "Quarterly";
  };
}

export interface Product {
  item_code: string;
  item_name: string;
  brand: string | null;
  pp_lab: string | null;
  item_group: string;
  image: string | null;
  disabled: 0 | 1;
  has_batch_no: 0 | 1;
  is_stock_item: 0 | 1;
  stock_uom: string;
  pp_min_stock: number;
  pp_is_tester: 0 | 1;
  price_ttc: number | null;
  barcodes: string[];
  stock_qty: number;
  vat_template: string | null;
  vat_rate: number | null;
  /** Only for owner, manager and accountant. */
  valuation_rate?: number;
  last_purchase_rate?: number;
}

export interface ProductDetail extends Product {
  default_supplier: string | null;
  stock_by_warehouse: { warehouse: string; actual_qty: number }[];
}

export interface ProductList {
  items: Product[];
  has_more: boolean;
  start: number;
}

export interface ItemGroupOption {
  name: string;
  vat_template: string | null;
  vat_title: string | null;
  vat_rate: number | null;
}

export interface ProductFormOptions {
  item_groups: ItemGroupOption[];
  brands: string[];
  labs: string[];
  suppliers: { name: string; supplier_name: string }[];
  can_edit_price: boolean;
  can_see_costs: boolean;
}

export interface ProductInput {
  item_code?: string;
  item_name: string;
  item_group: string;
  brand?: string | null;
  pp_lab?: string | null;
  barcodes: string[];
  price_ttc?: number | null;
  has_batch_no?: boolean;
  pp_min_stock?: number | null;
  pp_is_tester?: boolean;
  default_supplier?: string | null;
  disabled?: boolean;
}

export interface SaveProductResult {
  item_code: string;
  warnings: { code: "below_cost"; loss_per_unit_ht: number }[];
}
