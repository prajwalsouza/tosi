// The home page scene: a small floating stone island with an observatory, a telescope on its terrace and a radio dish
// on the hill, under a sky where a few satellites keep passing along faint orbits. Low poly, soft shaded, no
// post-processing. It reads its colours from the theme tokens and re-tints live when the theme changes:
// night (dark themes) has stars, a crescent moon and warm lamps; day (light themes) a pale sky, a soft sun and lighter stone.
// mount(container) builds it and returns a cleanup function.

const THEMES = ["matte", "pitch", "blackboard", "neumorphism", "minimal", "textbook-light", "textbook-dark"];
const THREE_URL = new URL("./vendor/three/three.module.min.js", import.meta.url).href;

// A small seeded random, so the scene is the same on every visit.
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Read a CSS colour (any syntax the browser understands, including color-mix) as [r, g, b] in 0..1.
const probe = (() => { const c = document.createElement("canvas"); c.width = c.height = 1; return c.getContext("2d", { willReadFrequently: true }); })();
function cssColour(str, fallback) {
  if (!str) return fallback;
  probe.clearRect(0, 0, 1, 1); probe.fillStyle = "#000"; probe.fillStyle = str.trim(); probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const get = (n, f) => cssColour(cs.getPropertyValue(n), f);
  const bg = get("--bg", [0.08, 0.08, 0.08]);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(bg[0]) + 0.7152 * lin(bg[1]) + 0.0722 * lin(bg[2]);
  return { bg, ink: get("--ink", [0.92, 0.92, 0.9]), accent: get("--accent", [0.72, 0.67, 0.9]), surface: get("--surface", bg), dark: lum < 0.35 };
}

export function mount(container) {
  let disposed = false, stop = () => {};
  const sk = document.createElement("div");
  sk.className = "home3d-sk sk";
  container.append(sk);
  import(THREE_URL).then((THREE) => {
    if (disposed) return;
    try { stop = build(THREE, container, () => sk.remove()); } catch (e) { console.warn("home3d:", e); sk.remove(); }
  }).catch(() => sk.remove());
  return () => { disposed = true; stop(); sk.remove(); };
}

function build(THREE, container, ready) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  container.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 17, 34);
  const camera = new THREE.PerspectiveCamera(30, 2, 0.1, 80);
  const C = (h) => new THREE.Color(h);
  const R = rng(7);

  /* ---------- materials: one per colour role, re-tinted by the theme ---------- */
  const lam = (o = {}) => new THREE.MeshLambertMaterial({ flatShading: true, ...o });
  const M = {
    stone: lam(), stoneDark: lam(), rock: lam(), grass: lam(), hill: lam(), hillFar: lam(), cypress: lam(), shrub: lam(),
    white: lam(), dome: lam(), wood: lam(), woodDark: lam(), black: lam(), metal: lam(), panel: lam(), satBody: lam(), ivy: lam(),
    planet: lam({ fog: false }), dish: lam({ side: THREE.DoubleSide }),
    flower: new THREE.MeshBasicMaterial(),
    warm: new THREE.MeshBasicMaterial(), glass: new THREE.MeshBasicMaterial({ transparent: true }), slit: new THREE.MeshBasicMaterial(),
    mountain: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    ring: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, fog: false, depthWrite: false }),
    satPanel: lam({ fog: false }), satCore: lam({ fog: false }),
    orbit: new THREE.LineBasicMaterial({ transparent: true, fog: false, depthWrite: false }),
    lattice: new THREE.LineBasicMaterial({ transparent: true }),
  };

  /* ---------- shape helpers ---------- */
  // Move each vertex by a little noise keyed on its position, so seams stay shut and the faces look hand-cut.
  function jitter(geo, amt, keepTop = false) {
    const p = geo.attributes.position, v = new THREE.Vector3();
    const h = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s) - 0.5; };
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = [v.x.toFixed(3), v.y.toFixed(3), v.z.toFixed(3)].map(Number);
      const top = keepTop && v.y > -1e-3 + geo.userData.top;
      p.setXYZ(i, v.x + h(k[0], k[1], k[2]) * amt, top ? v.y : v.y + h(k[1], k[2], k[0]) * amt, v.z + h(k[2], k[0], k[1]) * amt);
    }
    geo.computeVertexNormals();
    return geo;
  }
  const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = scene) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const up = new THREE.Vector3(0, 1, 0);
  // A thin cylinder from a to b.
  function rod(a, b, r, mat, parent = scene, seg = 5) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const m = mesh(new THREE.CylinderGeometry(r, r, len, seg), mat, 0, 0, 0, parent);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(up, d.normalize());
    return m;
  }
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  /* ---------- the island ---------- */
  const island = new THREE.Group();
  scene.add(island);
  const top = new THREE.CylinderGeometry(4.35, 4.15, 0.55, 15, 1); top.userData.top = 0.275;
  mesh(jitter(top, 0.18, true), M.stone, 0, -0.29, 0, island);
  mesh(new THREE.CylinderGeometry(4.2, 4.3, 0.1, 15, 1), M.grass, 0, 0.0, 0, island);
  const under = new THREE.ConeGeometry(4.15, 3.8, 13, 4); under.rotateX(Math.PI);
  mesh(jitter(under, 0.45), M.stoneDark, 0, -2.45, 0, island).rotation.y = 0.3;
  // two small stones drifting under it
  mesh(jitter(new THREE.DodecahedronGeometry(0.42, 0), 0.12), M.stoneDark, -2.6, -3.3, 0.8, island);
  mesh(jitter(new THREE.DodecahedronGeometry(0.26, 0), 0.08), M.stoneDark, 2.4, -3.9, 0.4, island);

  // the rolling hills at the back, and the hill on the right that carries the dish
  const hillGeo = jitter(new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0.06);
  const hill = (x, z, sx, sy, sz, mat) => { const m = mesh(hillGeo, mat, x, 0.0, z, island); m.scale.set(sx, sy, sz); return m; };
  hill(-0.6, -2.7, 2.7, 0.75, 1.3, M.hill);
  hill(1.0, -3.1, 2.5, 1.05, 1.1, M.hillFar);
  hill(2.7, -1.5, 1.75, 1.15, 1.6, M.grass);
  hill(-3.2, -1.2, 1.2, 0.35, 1.2, M.hill);

  // the curved terrace in front and its steps
  const TER = 0.2;
  const terrace = mesh(new THREE.CylinderGeometry(2.75, 2.85, TER, 22, 1, false, -1.95, 3.9), M.stone, 0.35, TER / 2, 0.55, island);
  terrace.geometry = jitter(terrace.geometry, 0.03);
  for (let i = 0; i < 3; i++) {
    const w = 1.5 + i * 0.25;
    mesh(new THREE.BoxGeometry(w, 0.13, 0.36), i % 2 ? M.stoneDark : M.stone, 0.35, TER - 0.13 * (i + 1) + 0.065, 3.5 + i * 0.32, island);
  }

  /* ---------- the observatory ---------- */
  const obs = new THREE.Group(); obs.position.set(-1.85, 0, -0.85); island.add(obs);
  mesh(new THREE.CylinderGeometry(1.08, 1.14, 1.7, 18), M.white, 0, 0.85, 0, obs);
  mesh(new THREE.CylinderGeometry(1.17, 1.17, 0.09, 18), M.metal, 0, 1.72, 0, obs);
  const dome = mesh(new THREE.SphereGeometry(1.1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.dome, 0, 1.76, 0, obs);
  // the open slit, glowing from inside, turned a little towards the telescope
  const sa = Math.PI / 2 + 0.55;
  mesh(new THREE.SphereGeometry(1.115, 2, 7, sa - 0.13, 0.26, 0.04, Math.PI / 2 - 0.04), M.slit, 0, 1.76, 0, obs);
  // ribs on the dome
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const rib = mesh(new THREE.TorusGeometry(1.105, 0.018, 3, 10, Math.PI / 2), M.metal, 0, 1.76, 0, obs);
    rib.rotation.y = a;           // the torus arc runs from the equator (+x) to the top (+y): a meridian
  }
  void dome;
  // the arched door, facing the front a little to the right, with a lamp beside it
  const da = 0.42;
  const doorShape = new THREE.Shape();
  doorShape.moveTo(-0.22, 0); doorShape.lineTo(0.22, 0); doorShape.lineTo(0.22, 0.52); doorShape.absarc(0, 0.52, 0.22, 0, Math.PI, false); doorShape.lineTo(-0.22, 0);
  const door = mesh(new THREE.ShapeGeometry(doorShape, 6), M.woodDark, Math.sin(da) * 1.125, 0.01, Math.cos(da) * 1.125, obs);
  door.rotation.y = da;
  const frame = mesh(new THREE.ShapeGeometry(doorShape, 6), M.metal, Math.sin(da) * 1.118, -0.02, Math.cos(da) * 1.118, obs);
  frame.rotation.y = da; frame.scale.set(1.18, 1.1, 1);
  const la = da + 0.36;
  const lampPos = V(Math.sin(la) * 1.17, 0.98, Math.cos(la) * 1.17);
  mesh(new THREE.SphereGeometry(0.055, 8, 6), M.warm, lampPos.x, lampPos.y, lampPos.z, obs);
  mesh(new THREE.BoxGeometry(0.05, 0.05, 0.08), M.black, Math.sin(la) * 1.13, 1.05, Math.cos(la) * 1.13, obs).rotation.y = la;
  const lampLight = new THREE.PointLight(0xffc27a, 0, 3.2, 1.6);
  lampLight.position.copy(lampPos).multiplyScalar(1.15); obs.add(lampLight);
  // ivy with small white flowers, climbing the wall left of the door
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const leaves = new THREE.InstancedMesh(leafGeo, M.ivy, 90), flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), M.flower, 26);
  const tmp = new THREE.Object3D();
  for (let i = 0; i < 90; i++) {
    const y = Math.pow(R(), 1.6) * 1.55, spread = 0.75 - y * 0.3;
    const a = -0.15 - R() * spread;
    tmp.position.set(Math.sin(a) * 1.15, y + 0.04, Math.cos(a) * 1.15);
    tmp.rotation.set(R() * 3, R() * 3, R() * 3);
    const s = 0.06 + R() * 0.07 - y * 0.015; tmp.scale.set(s, s * 0.8, s);
    tmp.updateMatrix(); leaves.setMatrixAt(i, tmp.matrix);
  }
  for (let i = 0; i < 26; i++) {
    const y = Math.pow(R(), 1.4) * 1.35, a = -0.15 - R() * (0.72 - y * 0.3);
    tmp.position.set(Math.sin(a) * 1.21, y + 0.05, Math.cos(a) * 1.21); tmp.rotation.set(0, 0, 0);
    tmp.scale.setScalar(0.022 + R() * 0.012); tmp.updateMatrix(); flowers.setMatrixAt(i, tmp.matrix);
  }
  obs.add(leaves, flowers);

  // two tall cypresses behind it on the left
  const cyp = (x, z, h) => {
    const pts = []; for (let i = 0; i <= 7; i++) { const t = i / 7; pts.push(new THREE.Vector2(Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.36 * (1 - t * 0.35) + 0.001, t * h)); }
    const g = jitter(new THREE.LatheGeometry(pts, 7), 0.05);
    mesh(g, M.cypress, x, 0.05, z, island);
    mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.25, 5), M.woodDark, x, 0.05, z, island);
  };
  cyp(-3.25, -1.95, 3.5); cyp(-2.55, -2.65, 4.1);

  // rocks and dark shrubs around the base
  const rockGeo = jitter(new THREE.DodecahedronGeometry(1, 0), 0.25), shrubGeo = jitter(new THREE.IcosahedronGeometry(1, 0), 0.2);
  const ROCKS = [[-3.4, -0.2, 0.42], [-3.0, 0.7, 0.3], [-0.6, -0.15, 0.24], [-3.6, -1.0, 0.3], [3.6, 0.9, 0.38], [3.3, 1.6, 0.24], [-2.1, 2.6, 0.3], [-3.0, 1.9, 0.26], [1.3, -1.6, 0.22], [3.9, -0.2, 0.3], [-1.3, 3.4, 0.2]];
  for (const [x, z, s] of ROCKS) { const m = mesh(rockGeo, M.rock, x, s * 0.35, z, island); m.scale.set(s, s * 0.75, s); m.rotation.set(R() * 3, R() * 3, R() * 3); }
  const SHRUBS = [[-2.9, 0.25, 0.3], [-0.75, 0.45, 0.24], [-1.2, 0.6, 0.18], [-3.5, 0.4, 0.22], [3.1, 0.35, 0.28], [3.75, 1.3, 0.2], [-2.5, 1.9, 0.22], [1.9, -0.6, 0.22], [-0.3, -1.5, 0.26]];
  for (const [x, z, s] of SHRUBS) { const m = mesh(shrubGeo, M.shrub, x, s * 0.55, z, island); m.scale.set(s, s * 0.85, s); m.rotation.set(R() * 3, R() * 3, R() * 3); }

  /* ---------- on the terrace: telescope, chest, lantern ---------- */
  const scope = new THREE.Group(); scope.position.set(1.05, TER, 0.95); island.add(scope);
  const apex = V(0, 1.0, 0);
  for (let i = 0; i < 3; i++) { const a = i * (Math.PI * 2 / 3) + 0.4; rod(apex, V(Math.sin(a) * 0.48, 0, Math.cos(a) * 0.48), 0.024, M.black, scope); }
  mesh(new THREE.BoxGeometry(0.14, 0.12, 0.14), M.black, 0, 1.03, 0, scope);
  const dir = V(0.5, 0.78, -0.38).normalize();
  const tubeC = apex.clone().add(V(0, 0.1, 0)).addScaledVector(dir, 0.22);
  const tube = new THREE.Group(); tube.position.copy(tubeC); tube.quaternion.setFromUnitVectors(up, dir); scope.add(tube);
  mesh(new THREE.CylinderGeometry(0.085, 0.07, 1.45, 12), M.white, 0, 0, 0, tube);
  mesh(new THREE.CylinderGeometry(0.105, 0.095, 0.32, 12), M.white, 0, 0.66, 0, tube);
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12), M.black, 0, 0.815, 0, tube);
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), M.black, 0, 0.18, 0, tube);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), M.black, 0, -0.78, 0, tube);
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 6), M.white, 0.12, 0.2, 0, tube);
  // the chest
  const chest = new THREE.Group(); chest.position.set(2.15, TER, 1.75); chest.rotation.y = -0.5; island.add(chest);
  mesh(new THREE.BoxGeometry(0.56, 0.3, 0.36), M.wood, 0, 0.15, 0, chest);
  mesh(new THREE.BoxGeometry(0.6, 0.1, 0.4), M.woodDark, 0, 0.35, 0, chest);
  mesh(new THREE.BoxGeometry(0.06, 0.41, 0.385), M.metal, -0.18, 0.2, 0, chest);
  mesh(new THREE.BoxGeometry(0.06, 0.41, 0.385), M.metal, 0.18, 0.2, 0, chest);
  // the lantern on the ground
  const lantern = new THREE.Group(); lantern.position.set(-0.55, TER, 2.15); island.add(lantern);
  mesh(new THREE.BoxGeometry(0.2, 0.04, 0.2), M.black, 0, 0.02, 0, lantern);
  mesh(new THREE.BoxGeometry(0.15, 0.22, 0.15), M.glass, 0, 0.15, 0, lantern);
  mesh(new THREE.SphereGeometry(0.045, 8, 6), M.warm, 0, 0.14, 0, lantern);
  mesh(new THREE.ConeGeometry(0.15, 0.1, 4), M.black, 0, 0.31, 0, lantern).rotation.y = Math.PI / 4;
  mesh(new THREE.TorusGeometry(0.05, 0.008, 4, 10), M.black, 0, 0.39, 0, lantern);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(new THREE.BoxGeometry(0.018, 0.22, 0.018), M.black, x * 0.075, 0.15, z * 0.075, lantern);
  const lanternLight = new THREE.PointLight(0xffc27a, 0, 3.4, 1.5); lanternLight.position.set(0, 0.3, 0.15); lantern.add(lanternLight);

  /* ---------- the radio dish on its lattice tower ---------- */
  const tower = new THREE.Group(); tower.position.set(2.75, 1.05, -1.45); island.add(tower);
  const TH = 1.55, b0 = 0.36, b1 = 0.13;
  const corner = (y, s) => [[-s, -s], [s, -s], [s, s], [-s, s]].map(([x, z]) => V(x, y, z));
  const bottomC = corner(-0.2, b0), topC = corner(TH, b1);
  for (let i = 0; i < 4; i++) rod(bottomC[i], topC[i], 0.022, M.white, tower, 4);
  const lat = [];
  const LV = 4;
  for (let l = 0; l < LV; l++) {
    const y0 = -0.2 + (TH + 0.2) * l / LV, y1 = -0.2 + (TH + 0.2) * (l + 1) / LV;
    const s0 = b0 + (b1 - b0) * l / LV, s1 = b0 + (b1 - b0) * (l + 1) / LV;
    const c0 = corner(y0, s0), c1 = corner(y1, s1);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; lat.push(c0[i], c1[j], c0[j], c1[i], c1[i], c1[j]); }
  }
  tower.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lat), M.lattice));
  const dishG = new THREE.Group(); dishG.position.set(0, TH + 0.12, 0); tower.add(dishG);
  mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.24, 8), M.white, 0, -0.06, 0, dishG);
  const aim = new THREE.Group(); aim.quaternion.setFromUnitVectors(up, V(-0.42, 0.78, 0.48).normalize()); dishG.add(aim);
  const DR = 1.5, DA = 0.62;
  mesh(new THREE.SphereGeometry(DR, 22, 5, 0, Math.PI * 2, Math.PI - DA, DA), M.dish, 0, DR, 0, aim);
  const rimY = DR - DR * Math.cos(DA), rimR = DR * Math.sin(DA), focus = V(0, DR * 0.5, 0);
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; rod(V(Math.sin(a) * rimR * 0.95, rimY, Math.cos(a) * rimR * 0.95), focus, 0.012, M.white, aim, 4); }
  mesh(new THREE.ConeGeometry(0.07, 0.16, 8), M.white, focus.x, focus.y, focus.z, aim).rotation.x = Math.PI;
  // its small base building, with a lit window
  const hut = new THREE.Group(); hut.position.set(3.35, 0.62, -0.55); hut.rotation.y = -0.5; island.add(hut);
  mesh(new THREE.BoxGeometry(0.62, 0.38, 0.46), M.white, 0, 0.19, 0, hut);
  mesh(new THREE.BoxGeometry(0.7, 0.05, 0.54), M.metal, 0, 0.405, 0, hut);
  mesh(new THREE.PlaneGeometry(0.16, 0.12), M.warm, -0.12, 0.22, 0.231, hut);
  mesh(new THREE.PlaneGeometry(0.12, 0.24), M.woodDark, 0.16, 0.12, 0.231, hut);

  /* ---------- framing: the sky is laid out in screen terms, so its lines always stay above the land ---------- */
  const target = V(0.4, 2.35, 0);
  const DIST = 25, PITCH = 0.17;
  const baseCam = new THREE.PerspectiveCamera(30, 1.5, 0.1, 80);
  baseCam.position.set(target.x, target.y + Math.sin(PITCH) * DIST, target.z + Math.cos(PITCH) * DIST); baseCam.lookAt(target); baseCam.updateMatrixWorld();
  const ndc = (p) => p.clone().project(baseCam);
  // the point on the plane z = z that the base camera sees at screen position (nx, ny)
  function at(nx, ny, z) {
    const d = V(nx, ny, 0.5).unproject(baseCam).sub(baseCam.position).normalize();
    return baseCam.position.clone().addScaledVector(d, (z - baseCam.position.z) / d.z);
  }
  // the highest point of the island on screen: cypress tips, the dish, the dome
  scene.updateMatrixWorld(true);
  let landTop = -1;
  island.traverse((o) => {
    const pos = o.geometry?.attributes?.position; if (!pos) return;
    const v = V(0, 0, 0);
    if (o.isInstancedMesh) return;
    for (let i = 0; i < pos.count; i += 1) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); landTop = Math.max(landTop, ndc(v).y); }
  });
  const rimNdc = ndc(V(0, 0, -4.2)).y;
  const FLOOR = landTop + 0.1;            // no orbit line is ever drawn below this on screen
  const SKYTOP = 0.86;

  /* ---------- the far mountains: a soft silhouette whose foot fades into the page ---------- */
  const MZ = -15, COLS = 96, ROWS = 6;
  const peaks = [[-2.2, 0.1], [-1.3, 0.3], [-0.95, 0.55], [-0.72, 0.95], [-0.55, 0.7], [-0.36, 1.0], [-0.12, 0.62], [0.12, 0.5], [0.38, 0.82], [0.6, 0.6], [0.8, 0.9], [1.0, 0.45], [1.3, 0.3], [2.2, 0.1]];
  const silhouette = (nx) => { for (let i = 1; i < peaks.length; i++) if (nx <= peaks[i][0]) { const [x0, y0] = peaks[i - 1], [x1, y1] = peaks[i], t = (nx - x0) / (x1 - x0); return y0 + (y1 - y0) * (t * t * (3 - 2 * t)); } return 0.1; };
  const mFoot = rimNdc - 0.05, mTop = mFoot + (landTop - mFoot) * 0.62;
  const mPos = [], mFade = [], mIdx = [];
  for (let c = 0; c <= COLS; c++) {
    const nx = -2.2 + 4.4 * c / COLS, top = mFoot + (mTop - mFoot) * silhouette(nx);
    for (let r = 0; r <= ROWS; r++) {
      const ny = top - (top - (mFoot - 0.25)) * (r / ROWS);
      const p = at(nx, ny, MZ); mPos.push(p.x, p.y, p.z);
      const side = Math.min(1, Math.max(0, (Math.abs(nx) - 0.5) / 0.55));   // and fades out towards the sides
      mFade.push(Math.min(1, Math.max(side, (top - ny) / (top - mFoot + 0.12))));
    }
  }
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const a = c * (ROWS + 1) + r, b = a + ROWS + 1; mIdx.push(a, a + 1, b, b, a + 1, b + 1); }
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute("position", new THREE.Float32BufferAttribute(mPos, 3));
  mGeo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(mFade.length * 3), 3));
  mGeo.setIndex(mIdx);
  M.mountain.vertexColors = true; M.mountain.transparent = false; M.mountain.depthWrite = true; M.mountain.fog = false;
  const mountain = new THREE.Mesh(mGeo, M.mountain); scene.add(mountain);
  function tintMountain(top, bg) {
    const col = mGeo.attributes.color, c = new THREE.Color();
    for (let i = 0; i < mFade.length; i++) { const f = mFade[i]; c.copy(top).lerp(bg, f * f * (3 - 2 * f)); col.setXYZ(i, c.r, c.g, c.b); }
    col.needsUpdate = true;
  }

  /* ---------- the sky ---------- */
  const sky = new THREE.Group(); scene.add(sky);
  const tex = (size, draw) => { const c = document.createElement("canvas"); c.width = c.height = size; draw(c.getContext("2d"), size); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const dotTex = tex(32, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, "#fff"); gr.addColorStop(0.45, "rgba(255,255,255,.9)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
  const sparkTex = tex(128, (g, s) => {
    const c = s / 2; g.fillStyle = "#fff"; g.beginPath(); g.moveTo(c, 2);
    for (const [x, y] of [[c + 7, c - 7], [s - 2, c], [c + 7, c + 7], [c, s - 2], [c - 7, c + 7], [2, c], [c - 7, c - 7]]) g.quadraticCurveTo(c, c, x, y);
    g.quadraticCurveTo(c, c, c, 2); g.fill();
    const gr = g.createRadialGradient(c, c, 0, c, c, c * 0.45); gr.addColorStop(0, "rgba(255,255,255,.7)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  const moonTex = tex(128, (g, s) => { g.fillStyle = "#fff"; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(s / 2 - s * 0.17, s / 2 - s * 0.07, s * 0.4, 0, Math.PI * 2); g.fill(); });
  const sunTex = tex(128, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.6, "rgba(255,255,255,1)"); gr.addColorStop(0.68, "rgba(255,255,255,.22)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, s, s); });
  const sprite = (map, p, s, opts = {}) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, fog: false, depthWrite: false, ...opts })); sp.position.copy(p); sp.scale.set(s, s, 1); sky.add(sp); return sp; };

  // stars: two sizes; the larger ones twinkle a little. Those low in the sky sit behind the mountains.
  const starSet = (n, size, seed) => {
    const r = rng(seed), pos = [];
    for (let i = 0; i < n; i++) { const p = at(-1.3 + r() * 2.6, rimNdc + r() * (1 - rimNdc), -17 - r() * 4); pos.push(p.x, p.y, p.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dotTex, transparent: true, depthWrite: false, fog: false, sizeAttenuation: true }));
    p.renderOrder = -4; sky.add(p); return p;
  };
  const stars = starSet(240, 0.15, 11), bigStars = starSet(36, 0.27, 23);
  const skyY = (k) => FLOOR + (SKYTOP - FLOOR) * k;      // 0 = just above the land, 1 = the top of the sky
  const spark = sprite(sparkTex, at(-0.18, skyY(0.78), -16), 1.2);
  const moon = sprite(moonTex, at(0.66, skyY(0.62), -16), 2.0); moon.material.rotation = -0.5;
  const sun = sprite(sunTex, moon.position, 1.9);      // by day the sun takes the moon's place
  moon.userData.s = 2.0; sun.userData.s = 1.9;
  // the ringed planet, upper left
  const planet = new THREE.Group(); planet.position.copy(at(-0.7, skyY(0.42), -15)); planet.rotation.set(0.35, 0, 0.42); sky.add(planet);
  mesh(new THREE.SphereGeometry(0.55, 14, 10), M.planet, 0, 0, 0, planet);
  const ring = mesh(new THREE.RingGeometry(0.75, 1.1, 40), M.ring, 0, 0, 0, planet); ring.rotation.x = Math.PI / 2 - 0.15;

  /* ---------- satellites: two far orbits high in the sky, and passes that rise from behind the hills and set again ---------- */
  const satGeo = { body: new THREE.BoxGeometry(0.17, 0.13, 0.13), panel: new THREE.BoxGeometry(0.32, 0.01, 0.15), arm: new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4), dish: new THREE.ConeGeometry(0.05, 0.04, 8) };
  function satellite(core = M.satCore, panel = M.satPanel) {
    const s = new THREE.Group();
    mesh(satGeo.body, core, 0, 0, 0, s);
    for (const k of [-1, 1]) { mesh(satGeo.panel, panel, k * 0.32, 0, 0, s); mesh(satGeo.arm, core, k * 0.12, 0, 0, s).rotation.z = Math.PI / 2; }
    mesh(satGeo.dish, core, 0, -0.09, 0, s);
    return s;
  }
  const dotMat = new THREE.PointsMaterial({ size: 0.16, map: dotTex, transparent: true, depthWrite: false, fog: false });
  // An orbit is an ellipse on a far plane, sized in screen terms so its lowest point stays above FLOOR.
  const ORBITS = [
    { cx: -0.1, k0: 0.08, k1: 0.56, w: 0.78, z: -17, rz: 0.07, speed: 0.022, t0: 0.15, dots: [0.62, 0.7] },
    { cx: 0.22, k0: 0.46, k1: 0.98, w: 0.62, z: -19, rz: -0.09, speed: -0.017, t0: 0.6, dots: [0.2, 0.86] },
  ];
  const sats = ORBITS.map((o) => {
    const lo = at(o.cx, skyY(o.k0), o.z), hi = at(o.cx, skyY(o.k1), o.z), side = at(o.cx + o.w, skyY((o.k0 + o.k1) / 2), o.z);
    const c = lo.clone().add(hi).multiplyScalar(0.5);
    o.a = Math.abs(side.x - c.x); o.b = (hi.y - lo.y) / 2 - o.a * Math.abs(Math.sin(o.rz));
    const g = new THREE.Group(); g.position.copy(c); g.rotation.z = o.rz; sky.add(g);
    const pts = new THREE.EllipseCurve(0, 0, o.a, o.b, 0, Math.PI * 2).getPoints(180).map((p) => V(p.x, p.y, 0));
    g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), M.orbit));
    g.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(o.dots.map((t) => V(Math.cos(t * Math.PI * 2) * o.a, Math.sin(t * Math.PI * 2) * o.b, 0))), dotMat));
    const s = satellite(); g.add(s); s.scale.setScalar(1.35);
    return { o, s, t: o.t0 };
  });

  // Passes: each rises from behind the far hills, crosses the sky on an arc and sets on the other side.
  // Below the hills it is hidden by the mountains; its faint track is drawn only where it is above the land.
  const PZ = -21, passes = [], prand = rng(99);
  let nextPass = 0, passTint = null;
  function spawnPass(u0 = 0) {
    const dir = prand() < 0.5 ? 1 : -1, x0 = -dir * (0.55 + prand() * 0.5), x1 = dir * (0.45 + prand() * 0.6);
    const peakX = (x0 + x1) / 2 + (prand() - 0.5) * 0.3, peakK = 0.3 + prand() * 0.65;
    const horizon = mFoot + (mTop - mFoot) * 0.35;
    const N = 90, path = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N, nx = x0 + (x1 - x0) * u, lift = Math.sin(Math.PI * u);
      path.push(at(nx + (peakX - (x0 + x1) / 2) * lift, horizon + (skyY(peakK) - horizon) * Math.pow(lift, 0.7), PZ));
    }
    // the track: alpha ramps in and out over the part that is above the land on screen
    const above = path.map((p) => ndc(p).y > FLOOR), first = above.indexOf(true), lastI = above.lastIndexOf(true);
    const col = new Float32Array((N + 1) * 4);
    for (let i = 0; i <= N; i++) {
      const t = lastI > first ? (i - first) / (lastI - first) : 0;
      const a = i < first || i > lastI ? 0 : Math.min(1, Math.min(t, 1 - t) * 5);
      col.set([1, 1, 1, a], i * 4);
    }
    const lg = new THREE.BufferGeometry().setFromPoints(path); lg.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    const lm = new THREE.LineBasicMaterial({ transparent: true, vertexColors: true, depthWrite: false, fog: false });
    const line = new THREE.Line(lg, lm); line.renderOrder = -3; sky.add(line);
    const core = M.satCore.clone(), panel = M.satPanel.clone(); core.transparent = panel.transparent = true;
    const s = satellite(core, panel); s.scale.setScalar(1.3); sky.add(s);
    const p = { path, line, lm, s, core, panel, u: u0, dur: 30 + prand() * 16, spin: (prand() - 0.5) * 0.6 };
    passes.push(p); if (passTint) passTint(p);
    return p;
  }
  function dropPass(p) {
    sky.remove(p.line, p.s); p.line.geometry.dispose(); p.lm.dispose(); p.core.dispose(); p.panel.dispose();
    passes.splice(passes.indexOf(p), 1);
  }
  function stepPasses(dt) {
    for (const p of [...passes]) { p.u += dt / p.dur; if (p.u >= 1) dropPass(p); }
    nextPass -= dt;
    if (nextPass <= 0 && passes.length < 3) { spawnPass(0); nextPass = 8 + prand() * 9; }
  }
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  function placeSats() {
    for (const k of sats) {
      const a = k.t * Math.PI * 2, { a: A, b: B } = k.o;
      k.s.position.set(Math.cos(a) * A, Math.sin(a) * B, 0);
      k.s.rotation.set(0.4, a * 0.5, Math.atan2(Math.cos(a) * B, -Math.sin(a) * A));
    }
    for (const p of passes) {
      const f = p.u * (p.path.length - 1), i = Math.min(p.path.length - 2, Math.floor(f)), a = p.path[i], b = p.path[i + 1];
      p.s.position.lerpVectors(a, b, f - i);
      p.s.rotation.set(0.35, p.u * 6 * p.spin, Math.atan2(b.y - a.y, b.x - a.x));
      const life = smooth(0, 0.06, p.u) * smooth(1, 0.94, p.u);
      p.core.opacity = p.panel.opacity = life;
      p.lm.opacity = (passTint?.lineOpacity ?? 0.3) * smooth(0, 0.2, p.u) * smooth(1, 0.8, p.u);
    }
  }
  // the sky is never empty: two passes already under way
  spawnPass(0.3); spawnPass(0.68); nextPass = 5;

  /* ---------- lights ---------- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-4, 2, 6); scene.add(fill);
  const slitLight = new THREE.PointLight(0xffc27a, 0, 3, 1.6); slitLight.position.set(-1.0, 2.6, 0.2); island.add(slitLight);

  /* ---------- colours from the theme ---------- */
  let mode = null;
  function tint() {
    const t = tokens(); mode = t;
    const bg = new THREE.Color().setRGB(...t.bg, THREE.SRGBColorSpace), ink = new THREE.Color().setRGB(...t.ink, THREE.SRGBColorSpace), acc = new THREE.Color().setRGB(...t.accent, THREE.SRGBColorSpace);
    const mix = (a, b, k) => (typeof a === "string" ? C(a) : a.clone()).lerp(typeof b === "string" ? C(b) : b, k);
    const soft = (h, k) => mix(h, bg, k);         // pull a colour toward the page, so the scene sits calmly on it
    scene.fog.color.copy(bg);
    const n = t.dark;
    const P = n ? {
      stone: soft("#87847f", 0.08), stoneDark: soft("#55534f", 0.2), rock: soft("#75736f", 0.1), grass: soft("#2c4233", 0.05), hill: soft("#22362a", 0.12), hillFar: soft("#1b2c23", 0.25),
      cypress: "#13201a", shrub: "#18271f", white: "#e4e1db", dome: "#8b8e94", wood: "#5a4130", woodDark: "#2f241b", black: "#141414", metal: "#a3a3a0",
      dish: "#e8e6e1", ivy: "#2f4d35", flower: "#f4f1e8", warm: "#ffcf86", glass: "#ffd9a0", slit: "#f3c27d", planet: soft("#c9b79a", 0.25), ring: mix(acc, ink, 0.3),
      satPanel: "#3a4766", satCore: "#d6d0c2", orbit: mix(ink, acc, 0.45), lattice: "#d8d6d0",
      mountain: soft("#2c3d45", 0.45), star: mix(ink, "#ffffff", 0.4), spark: mix("#ffffff", acc, 0.25), moon: "#f4ecd6",
      hemiSky: "#56628a", hemiGround: "#0d0e12", hemiI: 1.6, key: "#bcc8ff", keyI: 2.2, keyPos: [7, 9, 5], fillI: 0.35, lamps: 1,
    } : {
      stone: soft("#d3cdc2", 0.06), stoneDark: soft("#bdb6ab", 0.2), rock: soft("#c2bcb2", 0.08), grass: soft("#a9c79f", 0.08), hill: soft("#b5d0a9", 0.12), hillFar: soft("#c6dbbd", 0.25),
      cypress: "#6f8f72", shrub: "#86a383", white: "#ffffff", dome: "#b7bcc5", wood: "#9a7657", woodDark: "#6e523c", black: "#3b3b3d", metal: "#a9a9a6",
      dish: "#e6e4df", ivy: "#7ea376", flower: "#ffffff", warm: "#f6dfb4", glass: "#fbeed6", slit: "#e9c993", planet: soft("#d9c7a8", 0.5), ring: mix(acc, bg, 0.45),
      satPanel: "#4d5874", satCore: "#8d8a84", orbit: mix(ink, acc, 0.35), lattice: "#a19f9a",
      mountain: soft("#b4c6c6", 0.5), star: ink, spark: acc, moon: mix(bg, "#97a3bd", 0.4),
      hemiSky: "#ffffff", hemiGround: "#d6cdbb", hemiI: 2.0, key: "#fff0d8", keyI: 2.4, keyPos: [-7, 9, 6], fillI: 0.5, lamps: 0,
    };
    for (const k of ["stone", "stoneDark", "rock", "grass", "hill", "hillFar", "cypress", "shrub", "white", "dome", "wood", "woodDark", "black", "metal", "dish", "ivy", "flower", "warm", "glass", "slit", "planet", "satPanel", "satCore", "lattice"]) M[k].color.copy(typeof P[k] === "string" ? C(P[k]) : P[k]);
    M.glass.opacity = n ? 0.85 : 0.7;
    M.mountain.color.set(0xffffff); tintMountain(P.mountain, bg);
    M.ring.color.copy(P.ring); M.ring.opacity = n ? 0.55 : 0.5;
    M.orbit.color.copy(P.orbit); M.orbit.opacity = n ? 0.3 : 0.32;
    M.lattice.opacity = n ? 0.85 : 0.9;
    dotMat.color.copy(P.orbit); dotMat.opacity = n ? 0.7 : 0.6;
    stars.material.color.copy(P.star); bigStars.material.color.copy(P.star);
    stars.visible = bigStars.visible = n;
    spark.visible = n; spark.material.color.copy(P.spark);
    moon.material.color.copy(typeof P.moon === "string" ? C(P.moon) : P.moon); moon.material.opacity = 1;
    moon.visible = n; sun.visible = !n; sun.material.color.set("#f6c46a"); sun.material.opacity = 1;
    // remember the last dark and the last light theme, so the moon and the sun can switch between them
    const id = document.documentElement.dataset.theme;
    if (THEMES.includes(id)) try { localStorage.setItem(n ? "tosi.theme.dark" : "tosi.theme.light", id); } catch {}
    planet.visible = n; M.ring.depthWrite = false;
    hemi.color.set(P.hemiSky); hemi.groundColor.set(P.hemiGround); hemi.intensity = P.hemiI;
    key.color.set(P.key); key.intensity = P.keyI; key.position.set(...P.keyPos); fill.intensity = P.fillI;
    lampLight.intensity = 2.2 * P.lamps; lanternLight.intensity = 2.0 * P.lamps; slitLight.intensity = 1.6 * P.lamps;
    for (const m of Object.values(M)) m.needsUpdate = true;
    dotMat.needsUpdate = true;
    passTint = (p) => { p.core.color.copy(M.satCore.color); p.panel.color.copy(M.satPanel.color); p.lm.color.copy(M.orbit.color); };
    passTint.lineOpacity = n ? 0.32 : 0.34;
    passes.forEach(passTint);
  }

  /* ---------- camera: parallax with the pointer, a limited turn by dragging ---------- */
  let px = 0, py = 0, cx = 0, cy = 0, drag = 0, dragV = 0, dragging = false, lastX = 0;
  function placeCamera() {
    const yaw = cx * 0.09 + drag, pitch = PITCH + cy * 0.05;
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * DIST, target.y + Math.sin(pitch) * DIST, target.z + Math.cos(yaw) * Math.cos(pitch) * DIST);
    camera.lookAt(target);
  }
  const onMove = (e) => {
    if (e.pointerType === "touch" && !dragging) return;
    const r = canvas.getBoundingClientRect();
    px = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    py = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
    if (!dragging) setHover(e.target === canvas && hitOrb(e));
    if (dragging) { const dx = e.clientX - lastX; lastX = e.clientX; drag = Math.max(-0.35, Math.min(0.35, drag - dx * 0.003)); }
    wake();
  };
  // The moon (night) and the sun (day) are a theme switch: clicking one swaps to the last theme of the other kind,
  // stored like a choice in Settings. Only that one object is raycast.
  const ray = new THREE.Raycaster(), pt = new THREE.Vector2();
  let hover = false, downX = 0, downY = 0;
  const orb = () => (mode?.dark ? moon : sun);
  function hitOrb(e) {
    const r = canvas.getBoundingClientRect();
    pt.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(pt, camera);
    return ray.intersectObject(orb(), false).length > 0;
  }
  function setHover(h) { if (h === hover) return; hover = h; canvas.style.cursor = h ? "pointer" : ""; canvas.title = h ? (mode?.dark ? "Switch to a light theme" : "Switch to a dark theme") : ""; wake(); }
  function toggleTheme() {
    const toLight = !!mode?.dark;
    let id = null; try { id = localStorage.getItem(toLight ? "tosi.theme.light" : "tosi.theme.dark"); } catch {}
    if (!THEMES.includes(id)) id = toLight ? "minimal" : "matte";
    document.documentElement.dataset.theme = id;
    try { localStorage.setItem("tosi.theme", id); } catch {}
    setHover(false);
  }
  const onDown = (e) => { if (e.button !== 0) return; downX = e.clientX; downY = e.clientY; dragging = true; lastX = e.clientX; canvas.classList.add("dragging"); canvas.setPointerCapture?.(e.pointerId); };
  const onUp = (e) => {
    const click = dragging && Math.hypot(e.clientX - downX, e.clientY - downY) < 6;
    dragging = false; canvas.classList.remove("dragging"); canvas.releasePointerCapture?.(e.pointerId);
    if (click && hitOrb(e)) toggleTheme();
    wake();
  };
  const onLeave = () => { px = 0; py = 0; wake(); };
  addEventListener("pointermove", onMove, { passive: true });
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  document.documentElement.addEventListener("pointerleave", onLeave);

  /* ---------- size, visibility, loop ---------- */
  let W = 0, H = 0;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h || (w === W && h === H)) return;
    W = w; H = h; renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the island a similar size on narrow screens
    camera.fov = w / h < 1.3 ? 30 * Math.min(1.7, 1.3 / (w / h)) : 30;
    camera.updateProjectionMatrix();
    draw();
  }
  let visible = false, raf = 0, last = 0, still = reduce.matches, shown = false;
  function draw(dt = 1) {
    for (const o of [moon, sun]) { const s = o.userData.s * (hover && o === orb() ? 1.12 : 1), k = 1 - Math.exp(-dt * 10); o.scale.setScalar(o.scale.x + (s - o.scale.x) * k); }
    placeSats(); placeCamera(); renderer.render(scene, camera);
    if (!shown) { shown = true; canvas.classList.add("on"); ready(); }
  }
  function loop(now) {
    raf = 0;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    const k = 1 - Math.exp(-dt * 3);
    cx += (px - cx) * k; cy += (py - cy) * k;
    if (!dragging) drag *= Math.exp(-dt * 2.2);
    for (const s of sats) s.t = (s.t + s.o.speed * dt + 1) % 1;
    stepPasses(dt);
    if (mode?.dark) { const f = 1 + Math.sin(now / 170) * 0.06 + Math.sin(now / 53) * 0.04; lanternLight.intensity = 2.0 * f; bigStars.material.opacity = 0.75 + Math.sin(now / 900) * 0.2; }
    draw(dt);
    if (visible && !document.hidden && !still) raf = requestAnimationFrame(loop);
  }
  function wake() { if (!raf && visible && !document.hidden) { if (still) draw(); else { last = 0; raf = requestAnimationFrame(loop); } } }
  function sleep() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); else sleep(); }, { rootMargin: "80px" });
  io.observe(canvas);
  const ro = new ResizeObserver(resize); ro.observe(canvas);
  const onVis = () => { if (document.hidden) sleep(); else wake(); };
  document.addEventListener("visibilitychange", onVis);
  const onMotion = () => { still = reduce.matches; if (still) { sleep(); cx = cy = drag = 0; draw(); } else wake(); };
  reduce.addEventListener("change", onMotion);
  const mo = new MutationObserver(() => { tint(); draw(); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const onLost = (e) => e.preventDefault();
  canvas.addEventListener("webglcontextlost", onLost);

  tint(); resize(); if (!W) draw();

  return () => {
    sleep(); io.disconnect(); ro.disconnect(); mo.disconnect();
    removeEventListener("pointermove", onMove);
    document.removeEventListener("visibilitychange", onVis);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    reduce.removeEventListener("change", onMotion);
    scene.traverse((o) => { o.geometry?.dispose(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose(); x.dispose(); }); });
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
  };
}
