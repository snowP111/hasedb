// HaseDB – Service Worker: App-Dateien offline verfügbar (Netz zuerst, sonst Cache)
const CACHE = 'hasedb-v2';
const DATEIEN = ['./', 'index.html', 'style.css', 'app.js', 'logik.js', 'karte.js', 'graph.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Supabase, Karte, MVG direkt
  e.respondWith(fetch(e.request).then((r) => { const k = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, k)); return r; }).catch(() => caches.match(e.request)));
});
