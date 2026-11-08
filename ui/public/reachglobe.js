// The Reach picture: Finland on the curve of the globe, seen at a slant from the south, with the sky above it as a
// glass dome. Each satellite Finland can see sits in the dome where you would look to find it. Not to scale: the
// dome stands for the whole sky, however far away a satellite is. Display only; Reach's result decides, not this.
// Drag to turn the view around Finland or tilt it; double-click to go back. Plain projection maths, no 3D library.
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const LAT0 = 64, LON0 = 26;                 // the middle of Finland: the dome stands here
const TILT = 64, YAW = 0;                   // the starting view: leaning 64° from straight down, looking north
const TILT_MIN = 30, TILT_MAX = 82;
const RE = 6378.14, RG = 42164.2;           // as in spec/rulebook/reach.json

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const vec = (lat, lon) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const N = vec(LAT0, LON0);                                                       // up, at the middle of Finland
const E = [-Math.sin(LON0 * RAD), Math.cos(LON0 * RAD), 0];                       // east
const U = [-Math.sin(LAT0 * RAD) * Math.cos(LON0 * RAD), -Math.sin(LAT0 * RAD) * Math.sin(LON0 * RAD), Math.cos(LAT0 * RAD)]; // north
// The camera for a view: yaw turns it around Finland (0 looks north), tilt leans it from straight down.
function camera(yaw, tilt) {
  const y = yaw * RAD, t = tilt * RAD;
  const ahead = add(U.map((v) => v * Math.cos(y)), E, Math.sin(y));                // the way the viewer faces, level
  const right = add(E.map((v) => v * Math.cos(y)), U, -Math.sin(y));
  return { right, cam: add(N.map((v) => v * Math.cos(t)), ahead, -Math.sin(t)), up: add(N.map((v) => v * Math.sin(t)), ahead, Math.cos(t)) };
}

// A stable spread in [0, 1) for each filing, so dots that share an orbit do not sit on one another.
export function spread(id, k = 1) {
  let h = Math.imul((id | 0) ^ Math.imul(k, 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Where a fixed satellite appears from the middle of Finland: compass direction and height above the horizon.
export function gsoSky(lon) {
  const d = ((lon - LON0 + 540) % 360) - 180, phi = LAT0 * RAD;
  const c = Math.cos(phi) * Math.cos(d * RAD);
  return { az: (Math.atan2(Math.sin(d * RAD), -Math.sin(phi) * Math.cos(d * RAD)) * DEG + 360) % 360, el: Math.atan2(c - RE / RG, Math.sqrt(1 - c * c)) * DEG };
}
// Where a moving satellite appears at its highest pass over the middle of Finland. The filing has no time, so the
// direction is illustrative: south for an orbit that stays south of Finland, anywhere near overhead for one that crosses it.
export function ngsoSky(id, tilt, apogee) {
  const a = spread(id), b = spread(id, 2);
  if (tilt == null || apogee == null) return { az: a * 360, el: 25 + 40 * b };
  if (tilt >= LAT0) return { az: a * 360, el: 32 + 52 * Math.sqrt(b) };
  const gap = (LAT0 - tilt) * RAD, el = Math.atan2(Math.cos(gap) - RE / (RE + apogee), Math.sin(gap)) * DEG;
  return { az: 180 + (a - 0.5) * 110, el: Math.max(4, el) * (0.85 + 0.15 * b) };
}

export function makeGlobe(el, finland) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "rglobe"); svg.setAttribute("aria-hidden", "true");
  const node = (tag, cls) => { const e = document.createElementNS(NS, tag); if (cls) e.setAttribute("class", cls); svg.append(e); return e; };
  // The globe fades out away from Finland, so only the curve near it shows.
  const id = "rgfade" + Math.random().toString(36).slice(2, 8);
  const defs = node("defs");
  defs.innerHTML = `<radialGradient id="${id}g" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="${id}" maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000"><rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#${id}g)"/></mask>`;
  const fade = document.createElementNS(NS, "g"); fade.setAttribute("mask", `url(#${id})`); svg.append(fade);
  const inFade = (tag, cls) => { const e = document.createElementNS(NS, tag); e.setAttribute("class", cls); fade.append(e); return e; };
  const earth = inFade("circle", "rg-earth"), grid = inFade("path", "rg-grat"), land = node("path", "rg-land");
  const dome = node("path", "rg-dome"), ring = node("path", "rg-ring"), arc = node("path", "rg-arc");
  const note = el("div", { class: "nsub rg-note" }, "Not to scale. The sky as seen from the middle of Finland; moving satellites are shown at their highest pass. Drag to turn it.");
  const legend = el("div", { class: "nsub rg-legend" },
    el("span", { class: "rg-key" }, el("b", { class: "rg-fixed" }), "Fixed in the sky"),
    el("span", { class: "rg-key" }, el("b", { class: "rg-pass" }), "Crosses the sky, briefly · orbit tilt 0°", el("i", {}), "90°"),
    el("span", { class: "rg-key" }, el("b", { class: "rg-far" }), "Beyond Earth"));
  let P = null, box = null, yaw = YAW, tilt = TILT;  // projection, set by draw

  function layout(b) { box = b; draw(); }
  function turn(dYaw, dTilt) { yaw = (yaw + dYaw + 360) % 360; tilt = Math.min(TILT_MAX, Math.max(TILT_MIN, tilt + dTilt)); draw(); }
  function reset() { yaw = YAW; tilt = TILT; draw(); }
  const turned = () => yaw !== YAW || tilt !== TILT;
  function draw() {
    if (!box) return;
    // Fit: the dome's radius from the room available; Finland's scale fixed from the starting view, so turning
    // never changes its size.
    const r = Math.min((box.y1 - box.y0) / 1.55, (box.x1 - box.x0) / 2);
    if (!(r > 0)) return;                    // not laid out yet (the stage has no size)
    const { right, cam, up } = camera(yaw, tilt);
    const cx = (box.x0 + box.x1) / 2, cy = box.y0 + r;
    const ext = finland.rings.flat().map(([lo, la]) => dot3(vec(la, lo), E));
    const s = (r * 0.8) / (Math.max(...ext) - Math.min(...ext));
    const ox = cx, oy = cy + s * dot3(N, up);                                   // where the Earth's centre lands
    const pr = (v) => ({ x: ox + s * dot3(v, right), y: oy - s * dot3(v, up), z: dot3(v, cam) });
    const rd = r / s;
    const skyv = (az, elv) => add(add(E.map((v) => v * Math.cos(elv * RAD) * Math.sin(az * RAD)), U, Math.cos(elv * RAD) * Math.cos(az * RAD)), N, Math.sin(elv * RAD));
    P = { r, cx, cy, ground: (lon, lat) => pr(vec(lat, lon)), sky: (az, elv) => { const d = skyv(az, elv), p = pr(add(N, d, rd)); return { ...p, far: dot3(d, cam) < -0.05 }; } };
    const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
    earth.setAttribute("cx", ox); earth.setAttribute("cy", oy); earth.setAttribute("r", s);
    const g0 = defs.querySelector("radialGradient");
    g0.setAttribute("cx", cx); g0.setAttribute("cy", cy); g0.setAttribute("r", r * 1.25);
    land.setAttribute("d", finland.rings.map((ring) => path(ring.map(([lo, la]) => pr(vec(la, lo)))) + "Z").join(""));
    let g = "";
    for (let la = 50; la <= 80; la += 5) { const pts = []; for (let lo = -10; lo <= 60; lo += 1) pts.push(pr(vec(la, lo))); g += path(pts.filter((p) => p.z > 0)); }
    for (let lo = 0; lo <= 50; lo += 10) { const pts = []; for (let la = 45; la <= 85; la += 1) pts.push(pr(vec(la, lo))); g += path(pts.filter((p) => p.z > 0)); }
    grid.setAttribute("d", g);
    const base = []; for (let a = 0; a <= 360; a += 4) base.push(P.sky(a, 0));
    ring.setAttribute("d", path(base));
    dome.setAttribute("d", `M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`);
    const belt = []; for (let lo = -180; lo <= 180; lo += 1) { const q = gsoSky(lo); if (q.el >= 0) belt.push({ lo, ...q }); }
    belt.sort((a, b) => a.az - b.az);
    arc.setAttribute("d", path(belt.map((q) => P.sky(q.az, q.el))));
    note.style.left = `${box.x0}px`; note.style.top = `${box.y0 - 46}px`; note.style.maxWidth = `${box.x1 - box.x0}px`;
    legend.style.left = `${box.x0}px`; legend.style.top = `${box.y1 - 16}px`; legend.style.maxWidth = `${box.x1 - box.x0}px`;
  }
  // Screen position for a satellite at (az, el); a dot is centred on it.
  const place = (az, elv, size = 12) => { if (!P) return null; const p = P.sky(az, elv); return { x: p.x - size / 2, y: p.y - size / 2, far: p.far }; };
  // A point on Finland's ground, for the stations and where the beams land (the middle of Finland by default).
  const toGround = (lon = LON0, lat = LAT0) => P ? P.ground(lon, lat) : null;
  // Whether a point on the stage is over the picture, where a drag turns it.
  const over = (x, y) => !!box && x >= box.x0 && x <= box.x1 && y >= box.y0 - 10 && y <= box.y1;
  function show(o, words = o) {                // words: the note and legend, which only Reach itself shows
    svg.style.opacity = String(o); note.style.opacity = String(words); legend.style.opacity = String(words);
    svg.style.transform = `scale(${0.97 + 0.03 * o})`;
  }
  return { svg, note, legend, layout, place, show, turn, reset, turned, over, toGround };
}

// Pink for a moving satellite, paler for a gentle orbit tilt, deeper for a steep one. Kept well away from red.
export function tiltPink(tilt, dark) {
  const t = Math.min(1, Math.max(0, (tilt ?? 0) / 90));
  return dark ? `hsl(328 70% ${88 - 26 * t}%)` : `hsl(328 62% ${78 - 30 * t}%)`;
}

// A satellite travelling around another body: a soft blue, apart from the fixed (purple) and the passing (pink).
export const farBlue = (dark) => dark ? "hsl(205 60% 78%)" : "hsl(205 55% 58%)";
