/**
 * CephasGM SI — sw.js
 * ----------------------------------------------------------------------------
 * Service Worker: offline shell + layered caching.
 *
 * Strategies:
 *   Navigate requests  → network-first (3s timeout) → cache → offline page
 *   Shell (JS/CSS/HTML)→ stale-while-revalidate
 *   API (/chat, /v1…)  → network-only + structured offline response
 *   Media (img/video)  → cache-first, LRU-trimmed to MAX_RUNTIME
 *   Cross-origin       → pass-through (Firebase, CDNs handle their own cache)
 *
 * Update flow: SW does NOT skipWaiting automatically. It posts
 * SW_UPDATE_AVAILABLE to clients; app sends SKIP_WAITING to apply.
 *
 * Bump BUILD on every deploy. Old shell caches are deleted on activate.
 * ----------------------------------------------------------------------------
 */

'use strict';

/* ============================================================================
 * Config
 * ========================================================================== */
const BUILD = '2025-01-15a';                         // ← bump per deploy
const SHELL_CACHE = `si-shell-${BUILD}`;
const RUNTIME_CACHE = `si-runtime-${BUILD}`;
const MAX_RUNTIME_ENTRIES = 60;
const NETWORK_TIMEOUT_MS = 3000;

// Files required to boot the app offline. Anything not in this list is
// handled by runtime caching.
const PRECACHE = [
  '/',
  '/index.html',
  '/login-signup.html',
  '/manifest.json',
  '/config.js',
  '/app.js',
  '/ai.js',
  '/voice.js',
  '/memory.js',
  '/agents.js',
  '/image.js'
];

// Routes that must NEVER be cached (auth-sensitive, dynamic).
const API_PATTERN = /^\/(chat|code|research|video|task|agents|generate|memory|graph|gpu|models|cluster|user|admin|v1|plugins|license|health|status|metrics)(\/|$)/;

// Patterns for the shell — stale-while-revalidate.
const SHELL_PATTERN = /\.(?:js|css|html|json|webmanifest|woff2?|ttf|otf)$/i;

// Patterns for media — cache-first.
const MEDIA_PATTERN = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav)$/i;

/* ============================================================================
 * Install — precache shell (individually, so one 404 doesn't kill install)
 * ========================================================================== */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const results = await Promise.allSettled(
      PRECACHE.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'no-cache' });
          if (res.ok) await cache.put(url, res.clone());
          else console.warn(`[SW] precache skipped ${url} (HTTP ${res.status})`);
        } catch (e) {
          console.warn(`[SW] precache failed ${url}:`, e.message);
        }
      })
    );
    const ok = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[SW ${BUILD}] precache complete: ${ok}/${PRECACHE.length}`);
    // Do NOT call skipWaiting here — wait for client signal.
  })());
});

/* ============================================================================
 * Activate — clean old caches, claim clients
 * ========================================================================== */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => n.startsWith('si-') && n !== SHELL_CACHE && n !== RUNTIME_CACHE)
        .map(n => { console.log('[SW] deleting old cache', n); return caches.delete(n); })
    );
    await self.clients.claim();
    console.log(`[SW ${BUILD}] activated`);
  })());
});

/* ============================================================================
 * Message channel — client ↔ SW
 * ========================================================================== */
self.addEventListener('message', (event) => {
  const data = event.data || {};
  switch (data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'GET_VERSION':
      event.ports?.[0]?.postMessage({ version: BUILD });
      break;
    case 'CLEAR_CACHES':
      event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(n => n.startsWith('si-')).map(n => caches.delete(n)));
        event.ports?.[0]?.postMessage({ cleared: true });
      })());
      break;
    default:
      break;
  }
});

/* ============================================================================
 * Fetch — route by request type
 * ========================================================================== */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only GET is cacheable
  if (req.method !== 'GET') {
    // Special case: POST to API while offline → structured offline response
    if (isApi(req)) {
      event.respondWith(networkOnlyWithOfflineSignal(req));
    }
    return;
  }

  const url = new URL(req.url);

  // Cross-origin: pass through
  if (url.origin !== self.location.origin) return;

  // Range requests (video/audio seeking) — bypass cache
  if (req.headers.get('range')) return;

  // API GETs — never cache
  if (isApi(req)) {
    event.respondWith(networkOnlyWithOfflineSignal(req));
    return;
  }

  // Navigations — network-first with cache fallback + offline page
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirstWithOfflinePage(req));
    return;
  }

  // Media — cache-first
  if (MEDIA_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
    return;
  }

  // Shell assets — stale-while-revalidate
  if (SHELL_PATTERN.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }

  // Default — network with cache fallback
  event.respondWith(networkFirstWithCache(req));
});

/* ============================================================================
 * Strategy: stale-while-revalidate
 * ========================================================================== */
async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const network = fetch(req)
    .then(res => {
      if (res && res.status === 200 && res.type !== 'opaque') {
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);

  // Return cached immediately if we have it; refresh in the background
  return cached || (await network) || new Response('', { status: 504 });
}

/* ============================================================================
 * Strategy: cache-first (media)
 * ========================================================================== */
async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type !== 'opaque') {
      await cache.put(req, res.clone());
      trimCache(cacheName, MAX_RUNTIME_ENTRIES).catch(() => {});
    }
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

/* ============================================================================
 * Strategy: network-first with cache fallback
 * ========================================================================== */
async function networkFirstWithCache(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
    if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response('', { status: 504, statusText: 'Offline' });
  }
}

/* ============================================================================
 * Strategy: network-first for navigations, fall back to cached shell,
 *           then to an inline offline page
 * ========================================================================== */
async function networkFirstWithOfflinePage(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
    if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch {
    // Exact match
    const cached = await cache.match(req);
    if (cached) return cached;
    // Cached index as SPA fallback
    const shell = await cache.match('/index.html') || await cache.match('/');
    if (shell) return shell;
    // Nothing cached at all — inline offline page
    return offlineResponsePage();
  }
}

/* ============================================================================
 * Strategy: network-only for API; when network fails, return a
 *           structured 503 so the client can react (queue, switch to
 *           local Ollama, show offline banner, etc.)
 * ========================================================================== */
async function networkOnlyWithOfflineSignal(req) {
  try {
    return await fetch(req);
  } catch {
    return new Response(
      JSON.stringify({
        offline: true,
        error: 'Network unavailable',
        hint: 'Client should queue this request or route to local inference',
        ts: Date.now()
      }),
      {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'application/json', 'X-Offline': '1' }
      }
    );
  }
}

/* ============================================================================
 * Helpers
 * ========================================================================== */
function isApi(req) {
  try {
    const u = new URL(req.url);
    return u.origin === self.location.origin && API_PATTERN.test(u.pathname);
  } catch { return false; }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

/* ============================================================================
 * Offline page (inlined — no separate file needed)
 * ========================================================================== */
function offlineResponsePage() {
  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — CephasGM SI</title>
<style>
  :root{--bg:#0b0d10;--surface:#171b22;--border:#232a35;--text:#e8eaed;--muted:#9aa3b2;--accent:#f5b301;}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;
       min-height:100vh;display:grid;place-items:center;padding:24px}
  .card{max-width:420px;text-align:center;background:var(--surface);border:1px solid var(--border);
        border-radius:16px;padding:36px 28px}
  .mark{width:56px;height:56px;border-radius:14px;margin:0 auto 20px;
        background:linear-gradient(135deg,var(--accent) 0%,#c98f00 100%);
        display:grid;place-items:center;font-family:Georgia,serif;font-weight:700;font-size:22px;color:#0b0d10}
  h1{font-size:20px;font-weight:600;margin-bottom:8px}
  p{color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:24px}
  button{background:var(--accent);color:#0b0d10;border:none;border-radius:10px;
         padding:11px 22px;font-size:14px;font-weight:600;cursor:pointer}
  button:hover{background:#ffc72c}
  .hint{margin-top:20px;font-size:12px;color:#6b7382}
</style></head>
<body><div class="card">
  <div class="mark">SI</div>
  <h1>You're offline</h1>
  <p>CephasGM SI couldn't reach the network. Cached pages still work, and local inference will resume automatically when available.</p>
  <button onclick="location.reload()">Retry</button>
  <div class="hint">Copyright © 2025 Cephas GM</div>
</div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/* ============================================================================
 * Detect new SW taking over → tell clients
 * ========================================================================== */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: BUILD }));
  })());
});

console.log(`[SW ${BUILD}] loaded`);
