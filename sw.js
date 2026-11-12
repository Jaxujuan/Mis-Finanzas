/* Service worker: guarda la "cáscara" de la app para que abra al instante y sin conexión.
   Los datos financieros NO se guardan aquí (van por POST a Apps Script). */
const VERSION = 'mf-v1.3.0';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'js/ui.js', 'js/api.js', 'js/charts.js', 'js/views.js', 'js/parser.js', 'js/entry.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.indexOf('script.google') >= 0) return; // nunca cachear la API
  if (url.origin === location.origin) {
    // Red primero (para recibir actualizaciones), caché si no hay conexión.
    e.respondWith(fetch(req).then(function (res) {
      const copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); }));
  } else if (/cdnjs|fonts\.(googleapis|gstatic)/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      });
    }));
  }
});
