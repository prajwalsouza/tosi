//! Stage 5: check each applicable limit row for the position, gain, power and mask it needs.
use crate::space_common::*;
use serde_json::json;
use std::collections::{HashMap, HashSet};

#[derive(Default)]
struct Per { ok: usize, rows: usize, reasons: HashSet<String> }

pub fn run(folder: &str) -> Result<String, String> {
    let intake = require_space(folder, "Data")?;
    let (rules, stamp) = rulebook("data")?;
    let reach = read_json(folder, "reach.json")?;
    let lim = read_json(folder, "limit.json")?;
    emit("data", "start", json!({}));
    let mut db = Db::open(folder, "data")?;
    let want = arr(&lim["rows"]).iter().map(|r| ji(&r[0])).collect();
    let ntcs = arr(&lim["rows"]).iter().map(|r| ji(&r[1])).collect();
    let beam = beams(&mut db, &want)?;
    let gain = gains(&mut db, &ntcs, js(&rules["transmit"]))?;
    let mut pw: HashMap<i64, (bool, bool)> = HashMap::new();
    for r in db.columns("emiss", &["grp_id", "pep_max", "pwr_ds_max"])? {
        let g = id(&r[0]);
        if !want.contains(&g) { continue; }
        let p = pw.entry(g).or_default();
        p.0 |= num(&r[1]).is_some(); p.1 |= num(&r[2]).is_some();
    }
    let orb = orbits(&mut db)?;
    let lon: HashMap<_, _> = arr(&reach["notices"]).iter().map(|n| (ji(&n["ntc_id"]), n["longitude"].as_f64())).collect();
    let l = limits()?;
    let order: Vec<_> = arr(&rules["reasons_order"]).iter().map(js).collect();
    let mut by_reason = counts(&order);
    let mut per: HashMap<i64, Per> = HashMap::new();
    let mut ok = Vec::new();
    for r in arr(&lim["rows"]) {
        let (g, ntc, t, provn) = (ji(&r[0]), ji(&r[1]), js(&r[2]), ji(&r[4]));
        let p = per.entry(ntc).or_default(); p.rows += 1;
        let lt = &l.tables[t];
        let pv = &lt.provision[&provn];
        let segs = lt.mask.get(&ji(&pv["mask_code"])).map(Vec::as_slice).unwrap_or(&[]);
        let e = pw.get(&g);
        let position = if t == "G" { lon.get(&ntc).copied().flatten().is_some() } else { orb.get(&ntc).and_then(|o| o.perig).map_or(false, |p| p >= 0.0) };
        let fails = |k: &str| match k {
            "no_orbit" => !position,
            "no_gain" => !gain.contains_key(&(ntc, beam.get(&g).cloned().unwrap_or("undefined".into()))),
            "no_power" => e.map_or(true, |e| if jf(&pv["bw"]) > 0.0 { !(e.0 || e.1) } else { !e.0 }),
            "needs_xy" => !segs.iter().any(usable),
            _ => false,
        };
        if let Some(why) = order.iter().copied().find(|k| fails(k)) { bump(&mut by_reason, why); p.reasons.insert(why.into()); }
        else { p.ok += 1; ok.push(r.clone()); }
    }
    let mut how = counts(std::iter::once("complete").chain(order.iter().copied()));
    let mut notices = Vec::new();
    for n in arr(&lim["notices"]).iter().filter(|n| n["limited"] == true) {
        let p = &per[&ji(&n["ntc_id"])];
        let k = if p.ok > 0 { "complete" } else { order.iter().copied().find(|k| p.reasons.contains(*k)).ok_or("missing data reason")? };
        bump(&mut how, k);
        notices.push(json!({"ntc_id": n["ntc_id"], "type": n["type"], "complete": k == "complete", "how": k, "rows": p.rows, "rows_ok": p.ok}));
    }
    let complete = ji(&how["complete"]);
    let result = json!({"schema": "data/1", "rulebook": stamp, "file": intake["file"]["sha256"],
        "counts": {"notices": notices.len(), "complete": complete, "left": notices.len() as i64 - complete, "how": how, "rows": arr(&lim["rows"]).len(), "rows_ok": ok.len(), "rows_missing": by_reason}, "notices": notices, "rows": ok});
    emit("data", "done", json!({"complete": complete, "notices": notices.len(), "rows": ok.len()}));
    write(folder, "data", result)
}
