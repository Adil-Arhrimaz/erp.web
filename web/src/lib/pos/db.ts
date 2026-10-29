import Dexie, { type EntityTable } from "dexie";

import type { BusinessCustomer, PosCatalog, Receipt, SalePayload } from "./types";

/** A sale waiting to reach ERPNext, or already sent. Kept for the day so receipts can be reprinted. */
export interface OutboxSale {
  client_id: string;
  /** The cashier who made the sale: only their session may send it (ERPNext records them as owner). */
  user: string;
  created_at: number;
  status: "pending" | "synced" | "failed";
  payload: SalePayload;
  /** Computed on the device, identical to what ERPNext books; replaced by ERPNext's once synced. */
  receipt: Receipt;
  attempts: number;
  error?: string;
  invoice?: string;
}

export interface ParkedCart {
  id: string;
  user: string;
  created_at: number;
  lines: CartLine[];
  cart_discount: number;
  customer?: BusinessCustomer | null;
}

export interface CartLine {
  item_code: string;
  item_name: string;
  qty: number;
  price: number;
  vat_rate: number;
  discount: number;
}

export interface CachedCatalog extends PosCatalog {
  key: string;
  fetched_at: number;
}

class PosDatabase extends Dexie {
  catalog!: EntityTable<CachedCatalog, "key">;
  outbox!: EntityTable<OutboxSale, "client_id">;
  parked!: EntityTable<ParkedCart, "id">;

  constructor() {
    super("parapilot-pos");
    this.version(1).stores({
      catalog: "key",
      outbox: "client_id, [user+status], created_at",
      parked: "id, user",
    });
  }
}

export const posDb = new PosDatabase();
