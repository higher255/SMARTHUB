// Cache static, public assets only. Never cache HTML or API responses: server
// functions can return tenant or user data, including on GET requests.
const CACHE_NAME = "smart-ehs-static-v2";
const STATIC_ASSETS = ["/favicon.svg", "/__grok/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("smart-ehs-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const pathname = new URL(event.request.url).pathname;
  if (!STATIC_ASSETS.includes(pathname)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error())),
  );
});
