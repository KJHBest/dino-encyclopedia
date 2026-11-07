// 한국어 읽어주기 (공룡 백과사전에서 쓰던 아이패드 대비 방법 그대로)
const isIOS =
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const ok = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
let voice = null;
let timer = 0;
let current = null; // 지금 읽는 문장의 id
let pendingEnd = null; // 지금 문장이 끝날 때 부를 함수 (다른 것 때문에 멈춰도 꼭 불러요)
let onHelp = () => {};

function pickVoice() {
  // 아이폰·아이패드는 음성을 직접 고르면 소리가 안 나는 경우가 있어 기본 음성을 씁니다.
  if (isIOS || !ok) return;
  const vs = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang));
  voice = vs.find((v) => /natural|online|google/i.test(v.name)) || vs[0] || null;
}
if (ok) {
  pickVoice();
  speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
  window.addEventListener("pagehide", () => speechSynthesis.cancel());
}

export const speech = {
  ok,
  isIOS,
  rate: 1,
  setHelp(fn) { onHelp = fn; },

  // 첫 소리는 버튼 누를 때 바로 내야 iOS에서 들려요.
  unlock(text = "") {
    if (!ok) return;
    const u = new SpeechSynthesisUtterance(text || " ");
    u.lang = "ko-KR";
    u.volume = text ? 1 : 0;
    if (voice) u.voice = voice;
    speechSynthesis.resume();
    speechSynthesis.speak(u);
  },

  stop() {
    if (!ok) return false;
    clearTimeout(timer);
    const busy = speechSynthesis.speaking || speechSynthesis.pending;
    if (busy) speechSynthesis.cancel();
    current = null;
    const cb = pendingEnd;
    pendingEnd = null;
    cb?.(false);
    return busy;
  },

  speaking(id) { return current !== null && (id === undefined || current === id); },
  currentId() { return current; },

  // id: 같은 걸 다시 누르면 멈추게 하려고 씀. 반환: 시작했으면 true
  say(text, { id = text, onEnd, onStart } = {}) {
    if (!ok) { onHelp(); return false; }
    const same = current === id;
    const wasBusy = this.stop();
    if (same && wasBusy) { onEnd?.(false); return false; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = this.rate;
    u.volume = 1;
    if (voice) u.voice = voice;
    let started = false;
    current = id;
    pendingEnd = onEnd || null;
    const finish = (natural) => {
      if (current !== id) return;
      current = null;
      pendingEnd = null;
      onEnd?.(natural);
    };
    u.onstart = () => { started = true; onStart?.(); };
    u.onend = () => finish(true);
    u.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") onHelp();
      finish(false);
    };
    const go = () => {
      if (current !== id) return;
      speechSynthesis.resume();
      speechSynthesis.speak(u);
      setTimeout(() => {
        if (!started && current === id && !speechSynthesis.speaking) { onHelp(); finish(false); }
      }, 3000);
    };
    if (wasBusy) timer = setTimeout(go, 250);
    else go();
    return true;
  },
};

// 받침이 있으면 "이에요", 없으면 "예요"
export function ieyo(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const has = code >= 0 && code <= 11171 && code % 28 !== 0;
  return word + (has ? "이에요" : "예요");
}

// 받침이 있으면 "을", 없으면 "를"
export function eulReul(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const has = code >= 0 && code <= 11171 && code % 28 !== 0;
  return word + (has ? "을" : "를");
}

export function storyText(d) {
  const kind = d.note ? d.note.replace("공룡이 아닌 ", "") : "공룡";
  return `${d.name}. 이름의 뜻은, ${d.meaning}. ${d.era}에 살았던 ${d.diet} ${ieyo(kind)}. ${d.desc}`;
}
