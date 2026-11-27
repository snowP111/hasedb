// HaseDB – Service Worker: App-Dateien offline verfügbar (Netz zuerst, sonst Cache)
const CACHE = 'hasedb-v15';
const DATEIEN = ['./', 'index.html', 'style.css?v=15', 'app.js?v=15', 'logik.js?v=15', 'karte.js?v=15', 'graph.js?v=15', 'config.js?v=15', 'manifest.webmanifest', 'vendor/webawesome/webawesome.loader.js', 'vendor/webawesome/styles/themes/default.css', 'vendor/chartjs/chart.umd.min.js', 'vendor/lucide/lucide-auswahl.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Supabase, Karte, MVG direkt
  e.respondWith(fetch(e.request).then((r) => { const k = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, k)); return r; }).catch(() => caches.match(e.request)));
});
