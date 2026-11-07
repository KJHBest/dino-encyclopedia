// 공룡: 3D 모델 불러오기, 걷기 애니메이션(셰이더), 돌아다니기
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { heightAt, ZONES, LAKE, WORLD } from "./world.js";

// 종마다 몇 마리씩
const COUNT = {
  parasaurolophus: 3, gallimimus: 3, velociraptor: 3, protoceratops: 3, coelophysis: 3,
  triceratops: 2, styracosaurus: 2, pteranodon: 3, iguanodon: 2, stegosaurus: 2, koreaceratops: 2,
  brachiosaurus: 1, diplodocus: 2, ankylosaurus: 1, pachycephalosaurus: 2, plateosaurus: 2,
};
const KIND_ID = { biped: 0, quad: 1, flyer: 2 };

/* ---------- 걷기 애니메이션 셰이더 ---------- */
// 모델 좌표(가로 길이 1, 머리 +Z, 발 y=0)에서 다리, 꼬리, 목, 날개를 움직여요.
const ANIM_UNIFORMS = `
uniform float uTime, uGait, uWalk, uPhase, uFreq, uKind, uBelly, uHipZ, uShoulderZ, uTailZ, uHeadZ, uHeight, uWidth, uLook;
`;
const ANIM_CODE = `
{
  vec3 p = transformed;
  float t = uGait + uPhase; // 걸음 박자 (속도가 바뀌어도 끊기지 않게 쌓아 둔 값)
  if (uKind < 1.5) {
    // 다리: 배 아래쪽 점들을 앞뒤로 흔들어요 (발끝일수록 크게)
    float legT = clamp((uBelly - p.y) / max(uBelly, 0.01), 0.0, 1.0);
    float zLo = uKind > 0.5 ? uHipZ - 0.13 : uHipZ - 0.16;
    float zHi = uKind > 0.5 ? uShoulderZ + 0.13 : uHipZ + 0.16;
    float inLeg = step(zLo, p.z) * step(p.z, zHi);
    if (legT > 0.0 && inLeg > 0.5) {
      float side = p.x >= 0.0 ? 0.0 : 3.14159;
      float pair = (uKind > 0.5 && p.z > (uHipZ + uShoulderZ) * 0.5) ? 3.14159 : 0.0;
      float s = sin(t + side + pair);
      float stride = 0.055;
      p.z += s * stride * legT * uWalk;
      p.y += max(0.0, cos(t + side + pair)) * stride * 0.45 * legT * uWalk;
    }
    // 꼬리: 엉덩이 뒤쪽을 좌우로 살랑
    float tailStart = uHipZ - (uKind > 0.5 ? 0.06 : 0.09);
    if (p.z < tailStart) {
      float k = clamp((tailStart - p.z) / max(tailStart - uTailZ, 0.01), 0.0, 1.0);
      p.x += sin(uTime * (1.3 + uWalk * 1.5) + uPhase - k * 2.2) * (0.035 + 0.03 * uWalk) * k * k;
    }
    // 목·머리: 살짝 끄덕이고, 서 있을 땐 두리번
    float neckStart = (uKind > 0.5 ? uShoulderZ + 0.04 : uHipZ + 0.14);
    if (p.z > neckStart) {
      float k = clamp((p.z - neckStart) / max(uHeadZ - neckStart, 0.01), 0.0, 1.0);
      p.y += sin(t * 2.0) * 0.008 * k * uWalk + sin(uTime * 0.9 + uPhase) * 0.006 * k;
      p.x += (sin(uTime * 0.45 + uPhase) * 0.05 * (1.0 - uWalk) + uLook * 0.12) * k * k;
    }
    // 몸 전체가 걸음마다 위아래로
    p.y += abs(sin(t)) * 0.008 * uWalk;
  } else {
    // 날개: 몸에서 멀수록 크게 퍼덕
    float w = max(0.0, abs(p.x) - uWidth * 0.06) / (uWidth * 0.5);
    p.y += sin(uTime * 5.0 + uPhase) * 0.22 * w * w * uWalk + sin(uTime * 1.3 + uPhase) * 0.02 * w;
  }
  transformed = p;
}
`;

function animate(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + ANIM_UNIFORMS)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + ANIM_CODE);
  };
  material.customProgramCacheKey = () => "dino-anim";
  return material;
}

/* ---------- 모델이 아직 없을 때 쓰는 임시 공룡 ---------- */
function placeholder(d) {
  const color = d.diet === "육식" ? "#b5654a" : d.diet === "잡식" ? "#c49a4a" : "#6f9a52";
  const parts = [];
  const add = (geo, x, y, z, sx = 1, sy = 1, sz = 1) => {
    geo.scale(sx, sy, sz);
    geo.translate(x, y, z);
    parts.push(geo.toNonIndexed());
  };
  const H = d.kind === "biped" ? 0.55 : 0.42;
  add(new THREE.SphereGeometry(0.5, 14, 10), 0, H, 0, 0.32, 0.26, 0.5); // 몸
  add(new THREE.SphereGeometry(0.5, 12, 8), 0, H + 0.18, 0.36, 0.16, 0.16, 0.24); // 머리
  add(new THREE.ConeGeometry(0.11, 0.55, 8).rotateX(-Math.PI / 2), 0, H, -0.45); // 꼬리
  const leg = (x, z) => add(new THREE.CylinderGeometry(0.045, 0.05, H, 6), x, H / 2, z);
  if (d.kind === "biped") { leg(0.09, 0); leg(-0.09, 0); }
  else { leg(0.1, 0.16); leg(-0.1, 0.16); leg(0.1, -0.16); leg(-0.1, -0.16); }
  let n = 0;
  parts.forEach((g) => (n += g.attributes.position.count));
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  parts.forEach((g) => {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  const meta = {
    height: H + 0.3, width: 0.32, tailZ: -0.72, headZ: 0.48, bellyY: H - 0.1,
    hipZ: d.kind === "biped" ? 0 : -0.16, shoulderZ: d.kind === "biped" ? 0 : 0.16,
  };
  return { geo, map: null, color, meta };
}

/* ---------- 불러오기 ---------- */
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

async function loadSpecies(d, base) {
  try {
    const [gltf, meta, map] = await Promise.all([
      loader.loadAsync(`${base}/${d.id}.glb`),
      fetch(`${base}/meta/${d.id}.json`).then((r) => { if (!r.ok) throw new Error("meta"); return r.json(); }),
      texLoader.loadAsync(`${base}/${d.id}.webp`),
    ]);
    let geo = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; });
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = false;
    map.anisotropy = 4;
    return { geo, map, meta, color: "#ffffff" };
  } catch (e) {
    console.warn(`${d.id}: 3D 모델이 아직 없어서 임시 모양을 써요`, e.message);
    return placeholder(d);
  }
}

/* ---------- 한 마리 ---------- */
class Dino {
  constructor(d, sp, index, rnd) {
    this.data = d;
    this.sp = sp;
    this.kind = d.kind;
    this.len = d.len * (0.9 + rnd() * 0.2);
    this.zone = ZONES[d.zone];
    this.uniforms = {
      uTime: { value: 0 }, uGait: { value: 0 }, uWalk: { value: 0 }, uPhase: { value: rnd() * 6.28 }, uFreq: { value: 4 },
      uKind: { value: KIND_ID[d.kind] }, uBelly: { value: sp.meta.bellyY }, uHipZ: { value: sp.meta.hipZ },
      uShoulderZ: { value: sp.meta.shoulderZ }, uTailZ: { value: sp.meta.tailZ }, uHeadZ: { value: sp.meta.headZ },
      uHeight: { value: sp.meta.height }, uWidth: { value: sp.meta.width }, uLook: { value: 0 },
    };
    const mat = animate(new THREE.MeshStandardMaterial({
      map: sp.map, color: sp.color, roughness: 0.82, metalness: 0,
    }), this.uniforms);
    const mesh = new THREE.Mesh(sp.geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // 그림자도 같은 모양으로 움직이게
    mesh.customDepthMaterial = animate(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), this.uniforms);
    mesh.scale.setScalar(this.len);
    mesh.userData.dino = this;
    this.mesh = mesh;
    this.radius = Math.max(0.6, sp.meta.width * this.len * 0.45);
    this.walkSpeed = Math.min(3.2, 0.7 + this.len * 0.13);
    this.small = d.kind !== "flyer" && this.len < 5;
    this.yaw = rnd() * 6.28;
    this.state = "idle";
    this.timer = rnd() * 3;
    this.target = new THREE.Vector3();
    this.rnd = rnd;
    this.walk = 0;
    this.gait = 0;
    this.look = 0;
    this.pos = new THREE.Vector3();
    if (d.kind === "flyer") {
      this.orbitR = 60 + index * 22;
      this.orbitA = rnd() * 6.28;
      this.orbitDir = index % 2 ? -1 : 1;
      this.alt = 26 + index * 6;
      this.flap = 0;
    } else {
      this.pickPoint(this.pos, true);
    }
  }

  canStand(x, z) {
    const h = heightAt(x, z);
    if (this.data.zone === "lake") return h > -2.2 && Math.hypot(x, z) < WORLD.driveRadius - 5;
    return h > 0.4 && Math.hypot(x, z) < WORLD.driveRadius - 5;
  }

  pickPoint(out, first) {
    const zn = this.zone;
    for (let i = 0; i < 30; i++) {
      const a = this.rnd() * 6.28, r = Math.sqrt(this.rnd()) * zn.r;
      let x = zn.x + Math.cos(a) * r, z = zn.z + Math.sin(a) * r;
      if (this.data.zone === "lake") {
        // 스피노사우루스는 호숫가를 따라 걸어요
        const la = this.rnd() * 6.28, lr = LAKE.r * (0.75 + this.rnd() * 0.5);
        x = LAKE.x + Math.cos(la) * lr; z = LAKE.z + Math.sin(la) * lr;
      }
      if (this.canStand(x, z)) return out.set(x, 0, z);
    }
    return first ? out.set(zn.x, 0, zn.z) : out.copy(this.pos);
  }

  update(dt, time, jeep, honk) {
    const u = this.uniforms;
    u.uTime.value = time;
    if (this.kind === "flyer") return this.fly(dt, time);

    const toJeep = Math.hypot(jeep.pos.x - this.pos.x, jeep.pos.z - this.pos.z);
    // 빵빵 소리 듣거나, 작은 공룡은 지프가 가까이 오면 도망
    if ((this.small && toJeep < 9 + this.radius && Math.abs(jeep.speed) > 2) || (honk && toJeep < 30 && this.small)) {
      const ax = this.pos.x - jeep.pos.x, az = this.pos.z - jeep.pos.z, l = Math.hypot(ax, az) || 1;
      const fx = this.pos.x + (ax / l) * 14, fz = this.pos.z + (az / l) * 14;
      if (this.canStand(fx, fz)) { this.target.set(fx, 0, fz); this.state = "flee"; this.timer = 3; }
    } else if (honk && toJeep < 45) {
      this.state = "look";
      this.timer = 3 + this.rnd() * 2;
    }

    this.timer -= dt;
    let speed = 0;
    if (this.state === "idle" || this.state === "look") {
      if (this.timer <= 0) {
        this.pickPoint(this.target);
        this.state = "walk";
        this.timer = 25;
      }
      // 지프가 가까이 서 있으면 쳐다봐요
      if (toJeep < 22 + this.radius || this.state === "look") this.turnToward(jeep.pos.x, jeep.pos.z, dt, 0.8);
    } else {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5 || this.timer <= 0) {
        this.state = "idle";
        this.timer = 2 + this.rnd() * 6;
      } else {
        const turned = this.turnToward(this.target.x, this.target.z, dt, this.state === "flee" ? 2.5 : 1.0);
        speed = this.walkSpeed * (this.state === "flee" ? 2.4 : 1) * (turned ? 1 : 0.35);
        const nx = this.pos.x + Math.sin(this.yaw) * speed * dt, nz = this.pos.z + Math.cos(this.yaw) * speed * dt;
        if (this.canStand(nx, nz) || !this.canStand(this.pos.x, this.pos.z)) { this.pos.x = nx; this.pos.z = nz; }
        else { this.state = "idle"; this.timer = 1; }
      }
    }
    // 걷기 정도를 부드럽게
    const want = speed > 0.05 ? 1 : 0;
    this.walk += (want - this.walk) * Math.min(1, dt * 4);
    u.uWalk.value = this.walk;
    // 다리 움직임 빠르기: 속도에 맞춰
    u.uFreq.value = 2 + (speed / Math.max(0.5, this.len * 0.22)) * 3.2;
    this.gait = (this.gait + u.uFreq.value * dt) % (Math.PI * 2000);
    u.uGait.value = this.gait;
    // 지프를 볼 때 고개 돌리기
    let lookWant = 0;
    if (toJeep < 22 + this.radius && this.walk < 0.3) {
      const a = Math.atan2(jeep.pos.x - this.pos.x, jeep.pos.z - this.pos.z);
      lookWant = Math.max(-1, Math.min(1, Math.atan2(Math.sin(a - this.yaw), Math.cos(a - this.yaw))));
    }
    this.look += (lookWant - this.look) * Math.min(1, dt * 2);
    u.uLook.value = this.look;

    const h = heightAt(this.pos.x, this.pos.z);
    this.pos.y = h - 0.05 * this.len * 0.1;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  turnToward(x, z, dt, rate) {
    const a = Math.atan2(x - this.pos.x, z - this.pos.z);
    const diff = Math.atan2(Math.sin(a - this.yaw), Math.cos(a - this.yaw));
    this.yaw += Math.max(-rate * dt, Math.min(rate * dt, diff));
    return Math.abs(diff) < 0.6;
  }

  fly(dt, time) {
    const speed = 9;
    this.orbitA += (this.orbitDir * speed * dt) / this.orbitR;
    const r = this.orbitR + Math.sin(time * 0.1 + this.uniforms.uPhase.value) * 15;
    this.pos.set(Math.cos(this.orbitA) * r, this.alt + Math.sin(time * 0.6 + this.orbitA) * 3, Math.sin(this.orbitA) * r);
    // 날아가는 방향 보기
    this.yaw = Math.atan2(-Math.sin(this.orbitA) * this.orbitDir, Math.cos(this.orbitA) * this.orbitDir);
    // 몇 초 날갯짓, 몇 초 활공
    const cycle = (time + this.uniforms.uPhase.value * 3) % 7;
    const want = cycle < 2.5 ? 1 : 0;
    this.flap += (want - this.flap) * Math.min(1, dt * 3);
    this.uniforms.uWalk.value = this.flap;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.yaw, 0);
    this.mesh.rotateZ(0.25 * this.orbitDir); // 도는 쪽으로 기울기
  }
}

/* ---------- 전체 공룡 무리 ---------- */
export class DinoPark {
  constructor(scene, list) {
    this.scene = scene;
    this.list = list;
    this.dinos = [];
    this.species = new Map();
    this.time = 0;
    this.honkT = 0;
    let s = 7;
    this.rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }

  async load(base, onProgress) {
    let done = 0;
    await Promise.all(this.list.map(async (d) => {
      const sp = await loadSpecies(d, base);
      this.species.set(d.id, sp);
      onProgress?.(++done / this.list.length);
    }));
    for (const d of this.list) {
      const sp = this.species.get(d.id);
      const n = COUNT[d.id] || 1;
      for (let i = 0; i < n; i++) {
        const dino = new Dino(d, sp, i, this.rnd);
        this.dinos.push(dino);
        this.scene.add(dino.mesh);
      }
    }
  }

  honk() { this.honkT = 0.1; }

  update(dt, jeep) {
    this.time += dt;
    const honk = this.honkT > 0;
    this.honkT -= dt;
    for (const d of this.dinos) d.update(dt, this.time, jeep, honk);
    // 서로 겹치지 않게 살짝 밀기
    const walkers = this.dinos.filter((d) => d.kind !== "flyer");
    for (let i = 0; i < walkers.length; i++) for (let j = i + 1; j < walkers.length; j++) {
      const a = walkers[i], b = walkers[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), min = a.radius + b.radius;
      if (d < min && d > 1e-3) {
        const push = (min - d) / 2;
        const ax = a.pos.x - (dx / d) * push, az = a.pos.z - (dz / d) * push;
        const bx = b.pos.x + (dx / d) * push, bz = b.pos.z + (dz / d) * push;
        if (a.canStand(ax, az)) { a.pos.x = ax; a.pos.z = az; }
        if (b.canStand(bx, bz)) { b.pos.x = bx; b.pos.z = bz; }
      }
    }
    // 지프가 부딪히는 공룡
    jeep.obstacles = walkers.map((d) => ({ x: d.pos.x, z: d.pos.z, r: d.radius }));
  }

  // 지프에서 가장 가까운 공룡 (종 하나당 한 번)
  nearest(pos, maxDist) {
    let best = null, bd = maxDist;
    for (const d of this.dinos) {
      const dist = Math.hypot(d.pos.x - pos.x, d.pos.z - pos.z) - d.radius - (d.kind === "flyer" ? 10 : 0);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best ? { dino: best, dist: bd } : null;
  }

  // 화면을 누른 곳의 공룡
  // blockers: 땅, 바위처럼 공룡을 가리는 것 (가려진 공룡은 고르지 않아요)
  pick(raycaster, camera, x, y, w, h, blockers = []) {
    const meshes = this.dinos.map((d) => d.mesh);
    const hits = raycaster.intersectObjects(meshes.concat(blockers), false);
    if (hits.length && hits[0].object.userData.dino) return hits[0].object.userData.dino;
    // 조금 빗나가도 가까운 공룡을 골라 줘요 (보이는 공룡만)
    let best = null, bd = 70;
    const v = new THREE.Vector3(), dir = new THREE.Vector3();
    const ray = new THREE.Raycaster();
    for (const d of this.dinos) {
      v.copy(d.pos);
      v.y += d.len * 0.3;
      const world = v.clone();
      v.project(camera);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const dist = Math.hypot(sx - x, sy - y);
      if (dist >= bd) continue;
      dir.subVectors(world, camera.position);
      const far = dir.length();
      ray.set(camera.position, dir.normalize());
      ray.far = far - d.radius;
      if (ray.intersectObjects(blockers, false).length) continue;
      bd = dist;
      best = d;
    }
    return best;
  }

  // 그 종이 있는 곳(가장 가까운 한 마리)
  find(id, from) {
    let best = null, bd = Infinity;
    for (const d of this.dinos) if (d.data.id === id) {
      const dist = Math.hypot(d.pos.x - from.x, d.pos.z - from.z);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  }
}
