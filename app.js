(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  // 가로형 그림(_wide)을 먼저 쓰고, 없으면 정사각형 그림을 씁니다.
  const imgSrcs = (d, thumb) => {
    const dir = `images/${thumb ? "thumb/" : ""}`;
    return [`${dir}${d.id}_wide.webp`, `${dir}${d.id}.webp`];
  };
  const emoji = (d) => (d.diet === "육식" ? "🦖" : "🦕");

  const state = {
    query: "",
    era: "전체",
    diet: "전체",
    rate: Number(localStorage.getItem("dino-rate")) || 1,
    current: -1, // 상세 보기에서 보고 있는 공룡 (DINOSAURS 인덱스)
    visible: [], // 지금 화면에 보이는 공룡 목록
    auto: false, // 계속 넘기며 읽기 중인지
  };

  /* ---------- 음성 읽기 ---------- */
  const isIOS =
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS

  const tts = {
    ok: "speechSynthesis" in window && "SpeechSynthesisUtterance" in window,
    voice: null,
    button: null,
    timer: 0,
  };

  function pickVoice() {
    // 아이폰·아이패드는 음성을 직접 고르면 소리가 안 나는 경우가 있어
    // 기기의 기본 한국어 음성을 쓰게 둡니다.
    if (isIOS) return;
    const voices = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang));
    // 자연스러운 음성(Google, Natural, Online)을 우선으로 고릅니다.
    tts.voice =
      voices.find((v) => /natural|online|google/i.test(v.name)) || voices[0] || null;
  }

  function setSpeaking(btn, on) {
    if (!btn) return;
    btn.classList.toggle("speaking", on);
    btn.textContent = on ? "⏹ 그만 읽기" : "🔊 읽어주기";
    btn.setAttribute("aria-pressed", String(on));
  }

  function showSpeechHelp() {
    const n = $("#tts-notice");
    n.textContent = isIOS
      ? "소리가 안 들리면: 제어 센터에서 무음 모드(🔔)를 끄고 볼륨을 올려 주세요. 그래도 안 되면 설정 → 손쉬운 사용 → 읽기 및 말하기 → 음성 → 한국어에서 음성을 내려받아 주세요."
      : "음성을 재생하지 못했어요. 기기의 소리를 켜거나 다른 브라우저(크롬, 사파리, 엣지)에서 열어 보세요.";
    n.hidden = false;
  }

  // 아이폰·아이패드 사파리는 cancel() 직후 바로 speak()하면 소리가 사라지는 문제가 있어,
  // 읽는 중일 때만 멈추고 다음 말은 조금 있다가 시작합니다.
  function stopSpeaking() {
    if (!tts.ok) return false;
    clearTimeout(tts.timer);
    const wasBusy = speechSynthesis.speaking || speechSynthesis.pending;
    if (wasBusy) speechSynthesis.cancel();
    setSpeaking(tts.button, false);
    tts.button = null;
    return wasBusy;
  }

  // 받침이 있으면 "이에요", 없으면 "예요"
  function ieyo(word) {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    const hasBatchim = code >= 0 && code <= 11171 && code % 28 !== 0;
    return word + (hasBatchim ? "이에요" : "예요");
  }

  function speechText(d) {
    const kind = d.note ? d.note.replace("공룡이 아닌 ", "") : "공룡";
    return `${d.name}. 이름의 뜻은, ${d.meaning}. ${d.era}에 살았던 ${d.diet} ${ieyo(kind)}. ${d.desc}`;
  }

  // 처음 누를 때는 클릭 핸들러 안에서 바로 speak()해야 iOS에서 소리가 납니다.
  // opts.onDone: 끝까지 다 읽었을 때 부를 함수 (자동 넘기기에 사용)
  // opts.justCanceled: 바로 전에 읽던 걸 멈췄으면 true (iOS를 위해 잠깐 기다림)
  function speak(d, btn, opts = {}) {
    if (!tts.ok) return;
    const same = tts.button === btn;
    const wasBusy = stopSpeaking() || !!opts.justCanceled;
    if (same && wasBusy && !opts.onDone) return; // 같은 버튼을 다시 누르면 멈춤

    const u = new SpeechSynthesisUtterance(speechText(d));
    u.lang = "ko-KR";
    u.rate = state.rate;
    u.volume = 1;
    if (tts.voice) u.voice = tts.voice;
    let started = false;
    u.onstart = () => { started = true; };
    const finish = (natural) => {
      if (tts.button !== btn) return; // 이미 다른 읽기로 바뀜
      setSpeaking(btn, false);
      tts.button = null;
      if (natural && opts.onDone) opts.onDone();
    };
    u.onend = () => finish(true);
    u.onerror = (e) => {
      if (e.error !== "interrupted" && e.error !== "canceled") {
        showSpeechHelp();
        setAuto(false);
      }
      finish(false);
    };
    tts.button = btn;
    setSpeaking(btn, true);

    const go = () => {
      if (tts.button !== btn) return;
      speechSynthesis.resume(); // iOS에서 멈춤 상태로 남아 있는 경우 풀기
      speechSynthesis.speak(u);
      // 3초가 지나도 시작하지 않으면 도움말을 보여 줍니다.
      setTimeout(() => {
        if (!started && tts.button === btn && !speechSynthesis.speaking) {
          showSpeechHelp();
          setAuto(false);
          setSpeaking(btn, false);
          tts.button = null;
        }
      }, 3000);
    };
    if (wasBusy) tts.timer = setTimeout(go, 250);
    else go();
  }

  if (tts.ok) {
    pickVoice();
    speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
    window.addEventListener("pagehide", () => speechSynthesis.cancel());
  } else {
    $("#tts-notice").hidden = false;
  }

  /* ---------- 필터 칩 ---------- */
  function makeChips(container, options, getValue, setValue) {
    const el = $(container);
    el.innerHTML = "";
    options.forEach(({ label, value }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = label;
      b.setAttribute("aria-pressed", String(getValue() === value));
      b.addEventListener("click", () => {
        el.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        setValue(value);
      });
      el.appendChild(b);
    });
  }

  const uniq = (key) => [...new Set(DINOSAURS.map((d) => d[key]))];
  const ERA_ORDER = ["트라이아스기", "쥐라기", "백악기"];
  const eras = uniq("era").sort((a, b) => ERA_ORDER.indexOf(a) - ERA_ORDER.indexOf(b));
  const diets = uniq("diet");

  makeChips(
    "#era-chips",
    ["전체", ...eras].map((v) => ({ label: v, value: v })),
    () => state.era,
    (v) => { state.era = v; render(); }
  );
  makeChips(
    "#diet-chips",
    ["전체", ...diets].map((v) => ({ label: v, value: v })),
    () => state.diet,
    (v) => { state.diet = v; render(); }
  );
  makeChips(
    "#speed-chips",
    [
      { label: "🐢 느리게", value: 0.75 },
      { label: "보통", value: 1 },
      { label: "🐇 빠르게", value: 1.3 },
    ],
    () => state.rate,
    (v) => { state.rate = v; localStorage.setItem("dino-rate", String(v)); }
  );
  if (!tts.ok) $("#speed-chips").closest(".chip-row").hidden = true;

  /* ---------- 카드 목록 ---------- */
  function imageEl(d, thumb) {
    const img = document.createElement("img");
    const srcs = imgSrcs(d, thumb);
    img.src = srcs.shift();
    img.alt = `${d.name} 그림`;
    img.loading = thumb ? "lazy" : "eager";
    img.decoding = "async";
    img.addEventListener("error", () => {
      if (srcs.length) img.src = srcs.shift();
      else img.remove(); // 그림이 없으면 이모지가 보입니다
    });
    return img;
  }

  function cardEl(d) {
    const idx = DINOSAURS.indexOf(d);
    const li = document.createElement("li");
    li.className = "card";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "card-open";
    open.setAttribute("aria-label", `${d.name} 자세히 보기`);
    open.innerHTML = `
      <div class="card-img">${emoji(d)}</div>
      <div class="card-body">
        <h2 class="card-name"></h2>
        <p class="latin"></p>
        <div class="tags">
          <span class="tag">${d.era}</span>
          <span class="tag tag-${d.diet}">${d.diet}</span>
          ${d.note ? '<span class="tag tag-note"></span>' : ""}
        </div>
        <p class="card-desc"></p>
      </div>`;
    open.querySelector(".card-img").appendChild(imageEl(d, true));
    open.querySelector(".card-name").textContent = d.name;
    open.querySelector(".latin").textContent = d.latin;
    open.querySelector(".card-desc").textContent = d.desc;
    if (d.note) open.querySelector(".tag-note").textContent = d.note;
    open.addEventListener("click", () => openDetail(idx));
    li.appendChild(open);

    if (tts.ok) {
      const actions = document.createElement("div");
      actions.className = "card-actions";
      const sb = document.createElement("button");
      sb.type = "button";
      sb.className = "btn btn-speak";
      sb.textContent = "🔊 읽어주기";
      sb.setAttribute("aria-label", `${d.name} 읽어주기`);
      sb.addEventListener("click", () => speak(d, sb));
      actions.appendChild(sb);
      li.appendChild(actions);
    }
    return li;
  }

  const norm = (s) => s.toLowerCase().replace(/\s+/g, "");

  function render() {
    const q = norm(state.query);
    state.visible = DINOSAURS.filter(
      (d) =>
        (state.era === "전체" || d.era === state.era) &&
        (state.diet === "전체" || d.diet === state.diet) &&
        (!q || norm(d.name + d.latin + d.meaning).includes(q))
    );
    stopSpeaking();
    const grid = $("#grid");
    grid.innerHTML = "";
    const frag = document.createDocumentFragment();
    state.visible.forEach((d) => frag.appendChild(cardEl(d)));
    grid.appendChild(frag);
    $("#empty").hidden = state.visible.length > 0;
    $("#count").textContent = `공룡 친구 ${state.visible.length}마리`;
  }

  /* ---------- 상세 보기 ---------- */
  const dialog = $("#detail");

  function fillDetail(idx) {
    const d = DINOSAURS[idx];
    state.current = idx;
    const wrap = $(".v-bg");
    wrap.textContent = emoji(d);
    wrap.appendChild(imageEl(d));
    $("#d-name").textContent = d.name;
    $("#d-latin").textContent = d.latin;
    $("#d-meaning").textContent = d.meaning;
    $("#d-era").textContent = d.era;
    $("#d-era-tag").textContent = `${d.era} · ${d.diet}`;
    const list = state.visible.length ? state.visible : DINOSAURS;
    $("#d-count").textContent = `${list.indexOf(d) + 1} / ${list.length}`;
    $("#d-diet").textContent = d.diet;
    $("#d-size").textContent = d.size;
    $("#d-place").textContent = d.place;
    $("#d-desc").textContent = d.desc;
    const note = $("#d-note");
    note.hidden = !d.note;
    note.textContent = d.note || "";
    $("#d-wiki").href = `https://ko.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(d.name)}`;
    $(".v-scroll").scrollTop = 0;
  }

  function openDetail(idx) {
    const wasBusy = stopSpeaking();
    fillDetail(idx);
    if (!dialog.open) {
      togglePanel(false);
      dialog.showModal();
    }
    // 자동 읽기 중이면 넘어간 공룡도 이어서 읽어 줍니다.
    if (state.auto) autoRead(wasBusy);
  }

  /* ---------- 계속 넘기며 읽기 ---------- */
  const autoBtn = $("#d-auto");
  let autoTimer = 0;

  function setAuto(on) {
    state.auto = on;
    clearTimeout(autoTimer);
    autoBtn.setAttribute("aria-pressed", String(on));
    autoBtn.textContent = on ? "⏸ 자동 읽기 멈추기" : "▶ 계속 넘기며 읽기";
  }

  function autoRead(justCanceled) {
    clearTimeout(autoTimer);
    speak(DINOSAURS[state.current], $("#d-speak"), {
      justCanceled,
      onDone: () => {
        if (!state.auto || !dialog.open) return;
        const list = state.visible.length ? state.visible : DINOSAURS;
        // 마지막 공룡까지 읽으면 멈춥니다.
        if (list.indexOf(DINOSAURS[state.current]) >= list.length - 1) return setAuto(false);
        // 한숨 쉬고 다음 공룡으로 넘어가요.
        autoTimer = setTimeout(() => {
          if (state.auto && dialog.open) step(1);
        }, 1500);
      },
    });
  }

  autoBtn.addEventListener("click", () => {
    if (state.auto) {
      setAuto(false);
      stopSpeaking();
    } else {
      setAuto(true);
      autoRead(false); // 버튼을 누른 순간 바로 읽어야 iOS에서 소리가 나요
    }
  });
  if (!tts.ok) autoBtn.hidden = true;

  function step(dir) {
    // 지금 보이는 목록 안에서 이전/다음으로 이동합니다.
    const list = state.visible.length ? state.visible : DINOSAURS;
    let pos = list.indexOf(DINOSAURS[state.current]);
    pos = (pos + dir + list.length) % list.length;
    openDetail(DINOSAURS.indexOf(list[pos]));
  }

  $("#d-speak").addEventListener("click", (e) => {
    if (state.auto) {
      // 자동 읽기 중에 "그만 읽기"를 누르면 자동 읽기도 멈춰요.
      setAuto(false);
      stopSpeaking();
      return;
    }
    speak(DINOSAURS[state.current], e.currentTarget);
  });
  if (!tts.ok) $("#d-speak").hidden = true;
  $("#d-prev").addEventListener("click", () => step(-1));
  $("#d-next").addEventListener("click", () => step(1));
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  // 그림만 크게 보기 (설명 패널 숨기기/보이기)
  function togglePanel(force) {
    const hide = dialog.classList.toggle("hide-panel", force);
    const t = $("#d-toggle");
    t.setAttribute("aria-pressed", String(hide));
    t.setAttribute("aria-label", hide ? "설명 보기" : "설명 숨기기");
    t.textContent = hide ? "📖" : "🖼️";
  }
  $("#d-toggle").addEventListener("click", () => togglePanel());
  $(".v-bg").addEventListener("click", () => togglePanel());

  // 🔍 목록으로 돌아가서 바로 검색
  $("#d-search").addEventListener("click", () => {
    dialog.close();
    const s = $("#search");
    s.scrollIntoView({ block: "center" });
    s.focus();
    s.select();
  });

  // 손가락으로 좌우로 밀어서 넘기기
  let touchX = null, touchY = null;
  dialog.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  dialog.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
  });
  dialog.addEventListener("close", () => {
    setAuto(false);
    stopSpeaking();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  /* ---------- 검색, 랜덤 ---------- */
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    render();
  });

  $("#random").addEventListener("click", () => {
    const list = state.visible.length ? state.visible : DINOSAURS;
    let pick;
    do {
      pick = DINOSAURS.indexOf(list[Math.floor(Math.random() * list.length)]);
    } while (list.length > 1 && pick === state.current);
    openDetail(pick);
  });

  /* ---------- 처음 화면 (메인 메뉴) ---------- */
  // 주소 끝이 #book이면 바로 백과사전, 아니면 처음 화면부터 보여 줘요.
  const menu = $("#menu");
  function showMenu(on) {
    menu.hidden = !on;
    document.body.style.overflow = on ? "hidden" : "";
    history.replaceState(null, "", on ? location.pathname : "#book");
    if (on) stopSpeaking();
  }
  showMenu(location.hash !== "#book");
  $("#menu-book").addEventListener("click", () => {
    showMenu(false);
    window.scrollTo(0, 0);
  });
  $("#to-menu").addEventListener("click", () => showMenu(true));

  /* ---------- 앱처럼 설치 (홈 화면에 추가) ---------- */
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (isIOS && !standalone && !localStorage.getItem("dino-install-hint-closed")) {
    $("#install-hint").hidden = false;
  }
  $("#install-close").addEventListener("click", () => {
    $("#install-hint").hidden = true;
    localStorage.setItem("dino-install-hint-closed", "1");
  });

  // 오프라인 저장
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
  }

  render();
})();
