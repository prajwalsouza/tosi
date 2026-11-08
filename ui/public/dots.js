// How dots scale with the size of a file. The numbers live in design-tokens.css (--dot-*) so they can be tuned in
// one place; this works out, for n filings in a box, how big each dot is, how far apart, how to draw them and
// whether one dot must stand for several filings. Every scene in the Flow asks this before laying out.
const read = (name, fallback) => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
};
export function tokens() {
  return { max: read("--dot-max", 12), min: read("--dot-min", 3), fill: read("--dot-fill", 0.62), cellMax: read("--dot-cell-max", 22),
    domMax: read("--dot-dom-max", 1500), groupMax: read("--dot-group-max", 6000) };
}
// n filings to fit in w × h pixels. Returns the cell (centre-to-centre spacing), the dot size, how many columns,
// how many filings one dot stands for (1 unless the file is very large), and whether to draw on a canvas.
export function plan(n, w, h) {
  const t = tokens();
  const per = n > t.groupMax ? Math.ceil(n / t.groupMax) : 1;
  const shown = Math.ceil(n / per);
  // the largest square cell that lets every dot fit in the box
  let cell = Math.min(t.cellMax, Math.sqrt((w * h) / Math.max(1, shown)));
  let cols = Math.max(1, Math.floor(w / cell));
  while (cols * Math.floor(h / cell) < shown && cell > t.min) { cell *= 0.96; cols = Math.max(1, Math.floor(w / cell)); }
  const size = Math.max(t.min, Math.min(t.max, cell * t.fill));
  return { cell, size, cols, per, shown, canvas: shown > t.domMax };
}
// The same rule for scattered dots (a map, the sky): only the dot size, from how many share the area.
export function scatterSize(n, w, h) {
  const t = tokens();
  return Math.max(t.min, Math.min(t.max, Math.sqrt((w * h) / Math.max(1, n)) * t.fill * 0.6));
}
