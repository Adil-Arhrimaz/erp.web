import { ApiError, api } from "@/lib/api-client";

import { type OutboxSale, posDb } from "./db";
import type { Receipt } from "./types";

let running: Promise<SyncResult> | null = null;

export interface SyncResult {
  sent: number;
  failed: number;
  pending: number;
  offline: boolean;
}

/**
 * Sends the cashier's queued sales to ERPNext, oldest first. A network or server error stops the run
 * and leaves the sale queued (retried later); a refusal by ERPNext marks it failed for a manager to
 * look at. Sending the same sale twice is safe: ERPNext returns the first invoice.
 */
export function syncOutbox(user: string): Promise<SyncResult> {
  running ??= run(user).finally(() => {
    running = null;
  });
  return running;
}

async function run(user: string): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, failed: 0, pending: 0, offline: false };
  const queue = await posDb.outbox.where({ user, status: "pending" }).sortBy("created_at");

  for (const sale of queue) {
    try {
      const receipt = await api<Receipt>("/api/pos/sales", {
        method: "POST",
        json: sale.payload,
        // A lost session must not interrupt the till: the sale stays queued until the next login.
        redirectOn401: false,
      });
      await posDb.outbox.update(sale.client_id, {
        status: "synced",
        receipt,
        invoice: receipt.name ?? undefined,
        attempts: sale.attempts + 1,
        error: undefined,
      } satisfies Partial<OutboxSale>);
      result.sent++;
    } catch (error) {
      const retryable = !(error instanceof ApiError) || error.status >= 500 || error.status === 401;
      await posDb.outbox.update(sale.client_id, {
        attempts: sale.attempts + 1,
        error: (error as Error).message,
        ...(retryable ? {} : { status: "failed" as const }),
      });
      if (retryable) {
        result.offline = true;
        break;
      }
      result.failed++;
    }
  }
  result.pending = await posDb.outbox.where({ user, status: "pending" }).count();
  return result;
}

/** Synced sales older than two days are only in ERPNext now; failed ones stay until handled. */
export async function pruneOutbox() {
  const cutoff = Date.now() - 2 * 24 * 3600 * 1000;
  await posDb.outbox.where("created_at").below(cutoff).and((s) => s.status === "synced").delete();
}
