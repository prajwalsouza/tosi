// The loading screen. A plain script, loaded before the app's modules so it shows on the first frame: a small globe
// with satellites on tilted orbits, the far ones fainter and hidden behind the Earth. Satellites near the pointer
// lean gently away from it; the one with panels turns to face it. The app calls window.tosiLoaded() when ready.
(function () {
  var root = document.getElementById("loader");
  if (!root) return;
  document.documentElement.classList.add("loading");
  var cv = root.querySelector("canvas"), g = cv.getContext("2d");
  var css = getComputedStyle(document.documentElement);
  var col = function (n, d) { return (css.getPropertyValue(n) || "").trim() || d; };
  var C = { bg: col("--bg", "#141414"), ink: col("--ink", "#ecebe8"), ink3: col("--ink3", "#6c6b67"), accent: col("--accent", "#b9abe8") };
  var still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var W = 0, H = 0, dpr = 1, R = 60, cx = 0, cy = 0;
  var TILT = 0.38;                                   // the camera looks down on the orbits a little

  // Orbits: radius (in globe radii), tilt, node, speed, dots. A stable pseudo-random so every load looks alike.
  var seed = 7; var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  var orbits = [];
  [[1.45, 0.25, 0.3, 1.0, 9], [1.75, 1.05, 1.9, 0.72, 11], [2.05, 0.6, 3.4, 0.55, 12], [2.45, 1.4, 5.0, 0.42, 10], [2.9, 0.15, 0.9, 0.3, 14]].forEach(function (o) {
    var dots = [];
    for (var i = 0; i < o[4]; i++) dots.push({ a: (i / o[4]) * Math.PI * 2 + rnd() * 0.4, accent: rnd() < 0.28, s: 0.8 + rnd() * 0.6, dx: 0, dy: 0 });
    orbits.push({ r: o[0], inc: o[1], node: o[2], w: o[3], dots: dots });
  });
  var sat = { r: 2.25, inc: 0.85, node: 4.2, w: 0.5, a: 1.2, face: 0 };
  var mouse = null, t0 = performance.now(), raf = 0;

  function size() {
    dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.max(34, Math.min(W, H) * 0.085); cx = W / 2; cy = H * 0.47;
  }
  // A point on an orbit, in screen space with depth z (positive towards the viewer).
  function at(o, a) {
    var x = Math.cos(a) * o.r, y = Math.sin(a) * o.r, z = 0;
    var ci = Math.cos(o.inc), si = Math.sin(o.inc);                  // tilt the orbit
    var y1 = y * ci, z1 = y * si;
    var cn = Math.cos(o.node), sn = Math.sin(o.node);                // turn it about the pole
    var x2 = x * cn - y1 * sn, y2 = x * sn + y1 * cn;
    var ct = Math.cos(TILT), st = Math.sin(TILT);                    // the camera's lean
    return { x: cx + x2 * R, y: cy - (z1 * ct - y2 * st) * R, z: z1 * st + y2 * ct };
  }
  function hidden(p) { var dx = p.x - cx, dy = p.y - cy; return p.z < 0 && dx * dx + dy * dy < R * R; }
  function ring(o, front) {
    g.beginPath();
    var started = false;
    for (var i = 0; i <= 96; i++) {
      var p = at(o, (i / 96) * Math.PI * 2);
      if ((p.z >= 0) === front && !hidden(p)) { started ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); started = true; } else started = false;
    }
    g.stroke();
  }
  function lean(d, p) {
    var tx = 0, ty = 0;
    if (mouse) {
      var dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy, reach = R * 1.6;
      if (d2 < reach * reach) { var k = (1 - Math.sqrt(d2) / reach) * 14 / (Math.sqrt(d2) + 1); tx = dx * k; ty = dy * k; }
    }
    d.dx += (tx - d.dx) * 0.12; d.dy += (ty - d.dy) * 0.12;
  }
  function frame(now) {
    var t = still ? 0 : (now - t0) / 1000;
    g.clearRect(0, 0, W, H);
    var items = [];
    orbits.forEach(function (o) {
      o.dots.forEach(function (d) {
        var p = at(o, d.a + t * o.w * 0.35);
        if (!still) lean(d, p);
        p.x += d.dx; p.y += d.dy;
        items.push({ p: p, d: d });
      });
    });
    // far halves of the orbits, the dots behind, the globe, then the near halves and the dots in front
    g.lineWidth = 1; g.strokeStyle = C.ink3;
    g.globalAlpha = 0.12; orbits.forEach(function (o) { ring(o, false); });
    items.forEach(function (it) { if (it.p.z < 0 && !hidden(it.p)) dot(it, 0.35); });
    g.globalAlpha = 1; g.fillStyle = C.bg; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = C.ink3; g.globalAlpha = 0.55; g.lineWidth = 1.2; g.stroke();
    g.globalAlpha = 0.22; g.lineWidth = 1;
    g.beginPath(); g.ellipse(cx, cy, R, R * Math.sin(TILT), 0, 0, Math.PI * 2); g.stroke();      // equator
    var spin = (t * 0.25) % (Math.PI * 2);
    g.beginPath(); g.ellipse(cx, cy, R * Math.abs(Math.cos(spin)), R, 0, 0, Math.PI * 2); g.stroke(); // a turning meridian
    g.globalAlpha = 0.18; g.strokeStyle = C.ink3; orbits.forEach(function (o) { ring(o, true); });
    items.forEach(function (it) { if (it.p.z >= 0) dot(it, 0.9); });
    satellite(t);
    g.globalAlpha = 1;
    if (!still && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function dot(it, a) {
    var s = (2 + it.p.z * 0.9) * it.d.s;
    g.globalAlpha = a * (it.d.accent ? 1 : 0.75); g.fillStyle = it.d.accent ? C.accent : C.ink3;
    g.beginPath(); g.arc(it.p.x, it.p.y, Math.max(1, s), 0, Math.PI * 2); g.fill();
  }
  function satellite(t) {
    var p = at(sat, sat.a + t * sat.w * 0.35), q = at(sat, sat.a + t * sat.w * 0.35 + 0.02);
    if (hidden(p)) return;
    var heading = Math.atan2(q.y - p.y, q.x - p.x), aim = heading + Math.PI / 2;
    if (mouse) aim = Math.atan2(mouse.y - p.y, mouse.x - p.x);
    var diff = Math.atan2(Math.sin(aim - sat.face), Math.cos(aim - sat.face));
    sat.face += still ? diff : diff * 0.08;
    var k = (1.15 + p.z * 0.25) * Math.max(1, R / 60), b = 5 * k, pw = 9 * k, ph = 3.4 * k;
    g.save(); g.translate(p.x, p.y); g.rotate(sat.face);
    g.globalAlpha = p.z < 0 ? 0.45 : 1;
    g.strokeStyle = C.accent; g.lineWidth = 1;
    g.beginPath(); g.moveTo(-b, 0); g.lineTo(-b - 2 * k, 0); g.moveTo(b, 0); g.lineTo(b + 2 * k, 0); g.stroke();
    g.fillStyle = C.accent; g.globalAlpha *= 0.55;
    g.fillRect(-b - 2 * k - pw, -ph / 2, pw, ph); g.fillRect(b + 2 * k, -ph / 2, pw, ph);           // panels
    g.globalAlpha = p.z < 0 ? 0.5 : 1; g.fillStyle = C.ink;
    g.fillRect(-b / 2 - 1, -b / 2 - 1, b + 2, b + 2);                                              // body
    g.fillStyle = C.accent; g.beginPath(); g.arc(0, -b / 2 - 2.2 * k, 1.3 * k, 0, Math.PI * 2); g.fill(); // dish
    g.restore();
  }
  size();
  addEventListener("resize", function () { size(); if (still) frame(performance.now()); });
  addEventListener("pointermove", function (e) { mouse = { x: e.clientX, y: e.clientY }; });
  document.addEventListener("pointerleave", function () { mouse = null; });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !still && !done) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } });
  raf = requestAnimationFrame(frame);

  // Leave once the app says it is ready, but never before 600 ms (no flash) and never after 6 s.
  var done = false, shownAt = performance.now();
  function leave() {
    if (done) return; done = true;
    setTimeout(function () {
      root.classList.add("out");
      document.documentElement.classList.remove("loading");
      setTimeout(function () { cancelAnimationFrame(raf); root.remove(); }, 500);
    }, Math.max(0, 600 - (performance.now() - shownAt)));
  }
  window.tosiLoaded = leave;
  setTimeout(leave, 6000);
})();
