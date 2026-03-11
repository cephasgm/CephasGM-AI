const CACHE_NAME = "cephasgm-ai-v1";
const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json",
  "/login-signup.html"
];

// Install event
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log("Cache opened");
        return cache.addAll(urlsToCache).catch(error => {
          console.error("Failed to cache:", error);
        });
      })
  );
});

// Fetch event - network first, then cache
self.addEventListener("fetch", event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clone the response
        const responseClone = response.clone();
        
        // Open cache and store the new response
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
        
        return response;
      })
      .catch(() => {
        // If network fails, try cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If not in cache, return offline page or fallback
          return new Response("Offline - Content not available");
        });
      })
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});
