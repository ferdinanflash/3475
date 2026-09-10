// ================= SERVICE WORKER =================
// Same strategy as the Reservation Portal's sw.js. Primary purpose here is
// enabling OS-level notifications (registration.showNotification() is
// required for notifications to work on Android Chrome — the plain
// Notification() constructor alone does not). Offline/installable support
// comes along as a side benefit.
//   - navigations (the HTML page): network first, cached copy as fallback
//   - same-origin static assets (js/css/images/icons): cache first
//   - everything else (Supabase, CDN): never touched, always straight to network
//
// >>> Bump CACHE_VERSION on every deploy so old files are dropped. <<<
const CACHE_VERSION = '2026-09-11-1';
const CACHE_NAME = `transfer3475-${CACHE_VERSION}`;
const PRECACHE = [
    './',
    './index.html',
    './effect.css',
    './common.js',
    './script.js',
    './notifications.js',
    './opening-animation.js',
    './site.webmanifest',
    './android-chrome-192x192.png',
    './android-chrome-512x512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE))
            .catch(() => undefined)
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return; // Supabase / CDN: untouched

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request).then((response) => {
            if (response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
        }))
    );
});

// ================= NOTIFICATION HANDLING =================
// notifications.js (the page) decides WHEN a notification should be shown
// via registration.showNotification(). This worker only displays it and
// focuses/opens the app when the user taps it.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('./');
        })
    );
});
