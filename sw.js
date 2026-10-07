const CACHE_NAME = 'hf-business-v2';

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

  // Solo nos interesa GET
  if (request.method !== 'GET') return;

  // Supabase NUNCA debe salir del caché
  if (
    request.url.includes('supabase.co') ||
    request.url.includes('/rest/v1/') ||
    request.url.includes('/realtime/')
  ) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Para los archivos de la aplicación:
  // intenta primero internet para recibir cambios de GitHub.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy);
          });
        }

        return response;
      })
      .catch(() => caches.match(request))
  );
});
