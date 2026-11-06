// 오프라인 저장: 한 번 열면 인터넷이 없어도 공룡 백과사전을 볼 수 있어요.
// 파일을 바꾸면 VERSION 숫자를 올려 주세요.
const VERSION = "dino-v3";
importScripts("data.js?v=3"); // DINOSAURS 목록

const CORE = [
  "./",
  "index.html",
  "style.css?v=3",
  "data.js?v=3",
  "app.js?v=3",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];
const IMAGES = DINOSAURS.flatMap((d) => [
  `images/thumb/${d.id}_wide.webp`,
  `images/${d.id}_wide.webp`,
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(CORE);
      // 그림은 하나가 실패해도 설치는 계속합니다.
      await Promise.allSettled(IMAGES.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== VERSION) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  // 그림: 저장된 것을 먼저 씁니다.
  if (req.destination === "image") {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          })
      )
    );
    return;
  }

  // 페이지와 코드: 인터넷이 되면 새 버전, 안 되면 저장된 것.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("index.html");
        return Response.error();
      })
  );
});
