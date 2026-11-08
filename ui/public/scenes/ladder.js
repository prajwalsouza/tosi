// The concern ladder, made visible: one row per rung, the most serious at the top. Each row has the rung's plain
// wording, its count and, quietly, the guidebook rule it rests on; the cases sit on the row as dots. Used by the space
// scene (DOM dots that fly in from the scene before) and by the terrestrial map (canvas points).
// The rungs, their wording and their levels come from the rulebook (spec/rulebook/ladder.json, tladder.json);
// which rung each case is on comes from the engine's result. Nothing here decides anything.

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const LEVEL_WORDS = { crit: "Needs attention", warn: "Worth a look", none: "No concern" };
export const levelColour = (lv) => lv === "crit" ? "var(--bad)" : lv === "warn" ? "var(--warn)" : "var(--ink3)";

// rulebook: the stage's rulebook ({rungs:[{key,rung,means,level,cites}]}); counts: {key: n}; guide: id -> {title, rule}
export function makeRungs({ el, stage, rulebook, counts, guide }) {
  const rungs = (rulebook?.rungs ?? Object.keys(counts).map((key) => ({ key, rung: key.replaceAll("_", " "), level: "none", cites: [] })));
  const rows = rungs.map((r) => {
    const cite = (r.cites ?? []).join(" · ");
    const tip = (r.cites ?? []).map((c) => guide?.[c] ? `Guidebook ${c}, ${guide[c].title}: ${guide[c].rule}` : `Guidebook ${c}`).join("\n\n");
    const means = el("span", { class: "lad-means" }, r.means ?? "");
    const e = el("div", { class: `lad-rung ${r.level}${counts[r.key] ? "" : " nil"}`, "data-rung": r.key },
      el("div", { class: "lad-top" },
        el("i", { class: `lad-lv ${r.level}` }),
        el("b", {}, r.rung),
        el("span", { class: "lad-n" }, (counts[r.key] ?? 0).toLocaleString("en-GB")),
        cite ? el("small", { class: "lad-cite", title: tip }, cite) : null),
      means);
    stage.append(e);
    return { ...r, e, means, n: counts[r.key] ?? 0 };
  });
  let at = new Map(), cell = 12, size = 8;
  return {
    rows,
    // Lay the rows out in a box. minCell/maxCell: the spacing of the dots; fill: dot size as a share of the cell.
    // Returns nothing; pos(key, i) then gives the top-left of the i-th dot on a rung.
    // concernCell: a larger spacing for the few cases on a concern rung, when they fit on one line, so they stand out.
    layout({ x0, x1, y0, y1 }, { minCell = 3, maxCell = 18, fill = 0.68, fixedSize = null, concernCell = null } = {}) {
      const W = x1 - x0, LW = Math.min(360, Math.max(292, W * 0.4)), dx = x0 + LW + 18, dw = Math.max(60, x1 - dx);
      const avail = y1 - y0, groups = new Set(rows.map((r) => r.level)).size - 1;
      const plan = (c, withMeans) => {
        const labelH = withMeans ? 38 : 20, gap = withMeans ? 8 : 5;
        let h = groups * 10;
        const cols = Math.max(1, Math.floor(dw / c));
        for (const r of rows) h += Math.max(labelH, Math.ceil(Math.max(1, r.n) / cols) * c) + gap;
        return { h, cols, labelH, gap };
      };
      let c = maxCell, withMeans = true, p = plan(c, true);
      while (p.h > avail && c > minCell) { c = Math.max(minCell, c * 0.94); p = plan(c, true); }
      if (p.h > avail) { withMeans = false; c = maxCell; p = plan(c, false); while (p.h > avail && c > minCell) { c = Math.max(minCell, c * 0.94); p = plan(c, false); } }
      cell = c; size = fixedSize ?? Math.max(2, c * fill);
      at = new Map();
      let y = y0, last = null;
      for (const r of rows) {
        if (last && r.level !== last) y += 10;
        last = r.level;
        const lines = Math.ceil(Math.max(1, r.n) / p.cols), h = Math.max(p.labelH, lines * c);
        r.e.style.left = `${x0}px`; r.e.style.top = `${y}px`; r.e.style.width = `${LW}px`;
        r.means.style.display = withMeans ? "" : "none";
        // the dots: centred on the label's first line when there is one line of them
        const dy = lines === 1 ? Math.max(0, 10 - c / 2) : 0;
        const big = concernCell && r.level !== "none" && r.n * concernCell <= dw && concernCell > c ? concernCell : null;
        const rc = big ?? c, rs = big ? (fixedSize ?? Math.max(2, big * fill)) : size;
        at.set(r.key, { x: dx, y: y + (big ? Math.max(0, 10 - big / 2) : dy), cols: big ? Math.max(1, Math.floor(dw / big)) : p.cols, cell: rc, size: rs });
        y += h + p.gap;
      }
    },
    pos(key, i) {
      const a = at.get(key); if (!a) return null;
      return { x: a.x + (i % a.cols) * a.cell + (a.cell - a.size) / 2, y: a.y + Math.floor(i / a.cols) * a.cell + (a.cell - a.size) / 2, size: a.size };
    },
    get cell() { return cell; }, get size() { return size; },
    frame(v) { const o = String(clamp(v)); for (const r of rows) { r.e.style.opacity = o; r.e.style.pointerEvents = v > 0.5 ? "" : "none"; } },
  };
}
