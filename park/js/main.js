// 다이노 파크: 지프를 타고 공룡을 찾아다니는 3D 게임
import * as THREE from "three";
import { buildWorld, upgradeTrees, heightAt, ZONES, LAKE, WORLD, occluders } from "./world.js";
import { makeVehicle, VEHICLES, JeepController } from "./jeep.js";
import { Input } from "./input.js";
import { DinoPark } from "./dinos.js";
import { speech, storyText, ieyo, eulReul } from "./speech.js";
import { PARK_DINOS } from "./dinodata.js";

const $ = (s) => document.querySelector(s);
const isIOS = speech.isIOS;

/* ---------- 3D 기본 ---------- */
const canvas = $("#c");
// 옛 기기(iPadOS 15 아이패드, 메모리 2GB 이하)는 가벼운 모드: 그림자 끄기, 해상도 낮추기, 나무·공룡 줄이기
// 주소 끝에 ?low 를 붙이면 일부러 가벼운 모드로 볼 수 있어요.
const safariMajor = Number((navigator.userAgent.match(/Version\/(\d+)/) || [])[1]) || 0;
const LOW = new URLSearchParams(location.search).has("low") ||
  (isIOS && safariMajor > 0 && safariMajor < 16) ||
  (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 2);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, powerPreference: "high-performance" });
let pixelRatio = LOW ? 1 : Math.min(window.devicePixelRatio || 1, isIOS ? 1.5 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = LOW ? new THREE.Fog("#cfe8f5", 80, 260) : new THREE.Fog("#cfe8f5", 110, 380);
const camera = new THREE.PerspectiveCamera(55, 1, 0.5, LOW ? 1000 : 1500);

scene.add(new THREE.HemisphereLight("#cfe9ff", "#6b8f4e", 1.15));
const sun = new THREE.DirectionalLight("#fff1d6", 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(isIOS ? 1024 : 2048, isIOS ? 1024 : 2048);
const sc = sun.shadow.camera;
sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 260;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.12;
sun.shadow.radius = 2;
scene.add(sun, sun.target);
const SUN_DIR = new THREE.Vector3(0.55, 0.8, 0.35).normalize();
const SUN_RIGHT = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
const SUN_UP = new THREE.Vector3().crossVectors(SUN_DIR, SUN_RIGHT).normalize();
const shadowCenter = new THREE.Vector3();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 세로 화면에서는 더 넓게 보이도록
  camera.fov = w < h ? 68 : 55;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const world = buildWorld(scene, { low: LOW });
const pickBlockers = [scene.getObjectByName("terrain"), ...occluders].filter(Boolean);
// 탈것: 지프 / 사파리 버스 / 번개 버기 / 몬스터 트럭 (고른 것을 기억해요)
const VEHICLE_KEY = "dinopark-vehicle";
let vehicleKind = VEHICLES[localStorage.getItem(VEHICLE_KEY)] ? localStorage.getItem(VEHICLE_KEY) : "jeep";
const jeep = new JeepController(makeVehicle(vehicleKind));
jeep.setVehicle(jeep.mesh, VEHICLES[vehicleKind]);
scene.add(jeep.mesh);
const park = new DinoPark(scene, PARK_DINOS, { low: LOW });

/* ---------- 안내 화살표 (지프 위) ---------- */
// 납작한 화살표 (뒤에서 봐도 방향이 잘 보이게 눕혀 놓아요, 끝이 +Z)
const arrowShape = new THREE.Shape();
arrowShape.moveTo(0, 2.2);
arrowShape.lineTo(1.5, 0.4);
arrowShape.lineTo(0.55, 0.4);
arrowShape.lineTo(0.55, -1.6);
arrowShape.lineTo(-0.55, -1.6);
arrowShape.lineTo(-0.55, 0.4);
arrowShape.lineTo(-1.5, 0.4);
arrowShape.closePath();
const arrowGeo = new THREE.ExtrudeGeometry(arrowShape, { depth: 0.25, bevelEnabled: false });
arrowGeo.rotateX(Math.PI / 2);
const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({
  color: "#ffd34d", depthTest: false, transparent: true, opacity: 0.92, side: THREE.DoubleSide,
}));
arrow.renderOrder = 10;
arrow.visible = false;
scene.add(arrow);

/* ---------- 상태 ---------- */
const FOUND_KEY = "dinopark-found";
const found = new Set(JSON.parse(localStorage.getItem(FOUND_KEY) || "[]").filter((id) => PARK_DINOS.some((d) => d.id === id)));
const state = {
  started: false,
  autoVoice: localStorage.getItem("dinopark-voice") !== "off",
  selected: null, // 눌러서 고른 공룡 (가까이 있는 공룡보다 먼저 보여 줌)
  selectedUntil: 0,
  cardDino: null,
  guide: null, // { id, name, x, z, dino }
  camDist: VEHICLES[vehicleKind].camDist,
  orbit: 0,
  orbitHold: 0,
};
$("#found-total").textContent = PARK_DINOS.length;
$("#start-total").textContent = PARK_DINOS.length;

function saveFound() { localStorage.setItem(FOUND_KEY, JSON.stringify([...found])); }
function updateFound() { $("#found-n").textContent = found.size; }
updateFound();

/* ---------- 알림, 음성 ---------- */
speech.setHelp(() => {
  const n = $("#notice");
  n.textContent = isIOS
    ? "소리가 안 들리면: 제어 센터에서 무음 모드(🔔)를 끄고 볼륨을 올려 주세요. 그래도 안 되면 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성 → 한국어에서 음성을 내려받아 주세요."
    : "음성을 재생하지 못했어요. 기기의 소리를 켜 보세요.";
  n.hidden = false;
  clearTimeout(n._t);
  n._t = setTimeout(() => (n.hidden = true), 9000);
});

let toastTimer = 0;
function toast(html, ms = 3200) {
  const t = $("#toast");
  t.innerHTML = html;
  t.hidden = false;
  t.style.animation = "none";
  void t.offsetWidth;
  t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function setSpeakBtn(btn, on) {
  if (!btn) return;
  btn.classList.toggle("speaking", on);
  btn.textContent = on ? "⏹ 그만" : btn.dataset.label;
}
$("#card-speak").dataset.label = "🔊 이야기";
$("#detail-speak").dataset.label = "🔊 읽어주기";

function tell(d, btn) {
  setSpeakBtn(btn, true);
  const started = speech.say(storyText(d), {
    id: `story-${d.id}`,
    onEnd: () => setSpeakBtn(btn, false),
  });
  if (!started) setSpeakBtn(btn, false);
}

/* ---------- 공룡 카드 ---------- */
// 그림은 공룡 백과사전의 것을 같이 써요
const thumb = (id) => `../images/thumb/${id}_wide.webp`;
function showCard(dino) {
  const d = dino.data;
  hideHint();
  if (state.cardDino !== d) {
    state.cardDino = d;
    $("#card-img").src = thumb(d.id);
    $("#card-name").textContent = d.name;
    $("#card-sub").textContent = `${d.meaning} · ${d.era} · ${d.diet}`;
    setSpeakBtn($("#card-speak"), speech.speaking(`story-${d.id}`));
  }
  $("#card").hidden = false;
}
function hideCard() {
  if (!state.cardDino) return;
  state.cardDino = null;
  $("#card").hidden = true;
}
$("#card-speak").addEventListener("click", () => state.cardDino && tell(state.cardDino, $("#card-speak")));
$("#card-book").addEventListener("click", () => state.cardDino && openBook(state.cardDino.id));

/* ---------- 새 공룡 발견 ---------- */
function discover(dino, { silent = false } = {}) {
  const d = dino.data;
  if (found.has(d.id)) return;
  found.add(d.id);
  saveFound();
  updateFound();
  const all = found.size === PARK_DINOS.length;
  toast(`🎉 새 공룡 발견!<br>${d.name}<small>도감에 기록했어요 (${found.size} / ${PARK_DINOS.length})</small>`);
  if (state.guide && state.guide.id === d.id) clearGuide(false);
  // 아이가 듣고 있는 공룡 이야기는 끊지 않아요
  if (state.autoVoice && !silent && !speech.currentId()?.startsWith("story-")) {
    speech.say(`새로운 공룡을 찾았어요! ${ieyo(d.name)}. ${d.desc.split(".")[0]}.`, { id: `found-${d.id}` });
  }
  // 도감이 열려 있으면 바로 고쳐 보여 줘요
  if (!$("#book").hidden) { buildBook(); if (bookOpenId === d.id) showDetail(d); }
  if (all) celebrate();
}

// 모든 공룡을 찾으면: 지금 말하는 게 끝난 뒤에 축하해요
function celebrate() {
  if (speech.currentId()) { setTimeout(celebrate, 600); return; }
  toast("🏆 축하해요!<br>공룡을 모두 찾았어요!<small>진짜 공룡 박사님이에요</small>", 6000);
  if (state.autoVoice) speech.say("축하해요! 공룡 친구들을 모두 찾았어요. 진짜 공룡 박사님이에요!", { id: "all" });
}

/* ---------- 안내 (찾으러 가기) ---------- */
function setGuide(d) {
  const dino = park.find(d.id, jeep.pos);
  state.guide = { id: d.id, name: d.name, dino };
  $("#guide").hidden = false;
  arrow.visible = true;
  closeBook();
  if (state.autoVoice) speech.say(`${eulReul(d.name)} 찾으러 가요! 노란 화살표를 따라가세요.`, { id: "guide" });
}
function clearGuide(arrived) {
  state.guide = null;
  $("#guide").hidden = true;
  arrow.visible = false;
  if (arrived) toast("🧭 도착했어요!", 1800);
}
$("#guide-x").addEventListener("click", () => clearGuide());

function updateGuide() {
  const g = state.guide;
  if (!g) return;
  const tx = g.dino ? g.dino.pos.x : 0, tz = g.dino ? g.dino.pos.z : 0;
  const dx = tx - jeep.pos.x, dz = tz - jeep.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 22 + (g.dino ? g.dino.radius : 0)) { clearGuide(true); return; }
  const a = Math.atan2(dx, dz);
  arrow.position.set(jeep.pos.x, jeep.pos.y + 5.2 + Math.sin(performance.now() / 250) * 0.25, jeep.pos.z);
  arrow.rotation.set(0, a, 0);
  // 화면 화살표: 카메라 기준 방향
  const rel = a - camYaw;
  $("#guide-arrow").style.transform = `rotate(${-rel}rad)`;
  $("#guide-text").textContent = `${g.name}까지 ${Math.round(dist)}m`;
}

/* ---------- 도감 ---------- */
let bookOpenId = null;
function zoneName(d) { return ZONES[d.zone] ? `${ZONES[d.zone].emoji} ${ZONES[d.zone].name}` : ""; }
function buildBook() {
  const ul = $("#book-grid");
  ul.innerHTML = "";
  PARK_DINOS.forEach((d) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const known = found.has(d.id);
    b.className = known ? "" : "unknown";
    let img;
    if (known) {
      img = document.createElement("img");
      img.src = thumb(d.id);
      img.alt = d.name;
      img.loading = "lazy";
    } else {
      // 아직 못 만난 공룡은 알 속에 숨어 있어요
      img = document.createElement("div");
      img.className = "egg";
      img.textContent = "🥚";
    }
    const nm = document.createElement("span");
    nm.className = "name";
    nm.textContent = known ? d.name : "???";
    const zn = document.createElement("span");
    zn.className = "zone";
    zn.textContent = zoneName(d);
    b.append(img, nm, zn);
    b.addEventListener("click", () => showDetail(d));
    li.appendChild(b);
    ul.appendChild(li);
  });
  $("#book-count").textContent = `${found.size} / ${PARK_DINOS.length}`;
}
function openBook(id) {
  buildBook();
  $("#book").hidden = false;
  $("#detail").hidden = true;
  input.release();
  if (id) showDetail(PARK_DINOS.find((d) => d.id === id));
}
function closeBook() {
  $("#book").hidden = true;
  bookOpenId = null;
}
function showDetail(d) {
  bookOpenId = d.id;
  const known = found.has(d.id);
  const det = $("#detail");
  det.classList.toggle("unknown", !known);
  $("#detail-img").hidden = !known;
  if (known) $("#detail-img").src = thumb(d.id);
  $("#detail-egg").hidden = known;
  $("#detail-note").hidden = !(known && d.note);
  $("#detail-note").textContent = d.note || "";
  $("#detail-name").textContent = known ? d.name : "??? (아직 못 만났어요)";
  $("#detail-latin").textContent = known ? d.latin : "";
  const info = $("#detail-info");
  info.innerHTML = "";
  if (known) {
    const dl = document.createElement("dl");
    [["이름 뜻", d.meaning], ["시대", d.era], ["먹이", d.diet], ["크기", d.size], ["발견 장소", d.place], ["공원에서 사는 곳", zoneName(d)]].forEach(([k, v]) => {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      dl.append(dt, dd);
    });
    const p = document.createElement("p");
    p.textContent = d.desc;
    info.append(p, dl);
  } else {
    const p = document.createElement("p");
    p.textContent = `${zoneName(d)} 쪽에 살고 있어요. 지프를 타고 찾으러 가 볼까요?`;
    info.append(p);
  }
  $("#detail-speak").hidden = !known;
  setSpeakBtn($("#detail-speak"), speech.speaking(`story-${d.id}`));
  det.hidden = false;
  det.scrollTop = 0;
}
$("#b-book").addEventListener("click", () => openBook());
$("#found").addEventListener("click", () => openBook());
$("#book-close").addEventListener("click", closeBook);
$("#detail-back").addEventListener("click", () => { $("#detail").hidden = true; buildBook(); });
$("#detail-speak").addEventListener("click", () => {
  const d = PARK_DINOS.find((x) => x.id === bookOpenId);
  if (d) tell(d, $("#detail-speak"));
});
$("#detail-go").addEventListener("click", () => {
  const d = PARK_DINOS.find((x) => x.id === bookOpenId);
  if (d) setGuide(d);
});

/* ---------- 버튼: 빵빵, 자동 설명 ---------- */
let audio = null;
function honk() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
    const t = audio.currentTime;
    [0, 0.28].forEach((off) => {
      const o1 = audio.createOscillator(), o2 = audio.createOscillator(), g = audio.createGain();
      o1.type = o2.type = "square";
      o1.frequency.value = 415; o2.frequency.value = 523;
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(0.18, t + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.22);
      o1.connect(g); o2.connect(g); g.connect(audio.destination);
      o1.start(t + off); o2.start(t + off);
      o1.stop(t + off + 0.25); o2.stop(t + off + 0.25);
    });
  } catch { /* 소리를 못 내도 괜찮아요 */ }
  park.honk();
}
$("#b-honk").addEventListener("click", honk);
function setVoice(on) {
  state.autoVoice = on;
  localStorage.setItem("dinopark-voice", on ? "on" : "off");
  $("#b-voice").setAttribute("aria-pressed", String(on));
  $("#b-voice").querySelector("span").textContent = on ? "🔊" : "🔇";
  if (!on) speech.stop();
}
$("#b-voice").addEventListener("click", () => setVoice(!state.autoVoice));
setVoice(state.autoVoice);

/* ---------- 조작 ---------- */
const input = new Input(canvas, $("#joy"));
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
input.onTap = (x, y) => {
  if (!state.started) return;
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const dino = park.pick(raycaster, camera, x, y, window.innerWidth, window.innerHeight, pickBlockers);
  if (dino) {
    state.selected = dino;
    state.selectedUntil = performance.now() + 15000;
    showCard(dino);
    // 멀리 있어도 눌렀다면 발견으로 쳐요 (화면에 보일 만큼 가까울 때)
    const dist = Math.hypot(dino.pos.x - jeep.pos.x, dino.pos.z - jeep.pos.z);
    if (dist < 70) discover(dino, { silent: true });
    tell(dino.data, $("#card-speak"));
  }
};
let hintShown = true;
function hideHint() {
  if (!hintShown) return;
  hintShown = false;
  const h = $("#hint");
  h.classList.add("fade");
  setTimeout(() => (h.hidden = true), 700);
}
input.onFirstDrive = hideHint;

/* ---------- 카메라 ---------- */
let camYaw = jeep.heading;
let steerYaw = null;
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const camDir = new THREE.Vector3();
const camRay = new THREE.Raycaster();
function updateCamera(dt, inp) {
  state.camDist = Math.max(8, Math.min(48, state.camDist + inp.zoom * 1.6));
  if (inp.orbit) {
    state.orbit = Math.atan2(Math.sin(state.orbit + inp.orbit), Math.cos(state.orbit + inp.orbit));
    state.orbitHold = 2.5;
  }
  state.orbitHold -= dt;
  // 운전 중이면 카메라 회전이 천천히 지프 뒤로 돌아와요
  if (state.orbitHold <= 0 && Math.abs(jeep.speed) > 1) state.orbit *= Math.exp(-dt * 1.2);
  const want = jeep.heading + state.orbit;
  let diff = Math.atan2(Math.sin(want - camYaw), Math.cos(want - camYaw));
  camYaw += diff * Math.min(1, dt * (Math.abs(jeep.speed) > 0.5 ? 2.2 : 4));
  const pitch = 0.36 + (state.camDist - 8) * 0.004;
  const d = state.camDist;
  camTarget.set(jeep.pos.x, jeep.pos.y + 2, jeep.pos.z);
  camPos.set(
    camTarget.x - Math.sin(camYaw) * Math.cos(pitch) * d,
    camTarget.y + Math.sin(pitch) * d,
    camTarget.z - Math.cos(camYaw) * Math.cos(pitch) * d);
  // 바위가 지프를 가리면 카메라를 바위 앞으로
  camRay.set(camTarget, camDir.subVectors(camPos, camTarget).normalize());
  camRay.far = d;
  const hit = camRay.intersectObjects(occluders, false)[0];
  if (hit) camPos.copy(camTarget).addScaledVector(camDir, Math.max(4, hit.distance - 0.8));
  const ground = heightAt(camPos.x, camPos.z) + 1.5;
  if (camPos.y < ground) camPos.y = ground;
  camera.position.lerp(camPos, Math.min(1, dt * 8));
  camera.lookAt(camTarget);
  // 그림자는 지프 주변만
  const texel = (sc.right - sc.left) / sun.shadow.mapSize.x;
  const u = jeep.pos.dot(SUN_RIGHT), v = jeep.pos.dot(SUN_UP);
  shadowCenter.copy(jeep.pos)
    .addScaledVector(SUN_RIGHT, Math.round(u / texel) * texel - u)
    .addScaledVector(SUN_UP, Math.round(v / texel) * texel - v);
  sun.position.copy(shadowCenter).addScaledVector(SUN_DIR, 120);
  sun.target.position.copy(shadowCenter);
}

/* ---------- 미니 지도 ---------- */
const mapCv = $("#map"), mapCtx = mapCv.getContext("2d");
let mapTimer = 0;
function drawMap() {
  const c = mapCtx, S = mapCv.width, k = S / 2 / (WORLD.radius + 5);
  const X = (x) => S / 2 + x * k, Y = (z) => S / 2 + z * k;
  c.clearRect(0, 0, S, S);
  c.save();
  c.beginPath(); c.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); c.clip();
  c.fillStyle = "#58a7d4"; c.fillRect(0, 0, S, S);
  c.fillStyle = "#86c160"; c.beginPath(); c.arc(S / 2, S / 2, WORLD.driveRadius * k + 6, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#58a7d4"; c.beginPath(); c.arc(X(LAKE.x), Y(LAKE.z), LAKE.r * 0.75 * k, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#d8b07a"; c.lineWidth = 5;
  c.beginPath(); c.arc(S / 2, S / 2, WORLD.ring * k, 0, Math.PI * 2); c.stroke();
  c.font = `${Math.round(S * 0.08)}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
  for (const [key, z] of Object.entries(ZONES)) if (key !== "sky") c.fillText(z.emoji, X(z.x), Y(z.z));
  // 찾은 공룡
  for (const d of park.dinos) {
    if (!found.has(d.data.id) || d.kind === "flyer") continue;
    c.fillStyle = d.data.diet === "육식" ? "#d9534f" : "#2f7d4f";
    c.beginPath(); c.arc(X(d.pos.x), Y(d.pos.z), 4, 0, Math.PI * 2); c.fill();
  }
  if (state.guide && state.guide.dino) {
    c.fillStyle = "#ffd34d"; c.strokeStyle = "#7a5b00"; c.lineWidth = 2;
    c.beginPath(); c.arc(X(state.guide.dino.pos.x), Y(state.guide.dino.pos.z), 8, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  // 지프
  c.save();
  c.translate(X(jeep.pos.x), Y(jeep.pos.z));
  c.rotate(-jeep.heading + Math.PI);
  c.fillStyle = "#f28c28"; c.strokeStyle = "#fff"; c.lineWidth = 3;
  c.beginPath(); c.moveTo(0, -12); c.lineTo(8, 9); c.lineTo(-8, 9); c.closePath(); c.fill(); c.stroke();
  c.restore();
  c.restore();
}

/* ---------- 화질 자동 조절 (느린 기기) ---------- */
// 30fps로 고정된 기기(저전력 모드)는 느린 게 아니에요. 25fps보다 느릴 때만 화질을 낮춰요.
let slowTime = 0, warmup = 4;
function adaptQuality(dt) {
  if (warmup > 0) { warmup -= dt; return; }
  if (dt > 1 / 25) slowTime += dt; else slowTime = Math.max(0, slowTime - dt * 0.5);
  if (slowTime > 3) {
    slowTime = 0;
    if (pixelRatio > 1.01) { pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
    else if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => o.material && (o.material.needsUpdate = true)); }
  }
}

/* ---------- 매 프레임 ---------- */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  frame(now);
}
function frame(now, force) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  if (document.hidden && !force) return;
  const inp = input.state();
  // 끌기 시작할 때의 카메라 방향을 기준으로 운전 (아래로 끌면 돌아서 그쪽으로 가요)
  if (inp.move.mag > 0.05) { if (steerYaw === null) steerYaw = camYaw; } else steerYaw = null;
  if (state.started && $("#book").hidden) jeep.update(dt, inp.move, steerYaw ?? camYaw);
  else jeep.update(dt, { x: 0, y: 0, mag: 0 }, camYaw);
  park.update(dt, jeep);
  world.update(dt);
  updateCamera(dt, inp);
  if (state.started) {
    // 가까운 공룡 카드 + 발견
    const near = park.nearest(jeep.pos, 30);
    if (near && near.dist < 18 && $("#book").hidden) discover(near.dino);
    if (state.selected && now < state.selectedUntil) showCard(state.selected);
    else if (near) { state.selected = null; showCard(near.dino); }
    else { state.selected = null; hideCard(); }
    updateGuide();
    mapTimer -= dt;
    if (mapTimer <= 0) { drawMap(); mapTimer = 0.2; }
    adaptQuality(dt);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

/* ---------- 시작 ---------- */
const go = $("#go");
park.load("models", (p) => ($("#bar-fill").style.width = `${Math.round(p * 100)}%`)).then(() => {
  // 3D 나무는 공룡 다음에 천천히 불러와요 (없으면 간단한 나무 그대로)
  upgradeTrees("models", { shadows: !LOW });
  go.disabled = false;
  go.textContent = "🚙 출발!";
});
/* ---------- 탈것 고르기 ---------- */
function setVehicle(kind, announce) {
  if (!VEHICLES[kind]) return;
  vehicleKind = kind;
  localStorage.setItem(VEHICLE_KEY, kind);
  const old = jeep.mesh;
  const m = makeVehicle(kind);
  m.position.copy(old.position);
  m.quaternion.copy(old.quaternion);
  scene.remove(old);
  scene.add(m);
  jeep.setVehicle(m, VEHICLES[kind]);
  state.camDist = VEHICLES[kind].camDist;
  document.querySelectorAll(".pick-car").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.kind === kind)));
  $("#b-car").querySelector("span").textContent = VEHICLES[kind].emoji;
  if (announce) {
    const msg = `${VEHICLES[kind].name}${hasBatchim(VEHICLES[kind].name) ? "으로" : "로"} 바꿨어요!`;
    toast(`${VEHICLES[kind].emoji} ${msg}`, 1800);
    if (state.autoVoice) speech.say(msg, { id: "car" });
  }
}
function hasBatchim(word) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0 && c % 28 !== 8; // ㄹ 받침은 "로"
}
// 시작 화면의 탈것 버튼
const picker = $("#car-picker");
Object.entries(VEHICLES).forEach(([kind, v]) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pick-car";
  b.dataset.kind = kind;
  b.innerHTML = `<span class="pick-emoji">${v.emoji}</span><span class="pick-name">${v.name}</span>`;
  b.addEventListener("click", () => setVehicle(kind, false));
  picker.appendChild(b);
});
// 게임 중에는 🚗 버튼으로 다음 탈것으로 바꿔요
$("#b-car").addEventListener("click", () => {
  const kinds = Object.keys(VEHICLES);
  setVehicle(kinds[(kinds.indexOf(vehicleKind) + 1) % kinds.length], true);
});
setVehicle(vehicleKind, false);

go.addEventListener("click", () => {
  // 버튼을 누른 순간 소리를 켜 둬야 아이패드에서 읽어주기가 돼요
  if (state.autoVoice) speech.unlock("공룡 테마파크에 온 걸 환영해요! 화면을 끌어서 지프를 움직여 보세요.");
  else speech.unlock();
  try { audio = new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* 없음 */ }
  state.started = true;
  $("#start").classList.add("hide");
  setTimeout(() => ($("#start").hidden = true), 700);
  $("#hud").hidden = false;
  drawMap();
  setTimeout(hideHint, 15000);
});

document.addEventListener("visibilitychange", () => { if (document.hidden) speech.stop(); last = performance.now(); });

// 오프라인 저장 (홈 화면 앱)
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}

// 개발 확인용
window.__park = {
  LOW, park, jeep, state, found, camera, scene, renderer,
  // 화면이 가려져 있을 때 시험용으로 프레임을 직접 돌리기
  tick(n = 1, ms = 16.7) { for (let i = 0; i < n; i++) frame(last + ms, true); },
};
