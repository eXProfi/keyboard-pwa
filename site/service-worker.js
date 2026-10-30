/* Cache complete app versions; updates never reload an active patient session. */
const CACHE_PREFIX = `keyboard-pwa:${self.registration.scope}:`;
const LEGACY_CACHE_PREFIX = `russian-keyboard:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}head-blink-v1-__BUILD_ID__`;
const LANGUAGES = ['ru', 'uk', 'en', 'de', 'es', 'pt', 'it'];
const APP_FILES = [
  './', './index.html', './manifest.webmanifest', './apple-touch-icon.png',
  './LICENSE.txt', './vendor/mediapipe/LICENSE', './models/LICENSE',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './src/app.js', './src/styles.css', './src/bridge-client.js',
  './src/input-preferences.js',
  './src/navigation.js',
  './src/input-panel.js', './src/external-click.js',
  './src/tracking/engine.js', './src/tracking/controller.js', './src/tracking/panel.js',
  './src/tracking/eye-geometry.js',
  './src/tracking/mouth-geometry.js',
  './src/tracking/preferences.js', './src/tracking/tuning-panel.js',
  './vendor/mediapipe/vision_bundle.mjs',
  './vendor/mediapipe/wasm/vision_wasm_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  './vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm',
  './models/face_landmarker.task',
  ...LANGUAGES.flatMap(code => [`./locales/${code}.json`, `./layouts/${code}.json`])
];
self.addEventListener('install', event => {
  // CRITICAL: any missing asset fails installation, retaining the previous app.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
  // CRITICAL: the original worker searched all caches for offline navigation.
  // Remove its scope's old HTML only after this version fully installed and
  // old clients closed, or an upgrade can fall back to the obsolete interface.
  // Preferences live in localStorage and are never part of this cleanup.
  await Promise.all(keys.filter(key =>
    (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) || key.startsWith(LEGACY_CACHE_PREFIX))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
      !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') {
      const entry = await cache.match('./index.html');
      if (entry) return entry;
    }
    return fetch(event.request);
  })());
});
