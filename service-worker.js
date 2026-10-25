const CACHE_VERSION = "russian-keyboard-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

/*
  При установке сохраняем все необходимые файлы.
  Никаких внешних CDN или библиотек приложение не использует.
*/
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting())
  );
});

/*
  Удаляем старые версии кэша после обновления приложения.
*/
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/*
  Для навигации используем стратегию:
  сеть -> кэш -> локальный index.html.

  Для остальных файлов:
  кэш -> сеть.

  Поэтому после первого успешного открытия приложение продолжит
  запускаться даже при полном отсутствии интернета.
*/
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();

          caches.open(CACHE_VERSION).then((cache) => {
            cache.put("./index.html", copy);
          });

          return response;
        })
        .catch(async () => {
          const cached =
            await caches.match(event.request);

          return (
            cached ||
            (await caches.match("./index.html"))
          );
        })
    );

    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        if (
          !networkResponse ||
          networkResponse.status !== 200 ||
          networkResponse.type === "opaque"
        ) {
          return networkResponse;
        }

        const copy = networkResponse.clone();

        caches.open(CACHE_VERSION).then((cache) => {
          cache.put(event.request, copy);
        });

        return networkResponse;
      });
    })
  );
});
