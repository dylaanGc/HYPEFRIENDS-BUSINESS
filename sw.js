/* =========================================================
   HYPEFRIENDS BUSINESS — SERVICE WORKER
   Sincronización y actualización de archivos
   ========================================================= */

const CACHE_NAME = 'hf-business-v2';

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './assets/icon.svg'
];

/* ---------------------------------------------------------
   INSTALL
   --------------------------------------------------------- */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ---------------------------------------------------------
   ACTIVATE
   Elimina cachés viejos
   --------------------------------------------------------- */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ---------------------------------------------------------
   FETCH
   IMPORTANTE:
   - JS / CSS / HTML siempre intentan red primero.
   - Supabase nunca se guarda en caché.
   - Si no hay internet, usa caché como respaldo.
   --------------------------------------------------------- */

self.addEventListener('fetch', event => {

  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  /* ---------------------------------------------
     NUNCA CACHEAR SUPABASE
     --------------------------------------------- */

  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.in')
  ) {
    event.respondWith(
      fetch(request)
    );
    return;
  }

  /* ---------------------------------------------
     ARCHIVOS DE LA APP
     Network First
     --------------------------------------------- */

  const isAppFile =
    request.destination === 'document' ||
    request.destination === 'script' ||
    request.destination === 'style' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css');

  if (isAppFile) {

    event.respondWith(
      fetch(request)
        .then(response => {

          if (response && response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(request, copy);
              });
          }

          return response;
        })
        .catch(() => {
          return caches.match(request);
        })
    );

    return;
  }

  /* ---------------------------------------------
     IMÁGENES / OTROS RECURSOS
     Cache First
     --------------------------------------------- */

  event.respondWith(
    caches.match(request)
      .then(cached => {

        if (cached) {
          return cached;
        }

        return fetch(request)
          .then(response => {

            if (response && response.ok) {
              const copy = response.clone();

              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(request, copy);
                });
            }

            return response;
          });
      })
  );

});
