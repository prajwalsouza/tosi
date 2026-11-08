// Tosi interface shell: a floating sidebar, simple hash routes, and the settings pages.
import { icon } from "./icons.js";
import * as flow from "./flow.js";
import * as guidebook from "./guidebook.js";
import * as library from "./library.js";
import { testsPage } from "./tests.js";
import * as demo from "./demo.js";
import * as assistant from "./assistant.js";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
}

/* ---------- state ---------- */
const state = {
  engines: [],          // [{id, name}]
  answers: {},          // id -> server answer, or undefined while asking
  using: store.get("tosi.engine", null),
  about: null,
};

async function askAll() {
  state.answers = {};
  render();
  const all = await fetch("/api/engines").then((r) => r.json());
  state.engines = all.map(({ id, name, available }) => ({ id, name, available: available !== false }));
  for (const a of all) state.answers[a.id] = a;
  if (!state.engines.some((e) => e.id === state.using && e.available)) use(state.engines.find((e) => e.available)?.id, false);
  render();
}
async function askOne(id) {
  delete state.answers[id];
  render();
  state.answers[id] = await fetch(`/api/engines/${id}/info`).then((r) => r.json());
  render();
}
function use(id, ask = true) {
  if (!id || !state.engines.find((e) => e.id === id)?.available) return;
  state.using = id;
  store.set("tosi.engine", id);
  if (ask) askOne(id); else render();
}
const dotClass = (a) => (!a ? "sk dot" : "dot " + (a.ok ? "ok" : "bad"));

/* ---------- sidebar ---------- */
const NAV = [
  { route: "/", label: "Home", icon: "house" },
  { route: "/flow", label: "Flow", icon: "route" },
  { route: "/library", label: "Library", icon: "folder-open" },
  { route: "/algorithm", label: "Algorithm", icon: "sitemap" },
  { route: "/guidebook", label: "Guidebook", icon: "book" },
];

function setShut(shut) {
  document.body.classList.toggle("shut", shut);
  store.set("tosi.side", shut ? "shut" : "open");
  const t = $("tog");
  t.innerHTML = icon(shut ? "angles-right" : "angles-left");
  t.title = shut ? "Open the sidebar ( [ )" : "Collapse the sidebar ( [ )";
  t.setAttribute("aria-label", t.title);
  t.setAttribute("aria-expanded", String(!shut));
}

function drawSide(route) {
  $("nav").replaceChildren(...NAV.map((n) =>
    el("a", { href: `#${n.route}`, class: (n.route === "/" ? route === "/" : route.startsWith(n.route)) ? "on" : "", title: n.label }, el("span", { class: "ic", html: icon(n.icon) }), el("span", { class: "label" }, n.label))));
  const s = $("settings");
  s.className = route.startsWith("/settings") ? "on" : "";
  s.title = "Settings";
  s.setAttribute("aria-label", "Settings");
  s.innerHTML = `<span class="ic">${icon("gear")}</span><span class="label">Settings</span>`;
  const eng = state.engines.find((e) => e.id === state.using), a = state.answers[state.using];
  const u = $("using");
  u.replaceChildren(el("span", { class: "ic" }, a ? el("i", { class: dotClass(a) }) : el("i", { class: "sk dot" })), eng ? el("span", { class: "label" }, "Engine ", el("b", {}, eng.name)) : el("span", { class: "label sk", style: "width:90px" }));
  u.title = eng ? `Using the ${eng.name} engine${a && !a.ok ? " (not running)" : ""}` : "";
}

/* ---------- pages ---------- */
const SETTINGS = [
  { id: "engines", label: "Engines", icon: "microchip", draw: enginesPage },
  { id: "tests", label: "Tests", icon: "flask-vial", draw: () => testsPage(el) },
  { id: "appearance", label: "Appearance", icon: "palette", draw: appearancePage },
  { id: "about", label: "About", icon: "circle-info", draw: aboutPage },
];

/* Themes. Their colours live in theme-tokens.css; this list only names them. */
const THEMES = [
  { id: "matte", name: "Matte Black", mode: "dark", about: "Soft black, quiet greys. The default." },
  { id: "pitch", name: "Pitch Black", mode: "dark", about: "True black, for dark rooms and OLED screens." },
  { id: "minimal", name: "Clean Minimalist", mode: "light", about: "Warm paper, one ink, one accent." },
  { id: "blackboard", name: "Blackboard", mode: "light", about: "Hand-drawn outlines on dotted paper. Playful." },
  { id: "neumorphism", name: "Neumorphism", mode: "light", about: "One soft colour; depth from light and shadow." },
  { id: "textbook-light", name: "Textbook Light", mode: "light", about: "Apricot pastels on cream. Literata headings, Nunito text." },
  { id: "textbook-dark", name: "Textbook Dark", mode: "dark", about: "The same apricot book, by lamplight." },
];
function setTheme(id) {
  document.documentElement.dataset.theme = id;
  store.set("tosi.theme", id);
  render();
}

let SAMPLES = null;
function home() { return flow.homePage(SAMPLES); }

function settings(pageId) {
  const page = SETTINGS.find((p) => p.id === pageId) ?? SETTINGS[0];
  return el("div", { class: "set" },
    el("h1", {}, el("span", { class: "t" }, "Settings")),
    el("nav", { class: "sub", "aria-label": "Settings pages" },
      SETTINGS.map((p) => el("a", { href: `#/settings/${p.id}`, class: p === page ? "on" : "" }, el("span", { class: "ic", html: icon(p.icon) }), el("span", { class: "label" }, p.label)))),
    el("section", { class: "page" }, page.draw()));
}

function enginesPage() {
  const spec = state.about?.spec;
  return [
    el("div", { class: "bar" },
      el("div", {},
        el("h2", { html: icon("microchip") }, el("span", { class: "t" }, "Engines")),
        el("p", { class: "lede" }, "Every stage is written three times, once in each language. The engine in use runs your files; the others can be compared against it.")),
      el("button", { class: "icob", onclick: askAll, html: icon("rotate-left") }, el("span", { class: "t" }, "Check all again"))),
    el("div", { class: "eng" }, state.engines.length ? null : [0, 1, 2].map(() => el("div", { class: "row" },
      el("div", {}, el("span", { class: "sk title" }), el("span", { class: "sk line", style: "width:180px;margin-top:8px" })),
      el("span", { class: "sk", style: "width:72px;height:26px" }),
      el("dl", {}, [0, 1, 2, 3].map(() => el("div", {}, el("span", { class: "sk line", style: "width:70px" }), el("span", { class: "sk line", style: "width:90px;margin-top:6px" })))))),
      state.engines.map((e) => {
      const a = state.answers[e.id], inUse = e.id === state.using, i = a?.info;
      const status = !a ? el("span", { class: "sk line", style: "width:170px;margin-top:6px" }) : !e.available ? "Unavailable on this deployment" : a.ok ? `Running · answered in ${a.ms} ms` : "Not running";
      const row = el("div", { class: "row" },
        el("div", {},
          el("div", { class: "name" }, el("i", { class: dotClass(a) }), e.name),
          el("div", { class: "state" }, status)),
        el("button", !e.available
          ? { class: "use", disabled: true }
          : inUse
          ? { class: "use", disabled: true, html: icon("check") }
          : { class: "use", onclick: () => use(e.id), "aria-label": `Use the ${e.name} engine` },
          el("span", { class: "t" }, !e.available ? "Unavailable" : inUse ? "In use" : "Use this")));
      if (!a) {
        row.append(el("dl", {}, [0, 1, 2, 3].map(() => el("div", {}, el("span", { class: "sk line", style: "width:70px" }), el("span", { class: "sk line", style: "width:90px;margin-top:6px" })))));
      } else if (a.ok) {
        const specOff = spec && i.spec !== spec;
        row.append(el("dl", {},
          el("div", {}, el("dt", {}, "Engine version"), el("dd", {}, i.version)),
          el("div", {}, el("dt", {}, "Runtime"), el("dd", {}, i.runtime)),
          el("div", {}, el("dt", {}, "Spec"), el("dd", { class: specOff ? "warn" : "" }, specOff ? `${i.spec}, expected ${spec}` : i.spec)),
          el("div", {}, el("dt", {}, "Stages"), el("dd", {}, i.stages.length ? i.stages.join(", ") : "None yet"))));
      } else if (a && e.available) {
        row.append(el("div", { class: "err" }, a.error, a.hint ? el("code", {}, a.hint) : null));
      }
      return row;
    })),
  ];
}

function appearancePage() {
  const now = document.documentElement.dataset.theme;
  return [
    el("h2", { html: icon("palette") }, el("span", { class: "t" }, "Appearance")),
    el("p", { class: "lede" }, "Seven themes, one layout. Each preview is drawn in its own theme."),
    el("div", { class: "themes", role: "radiogroup", "aria-label": "Theme" }, THEMES.map((t) =>
      el("button", { class: "th" + (t.id === now ? " on" : ""), role: "radio", "aria-checked": String(t.id === now), onclick: () => setTheme(t.id) },
        el("div", { class: "prev", "data-theme": t.id, "aria-hidden": "true" },
          el("div", { class: "ps" }, el("i", { class: "a" }), el("i", {}), el("i", {})),
          el("div", { class: "pm" }, el("i", { class: "h" }), el("i", {}), el("i", { style: "width:70%" }), el("i", { class: "a", style: "width:25%" }))),
        el("div", { class: "meta", html: icon(t.mode === "dark" ? "moon" : "sun") }, el("b", {}, t.name), t.id === now ? el("span", { class: "chk", html: icon("check") }) : null),
        el("small", {}, t.about)))),
  ];
}

function aboutPage() {
  const a = state.about;
  return [
    el("h2", { html: icon("circle-info") }, el("span", { class: "t" }, "About")),
    el("p", { class: "lede" }, "Tosi checks new filings against national spectrum use. Every result comes from a stated rule and can be reproduced exactly."),
    a ? el("dl", { class: "about" },
      el("dt", {}, "Tosi"), el("dd", {}, a.tosi),
      el("dt", {}, "Spec"), el("dd", {}, a.spec),
      el("dt", {}, "Server"), el("dd", {}, a.server),
      el("dt", {}, "Engines"), el("dd", {}, a.engines.map((e) => e.name).join(", "))) : el("dl", { class: "about" }, [0, 1, 2, 3].flatMap(() => [el("dt", {}, el("span", { class: "sk line", style: "width:60px" })), el("dd", {}, el("span", { class: "sk line", style: "width:140px" }))])),
  ];
}

/* ---------- routing ---------- */
function route() { return (location.hash.replace(/^#/, "") || "/").replace(/\/+$/, "") || "/"; }
let page = null;
function render() {
  const r = route();
  drawSide(r);
  const parts = r.split("/").filter(Boolean);
  // The Flow manages its own live updates; only rebuild it when the route changes.
  if (parts[0] === "flow" && page?.route === r) return;
  page?.cleanup?.();
  page = parts[0] === "settings" ? settings(parts[1]) : parts[0] === "flow" ? flow.flowPage(parts[1]) : parts[0] === "guidebook" ? guidebook.guidebookPage(parts[1]) : parts[0] === "algorithm" ? guidebook.algorithmPage(parts[1]) : parts[0] === "library" ? library.libraryPage() : home();
  page.route = r;
  $("main").replaceChildren(...[].concat(page));
  if (parts[0] === "flow") scrollTo(0, 0);
  document.title = { settings: "Settings · Tosi", flow: "Flow · Tosi", guidebook: "Guidebook · Tosi", algorithm: "Algorithm · Tosi", library: "Library · Tosi" }[parts[0]] ?? "Tosi";
}

/* ---------- drop a file anywhere ---------- */
function busy(text, sub) {
  const b = $("busy");
  document.body.classList.toggle("busy", !!text);
  b.replaceChildren(...(text ? [el("b", {}, text), sub ? el("small", {}, sub) : null].filter(Boolean) : []));
}
function toast(text) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 5000);
}
let dragDepth = 0;
addEventListener("dragenter", (e) => { if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return; e.preventDefault(); dragDepth++; document.body.classList.add("over"); });
addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("over"); } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("over");
  const f = e.dataTransfer?.files?.[0];
  if (f) flow.upload(f);
});

addEventListener("hashchange", render);
addEventListener("keydown", (e) => {
  if (e.key === "[" && !e.target.closest("input, textarea, [contenteditable]")) setShut(!document.body.classList.contains("shut"));
});
$("tog").addEventListener("click", () => setShut(!document.body.classList.contains("shut")));
document.querySelector(".brand").addEventListener("click", (e) => { if (document.body.classList.contains("shut")) { e.preventDefault(); setShut(false); } });

setShut(store.get("tosi.side", "open") === "shut");
$("drop").querySelector(".ic").innerHTML = icon("arrow-up-from-bracket");
guidebook.init({ el, toast });
demo.init({ el, toast });          // the demo run and the assistant's button, on the Algorithm and Guidebook pages
assistant.init({ el });
library.init({ el, toast, using: () => state.using || "ts", go: (r) => { location.hash = `#${r}`; } });
flow.init({ el, store, using: () => state.using || "ts", go: (r) => { location.hash = `#${r}`; }, busy, toast });
render();
const engineList = askAll();
// Samples: shown on Home, and loaded automatically the first time this session opens with nothing loaded.
(async () => {
  await engineList;
  SAMPLES = await fetch("/api/samples").then((r) => r.json()).catch(() => []);
  const existing = await flow.loadRuns();
  if (route().startsWith("/flow")) { page?.cleanup?.(); page = null; render(); }
  let auto = false;
  try { auto = !sessionStorage.getItem("tosi.autoload"); sessionStorage.setItem("tosi.autoload", "1"); } catch {}
  if (auto && !existing.length && SAMPLES.length && route() === "/") {
    const ids = [];
    for (const s of SAMPLES) ids.push(await flow.startSample(s.name));
    location.hash = `#/flow/${ids[0]}`;
  } else if (route() === "/") render();
})().finally(() => window.tosiLoaded?.());       // the loading screen leaves once the first page is ready
fetch("/api/about").then((r) => r.json()).then((a) => { state.about = a; render(); });
