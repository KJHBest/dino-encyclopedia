// 탈것(지프, 버스, 버기, 몬스터 트럭): 모양 + 운전 (후진 포함)
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { heightAt, colliders, WORLD } from "./world.js";

// 탈것 4가지: 모양과 성능
// model: Hunyuan3D로 만든 3D 모델 (models/<model>.glb), length: 차 길이(m)
export const VEHICLES = {
  jeep: { name: "지프", emoji: "🚙", maxSpeed: 13, radius: 2.0, wheelR: 0.48, camDist: 17, model: "car_jeep", length: 4.6 },
  dino: { name: "공룡차", emoji: "🦖", maxSpeed: 12, radius: 2.0, wheelR: 0.48, camDist: 17, model: "car_dino", length: 4.6 },
  bus: { name: "사파리 버스", emoji: "🚌", maxSpeed: 10, radius: 2.8, wheelR: 0.6, camDist: 22, model: "car_bus", length: 7.6 },
  buggy: { name: "번개 버기", emoji: "🏎️", maxSpeed: 17, radius: 1.6, wheelR: 0.5, camDist: 14, model: "car_buggy", length: 3.6 },
  monster: { name: "몬스터 트럭", emoji: "🛻", maxSpeed: 12, radius: 2.4, wheelR: 1.0, camDist: 19, model: "car_monster", length: 5.0 },
};

// 3D 모델 불러오기 (한 번 불러오면 기억해 둬요)
const modelCache = {};
let modelBase = "models";
export function setVehicleModelBase(base) { modelBase = base; }
function loadVehicleModel(id) {
  if (!modelCache[id]) {
    modelCache[id] = Promise.all([
      new GLTFLoader().loadAsync(`${modelBase}/${id}.glb`),
      new THREE.TextureLoader().loadAsync(`${modelBase}/${id}.webp`),
    ]).then(([gltf, map]) => {
      let geo = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; });
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.anisotropy = 4;
      return { geo, mat: new THREE.MeshStandardMaterial({ map, roughness: 0.6 }) };
    }).catch((e) => {
      console.warn(`${id}: 3D 차 모델이 없어서 간단한 모양을 써요`, e.message);
      return null;
    });
  }
  return modelCache[id];
}

function parts() {
  const g = new THREE.Group();
  const body = new THREE.Group(); // 흔들림은 body에만
  g.add(body);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
  const box = (w, h, d, m, x, y, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    body.add(b);
    return b;
  };
  const dark = mat("#2b2b2b", { roughness: 0.85 });
  const white = mat("#f7f3ea", { roughness: 0.6 });
  const glass = mat("#a8dcf0", { roughness: 0.1, transparent: true, opacity: 0.45 });
  const lightMat = new THREE.MeshBasicMaterial({ color: "#fff6c8" });
  const wheels = [];
  const addWheels = (r, w, spots, hubColor = white) => {
    const wg = new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2);
    const hg = new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.02, 10).rotateZ(Math.PI / 2);
    spots.forEach(([x, z]) => {
      const wh = new THREE.Group();
      const t = new THREE.Mesh(wg, dark);
      t.castShadow = true;
      wh.add(t, new THREE.Mesh(hg, hubColor));
      wh.position.set(x, r, z);
      wh.userData.r = r;
      g.add(wh);
      wheels.push(wh);
    });
  };
  const lights = (xs, y, z) => xs.forEach((x) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12), lightMat);
    l.rotation.x = Math.PI / 2;
    l.position.set(x, y, z);
    body.add(l);
  });
  // 옆면 공룡 발자국 무늬
  const paw = (color, xs, y, z, size = 0.32) => {
    const m = new THREE.MeshBasicMaterial({ color });
    xs.forEach((x) => {
      const p = new THREE.Mesh(new THREE.CircleGeometry(size, 3), m);
      p.position.set(x, y, z);
      p.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      p.rotation.z = Math.PI / 2;
      body.add(p);
    });
  };
  return { g, body, mat, box, dark, white, glass, wheels, addWheels, lights, paw };
}

function makeJeepShape() {
  const { g, body, mat, box, dark, white, glass, wheels, addWheels, lights, paw } = parts();
  const paint = mat("#f28c28"), green = mat("#2f7d4f");
  box(2.1, 0.8, 4.2, paint, 0, 0.95, 0);
  box(2.12, 0.18, 4.22, green, 0, 0.62, 0);
  box(2.0, 0.35, 1.5, paint, 0, 1.45, 1.25);
  box(1.9, 0.75, 0.08, glass, 0, 1.95, 0.48).castShadow = false;
  [[-0.95, 0.5], [0.95, 0.5], [-0.95, -1.9], [0.95, -1.9]].forEach(([x, z]) => box(0.1, 1.3, 0.1, white, x, 2.0, z));
  box(2.1, 0.12, 2.6, white, 0, 2.7, -0.7);
  box(1.7, 0.5, 0.6, dark, 0, 1.45, -0.2);
  box(1.7, 0.5, 0.6, dark, 0, 1.45, -1.3);
  box(2.2, 0.3, 0.25, dark, 0, 0.75, 2.15);
  box(2.2, 0.3, 0.25, dark, 0, 0.75, -2.15);
  lights([-0.7, 0.7], 1.15, 2.12);
  paw("#2f7d4f", [-1.06, 1.06], 1.0, -0.4);
  addWheels(0.48, 0.4, [[-1.05, 1.35], [1.05, 1.35], [-1.05, -1.35], [1.05, -1.35]]);
  const spare = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.4, 16), dark);
  spare.rotation.x = Math.PI / 2;
  spare.position.set(0, 1.3, -2.35);
  body.add(spare);
  return { g, body, wheels };
}

function makeBusShape() {
  const { g, body, mat, box, dark, white, glass, wheels, addWheels, lights, paw } = parts();
  const yellow = mat("#ffc93c"), green = mat("#2f7d4f");
  box(2.5, 1.4, 7.2, yellow, 0, 1.55, 0);
  box(2.52, 0.3, 7.22, green, 0, 0.95, 0);
  // 창문이 뻥 뚫린 사파리 버스
  for (let i = 0; i < 6; i++) [-1.2, 1.2].forEach((x) => box(0.12, 0.85, 0.12, white, x, 2.65, 3.0 - i * 1.25));
  box(2.2, 0.8, 0.05, glass, 0, 2.65, 3.58).castShadow = false;
  box(2.6, 0.18, 7.3, white, 0, 3.15, 0);
  // 지붕 위 짐받이
  box(2.0, 0.08, 4.0, dark, 0, 3.32, -0.8);
  [-0.9, 0.9].forEach((x) => box(0.08, 0.25, 4.0, dark, x, 3.35, -0.8));
  // 좌석 줄
  for (let i = 0; i < 4; i++) box(2.1, 0.5, 0.5, dark, 0, 2.45, 1.8 - i * 1.4);
  box(2.6, 0.35, 0.3, dark, 0, 0.9, 3.7);
  box(2.6, 0.35, 0.3, dark, 0, 0.9, -3.7);
  lights([-0.85, 0.85], 1.4, 3.62);
  paw("#2f7d4f", [-1.27, 1.27], 1.6, 0, 0.45);
  addWheels(0.6, 0.45, [[-1.2, 2.4], [1.2, 2.4], [-1.2, -2.4], [1.2, -2.4]]);
  return { g, body, wheels };
}

function makeBuggyShape() {
  const { g, body, mat, box, dark, wheels, addWheels, lights } = parts();
  const red = mat("#e8463c"), chrome = mat("#d9dde3", { metalness: 0.6, roughness: 0.3 });
  box(1.6, 0.35, 3.2, red, 0, 0.7, 0);
  box(1.3, 0.3, 1.0, red, 0, 0.95, 1.2);
  box(1.4, 0.5, 0.5, dark, 0, 1.05, -0.4); // 좌석
  box(1.4, 0.6, 0.15, dark, 0, 1.35, -0.7);
  // 롤케이지 (튼튼한 쇠막대)
  const bar = (x1, y1, z1, x2, y2, z2) => {
    const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, a.distanceTo(b), 8), chrome);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true;
    body.add(m);
  };
  [-0.7, 0.7].forEach((x) => { bar(x, 0.85, 0.4, x, 1.9, -0.2); bar(x, 1.9, -0.2, x, 0.85, -1.2); });
  bar(-0.7, 1.9, -0.2, 0.7, 1.9, -0.2);
  // 뒤 날개와 엔진
  box(1.7, 0.08, 0.5, red, 0, 1.6, -1.55);
  [-0.6, 0.6].forEach((x) => box(0.08, 0.6, 0.08, chrome, x, 1.3, -1.5));
  box(0.9, 0.45, 0.7, chrome, 0, 0.95, -1.35);
  lights([-0.45, 0.45], 0.85, 1.72);
  // 앞바퀴는 작게, 뒷바퀴는 크게
  addWheels(0.42, 0.35, [[-0.95, 1.15], [0.95, 1.15]]);
  addWheels(0.58, 0.55, [[-1.0, -1.1], [1.0, -1.1]]);
  return { g, body, wheels };
}

function makeMonsterShape() {
  const { g, body, mat, box, dark, glass, wheels, addWheels, lights, paw } = parts();
  const purple = mat("#7b4fd6"), lime = mat("#9be15d");
  box(2.3, 0.9, 4.0, purple, 0, 2.15, 0);
  box(2.0, 0.8, 1.8, purple, 0, 2.95, -0.4);
  box(1.85, 0.6, 0.06, glass, 0, 3.0, 0.52).castShadow = false;
  [-1.01, 1.01].forEach((x) => (box(0.05, 0.5, 1.2, glass, x, 3.0, -0.4).castShadow = false));
  box(2.35, 0.2, 4.05, lime, 0, 1.75, 0);
  box(0.3, 0.3, 3.6, dark, 0, 1.45, 0); // 아래 축
  lights([-0.7, 0.7], 2.3, 2.02);
  lights([-0.5, 0, 0.5], 3.42, 0.2); // 지붕 위 조명
  paw("#9be15d", [-1.16, 1.16], 2.15, -0.6, 0.45);
  addWheels(1.0, 0.8, [[-1.35, 1.45], [1.35, 1.45], [-1.35, -1.45], [1.35, -1.45]], lime);
  return { g, body, wheels };
}

export function makeVehicle(kind) {
  // 3D 모델이 오기 전까지는 상자로 만든 모양을 보여 줘요
  const make = { jeep: makeJeepShape, bus: makeBusShape, buggy: makeBuggyShape, monster: makeMonsterShape }[kind] || makeJeepShape;
  const { g, body, wheels } = make();
  g.userData = { body, wheels, kind };
  const spec = VEHICLES[kind];
  if (spec && spec.model) {
    loadVehicleModel(spec.model).then((m) => {
      if (!m) return;
      body.clear();
      g.userData.wheels.forEach((w) => g.remove(w));
      g.userData.wheels = []; // 모델은 바퀴가 붙어 있어서 굴리지 않아요
      const mesh = new THREE.Mesh(m.geo, m.mat);
      mesh.scale.setScalar(spec.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      body.add(mesh);
    });
  }
  return g;
}

// 예전 이름도 그대로 쓸 수 있게
export const makeJeep = () => makeVehicle("jeep");

const tmp = new THREE.Vector3();

export class JeepController {
  constructor(mesh) {
    this.mesh = mesh;
    this.pos = new THREE.Vector3(0, 0, 14);
    this.heading = Math.PI; // 북쪽(-z)을 향해 출발
    this.speed = 0;
    this.maxSpeed = 13;
    this.maxReverse = 6;
    this.radius = 2.0;
    this.wheelR = 0.48;
    this.reversing = false;
    this.wheelSpin = 0;
    this.bump = 0;
    this.obstacles = []; // 공룡 같은 움직이는 장애물 {x,z,r}
  }

  // 탈것 바꾸기 (모양은 main.js가 장면에 넣고 빼요)
  setVehicle(mesh, spec) {
    this.mesh = mesh;
    this.maxSpeed = spec.maxSpeed;
    this.maxReverse = Math.round(spec.maxSpeed * 0.45);
    this.radius = spec.radius;
    this.wheelR = spec.wheelR;
  }

  // input: {x, y, mag} 화면 기준 (y는 위쪽이 -), cameraYaw: 카메라가 바라보는 방향
  update(dt, input, cameraYaw) {
    let targetSpeed = 0;
    if (input.mag > 0.05) {
      // 화면 위쪽 = 카메라 앞쪽. 원하는 방향으로 돌면서 달립니다.
      // (방향 값이 커지면 화면 왼쪽으로 돌아요)
      const want = cameraYaw - Math.atan2(input.x, -input.y);
      const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
      const diff = wrap(want - this.heading);
      // 뒤쪽으로 끌면 후진해요 (차를 돌리지 않고 뒤로). 한번 후진하면 조금 더 너그럽게 유지.
      const backLimit = this.reversing ? 1.75 : 2.05;
      this.reversing = Math.abs(diff) > backLimit;
      const turnRate = 2.2 * Math.min(1, 0.35 + Math.abs(this.speed) / 6);
      if (this.reversing) {
        // 차 뒤쪽이 원하는 방향을 보도록 돌면서 뒤로 가요
        const d2 = wrap(want + Math.PI - this.heading);
        this.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, d2));
        targetSpeed = -this.maxReverse * input.mag * (1 - Math.min(0.6, Math.abs(d2) / Math.PI));
      } else {
        this.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
        // 크게 돌아야 할 때는 천천히
        targetSpeed = this.maxSpeed * input.mag * (1 - Math.min(0.7, Math.abs(diff) / Math.PI));
      }
    } else {
      this.reversing = false;
    }
    // 속도를 올릴 땐 천천히, 멈추거나 방향을 바꿀 땐 빨리
    const speedingUp = Math.abs(targetSpeed) > Math.abs(this.speed) && targetSpeed * this.speed >= 0;
    const acc = speedingUp ? 9 : 14;
    this.speed += Math.max(-acc * dt, Math.min(acc * dt, targetSpeed - this.speed));

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let nx = this.pos.x + fx * this.speed * dt;
    let nz = this.pos.z + fz * this.speed * dt;

    // 바다, 깊은 물, 섬 끝은 못 가요
    const blocked = (x, z) => heightAt(x, z) < -0.6 || Math.hypot(x, z) > WORLD.driveRadius;
    // 얼마나 "못 가는 곳"인지 (물이 깊을수록, 섬 끝을 넘을수록 큼)
    const badness = (x, z) => Math.max(0, -0.6 - heightAt(x, z)) + Math.max(0, Math.hypot(x, z) - WORLD.driveRadius);
    const px = this.pos.x, pz = this.pos.z;
    const stuck = blocked(px, pz);
    const dir = this.speed < 0 ? -1 : 1; // 후진이면 뒤쪽을 살펴요
    const probeX = nx + fx * 2 * dir, probeZ = nz + fz * 2 * dir;
    // 이미 물에 빠졌으면, 얕은 쪽(덜 나쁜 쪽)으로는 갈 수 있게 해요
    if (blocked(probeX, probeZ) && !(stuck && badness(probeX, probeZ) <= badness(px, pz) + 0.01)) {
      nx = px; nz = pz;
      this.speed *= 0.3;
      this.bump = 0.25;
    }
    // 나무, 바위, 공룡과 부딪히면 밀려나기
    const hits = colliders.near(nx, nz).concat(this.obstacles);
    for (const c of hits) {
      const dx = nx - c.x, dz = nz - c.z;
      const d = Math.hypot(dx, dz), min = c.r + this.radius;
      if (d < min && d > 1e-4) {
        nx = c.x + (dx / d) * min;
        nz = c.z + (dz / d) * min;
        this.speed *= 0.6;
        if (Math.abs(this.speed) > 3) this.bump = 0.2;
      }
    }
    // 공룡에게 밀려서 물이나 섬 밖으로 나가지 않게
    if (blocked(nx, nz) && !stuck) { nx = px; nz = pz; }
    this.pos.x = nx;
    this.pos.z = nz;

    // 땅 모양에 맞춰 기울기
    const hf = heightAt(nx + fx * 1.4, nz + fz * 1.4), hb = heightAt(nx - fx * 1.4, nz - fz * 1.4);
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
    const hr = heightAt(nx + rx * 1, nz + rz * 1), hl = heightAt(nx - rx * 1, nz - rz * 1);
    const ground = Math.max(WORLD.water - 0.5, (hf + hb + hr + hl) / 4);
    this.pos.y = ground;
    const m = this.mesh;
    m.position.copy(this.pos);
    m.rotation.set(0, 0, 0);
    m.rotateY(this.heading);
    m.rotateX(-Math.atan2(hf - hb, 2.8));
    m.rotateZ(Math.atan2(hr - hl, 2.0));

    // 바퀴 굴리기, 차체 덜컹
    this.wheelSpin += this.speed * dt;
    m.userData.wheels.forEach((w) => (w.rotation.x = this.wheelSpin / (w.userData.r || this.wheelR)));
    this.bump = Math.max(0, this.bump - dt);
    const t = performance.now() / 1000;
    const body = m.userData.body;
    body.position.y = Math.sin(t * 18) * 0.025 * Math.min(1, Math.abs(this.speed) / 6) + Math.sin(t * 40) * this.bump * 0.15;
    body.rotation.z = Math.sin(t * 7) * 0.01 * Math.min(1, Math.abs(this.speed) / 8);
  }

  forward(out = tmp) {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }
}
