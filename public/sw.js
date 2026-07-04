const CACHE_NAME = 'habitify-cache-v1';
const urlsToCache = [
  '/',
  '/manifest.json',
  '/logo.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  // Only cache GET requests and non-api calls
  if (event.request.method !== 'GET' || event.request.url.includes('/api/') || event.request.url.includes('/_next/')) {
    return;
  }
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(
          networkResponse => {
            if(!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            return networkResponse;
          }
        ).catch(() => {
          // Offline fallback
          return caches.match('/');
        });
      })
  );
});
