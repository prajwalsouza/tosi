//! Stage 6: worst-case e.i.r.p. in each applicable limit's reference bandwidth.
use crate::space_common::*;
use serde_json::json;
use std::collections::HashMap;

pub fn run(folder: &str) -> Result<String, String> {
    let intake = require_space(folder, "Power")?;
    let (rules, stamp) = rulebook("power")?;
    let dat = read_json(folder, "data.json")?;
    emit("power", "start", json!({}));
    let mut db = Db::open(folder, "power")?;
    let want = arr(&dat["rows"]).iter().map(|r| ji(&r[0])).collect();
    let ntcs = arr(&dat["rows"]).iter().map(|r| ji(&r[1])).collect();
    let grp = beams(&mut db, &want)?;
    let gain = gains(&mut db, &ntcs, js(&rules["transmit"]))?;
    let span = spans(&mut db, &want)?;
    struct Emission { pep: Option<f64>, dens: Option<f64>, b: Option<f64> }
    let mut emis: HashMap<i64, Vec<Emission>> = HashMap::new();
    for r in db.columns("emiss", &["grp_id", "design_emi", "pep_max", "pwr_ds_max"])? {
        let g = id(&r[0]);
        if !want.contains(&g) { continue; }
        emis.entry(g).or_default().push(Emission { pep: num(&r[2]), dens: num(&r[3]), b: bandwidth_hz(&text(&r[1]).unwrap_or_default()) });
    }
    let l = limits()?;
    let mut rows = Vec::new();
    let mut per: HashMap<i64, (f64, usize)> = HashMap::new();
    let mut skipped = 0;
    for r in arr(&dat["rows"]) {
        let (g, ntc, t, provn) = (ji(&r[0]), ji(&r[1]), js(&r[2]), ji(&r[4]));
        let pv = &l.tables[t].provision[&provn];
        let (lo, hi) = *span.get(&g).ok_or("power row has no frequency span")?;
        let f = (lo + hi) / 2.0;
        let bref = jf(&pv["bw"]) * jf(&rules["mhz_to_hz"]);
        let mut best: Option<f64> = None;
        for e in emis.get(&g).into_iter().flatten() {
            if let Some(p) = power_in(e.pep, e.dens, e.b, f, bref, &rules) { if best.map_or(true, |b| p > b) { best = Some(p); } }
        }
        let Some(best) = best else { skipped += 1; continue };
        let eirp = best + gain.get(&(ntc, grp.get(&g).cloned().unwrap_or("undefined".into()))).copied().unwrap_or(f64::NAN);
        let mut row = arr(r).to_vec(); row.push(round2(eirp)); rows.push(row);
        let p = per.entry(ntc).or_insert((f64::NEG_INFINITY, 0)); p.1 += 1; p.0 = p.0.max(eirp);
    }
    let mut notices = Vec::new();
    for n in arr(&dat["notices"]).iter().filter(|n| n["complete"] == true) {
        let p = per.get(&ji(&n["ntc_id"]));
        notices.push(json!({"ntc_id": n["ntc_id"], "type": n["type"], "rows": p.map_or(0, |p| p.1), "eirp": p.map(|p| round2(p.0))}));
    }
    let result = json!({"schema": "power/1", "rulebook": stamp, "file": intake["file"]["sha256"],
        "counts": {"notices": notices.len(), "rows": rows.len(), "rows_without_power": skipped}, "notices": notices, "rows": rows});
    emit("power", "done", json!({"notices": notices.len(), "rows": rows.len()}));
    write(folder, "power", result)
}
