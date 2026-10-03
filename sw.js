const CACHE = "feda-shell-v6";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js?v=4", "./api.js?v=4", "./config.js?v=4", "./manifest.webmanifest", "./privacy.html", "./terms.html", "./icon-192.png", "./icon-512.png", "./tus.min.js?v=4"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(fetch(event.request)
    .then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; })
    .catch(async () => {
      const hit = await caches.match(event.request);
      if (hit) return hit;
      if (event.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }));
});
