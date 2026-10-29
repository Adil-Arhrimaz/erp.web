"use client";

import { useEffect } from "react";

/** Registers the offline service worker in production builds (dev reloads would fight the cache). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
