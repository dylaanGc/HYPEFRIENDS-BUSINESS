const CACHE_NAME = 'hf-business-v3';

const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/icon.svg'
];

/*
  INSTALACIÓN
*/
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

/*
  ACTIVACIÓN
  Borra versiones anteriores del caché.
*/
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

/*
  FETCH

  IMPORTANTE:
  Supabase NUNCA se guarda en caché.

  Esto evita que un dispositivo vea datos viejos.
*/
self.addEventListener('fetch', event => {

  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = request.url;

  /*
    NO CACHEAR SUPABASE
  */
  if (
    url.includes('supabase.co') ||
    url.includes('/rest/v1/') ||
    url.includes('/realtime/') ||
    url.includes('/auth/v1/')
  ) {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request))
    );

    return;
  }

  /*
    ARCHIVOS DE LA APP

    Primero intenta Internet.
    Si no hay Internet, usa caché.
  */
  event.respondWith(

    fetch(request)
      .then(response => {

        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {

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
});
