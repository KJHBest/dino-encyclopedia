// 오프라인 저장: 한 번 열면 인터넷 없이도 놀 수 있어요.
// 파일을 바꾸면 VERSION 숫자를 올려 주세요.
const VERSION = "dinopark-v2";

const CORE = [
  "./",
  "index.html",
  "css/style.css?v=2",
  "js/main.js?v=2",
  "js/world.js",
  "js/jeep.js",
  "js/input.js",
  "js/dinos.js",
  "js/speech.js",
  "js/dinodata.js",
  "vendor/three/three.module.js",
  "vendor/three/three.core.js",
  "vendor/three/addons/loaders/GLTFLoader.js",
  "vendor/three/addons/utils/BufferGeometryUtils.js",
  "vendor/three/addons/utils/SkeletonUtils.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];
const IDS = [
  "tyrannosaurus", "triceratops", "stegosaurus", "brachiosaurus", "velociraptor", "spinosaurus",
  "ankylosaurus", "pachycephalosaurus", "parasaurolophus", "iguanodon", "diplodocus", "allosaurus",
  "dilophosaurus", "carnotaurus", "therizinosaurus", "gallimimus", "protoceratops", "styracosaurus",
  "coelophysis", "plateosaurus", "pteranodon", "koreaceratops",
];
const ASSETS = IDS.flatMap((id) => [
  `models/${id}.glb`, `models/${id}.webp`, `models/meta/${id}.json`, `../images/thumb/${id}_wide.webp`,
]);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    // 공룡 파일은 하나가 없어도 설치는 계속해요.
    await Promise.allSettled(ASSETS.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // 공룡 백과사전의 저장 공간은 건드리지 않아요
    for (const key of await caches.keys()) if (key.startsWith("dinopark-") && key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

// 큰 파일(모델, 그림)은 저장된 것을 먼저, 나머지는 인터넷에서 새것을 먼저 받아요.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const big = /\/(models|images|vendor|icons)\//.test(req.url);
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (big) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req)) || (req.mode === "navigate" ? cache.match("index.html") : Response.error());
    }
  })());
});
