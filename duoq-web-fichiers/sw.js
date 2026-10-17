// Service worker minimal : permet l'installation sur l'écran d'accueil et un démarrage rapide.
// Réseau d'abord (toujours la dernière version), cache en secours. Les appels au serveur ne sont jamais mis en cache.
const C = "duoq-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(["./", "index.html", "shim.js", "icon-192.png"]).catch(() => {}))); });
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const k = r.clone(); caches.open(C).then((c) => c.put(e.request, k)); return r; }).catch(() => caches.match(e.request)));
});
