// 손가락 조작
// - 한 손가락으로 끌기: 끈 방향으로 지프가 달려요 (화면에 조이스틱이 나타나요)
// - 살짝 톡 누르기: 공룡을 누르면 그 공룡 이야기
// - 두 손가락: 벌리고 오므리면 확대/축소, 옆으로 밀면 카메라 돌리기
// - 키보드(WASD, 화살표)와 마우스 휠도 돼요
export class Input {
  constructor(el, joyEl) {
    this.el = el;
    this.joy = joyEl;
    this.knob = joyEl.querySelector(".knob");
    this.move = { x: 0, y: 0, mag: 0 };
    this.zoom = 0; // 이번 프레임 확대 변화
    this.orbit = 0; // 이번 프레임 카메라 회전
    this.onTap = null;
    this.onFirstDrive = null;
    this.pointers = new Map();
    this.drive = null; // {id, x0, y0, x, y, t0, moved}
    this.pinch = null;
    this.keys = new Set();
    this.R = 70; // 조이스틱 반지름(px)

    el.addEventListener("pointerdown", (e) => this.down(e));
    window.addEventListener("pointermove", (e) => this.moveEv(e), { passive: true });
    window.addEventListener("pointerup", (e) => this.up(e));
    window.addEventListener("pointercancel", (e) => this.up(e, true));
    el.addEventListener("wheel", (e) => { e.preventDefault(); this.zoom += e.deltaY * 0.01; }, { passive: false });
    // iOS: 화면 확대/스크롤 막기
    el.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    el.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
    ["gesturestart", "gesturechange"].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));
    window.addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("input, textarea")) return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => { this.keys.clear(); this.release(); });
  }

  down(e) {
    try { this.el.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저는 안 돼도 괜찮아요 */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.drive = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: false };
    } else if (this.pointers.size === 2) {
      // 두 손가락이면 운전을 멈추고 카메라 조작
      this.release();
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 };
    }
  }

  moveEv(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2;
      this.zoom -= (d - this.pinch.d) * 0.03;
      this.orbit += (mx - this.pinch.mx) * 0.008;
      this.pinch.d = d;
      this.pinch.mx = mx;
      return;
    }
    const dr = this.drive;
    if (!dr || dr.id !== e.pointerId) return;
    dr.x = e.clientX;
    dr.y = e.clientY;
    const dx = dr.x - dr.x0, dy = dr.y - dr.y0;
    if (!dr.moved && Math.hypot(dx, dy) > 12) {
      dr.moved = true;
      this.joy.hidden = false;
      this.joy.style.transform = `translate(${dr.x0}px, ${dr.y0}px)`;
      this.onFirstDrive?.();
    }
    if (dr.moved) {
      const len = Math.hypot(dx, dy);
      const k = Math.min(1, len / this.R);
      // 조이스틱 중심을 손가락 쪽으로 조금 따라가게 (멀리 끌어도 편하게)
      if (len > this.R * 1.4) {
        const pull = (len - this.R * 1.4) / len;
        dr.x0 += dx * pull;
        dr.y0 += dy * pull;
        this.joy.style.transform = `translate(${dr.x0}px, ${dr.y0}px)`;
      }
      const ux = len ? dx / len : 0, uy = len ? dy / len : 0;
      this.move = { x: ux, y: uy, mag: k };
      this.knob.style.transform = `translate(${ux * k * this.R}px, ${uy * k * this.R}px)`;
    }
  }

  up(e, cancel) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    const hadPinch = !!this.pinch;
    if (this.pointers.size < 2) this.pinch = null;
    // 두 손가락에서 하나를 떼면 남은 손가락으로 바로 운전
    if (hadPinch && this.pointers.size === 1 && !this.drive) {
      const [[id, q]] = [...this.pointers];
      this.drive = { id, x0: q.x, y0: q.y, x: q.x, y: q.y, t0: -Infinity, moved: false };
      return;
    }
    const dr = this.drive;
    if (dr && dr.id === e.pointerId) {
      if (!cancel && !dr.moved && performance.now() - dr.t0 < 1200 && p) this.onTap?.(p.x, p.y);
      this.release();
    }
  }

  release() {
    this.drive = null;
    this.move = { x: 0, y: 0, mag: 0 };
    this.joy.hidden = true;
    this.knob.style.transform = "";
  }

  // 키보드까지 합친 이번 프레임 입력
  state() {
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has("a") || k.has("arrowleft")) x -= 1;
    if (k.has("d") || k.has("arrowright")) x += 1;
    if (k.has("w") || k.has("arrowup")) y -= 1;
    if (k.has("s") || k.has("arrowdown")) y += 1;
    let mv = this.move;
    if (x || y) {
      const l = Math.hypot(x, y);
      mv = { x: x / l, y: y / l, mag: 1 };
      this.onFirstDrive?.();
    }
    if (k.has("q")) this.orbit -= 0.03;
    if (k.has("e")) this.orbit += 0.03;
    const out = { move: mv, zoom: this.zoom, orbit: this.orbit };
    this.zoom = 0;
    this.orbit = 0;
    return out;
  }
}
