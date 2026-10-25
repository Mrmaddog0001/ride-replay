// Ride Replay service worker: keeps the app on the phone, caches map tiles as you view them,
// and receives GPX files shared from other apps (Android share sheet).
const APP = "rr-app-v1", TILES = "rr-tiles-v1", SHARED = "rr-shared";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"];
const LIBS = ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"];
const TILE_HOSTS = ["server.arcgisonline.com", "basemaps.cartocdn.com", "elevation-tiles-prod"];
const MAX_TILES = 1500;

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    await c.addAll(SHELL);
    await Promise.all(LIBS.map(u => fetch(u, { mode: "cors" }).then(r => r.ok && c.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![APP, TILES, SHARED].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILES), keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);

  // Share target: stash the shared file(s), then open the app.
  if (req.method === "POST" && url.pathname.endsWith("/share")) {
    e.respondWith((async () => {
      try {
        const form = await req.formData(), c = await caches.open(SHARED);
        let i = 0;
        for (const f of form.getAll("gpx")) {
          if (typeof f === "string") continue;
          await c.put(new Request(new URL("rr-shared/" + (i++) + "-" + encodeURIComponent(f.name || "ride.gpx"), self.registration.scope).href), new Response(f));
        }
      } catch (err) {}
      return Response.redirect(new URL("./?shared=1", self.registration.scope).href, 303);
    })());
    return;
  }
  if (req.method !== "GET") return;

  // Map tiles: cache as you go, newest kept.
  if (TILE_HOSTS.some(h => url.hostname.includes(h) || url.pathname.includes(h))) {
    e.respondWith((async () => {
      const c = await caches.open(TILES), hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") { c.put(req, res.clone()); if (Math.random() < 0.05) trimTiles(); }
      return res;
    })());
    return;
  }

  // App and libraries: network first so updates arrive, cache when offline.
  if (url.origin === location.origin || LIBS.includes(req.url) || url.hostname.includes("fonts.g")) {
    e.respondWith((async () => {
      const c = await caches.open(APP);
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        return (await c.match(req, { ignoreSearch: true })) || (await c.match("index.html")) || Response.error();
      }
    })());
  }
});
