//! Stage 7: compare received power with the limit at the worst visible arrival angle.
use crate::space_common::*;
use serde_json::json;
use std::collections::HashMap;

#[derive(Clone, Copy)]
struct Point { a: f64, d: f64 }
#[derive(Clone, Copy)]
struct Margin { m: f64, lim: f64, q: Point }
struct Worst { x: f64, grp: i64, t: String, provn: i64, pfd: f64, w: Margin }
fn spread(d: f64) -> f64 { 10.0 * (4.0 * std::f64::consts::PI * (d * 1000.0).powi(2)).log10() }

pub fn run(folder: &str) -> Result<String, String> {
    let intake = require_space(folder, "Compare")?;
    let (rules, stamp) = rulebook("compare")?;
    let reach = read_json(folder, "reach.json")?;
    let pow = read_json(folder, "power.json")?;
    emit("compare", "start", json!({}));
    let mut db = Db::open(folder, "compare")?;
    let want = arr(&pow["rows"]).iter().map(|r| ji(&r[0])).collect();
    let span = spans(&mut db, &want)?;
    let orb = orbits(&mut db)?;
    let lon: HashMap<_, _> = arr(&reach["notices"]).iter().filter_map(|n| n["longitude"].as_f64().map(|v| (ji(&n["ntc_id"]), v))).collect();
    let l = limits()?;
    let (re, rg) = (jf(&rules["earth_radius_km"]), jf(&rules["geostationary_radius_km"]));
    let fin = table("finland")?;
    let points: Vec<_> = arr(&fin["test_points"]).iter().chain(arr(&fin["border"])).map(|p| (jf(&p[0]), jf(&p[1]))).collect();
    // Cache by the actual longitude/perigee. All geometry and mask loops preserve
    // reference order, so equal margins retain the first point and the first row.
    let mut geo: HashMap<(String, u64), Vec<Point>> = HashMap::new();
    let mut worst: HashMap<(String, i64, u64), Option<Margin>> = HashMap::new();
    let near = -jf(&rules["near_db"]);
    let mut keep = Vec::new();
    let mut per: HashMap<i64, Worst> = HashMap::new();
    let mut nogeo = 0;
    for r in arr(&pow["rows"]) {
        let (grp, ntc, t, ixf, provn, eirp) = (ji(&r[0]), ji(&r[1]), js(&r[2]), ji(&r[3]), ji(&r[4]), jf(&r[5]));
        let lt = &l.tables[t];
        let pv = &lt.provision[&provn];
        let value = if t == "G" { *lon.get(&ntc).ok_or("compare row has no longitude")? }
            else { orb.get(&ntc).and_then(|o| o.perig).ok_or("compare row has no perigee")? };
        let bits = if value == 0.0 { 0 } else { value.to_bits() };
        let gk = (t.to_owned(), bits);
        let g = geo.entry(gk).or_insert_with(|| {
            if t == "G" {
                let all: Vec<_> = points.iter().map(|&(x, y)| { let (a, d) = gso_from(x, y, value, re, rg); Point { a, d } }).collect();
                let mut g: Vec<_> = all.iter().copied().filter(|q| q.a >= 0.0).collect();
                if g.is_empty() {
                    let mut top = all[0];
                    for q in &all[1..] { if q.a > top.a { top = *q; } }
                    g.push(Point { a: 0.0, d: top.d });
                }
                g
            } else {
                let mut g = Vec::new();
                let step = jf(&rules["ngso_angle_step_deg"]);
                let h = value;
                let mut i = 0;
                while i as f64 * step <= 90.0 + 1e-9 {
                    let a = i as f64 * step;
                    let s = (a * RAD).sin();
                    g.push(Point { a, d: -re * s + ((re * s).powi(2) + 2.0 * re * h + h * h).sqrt() });
                    i += 1;
                }
                g
            }
        });
        let mask = ji(&pv["mask_code"]);
        let w = worst.entry((t.to_owned(), mask, bits)).or_insert_with(|| {
            let segs = lt.mask.get(&mask).map(Vec::as_slice).unwrap_or(&[]);
            let mut best: Option<Margin> = None;
            for &q in g.iter() {
                if let Some(lim) = mask_at(segs, q.a) {
                    let m = lim + spread(q.d);
                    if best.map_or(true, |b| m < b.m) { best = Some(Margin { m, lim, q }); }
                }
            }
            best
        });
        let Some(w) = *w else { nogeo += 1; continue };
        let excess = eirp - w.m;
        if per.get(&ntc).map_or(true, |p| excess > p.x) {
            per.insert(ntc, Worst { x: excess, grp, t: t.into(), provn, pfd: eirp - spread(w.q.d), w });
        }
        if excess > near {
            let x = lt.exam.iter().find(|e| ji(&e["ix_freq"]) == ixf).ok_or("compare row has no exam row")?;
            let (lo, hi) = *span.get(&grp).ok_or("compare row has no frequency span")?;
            keep.push(json!([grp, ntc, t, ixf, provn, round2(excess), number(lo.max(jf(&x["freq_min"]))), number(hi.min(jf(&x["freq_max"])))]));
        }
    }
    let mut how = outcomes(&rules);
    let mut notices = Vec::new();
    for n in arr(&pow["notices"]) {
        let Some(w) = per.get(&ji(&n["ntc_id"])) else {
            bump(&mut how, "no_result");
            notices.push(json!({"ntc_id": n["ntc_id"], "type": n["type"], "outcome": "no_result", "excess": null, "pfd": null, "limit": null, "angle": null, "distance_km": null, "grp_id": null, "table": null, "provision": null, "provn": null, "finding": null}));
            continue;
        };
        let outcome = if w.x > 0.0 { "over" } else if w.x > near { "near" } else { "under" };
        let pv = &l.tables[&w.t].provision[&w.provn];
        bump(&mut how, outcome);
        notices.push(json!({"ntc_id": n["ntc_id"], "type": n["type"], "outcome": outcome, "excess": round2(w.x), "pfd": round2(w.pfd), "limit": round2(w.w.lim), "angle": round2(w.w.q.a), "distance_km": round2(w.w.q.d),
            "grp_id": w.grp, "table": w.t, "provision": w.provn, "provn": js(&pv["provn"]).trim(), "finding": js(&pv["fndg"]).trim()}));
    }
    let result = json!({"schema": "compare/1", "rulebook": stamp, "file": intake["file"]["sha256"],
        "counts": {"notices": notices.len(), "how": how, "rows": arr(&pow["rows"]).len(), "rows_kept": keep.len(), "rows_without_angle": nogeo}, "notices": notices, "rows": keep});
    let mut done = json!({"notices": notices.len()}); done.as_object_mut().unwrap().extend(how);
    emit("compare", "done", done);
    write(folder, "compare", result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spreading_conformance() { assert_eq!(round2(spread(35786.0)), json!(162.07)); }
}
