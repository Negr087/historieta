// Service worker: guarda la app para leerla sin conexión.
// La app es un solo archivo (index.html con el génesis adentro): si no hay red,
// se abre la copia guardada y el génesis se lee igual. Los relays se reconectan solos.
// VERSION la reemplaza build.mjs con un hash, así cada build nuevo renueva el caché.

const CACHE = 'historieta-VERSION';
const ARCHIVOS = ['./', 'manifest.webmanifest', 'icono-192.png', 'icono-512.png', 'icono-maskable-512.png', 'apple-touch-icon.png'];
const FUENTES = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('historieta-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // La página: primero la red (para ver siempre la última versión), si no, la copia.
  if (req.mode === 'navigate' && url.origin === location.origin) {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put('./', copia)); }
      return r;
    }).catch(() => caches.match('./')));
    return;
  }

  // Íconos y manifest: la copia, si está.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req).then((g) => g || fetch(req)));
    return;
  }

  // Tipografías de Google: la copia al toque y se renueva por detrás.
  if (FUENTES.test(req.url)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const g = await c.match(req);
      const red = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => g);
      return g || red;
    }));
  }
});
