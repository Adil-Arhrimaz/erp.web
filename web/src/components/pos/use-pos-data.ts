"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { api } from "@/lib/api-client";
import { posDb } from "@/lib/pos/db";
import { pruneOutbox, syncOutbox } from "@/lib/pos/sync";
import type { PosCatalog } from "@/lib/pos/types";

const CATALOG_REFRESH_MS = 5 * 60 * 1000;
const SYNC_RETRY_MS = 15 * 1000;

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline() {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Catalog from the device cache at once, refreshed from ERPNext at opening and every 5 minutes. */
export function usePosCatalog(posProfile: string | undefined) {
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const catalog = useLiveQuery(
    () => (posProfile ? posDb.catalog.get(posProfile) : undefined),
    [posProfile],
  );

  const refresh = useCallback(async () => {
    if (!posProfile) return;
    setRefreshing(true);
    try {
      const fresh = await api<PosCatalog>(`/api/pos/catalog?pos_profile=${encodeURIComponent(posProfile)}`, {
        redirectOn401: false,
      });
      await posDb.catalog.put({ ...fresh, key: posProfile, fetched_at: Date.now() });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [posProfile]);

  useEffect(() => {
    if (!posProfile || !online) return;
    // First refresh right after the cached catalog has rendered, then every 5 minutes.
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, CATALOG_REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [posProfile, online, refresh]);

  return { catalog, error, refresh, refreshing };
}

/** Queue counts for the till's status line, and the background sender. */
export function useOutbox(user: string) {
  const online = useOnline();
  const [lastRunOffline, setLastRunOffline] = useState(false);
  const counts = useLiveQuery(
    async () => ({
      pending: await posDb.outbox.where({ user, status: "pending" }).count(),
      failed: await posDb.outbox.where({ user, status: "failed" }).count(),
      othersPending: await posDb.outbox
        .where("created_at")
        .above(0)
        .filter((s) => s.user !== user && s.status === "pending")
        .count(),
    }),
    [user],
  );

  const sync = useCallback(async () => {
    const result = await syncOutbox(user);
    setLastRunOffline(result.offline);
    return result;
  }, [user]);

  useEffect(() => {
    void pruneOutbox();
  }, []);

  useEffect(() => {
    if (!online) return;
    const first = window.setTimeout(() => void sync(), 0);
    const timer = window.setInterval(() => void sync(), SYNC_RETRY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [online, sync]);

  return {
    pending: counts?.pending ?? 0,
    failed: counts?.failed ?? 0,
    othersPending: counts?.othersPending ?? 0,
    offline: !online || lastRunOffline,
    sync,
  };
}
