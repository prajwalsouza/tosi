// The Play demo: a narrated film that plays over Tosi itself. The screen goes dark, the story is told in short beats,
// and the real interface comes back whenever there is something to show: a ghost cursor moves to it and presses it,
// and a spotlight lifts it out of the dark. Every number comes from real runs of the two sample issues (explainer/data.js).
// Pause at any point to look around; leaving puts the app back where it was.
import { icon } from "./icons.js";
import { makeA, S, G } from "./explainer/kit.js";
import { loadData } from "./explainer/data.js";
import { SCENES } from "./explainer/script.js";

const TITLE = 2.2;                                            // seconds a scene's title stands alone
const beatLen = (text) => Math.max(3.4, String(text).replace(/<[^>]+>/g, "").length / 17 + 0.9);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "html") e.innerHTML = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}

let P = null;                                                 // the film while it is open

/* ---------- the Play demo button on Home ---------- */
function injectButton() {
  const r = (location.hash.replace(/^#/, "") || "/").replace(/\/+$/, "") || "/";
  if (r !== "/" || P) return;
  const hint = document.querySelector(".home .drop-hint");
  if (!hint || hint.querySelector(".x-play")) return;
  hint.append(h("button", { class: "btn primary x-play", html: icon("circle-play"), onclick: () => open() }, "Play demo"));
}
new MutationObserver(injectButton).observe(document.documentElement, { childList: true, subtree: true });
addEventListener("hashchange", injectButton);

/* ---------- the film ---------- */
export function open() {
  if (P) return;
  const saved = { hash: location.hash || "#/", y: scrollY };
  const root = h("div", { class: "xp", role: "dialog", "aria-label": "Tosi demo", "aria-modal": "true" });
  const veil = h("div", { class: "xp-veil" });
  const svg = S("svg", { class: "xp-stage", viewBox: "0 0 1600 900", preserveAspectRatio: "xMidYMid meet" });
  const spot = h("div", { class: "xp-spot" }), note = h("div", { class: "xp-note" }), tip = h("div", { class: "xp-tip" });
  const cursor = h("div", { class: "xp-cursor", html: `<svg viewBox="0 0 24 24"><path d="M4 2.5l15.5 9.2-6.6 1.4 3.8 7.4-2.9 1.5-3.8-7.4L5 19z" fill="#f3f1ec" stroke="#17141f" stroke-width="1.3" stroke-linejoin="round"/></svg><i class="ring"></i>` });
  const title = h("div", { class: "xp-title" }), cap = h("div", { class: "xp-cap", "aria-live": "polite" });
  const bPlay = h("button", { class: "xp-b main", "aria-label": "Play", html: icon("play"), onclick: () => toggle() });
  const bPrev = h("button", { class: "xp-b", "aria-label": "Previous beat", title: "Previous (←)", html: icon("backward-step"), onclick: () => step(-1) });
  const bNext = h("button", { class: "xp-b", "aria-label": "Next beat", title: "Next (→)", html: icon("forward-step"), onclick: () => step(1) });
  const bVoice = h("button", { class: "xp-b", "aria-label": "Read aloud", title: "Read aloud (V)", html: icon("volume-xmark"), onclick: () => setVoice(!voice) });
  const bExit = h("button", { class: "xp-b", "aria-label": "Leave the demo", title: "Leave (Esc)", html: icon("xmark"), onclick: () => close() });
  const seek = h("div", { class: "xp-seek", role: "slider", tabindex: "0", "aria-label": "Position in the demo" });
  const hov = h("span", { class: "xp-hov" });
  const chap = h("span", { class: "xp-chap" }), time = h("span", { class: "xp-time" });
  const bar = h("div", { class: "xp-bar" }, bPlay, bPrev, bNext, seek, chap, time, bVoice, bExit);
  const fade = h("div", { class: "xp-fade" });
  root.append(veil, svg, spot, note, fade, title, cap, cursor, tip, bar);
  document.body.append(root);
  document.documentElement.classList.add("xp-on");

  const D = loadData(() => { if (!timeline && ready()) build(); });
  let timeline = null, t = 0, playing = false, hold = 0, voice = store.get("tosi.demo.voice") === "1", speaking = false;
  let cur = { si: -2, bi: -2 }, A = null, stageRoot = null, spotSel = null, spotBox = null, lastFrame = performance.now(), idle = 0;
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  P = { close };
  setVoice(voice, true);

  // The darkness comes first; the bar rises with the first beat.
  requestAnimationFrame(() => { veil.style.opacity = "1"; root.classList.add("dark"); });
  cap.innerHTML = `<span class="in"><i class="sk"></i></span>`;
  setTimeout(() => root.classList.add("up"), 900);

  function ready() { return D.sp && D.te && D.gb; }
  function build() {
    // Scene and beat times follow the captions, so reading pace and the film stay in step.
    let at = 0;
    timeline = SCENES.map((sc, i) => {
      const lead = sc.title ? TITLE : 0.6;
      const beats = sc.beats.map((b) => ({ ...b, text: typeof b.say === "function" ? b.say(D) : b.say }));
      const bd = beats.map((b) => b.len ?? beatLen(b.text)), bs = [];
      let x = lead; for (const d of bd) { bs.push(x); x += d; }
      const s = { ...sc, i, start: at, lead, beats, bs, bd, dur: x + 0.3 };
      at += s.dur;
      return s;
    });
    timeline.total = at;
    // The bar's segments, one per scene, a gap where a chapter starts; they arrive one after another.
    seek.replaceChildren(...timeline.map((s, i) => {
      const seg = h("div", { class: "xp-seg" + (i && s.chapter !== timeline[i - 1].chapter ? " ch" : ""), style: `flex:${s.dur.toFixed(2)};transition-delay:${(i * 60) + 200}ms` }, h("i"));
      return seg;
    }), hov);
    if (!reduced) play(); else draw();
  }

  /* where in the film a time falls */
  function locate(tt) {
    const s = timeline.find((x) => tt < x.start + x.dur) ?? timeline[timeline.length - 1];
    const lt = tt - s.start;
    let bi = -1; while (bi + 1 < s.bs.length && lt >= s.bs[bi + 1]) bi++;
    return { s, si: s.i, bi, lt };
  }

  /* ---------- scenes and beats ---------- */
  function enterScene(s) {
    stageRoot?.remove(); stageRoot = null; A = null;
    if (s.mode === "dark" && s.build) {
      stageRoot = G(svg, "xs");
      A = makeA({ bs: s.bs, bd: s.bd, dur: s.dur });
      try { s.build(stageRoot, A, D); } catch (e) { console.error("demo scene", s.id, e); }
    }
    chap.textContent = s.chapter;
    title.innerHTML = s.title ? s.title.split("|").map((x, i) => i ? `<em>${x.trim()}</em>` : x.trim() + " ").join("") : "";
  }
  async function enterBeat(s, bi) {
    const b = s.beats[bi];
    spotSel = b?.spot ?? null;
    setNote(b?.note ? (typeof b.note === "function" ? b.note(D) : b.note) : "");
    setCaption(b?.text ?? "");
    if (b && voice) speak(b.text);
    if (b?.act) {
      const my = ++hold;
      try { await Promise.race([b.act(X, D).catch((e) => console.error("demo beat", s.id, bi, e)), sleep(1200)]); } catch (e) { console.error("demo beat", s.id, bi, e); }
      if (hold === my) hold = 0;
    }
  }
  function setCaption(html) {
    if (cap.dataset.h === html) return;
    cap.dataset.h = html;
    const sp = h("span", { html });
    cap.replaceChildren(sp);
    requestAnimationFrame(() => requestAnimationFrame(() => sp.classList.add("in")));
  }
  function setNote(text) {
    note.classList.remove("in");
    if (text) { note.innerHTML = text; setTimeout(() => note.classList.add("in"), 350); }
  }

  /* ---------- driving the real app ---------- */
  const find = (sel) => typeof sel === "function" ? sel() : typeof sel === "string" ? document.querySelector(sel) : sel;
  const X = {
    async go(hash, waitFor) {
      if (location.hash !== hash) location.hash = hash;
      if (waitFor) await X.wait(waitFor);
      await sleep(250);
    },
    async wait(sel, ms = 8000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { const e = find(sel); if (e && e.getBoundingClientRect().width) return e; await sleep(120); }
      return null;
    },
    async to(sel) {
      const e = await X.wait(sel, 6000); if (!e) return null;
      const r = e.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) { e.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" }); await sleep(600); }
      const q = e.getBoundingClientRect();
      cursor.style.opacity = "1";
      cursor.style.transform = `translate(${q.left + Math.min(q.width * 0.5, 60)}px, ${q.top + q.height * 0.55}px)`;
      await sleep(reduced ? 50 : 900);
      return e;
    },
    async press(sel) {
      const e = await X.to(sel); if (!e) return null;
      cursor.classList.remove("press"); void cursor.offsetWidth; cursor.classList.add("press");
      await sleep(180);
      e.click();
      await sleep(500);
      return e;
    },
    hideCursor() { cursor.style.opacity = "0"; },
    // point at something and tap, without pressing it (for things the film must not start, such as a new run)
    async tap(sel) { const e = await X.to(sel); cursor.classList.remove("press"); void cursor.offsetWidth; cursor.classList.add("press"); await sleep(500); return e; },
    // A step in the Flow's list of modules, by its label.
    node(label) { return () => [...document.querySelectorAll(".diagram button.node")].find((n) => n.textContent.trim() === label); },
    async flowTo(label) { await X.press(X.node(label)); await sleep(1300); },
    // An outline row that opens: press it only if it is closed.
    async open(sel) { const e = await X.wait(sel, 6000); if (e && e.getAttribute("aria-expanded") === "false") await X.press(e); else if (e) await X.to(e); return e; },
    text(sel, words) { return () => [...document.querySelectorAll(sel)].find((n) => n.textContent.includes(words)); },
  };

  /* ---------- the clock ---------- */
  function frame(now) {
    if (!P) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now;
    if (timeline) {
      if (playing && !hold) {
        let nt = t + dt;
        // Reading aloud: the film waits at the end of a beat until the voice has finished it.
        const L = locate(t);
        if (speaking && L.bi >= 0) { const end = L.s.start + L.s.bs[L.bi] + L.s.bd[L.bi] - 0.02; if (nt > end) nt = Math.max(t, end); }
        t = nt;
        if (t >= timeline.total) { t = timeline.total - 0.001; pause(); }
      }
      draw();
      idle += dt; root.classList.toggle("quiet", playing && idle > 2.6);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function draw() {
    const L = locate(t), s = L.s;
    if (L.si !== cur.si) { if (cur.si >= 0) timeline[cur.si]?.leave?.(); enterScene(s); cur = { si: L.si, bi: -2 }; }
    if (L.bi !== cur.bi) { cur.bi = L.bi; if (L.bi >= 0) enterBeat(s, L.bi); else { spotSel = null; setNote(""); setCaption(""); if (s.mode === "app") X.hideCursor(); } }
    // A title stands alone at the start of its scene, then clears before the first beat.
    title.classList.toggle("in", !!s.title && L.lt > 0.25 && L.lt < s.lead - 0.35);
    const dark = s.mode === "dark" || L.bi < 0;
    root.classList.toggle("dark", dark); root.classList.toggle("app", !dark);
    veil.style.opacity = dark ? "1" : "0";
    if (s.mode === "dark") X.hideCursor();
    // the drawn scene, with a little parallax towards the cursor
    if (A) {
      par.x += (par.tx - par.x) * 0.06; par.y += (par.ty - par.y) * 0.06;
      stageRoot.setAttribute("transform", `translate(${par.x.toFixed(2)},${par.y.toFixed(2)})`);
      A.st.mouse = mouse; A.run(L.lt);
    }
    drawSpot(dark);
    // progress
    const segs = seek.querySelectorAll(".xp-seg i");
    timeline.forEach((x, i) => { segs[i].style.width = `${clamp((t - x.start) / x.dur) * 100}%`; });
    time.textContent = `${mmss(t)} / ${mmss(timeline.total)}`;
    seek.setAttribute("aria-valuenow", String(Math.round(t))); seek.setAttribute("aria-valuemax", String(Math.round(timeline.total)));
  }
  function drawSpot(dark) {
    const e = !dark && spotSel ? find(spotSel) : null;
    const r = e?.getBoundingClientRect();
    if (!r || !r.width) { spot.style.opacity = "0"; note.style.visibility = dark ? "hidden" : "visible"; if (!dark && spotSel === null) note.classList.remove("in"); return; }
    const pad = 12, want = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: Math.min(r.height + pad * 2, innerHeight - 150 - Math.max(0, r.top - pad)) };
    spotBox = spotBox && spot.style.opacity === "1" ? { x: spotBox.x + (want.x - spotBox.x) * 0.18, y: spotBox.y + (want.y - spotBox.y) * 0.18, w: spotBox.w + (want.w - spotBox.w) * 0.18, h: spotBox.h + (want.h - spotBox.h) * 0.18 } : want;
    Object.assign(spot.style, { left: `${spotBox.x}px`, top: `${spotBox.y}px`, width: `${spotBox.w}px`, height: `${Math.max(20, spotBox.h)}px`, opacity: "1" });
    note.style.visibility = "visible";
    // the note sits beside the light: to the right if there is room, else below, else above
    const nw = Math.min(340, innerWidth - 32), nh = note.offsetHeight || 60;
    let nx = spotBox.x + spotBox.w + 18, ny = spotBox.y + 8;
    if (nx + nw > innerWidth - 16) { nx = clamp(spotBox.x, 16, innerWidth - nw - 16); ny = spotBox.y + spotBox.h + 14; if (ny + nh > innerHeight - 150) ny = spotBox.y - nh - 14; }
    note.style.left = `${nx}px`; note.style.top = `${clamp(ny, 16, innerHeight - 150 - nh)}px`;
  }
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  /* ---------- controls ---------- */
  function play() { if (!timeline) return; if (t >= timeline.total - 0.01) seekTo(0); playing = true; bPlay.innerHTML = icon("pause"); bPlay.setAttribute("aria-label", "Pause"); idle = 0; }
  function pause() { playing = false; bPlay.innerHTML = icon("play"); bPlay.setAttribute("aria-label", "Play"); root.classList.remove("quiet"); speechSynthesis?.cancel?.(); speaking = false; }
  function toggle() { playing ? pause() : play(); }
  function seekTo(nt) { t = clamp(nt, 0, (timeline?.total ?? 1) - 0.001); speechSynthesis?.cancel?.(); speaking = false; hold = 0; draw(); }
  function step(d) {
    if (!timeline) return;
    const L = locate(t), all = [];
    timeline.forEach((s) => s.bs.forEach((b) => all.push(s.start + b)));
    const now = L.bi >= 0 ? L.s.start + L.s.bs[L.bi] : L.s.start;
    const i = all.findIndex((x) => x > now + 0.01);
    const target = d > 0 ? (i < 0 ? timeline.total - 0.01 : all[i]) : all.filter((x) => x < now - 0.01).pop() ?? 0;
    const L2 = locate(target + 0.02);
    seekTo(target + (playing || L2.bi < 0 ? 0.02 : Math.min(1.8, L2.s.bd[L2.bi] - 0.2)));
  }
  function stepScene(d) { if (!timeline) return; const L = locate(t); const n = timeline[clamp(L.si + d, 0, timeline.length - 1)]; seekTo(n.start + 0.02); }
  function setVoice(v, quiet) {
    voice = v && "speechSynthesis" in window; store.set("tosi.demo.voice", voice ? "1" : "0");
    bVoice.innerHTML = icon(voice ? "volume-high" : "volume-xmark"); bVoice.classList.toggle("on", voice);
    if (!voice) { speechSynthesis?.cancel?.(); speaking = false; } else if (!quiet && cap.dataset.h) speak(cap.dataset.h);
  }
  function speak(html) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(html.replace(/<[^>]+>/g, "").replace(/−/g, "minus ").replace(/\bdB\b/g, "decibels"));
    u.rate = 1.02; u.lang = "en-GB";
    speaking = true; u.onend = u.onerror = () => { speaking = false; };
    speechSynthesis.speak(u);
  }

  // seeking: click or drag along the bar; hover names the scene
  const tAt = (x) => { const r = seek.getBoundingClientRect(); return clamp((x - r.left) / r.width) * (timeline?.total ?? 0); };
  let dragging = false;
  seek.addEventListener("pointerdown", (e) => { if (!timeline) return; dragging = true; seek.setPointerCapture(e.pointerId); seekTo(tAt(e.clientX)); });
  seek.addEventListener("pointermove", (e) => {
    if (!timeline) return;
    const tt = tAt(e.clientX), L = locate(tt), r = seek.getBoundingClientRect();
    hov.textContent = `${L.s.chapter}${L.s.title ? ` · ${L.s.title.replace("|", "")}` : ""}`; hov.style.left = `${e.clientX - r.left}px`;
    if (dragging) seekTo(tt);
  });
  seek.addEventListener("pointerup", () => { dragging = false; });
  seek.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") { e.preventDefault(); seekTo(t + 5); } if (e.key === "ArrowLeft") { e.preventDefault(); seekTo(t - 5); } });

  // the keyboard belongs to the film while it is open
  function onKey(e) {
    if (e.target.closest?.("input, textarea")) return;
    const k = e.key;
    if (k === "Escape") close();
    else if (k === " " || k === "k") toggle();
    else if (k === "ArrowRight") e.shiftKey ? stepScene(1) : step(1);
    else if (k === "ArrowLeft") e.shiftKey ? stepScene(-1) : step(-1);
    else if (k === "v" || k === "V") setVoice(!voice);
    else return;
    e.preventDefault(); e.stopPropagation();
  }
  addEventListener("keydown", onKey, true);

  // the pointer: the drawn scenes lean towards it, glowing things explain themselves, and touching the app pauses the film
  let mouse = { x: 800, y: 450, in: false };
  function onMove(e) {
    idle = 0; root.classList.remove("quiet");
    const r = svg.getBoundingClientRect();
    // the stage keeps its shape (meet), so one scale maps the pointer into its 1600 × 900 drawing
    const sc = Math.min(r.width / 1600, r.height / 900), ox = (r.width - 1600 * sc) / 2, oy = (r.height - 900 * sc) / 2;
    mouse = { x: (e.clientX - r.left - ox) / sc, y: (e.clientY - r.top - oy) / sc, in: true };
    par.tx = (e.clientX / innerWidth - 0.5) * -14; par.ty = (e.clientY / innerHeight - 0.5) * -10;
    const hot = e.target.closest?.(".x-hot");
    if (hot?.__tip) {
      tip.innerHTML = `<b>${hot.__tip.title}</b>${hot.__tip.body ?? ""}`; tip.classList.add("in");
      tip.style.left = `${clamp(e.clientX + 14, 8, innerWidth - 310)}px`; tip.style.top = `${clamp(e.clientY + 14, 8, innerHeight - 120)}px`;
    } else tip.classList.remove("in");
  }
  function onDown(e) {
    if (e.target.closest?.(".xp-bar")) return;
    if (e.target.closest?.(".x-hot")) { pause(); return; }
    if (!root.classList.contains("dark") && playing) pause();          // looking around the app: the film waits
  }
  function onWheel() { if (!root.classList.contains("dark") && playing) pause(); }
  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("pointerdown", onDown, true);
  addEventListener("wheel", onWheel, { passive: true });

  function close() {
    if (!P) return;
    P = null;
    pause();
    D.stop?.();
    removeEventListener("keydown", onKey, true); removeEventListener("pointermove", onMove); removeEventListener("pointerdown", onDown, true); removeEventListener("wheel", onWheel);
    SCENES.forEach((s) => s.leave?.());
    root.style.transition = "opacity .5s"; root.style.opacity = "0";
    setTimeout(() => { root.remove(); document.documentElement.classList.remove("xp-on"); }, 520);
    if (location.hash !== saved.hash) location.hash = saved.hash;
    setTimeout(() => scrollTo(0, saved.y), 400);
    injectButton();
  }
}
