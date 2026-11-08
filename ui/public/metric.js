// A metric card: one big number with its unit, which you can type into, and a faint fill behind it that you drag
// sideways like a slider. Used for file sizes (Tests, and the file size limit on the Algorithm page).
//
// metric(el, { label, value, min, max, log, format(v) -> [number text, unit], parse(text, unit) -> v, onInput(v), disabled })

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function metric(el, o) {
  let v = clamp(o.value, o.min, o.max);
  const toF = (x) => o.log ? Math.log(x / o.min) / Math.log(o.max / o.min) : (x - o.min) / (o.max - o.min);
  const fromF = (f) => o.log ? o.min * Math.pow(o.max / o.min, f) : o.min + f * (o.max - o.min);

  const fill = el("div", { class: "mc-fill" });
  const input = el("input", { class: "mc-n", type: "text", inputmode: "decimal", "aria-label": o.label, disabled: o.disabled ? true : null });
  const unit = el("span", { class: "mc-u" });
  const card = el("div", { class: "mc" + (o.disabled ? " off" : ""), role: "slider", tabindex: o.disabled ? "-1" : "0", "aria-label": o.label,
    "aria-valuemin": String(o.min), "aria-valuemax": String(o.max) },
    fill,
    o.label ? el("div", { class: "mc-l" }, o.label) : null,
    el("div", { class: "mc-v" }, input, unit),
    o.hint ? el("div", { class: "mc-h" }, o.hint) : null);

  function show(fromTyping) {
    const [n, u] = o.format(v);
    if (!fromTyping) input.value = n;
    input.style.width = `${Math.max(1, input.value.length) * 0.62 + 0.1}em`;
    unit.textContent = u;
    fill.style.width = `${clamp(toF(v), 0, 1) * 100}%`;
    card.setAttribute("aria-valuenow", String(v)); card.setAttribute("aria-valuetext", `${n} ${u}`);
  }
  function set(x, fromTyping) { v = clamp(x, o.min, o.max); show(fromTyping); o.onInput?.(v); }

  // Dragging: anywhere on the card except the number itself. Movement is relative, so grabbing does not jump.
  let drag = null;
  card.addEventListener("pointerdown", (e) => {
    if (o.disabled || e.target === input || e.button !== 0) return;
    drag = { x: e.clientX, f: toF(v), w: card.getBoundingClientRect().width, moved: false };
    card.setPointerCapture(e.pointerId); card.classList.add("drag");
  });
  card.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    set(fromF(clamp(drag.f + dx / drag.w, 0, 1)));
  });
  const end = (e) => {
    if (!drag) return;
    // A click without movement sets the value where you clicked.
    if (!drag.moved && e.type === "pointerup") { const r = card.getBoundingClientRect(); set(fromF(clamp((e.clientX - r.left) / r.width, 0, 1))); }
    drag = null; card.classList.remove("drag");
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
  card.addEventListener("lostpointercapture", end);

  // Keys: arrows nudge by 2% of the range (Shift for 10%), Home and End go to the ends.
  card.addEventListener("keydown", (e) => {
    if (o.disabled || e.target === input) return;
    const step = e.shiftKey ? 0.1 : 0.02, f = toF(v);
    const k = { ArrowRight: f + step, ArrowUp: f + step, ArrowLeft: f - step, ArrowDown: f - step, Home: 0, End: 1 }[e.key];
    if (k == null) return;
    e.preventDefault(); set(fromF(clamp(k, 0, 1)));
  });

  // Typing: applied as you type when it reads as a number; tidied on leaving the field.
  input.addEventListener("input", () => { const x = o.parse(input.value, unit.textContent); if (x != null && isFinite(x) && x > 0) set(x, true); else show(true); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { show(); input.blur(); } });
  input.addEventListener("blur", () => show());

  show();
  card.value = () => v;
  card.set = (x) => set(x);
  return card;
}

// File sizes, held in gigabytes: below 1 GB shown in MB.
export const sizeFormat = (gb) => gb < 1 ? [String(Math.round(gb * 1000)), "MB"] : [gb < 10 ? gb.toFixed(1).replace(/\.0$/, "") : String(Math.round(gb)), "GB"];
export function sizeParse(text, unit) {
  const m = String(text).trim().match(/^([\d.,]+)\s*(mb|gb|tb)?$/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", ".")), u = (m[2] ?? unit).toUpperCase();
  return u === "MB" ? n / 1000 : u === "TB" ? n * 1000 : n;
}
