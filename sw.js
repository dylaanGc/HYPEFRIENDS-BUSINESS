const CACHE_NAME = 'hf-business-v3';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

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

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /*
   * IMPORTANTE:
   * Nunca cacheamos peticiones de Supabase.
   * Los datos siempre vienen de la nube.
   */
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('supabase.com')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  /*
   * Para archivos de la aplicación:
   * primero intenta obtener la versión nueva de Internet.
   * Si no hay conexión, utiliza la copia almacenada.
   */
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy);
          });
        }

        return response;
      })
      .catch(() => {
        return caches.match(request).then(cached => {
          return cached || caches.match('./index.html');
        });
      })
  );
});
