const CACHE_NAME = 'hf-business-v2';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './assets/icon.svg'
];


// =========================================================
// INSTALL
// =========================================================

self.addEventListener(
  'install',
  event => {

    event.waitUntil(

      caches
        .open(CACHE_NAME)
        .then(cache =>
          cache.addAll(APP_SHELL)
        )

    );

    self.skipWaiting();

  }
);


// =========================================================
// ACTIVATE
// =========================================================

self.addEventListener(
  'activate',
  event => {

    event.waitUntil(

      caches.keys()
        .then(keys =>

          Promise.all(

            keys
              .filter(
                key =>
                  key !== CACHE_NAME
              )
              .map(
                key =>
                  caches.delete(key)
              )

          )

        )

    );

    self.clients.claim();

  }
);


// =========================================================
// FETCH
// =========================================================

self.addEventListener(
  'fetch',
  event => {

    const request =
      event.request;


    // No interceptar POST,
    // Supabase, etc.

    if (
      request.method !== 'GET'
    ) {

      return;

    }


    const url =
      new URL(
        request.url
      );


    // -----------------------------------------------------
    // SUPABASE NUNCA DEBE SALIR DEL CACHE
    // -----------------------------------------------------

    if (
      url.hostname.includes(
        'supabase.co'
      )
    ) {

      event.respondWith(
        fetch(request)
      );

      return;

    }


    // -----------------------------------------------------
    // APP.JS / INDEX / CSS / SW
    // SIEMPRE NETWORK FIRST
    // -----------------------------------------------------

    const isAppFile =
      url.pathname.endsWith(
        '/app.js'
      ) ||

      url.pathname.endsWith(
        '/index.html'
      ) ||

      url.pathname.endsWith(
        '/styles.css'
      ) ||

      url.pathname.endsWith(
        '/sw.js'
      );


    if (isAppFile) {

      event.respondWith(

        fetch(request, {
          cache: 'no-store'
        })
        .then(response => {

          if (
            response &&
            response.ok
          ) {

            const copy =
              response.clone();

            caches
              .open(CACHE_NAME)
              .then(cache =>
                cache.put(
                  request,
                  copy
                )
              );

          }

          return response;

        })
        .catch(() =>
          caches.match(request)
        )

      );

      return;

    }


    // -----------------------------------------------------
    // RESTO: CACHE FIRST
    // -----------------------------------------------------

    event.respondWith(

      caches
        .match(request)
        .then(cached => {

          if (cached) {

            return cached;

          }


          return fetch(request)
            .then(response => {

              if (
                response &&
                response.ok
              ) {

                const copy =
                  response.clone();

                caches
                  .open(CACHE_NAME)
                  .then(cache =>
                    cache.put(
                      request,
                      copy
                    )
                  );

              }

              return response;

            });

        })

    );

  }
);

