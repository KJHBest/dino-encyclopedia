// 사파리 지프: 모양 + 운전
import * as THREE from "three";
import { heightAt, colliders, WORLD } from "./world.js";

export function makeJeep() {
  const g = new THREE.Group();
  const body = new THREE.Group(); // 흔들림은 body에만
  g.add(body);
  const paint = new THREE.MeshStandardMaterial({ color: "#f28c28", roughness: 0.55 });
  const white = new THREE.MeshStandardMaterial({ color: "#f7f3ea", roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.8 });
  const green = new THREE.MeshStandardMaterial({ color: "#2f7d4f", roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: "#a8dcf0", roughness: 0.1, transparent: true, opacity: 0.45 });
  const box = (w, h, d, m, x, y, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    body.add(b);
    return b;
  };
  box(2.1, 0.8, 4.2, paint, 0, 0.95, 0); // 차체
  box(2.12, 0.18, 4.22, green, 0, 0.62, 0); // 아래 띠
  box(2.0, 0.35, 1.5, paint, 0, 1.45, 1.25); // 보닛
  box(1.9, 0.75, 0.08, glass, 0, 1.95, 0.48).castShadow = false; // 앞유리
  // 지붕과 기둥
  [[-0.95, 0.5], [0.95, 0.5], [-0.95, -1.9], [0.95, -1.9]].forEach(([x, z]) => box(0.1, 1.3, 0.1, white, x, 2.0, z));
  box(2.1, 0.12, 2.6, white, 0, 2.7, -0.7);
  // 좌석
  box(1.7, 0.5, 0.6, dark, 0, 1.45, -0.2);
  box(1.7, 0.5, 0.6, dark, 0, 1.45, -1.3);
  // 범퍼, 전조등
  box(2.2, 0.3, 0.25, dark, 0, 0.75, 2.15);
  box(2.2, 0.3, 0.25, dark, 0, 0.75, -2.15);
  const lightMat = new THREE.MeshBasicMaterial({ color: "#fff6c8" });
  [-0.7, 0.7].forEach((x) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12), lightMat);
    l.rotation.x = Math.PI / 2;
    l.position.set(x, 1.15, 2.12);
    body.add(l);
  });
  // 옆 공룡 발자국 무늬
  const pawMat = new THREE.MeshBasicMaterial({ color: "#2f7d4f" });
  [-1.06, 1.06].forEach((x) => {
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.32, 3), pawMat);
    p.position.set(x, 1.0, -0.4);
    p.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
    p.rotation.z = Math.PI / 2;
    body.add(p);
  });
  // 바퀴
  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.4, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.42, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  [[-1.05, 1.35], [1.05, 1.35], [-1.05, -1.35], [1.05, -1.35]].forEach(([x, z]) => {
    const w = new THREE.Group();
    const t = new THREE.Mesh(wheelGeo, dark);
    t.castShadow = true;
    w.add(t, new THREE.Mesh(hubGeo, white));
    w.position.set(x, 0.48, z);
    g.add(w);
    wheels.push(w);
  });
  // 뒤 스페어 타이어
  const spare = new THREE.Mesh(wheelGeo, dark);
  spare.rotation.y = Math.PI / 2;
  spare.position.set(0, 1.3, -2.35);
  body.add(spare);
  g.userData = { body, wheels };
  return g;
}

const tmp = new THREE.Vector3();

export class JeepController {
  constructor(mesh) {
    this.mesh = mesh;
    this.pos = new THREE.Vector3(0, 0, 14);
    this.heading = Math.PI; // 북쪽(-z)을 향해 출발
    this.speed = 0;
    this.maxSpeed = 13;
    this.radius = 2.0;
    this.wheelSpin = 0;
    this.bump = 0;
    this.obstacles = []; // 공룡 같은 움직이는 장애물 {x,z,r}
  }

  // input: {x, y, mag} 화면 기준 (y는 위쪽이 -), cameraYaw: 카메라가 바라보는 방향
  update(dt, input, cameraYaw) {
    let targetSpeed = 0;
    if (input.mag > 0.05) {
      // 화면 위쪽 = 카메라 앞쪽. 원하는 방향으로 돌면서 달립니다.
      // (방향 값이 커지면 화면 왼쪽으로 돌아요)
      const want = cameraYaw - Math.atan2(input.x, -input.y);
      let diff = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
      const turnRate = 2.2 * Math.min(1, 0.35 + Math.abs(this.speed) / 6);
      this.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
      // 크게 돌아야 할 때는 천천히
      targetSpeed = this.maxSpeed * input.mag * (1 - Math.min(0.7, Math.abs(diff) / Math.PI));
    }
    const acc = targetSpeed > this.speed ? 9 : 14;
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
    const probeX = nx + fx * 2, probeZ = nz + fz * 2;
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
    this.wheelSpin += (this.speed * dt) / 0.48;
    m.userData.wheels.forEach((w) => (w.rotation.x = this.wheelSpin));
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
