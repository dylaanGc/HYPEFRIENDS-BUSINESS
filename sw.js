const CACHE_NAME = 'hf-business-v27';
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './legacy-migration.js',
  './manifest.json',
  './assets/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', event => {
  const payload=event.data?.json();
  if(!payload?.orderId||! /^[0-9a-f-]{36}$/i.test(payload.orderId))return;
  const destination=new URL('./',self.registration.scope);
  destination.searchParams.set('webOrderId',payload.orderId);
  event.waitUntil(self.registration.showNotification(payload.title||'Nueva compra del sitio web', {
    body:payload.body||`Pedido ${payload.orderNumber||''} · ${payload.customerName||'Cliente'}`,
    icon:'./assets/icon.svg',
    badge:'./assets/icon.svg',
    tag:`web-order-${payload.orderId}`,
    data:{url:destination.href}
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination=new URL(event.notification.data?.url||'./',self.registration.scope);
  if(destination.origin!==self.location.origin)destination.href=self.registration.scope;
  event.waitUntil((async()=>{
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of clients){
      if(new URL(client.url).origin===self.location.origin){
        await client.navigate(destination.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(destination.href);
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = request.url;
  if (
    url.includes('supabase.co') ||
    url.includes('/rest/v1/') ||
    url.includes('/realtime/') ||
    url.includes('/auth/v1/')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
