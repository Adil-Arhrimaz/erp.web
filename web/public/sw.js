/* ParaPilot service worker: lets the till reload and keep selling without internet.
   Caches the till pages and the app's static files only; /api data is never cached. */
const PAGES = "parapilot-pages-v1";
const STATIC = "parapilot-static-v1";
const OFFLINE_PAGES = ["/pos", "/till"];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== PAGES && key !== STATIC) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Build files are content-hashed: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Till pages: always the network when there is one, the last good copy when there is not.
  if (request.mode === "navigate" && OFFLINE_PAGES.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const response = await fetch(request);
          if (response.ok && !response.redirected) cache.put(url.pathname, response.clone());
          return response;
        } catch {
          return (await cache.match(url.pathname)) ?? Response.error();
        }
      })(),
    );
  }
});
