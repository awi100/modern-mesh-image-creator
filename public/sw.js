// Service Worker for Modern Mesh PWA
const CACHE_NAME = 'modern-mesh-v2';
const API_CACHE_NAME = 'modern-mesh-api-v1';

// Assets to cache on install (minimal - just the shell)
const PRECACHE_ASSETS = [
  '/icon.png',
  '/apple-touch-icon.png',
];

// Install event - cache minimal assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== API_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all pages immediately
  self.clients.claim();
});

// Helper: Check if request is a GET request for designs list or single design
function isDesignApiRequest(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  // Match /api/designs or /api/designs/[id]
  return url.pathname.match(/^\/api\/designs(\/[a-zA-Z0-9-]+)?$/);
}

// Helper: Stale-while-revalidate strategy
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  // Fetch fresh data in background
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        // Clone before caching
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch((error) => {
      console.log('[SW] Network request failed:', error);
      return cachedResponse;
    });

  // Return cached response immediately if available, otherwise wait for network
  return cachedResponse || fetchPromise;
}

// Fetch event
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Skip chrome-extension and other non-http(s) requests
  if (!event.request.url.startsWith('http')) return;

  // Handle design API requests with stale-while-revalidate
  if (isDesignApiRequest(event.request)) {
    event.respondWith(staleWhileRevalidate(event.request, API_CACHE_NAME));
    return;
  }

  // Skip other API requests - always go to network
  if (event.request.url.includes('/api/')) return;

  // For all other requests: network first, fallback to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone the response before caching
        const responseToCache = response.clone();

        // Cache successful responses for static assets
        if (response.status === 200) {
          const url = new URL(event.request.url);
          // Only cache static assets, not HTML pages
          if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ico)$/)) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
        }

        return response;
      })
      .catch(() => {
        // If network fails, try cache
        return caches.match(event.request);
      })
  );
});

// Background sync event - triggered when sync is registered and device comes online
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-designs') {
    event.waitUntil(notifyClientsToSync());
  }
});

// Notify all clients to start syncing
async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    client.postMessage({ type: 'SYNC_DESIGNS' });
  }
}

// Listen for messages from the client
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }

  // Client requesting to trigger sync
  if (event.data === 'triggerSync') {
    notifyClientsToSync();
  }

  // Clear API cache (for forced refresh)
  if (event.data === 'clearApiCache') {
    caches.delete(API_CACHE_NAME);
  }
});

// Push notification event (for future use)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();

  if (data.type === 'sync-available') {
    event.waitUntil(
      self.registration.showNotification('Modern Mesh', {
        body: 'Your offline changes have been synced.',
        icon: '/icon.png',
        badge: '/icon.png',
      })
    );
  }
});
