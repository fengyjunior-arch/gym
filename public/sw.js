// Service worker do Ironmind: guarda o app no aparelho para abrir rápido e sem internet.
const CACHE = "ironmind-b0ec0a01";
const SHELL = ["./", "index.html", "styles.css?v=b0ec0a01", "app.js?v=b0ec0a01", "shim.js?v=b0ec0a01", "config.js?v=b0ec0a01",
  "lib/supabase.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/favicon-64.png"];

self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("ironmind-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;                       // salvar dados sempre vai para a internet
  if (url.hostname.endsWith("supabase.co")) return;       // banco de dados: nunca do cache
  if (req.mode === "navigate") {                          // página: tenta a versão nova, senão usa a guardada
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put("index.html", cp)); return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  if (url.origin === location.origin || url.hostname.includes("fonts.g") || url.hostname === "cdnjs.cloudflare.com") {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === "opaque") { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    })));
  }
});
