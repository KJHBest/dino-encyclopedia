// 공원 세상: 섬 땅, 호수, 길, 나무, 바위, 구역 표지판, 하늘
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const WORLD = {
  radius: 175, // 섬 크기 (m)
  driveRadius: 150, // 지프가 갈 수 있는 끝
  water: 0, // 물 높이
  ring: 72, // 둥근 길 반지름
};

// 구역: 공룡이 사는 곳 (x, z는 m, 북쪽이 -z)
export const ZONES = {
  tria: { name: "트라이아스기 숲", emoji: "🌴", x: -92, z: 22, r: 26, trees: "palm" },
  jura: { name: "쥐라기 계곡", emoji: "🦕", x: -10, z: -102, r: 42, trees: "pine" },
  jura2: { name: "쥐라기 숲", emoji: "🌲", x: -88, z: -58, r: 24, trees: "pine" },
  cret: { name: "백악기 평원", emoji: "🦖", x: 70, z: 78, r: 44, trees: "broad" },
  cret2: { name: "백악기 언덕", emoji: "🌋", x: -28, z: 104, r: 30, trees: "broad" },
  lake: { name: "스피노 호수", emoji: "🏞️", x: 88, z: -42, r: 34, trees: "palm" },
  sky: { name: "하늘", emoji: "☁️", x: 0, z: 0, r: 95, trees: "none" },
};
export const LAKE = { x: 92, z: -46, r: 26 };

/* ---------- 결정적 노이즈 (항상 같은 땅) ---------- */
function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, z) {
  let s = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < 4; i++) {
    s += vnoise(x * f, z * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// 길: 가운데 광장에서 네 방향 + 둥근 길
const SPOKES = [0.35, 1.95, 3.4, 4.75].map((a) => [Math.cos(a), Math.sin(a)]);
export function roadDistance(x, z) {
  const r = Math.hypot(x, z);
  let d = Math.abs(r - WORLD.ring);
  for (const [cx, cz] of SPOKES) {
    const t = Math.max(0, Math.min(WORLD.ring, x * cx + z * cz));
    d = Math.min(d, Math.hypot(x - cx * t, z - cz * t));
  }
  return d;
}

// 땅 높이 (m)
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = 1.2 + (fbm(x * 0.018 + 10, z * 0.018 - 4) - 0.5) * 9;
  h += (fbm(x * 0.06, z * 0.06) - 0.5) * 1.2;
  // 북쪽 끝 산
  const north = smooth(110, 165, r) * smooth(0.1, 0.8, -z / (r + 1e-6));
  h += north * (10 + fbm(x * 0.03, z * 0.03) * 22);
  // 가운데 광장과 길은 평평하게
  const flat = 1 - smooth(4, 12, roadDistance(x, z));
  const plaza = 1 - smooth(14, 26, r);
  const keep = Math.max(flat * 0.85, plaza);
  h = h * (1 - keep) + 1.0 * keep;
  // 호수
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z);
  h -= 7.5 * (1 - smooth(LAKE.r * 0.35, LAKE.r * 1.15, ld));
  // 섬 가장자리 → 바닷가 → 바다
  h -= smooth(WORLD.driveRadius - 8, WORLD.radius + 10, r) * (h + 6);
  return h;
}

/* ---------- 땅 ---------- */
function makeTerrain() {
  const size = 420, seg = 210;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grass1 = new THREE.Color("#7fb84e"), grass2 = new THREE.Color("#5f9a3c"), dry = new THREE.Color("#b3b05a");
  const sand = new THREE.Color("#e8d39a"), dirt = new THREE.Color("#c99a62"), rock = new THREE.Color("#8d8578"), mud = new THREE.Color("#8a7a55");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = fbm(x * 0.05 + 3, z * 0.05);
    c.copy(grass1).lerp(grass2, n);
    // 백악기 평원은 조금 마른 풀
    const dc = Math.hypot(x - ZONES.cret.x, z - ZONES.cret.z);
    c.lerp(dry, (1 - smooth(20, 60, dc)) * 0.45);
    if (h > 9) c.lerp(rock, smooth(9, 16, h));
    const rd = roadDistance(x, z);
    c.lerp(dirt, 1 - smooth(2.6, 4.2, rd));
    if (Math.hypot(x, z) < 20) c.lerp(dirt, 0.6 + 0.2 * n);
    if (h < 0.9) c.lerp(sand, smooth(0.9, 0.2, h));
    if (h < -0.4) c.lerp(mud, smooth(-0.4, -2.5, h));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}

function makeWater() {
  const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: "#3aa6d8", transparent: true, opacity: 0.82, roughness: 0.15, metalness: 0.1,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = WORLD.water;
  m.receiveShadow = true;
  return m;
}

/* ---------- 하늘 ---------- */
function makeSky() {
  const geo = new THREE.SphereGeometry(900, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    uniforms: { top: { value: new THREE.Color("#4fa3e8") }, bottom: { value: new THREE.Color("#cfe8f5") } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
void main() {
  float h = normalize(vP).y;
  gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.02, 0.45, h)), 1.0);
  #include <colorspace_fragment>
}`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  return sky;
}

function makeClouds() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: "#ffffff", emissive: "#bcd7ee", emissiveIntensity: 0.35 });
  const ball = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Group();
    const n = 3 + Math.floor(hash(i, 7) * 4);
    for (let j = 0; j < n; j++) {
      const b = new THREE.Mesh(ball, mat);
      const s = 6 + hash(i, j) * 7;
      b.scale.set(s * 1.4, s * 0.7, s);
      b.position.set((j - n / 2) * 7, hash(j, i) * 3, hash(i + j, 3) * 6);
      c.add(b);
    }
    const a = (i / 14) * Math.PI * 2;
    const r = 120 + hash(i, 1) * 200;
    c.position.set(Math.cos(a) * r, 70 + hash(i, 2) * 40, Math.sin(a) * r);
    g.add(c);
  }
  g.userData.update = (dt) => { g.rotation.y += dt * 0.004; };
  return g;
}

/* ---------- 나무, 바위 (인스턴스로 가볍게) ---------- */
function treeKinds() {
  const trunkMat = new THREE.MeshLambertMaterial({ color: "#7a5332" });
  const pine = {
    trunk: new THREE.CylinderGeometry(0.25, 0.4, 3, 6).translate(0, 1.5, 0),
    crown: new THREE.ConeGeometry(2.4, 7, 7).translate(0, 6, 0),
    crownMat: new THREE.MeshLambertMaterial({ color: "#2f6b3a" }),
    trunkMat, radius: 0.9,
  };
  const broad = {
    trunk: new THREE.CylinderGeometry(0.3, 0.45, 3.2, 6).translate(0, 1.6, 0),
    crown: new THREE.IcosahedronGeometry(2.3, 0).translate(0, 4.8, 0),
    crownMat: new THREE.MeshLambertMaterial({ color: "#4f8f3a", flatShading: true }),
    trunkMat, radius: 1.0,
  };
  // 야자/소철: 줄기 + 납작한 잎 다발
  const leaves = [];
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.ConeGeometry(0.6, 4.2, 4);
    leaf.rotateZ(Math.PI / 2 - 0.35);
    leaf.translate(1.9, 0, 0);
    leaf.rotateY((i / 6) * Math.PI * 2);
    leaf.translate(0, 5.2, 0);
    leaves.push(leaf);
  }
  const palmCrown = mergeGeos(leaves);
  const palm = {
    trunk: new THREE.CylinderGeometry(0.22, 0.35, 5.2, 6).translate(0, 2.6, 0),
    crown: palmCrown,
    crownMat: new THREE.MeshLambertMaterial({ color: "#5aa843", flatShading: true }),
    trunkMat: new THREE.MeshLambertMaterial({ color: "#8f6a3e" }), radius: 0.7,
  };
  const fern = {
    trunk: null,
    crown: new THREE.ConeGeometry(1.3, 1.4, 6).translate(0, 0.6, 0),
    crownMat: new THREE.MeshLambertMaterial({ color: "#3f8a35", flatShading: true }),
    radius: 0,
  };
  return { pine, broad, palm, fern };
}

function mergeGeos(list) {
  // 간단 합치기 (위치/법선만)
  let count = 0;
  list.forEach((g) => { g = g.toNonIndexed(); count += g.attributes.position.count; });
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  list.forEach((g0) => {
    const g = g0.toNonIndexed();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  return out;
}

// 카메라를 가리면 카메라가 앞으로 오는 물체
export const occluders = [];

// 부딪히는 물체(나무, 바위, 표지판) — 칸으로 나눠 빨리 찾기
export const colliders = {
  cell: 10,
  grid: new Map(),
  add(x, z, r) {
    const k = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push({ x, z, r });
  },
  near(x, z) {
    const out = [];
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = this.grid.get(`${cx + i},${cz + j}`);
      if (a) out.push(...a);
    }
    return out;
  },
};

function zoneAt(x, z) {
  let best = null, bd = Infinity;
  for (const [k, zn] of Object.entries(ZONES)) {
    if (k === "sky") continue;
    const d = Math.hypot(x - zn.x, z - zn.z) / (zn.r + 30);
    if (d < bd) { bd = d; best = zn; }
  }
  return bd < 1.6 ? best : null;
}

// 나무 자리 (3D 나무로 바꿀 때 다시 써요)
let treeSpots = null;
let vegGroup = null;

function makeVegetation(low) {
  const kinds = treeKinds();
  const spots = { pine: [], broad: [], palm: [], fern: [] };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 2000; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * (WORLD.driveRadius + 12);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < 1.0 || roadDistance(x, z) < 7 || Math.hypot(x, z) < 28) continue;
    const zn = zoneAt(x, z);
    // 구역 가운데는 공룡이 다니게 조금 비워 둡니다
    if (zn && Math.hypot(x - zn.x, z - zn.z) < zn.r * 1.05 && rnd() < 0.93) continue;
    const dens = fbm(x * 0.03 + 50, z * 0.03);
    if (rnd() > dens * 1.25) continue;
    let kind = zn ? zn.trees : (h > 7 ? "pine" : rnd() < 0.5 ? "broad" : "pine");
    if (kind === "none") kind = "broad";
    if (rnd() < 0.28) kind = "fern";
    const sc = 0.75 + rnd() * 0.65, rot = rnd() * Math.PI * 2;
    // 가벼운 모드(옛 기기)에서는 나무를 반만 심어요
    if (low && i % 2) continue;
    spots[kind].push([x, h, z, sc, rot]);
  }
  treeSpots = spots;
  const g = new THREE.Group();
  for (const [name, list] of Object.entries(spots)) {
    const k = kinds[name];
    const parts = [];
    if (k.trunk) parts.push(new THREE.InstancedMesh(k.trunk, k.trunkMat, list.length));
    parts.push(new THREE.InstancedMesh(k.crown, k.crownMat, list.length));
    list.forEach(([x, h, z, sc, rot], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      m.compose(p.set(x, h - 0.2, z), q, s.set(sc, sc, sc));
      parts.forEach((im) => im.setMatrixAt(i, m));
      if (k.radius) colliders.add(x, z, k.radius * sc);
    });
    parts.forEach((im) => {
      im.castShadow = name !== "fern" && !low;
      im.receiveShadow = false;
      im.userData.treeKind = name; // 3D 나무가 오면 이걸 빼요
      g.add(im);
    });
  }
  // 바위
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: "#9a9184", flatShading: true });
  const rocks = [];
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2, r = 25 + Math.sqrt(rnd()) * (WORLD.driveRadius - 20);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < 0.6 || roadDistance(x, z) < 6) continue;
    rocks.push([x, h, z, 0.4 + rnd() * rnd() * 1.8, rnd() * 6]);
  }
  const rim = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
  rocks.forEach(([x, h, z, sc, rot], i) => {
    q.setFromEuler(new THREE.Euler(rot, rot * 2, rot * 0.5));
    m.compose(p.set(x, h + sc * 0.2, z), q, s.set(sc * 1.3, sc * 0.8, sc));
    rim.setMatrixAt(i, m);
    if (sc > 0.9) colliders.add(x, z, sc * 1.1);
  });
  rim.castShadow = !low;
  rim.name = "rocks";
  occluders.push(rim);
  g.add(rim);
  vegGroup = g;
  return g;
}

/* ---------- 3D 나무 (Hunyuan3D로 만든 모델) ---------- */
// 종류마다 모델과 크기(m). 공원 전체를 60m 칸으로 나눠, 화면에 안 보이는 칸은 그리지 않아요.
const TREE_MODELS = {
  pine: [{ id: "tree_pine", height: 9.5 }],
  broad: [{ id: "tree_broad", height: 7.2 }],
  palm: [{ id: "tree_palm", height: 7.6 }],
  fern: [{ id: "tree_cycad", height: 2.3 }, { id: "tree_bush", width: 3.4, every: 4 }],
};
const CHUNK = 60;

export async function upgradeTrees(base, { shadows = true } = {}) {
  if (!treeSpots || !vegGroup) return;
  const loader = new GLTFLoader(), texLoader = new THREE.TextureLoader();
  const ids = [...new Set(Object.values(TREE_MODELS).flat().map((v) => v.id))];
  const loaded = {};
  await Promise.all(ids.map(async (id) => {
    try {
      const [gltf, map, meta] = await Promise.all([
        loader.loadAsync(`${base}/${id}.glb`),
        texLoader.loadAsync(`${base}/${id}.webp`),
        fetch(`${base}/meta/${id}.json`).then((r) => r.json()),
      ]);
      let geo = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; });
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      loaded[id] = { geo, meta, mat: new THREE.MeshLambertMaterial({ map }) };
    } catch (e) {
      console.warn(`${id}: 3D 나무를 못 불러와서 간단한 나무를 그대로 써요`, e.message);
    }
  }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [kind, variants] of Object.entries(TREE_MODELS)) {
    if (!variants.every((v) => loaded[v.id])) continue; // 하나라도 없으면 이 종류는 그대로
    // 자리마다 어떤 모델을 쓸지 정하고, 칸별로 모으기
    const groups = new Map();
    treeSpots[kind].forEach((spot, i) => {
      const v = variants.find((vv) => vv.every && i % vv.every === 0) || variants.find((vv) => !vv.every);
      const key = `${v.id}|${Math.floor(spot[0] / CHUNK)},${Math.floor(spot[2] / CHUNK)}`;
      if (!groups.has(key)) groups.set(key, { v, list: [] });
      groups.get(key).list.push(spot);
    });
    for (const { v, list } of groups.values()) {
      const L = loaded[v.id];
      const im = new THREE.InstancedMesh(L.geo, L.mat, list.length);
      list.forEach(([x, h, z, sc, rot], i) => {
        const k = (v.height ? v.height / L.meta.height : v.width) * sc;
        q.setFromAxisAngle(up, rot);
        m.compose(p.set(x, h - 0.15, z), q, sv.set(k, k, k));
        im.setMatrixAt(i, m);
      });
      im.computeBoundingSphere();
      im.castShadow = shadows && kind !== "fern";
      im.userData.treeModel = v.id;
      vegGroup.add(im);
    }
    // 예전 간단한 나무 빼기
    vegGroup.children.filter((o) => o.userData.treeKind === kind).forEach((o) => vegGroup.remove(o));
  }
}

/* ---------- 표지판, 광장 ---------- */
function labelTexture(text, sub, bg = "#2f7d4f") {
  const cv = document.createElement("canvas");
  cv.width = 512; cv.height = 256;
  const x = cv.getContext("2d");
  x.fillStyle = bg;
  // 모서리가 둥근 네모 (옛 아이패드에는 roundRect가 없어서 직접 그려요)
  x.beginPath();
  const r = 36, X0 = 8, Y0 = 8, X1 = 504, Y1 = 248;
  x.moveTo(X0 + r, Y0);
  x.arcTo(X1, Y0, X1, Y1, r);
  x.arcTo(X1, Y1, X0, Y1, r);
  x.arcTo(X0, Y1, X0, Y0, r);
  x.arcTo(X0, Y0, X1, Y0, r);
  x.closePath();
  x.fill();
  x.lineWidth = 10;
  x.strokeStyle = "#f6e7b8";
  x.stroke();
  x.fillStyle = "#fffbe8";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.font = "bold 76px 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
  x.fillText(text, 256, sub ? 104 : 128);
  if (sub) {
    x.font = "bold 44px 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
    x.fillStyle = "#ffe08a";
    x.fillText(sub, 256, 186);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeSign(text, sub, x, z, faceX, faceZ, scale = 1) {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: "#8a5a2b" });
  const post = new THREE.CylinderGeometry(0.15, 0.18, 4, 6);
  [-1.6, 1.6].forEach((dx) => {
    const p = new THREE.Mesh(post, wood);
    p.position.set(dx, 2, 0);
    p.castShadow = true;
    g.add(p);
  });
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 2.2),
    new THREE.MeshBasicMaterial({ map: labelTexture(text, sub), side: THREE.DoubleSide }));
  board.position.set(0, 3.2, 0.2);
  g.add(board);
  g.scale.setScalar(scale);
  g.position.set(x, heightAt(x, z), z);
  g.lookAt(faceX, g.position.y, faceZ);
  colliders.add(x, z, 2.2 * scale);
  return g;
}

function makePlaza() {
  const g = new THREE.Group();
  // 입구 문: 나무 기둥 두 개 + 간판
  const wood = new THREE.MeshLambertMaterial({ color: "#7b4f28" });
  const pillar = new THREE.CylinderGeometry(0.7, 0.9, 10, 8);
  const gx = 0, gz = -16;
  [-7, 7].forEach((dx) => {
    const p = new THREE.Mesh(pillar, wood);
    p.position.set(gx + dx, heightAt(gx + dx, gz) + 5, gz);
    p.castShadow = true;
    g.add(p);
    colliders.add(gx + dx, gz, 1.0);
    // 기둥 위 횃불 모양
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 6), new THREE.MeshBasicMaterial({ color: "#ffb347" }));
    fire.position.set(gx + dx, p.position.y + 5.8, gz);
    g.add(fire);
  });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(16, 3.2, 0.5), [
    wood, wood, wood, wood,
    new THREE.MeshBasicMaterial({ map: labelTexture("다이노 파크", "🦖 공룡 테마파크 🦕", "#9b3d1e") }),
    new THREE.MeshBasicMaterial({ map: labelTexture("다이노 파크", "또 놀러 와요!", "#9b3d1e") }),
  ]);
  sign.position.set(gx, heightAt(gx, gz) + 9.4, gz);
  sign.castShadow = true;
  g.add(sign);
  // 광장 가운데 화석 조형물(큰 알)
  const egg = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), new THREE.MeshStandardMaterial({ color: "#f3ead2", roughness: 0.6 }));
  egg.scale.set(1, 1.35, 1);
  egg.position.set(-11, heightAt(-11, 4) + 2.1, 4);
  egg.castShadow = true;
  g.add(egg);
  const spots = new THREE.Mesh(new THREE.SphereGeometry(1.62, 16, 12, 0, Math.PI * 2, 0, 1.1),
    new THREE.MeshStandardMaterial({ color: "#7cc06b", roughness: 0.6 }));
  spots.scale.set(1, 1.35, 1);
  spots.position.copy(egg.position);
  g.add(spots);
  colliders.add(-11, 4, 2.0);
  return g;
}

export function buildWorld(scene, { low = false } = {}) {
  scene.add(makeSky());
  const clouds = makeClouds();
  scene.add(clouds);
  scene.add(makeTerrain());
  scene.add(makeWater());
  scene.add(makeVegetation(low));
  scene.add(makePlaza());
  // 구역 표지판: 둥근 길에서 구역 쪽을 바라보도록
  for (const [key, zn] of Object.entries(ZONES)) {
    if (key === "sky") continue;
    const a = Math.atan2(zn.z, zn.x);
    const sx = Math.cos(a) * (WORLD.ring + 7), sz = Math.sin(a) * (WORLD.ring + 7);
    scene.add(makeSign(`${zn.emoji} ${zn.name}`, null, sx, sz, 0, 0, 1.1));
  }
  return { update: (dt) => clouds.userData.update(dt) };
}
