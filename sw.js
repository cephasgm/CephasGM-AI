const CACHE_NAME = 'cephasgm-ai-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/login-signup.html',
  '/manifest.json'
];

// Install event - cache core files
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(error => console.log('Cache install error:', error))
  );
});

// Fetch event - network first, cache fallback
self.addEventListener('fetch', event => {
  // Skip caching for external URLs
  if (event.request.url.startsWith('http') && !event.request.url.includes(window.location.hostname)) {
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});
