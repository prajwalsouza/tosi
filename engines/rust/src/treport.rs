//! Terrestrial stage 8, report. See spec/stages/treport/README.md.
//! The notification for a terrestrial file: stations on crit and warn rungs with who, where, frequency, distance, field
//! strength against the trigger, coordination and exposed listed stations, plus report.csv and report.md.
use crate::report::{tpl, use_cells, use_text};
use crate::{report_common::*, terra_common::*};
use crate::space_common::{ji, jf, js};
use jetdb::Value;
use serde_json::{json, Value as J};
use std::collections::{BTreeSet, HashMap};

/// String(value ?? "") for a database cell.
fn cell(v: Option<&Value>) -> String {
    match v {
        Some(Value::Text(s)) => s.clone(),
        _ => num(v).map_or(String::new(), |x| string(&number(x))),
    }
}
fn plural(n: i64) -> &'static str { if n == 1 { "" } else { "s" } }

pub fn run(folder: &str) -> Result<String, String> {
    let intake = need_terrestrial(folder)?;
    let (rules, stamp) = rulebook("treport")?;
    let lad_bytes = std::fs::read(root().join("spec/rulebook/tladder.json")).map_err(|e| e.to_string())?;
    let lad: J = serde_json::from_slice(&lad_bytes).map_err(|e| e.to_string())?;
    let adm: J = serde_json::from_slice(&std::fs::read(root().join("spec/reference/administrations.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let mob = read_json(folder, "mobile")?;
    let rng = read_json(folder, "range")?;
    let tda = read_json(folder, "tdata")?;
    let fld = read_json(folder, "field")?;
    let thr = read_json(folder, "threshold")?;
    let tst = read_json(folder, "tstations")?;
    let lad2 = read_json(folder, "tladder")?;
    emit("treport", "start", json!({}));
    let mut db = Db::open(folder, "treport")?;
    let geo: HashMap<i64, (String, String)> = db.columns("fxm_geo", &["geo_key", "site_name", "ctry"])?.iter()
        .map(|g| (id(g, "geo_key"), (cell(g.get("site_name")), cell(g.get("ctry"))))).collect();
    let mut site: HashMap<i64, (String, String)> = HashMap::new();
    for r in db.columns("fxm_terra", &["terrakey", "geo_key"])? {
        if let Some(g) = geo.get(&id(&r, "geo_key")) { site.insert(id(&r, "terrakey"), g.clone()); }
    }
    let admin = js(&rules["administration"]);
    let mut coord: HashMap<i64, BTreeSet<String>> = HashMap::new();
    for c in db.columns("fxm_coord", &["terrakey", "adm", "coord_prov", "coord_st"])? {
        if cell(c.get("adm")).trim() != admin { continue; }
        coord.entry(id(&c, "terrakey")).or_default()
            .insert(format!("{}:{}", cell(c.get("coord_prov")).trim(), cell(c.get("coord_st")).trim()));
    }
    let fin = Finland::load()?;

    let rows = |o: &J| -> Index { expanded(o).into_iter().map(|n| (ji(&n["terrakey"]), n)).collect() };
    let (m_, r_, l_) = (rows(&mob), rows(&rng), expanded(&lad2));
    let (d_, f_, t_, s_) = (by(&tda, "terrakey"), by(&fld, "terrakey"), by(&thr, "terrakey"), by(&tst, "terrakey"));
    let rung = |k: &J| arr(&lad["rungs"]).iter().find(|r| r["key"] == *k).cloned().unwrap_or(J::Null);
    let levels = arr(&rules["levels_reported"]);
    let listed = ji(&rules["stations_listed"]) as usize;
    let uses_listed = ji(&rules["uses_listed"]) as usize;
    let describe = |key: i64| -> J {
        let m = get(&m_, key);
        let a = js(&m["adm"]).trim().to_string();
        let g = site.get(&key);
        let opt = |s: Option<&String>| s.filter(|s| !s.is_empty()).map_or(J::Null, |s| json!(s.trim()));
        json!({"administration": a, "country": adm["administrations"].get(&a).and_then(|c| c.as_str()).unwrap_or(&a),
            "site": opt(g.map(|g| &g.0)), "site_country": opt(g.map(|g| &g.1)),
            "class": m["cls"], "f_mhz": m["f_mhz"], "lon": m["lon"], "lat": m["lat"]})
    };

    // The reported stations, in ladder order.
    let mut items = Vec::new();
    for p in &l_ {
        let rg = rung(&p["rung"]);
        if !levels.contains(&rg["level"]) { continue; }
        let key = ji(&p["terrakey"]);
        let (r, f, t, s, dt) = (get(&r_, key), get(&f_, key), get(&t_, key), get(&s_, key), get(&d_, key));
        let mut o = json!({"terrakey": key});
        o.as_object_mut().unwrap().extend(describe(key).as_object().unwrap().clone());
        let at = f["border"].as_u64().and_then(|i| fin.border.get(i as usize))
            .map_or(J::Null, |b| json!({"lon": number(b.0), "lat": number(b.1), "kind": b.2}));
        let field = if f.is_null() { J::Null } else {
            json!({"e": f["e"], "limit": t["limit"], "excess": t["excess"], "bandwidth_correction": t["bc"], "at": at, "km": f["km"], "land": f["land"]})
        };
        let power = if dt.is_null() { J::Null } else {
            json!({"erp_dbw": dt["erp_dbw"], "heff_m": dt["heff_m"], "heff_from": dt["heff_from"], "assumptions": dt["assumptions"]})
        };
        let rest = json!({
            "distance_km": r["km"], "field": field, "power": power,
            "coordination": {"completed": truth(&t["coordinated"]), "records": coord.get(&key).cloned().unwrap_or_default()},
            "stations": {"over": arr(&s["over"]).len(), "first": first(&s["over"], listed), "worst": s["worst"]},
            "finnish_use": p["m4"],
            "why": {"rung": p["rung"], "level": rg["level"], "wording": rg["rung"], "means": rg["means"], "cites": rg["cites"]},
            "next": rules["next"].get(js(&p["rung"])).cloned().unwrap_or(J::Null),
        });
        o.as_object_mut().unwrap().extend(rest.as_object().unwrap().clone());
        items.push(o);
    }

    // Every station as one row of the processed file, in ascending terrakey order.
    let head = ["Station (terrakey)", "Administration", "Country", "Site", "Class", "Frequency (MHz)", "Longitude", "Latitude", "In scope",
        "Distance to Finland (km)", "e.r.p. (dBW)", "Effective height (m)", "Field strength at the border (dBuV/m)", "Trigger level (dBuV/m)",
        "Over the trigger by (dB)", "Coordinated with Finland", "Listed stations over the trigger", "Finnish use (M4)", "Licence-exempt use (M4)", "Concern", "Level", "Decided by"];
    let mut lines = vec![csv_line(&head.iter().map(|h| json!(h)).collect::<Vec<_>>())];
    let l_index: Index = l_.iter().map(|p| (ji(&p["terrakey"]), p.clone())).collect();
    let mut keys: Vec<i64> = m_.keys().copied().collect();
    keys.sort();
    for key in keys {
        let d = describe(key);
        let (m, r, dt, f, t, s, p) = (get(&m_, key), get(&r_, key), get(&d_, key), get(&f_, key), get(&t_, key), get(&s_, key), get(&l_index, key));
        let rg = rung(&p["rung"]);
        let [uses, exempt] = use_cells(&p["m4"]);
        let scope = if m["reason"].is_null() { json!("yes") } else { json!(format!("no: {}", tpl(&m["reason"]))) };
        lines.push(csv_line(&[json!(key), d["administration"].clone(), d["country"].clone(), d["site"].clone(), d["class"].clone(),
            d["f_mhz"].clone(), d["lon"].clone(), d["lat"].clone(), scope, r["km"].clone(), dt["erp_dbw"].clone(), dt["heff_m"].clone(),
            f["e"].clone(), t["limit"].clone(), t["excess"].clone(), if t.is_null() { json!("") } else { yes_no(&t["coordinated"]) },
            if s.is_null() { J::Null } else { json!(arr(&s["over"]).len()) }, uses, exempt, rg["rung"].clone(), rg["level"].clone(), p["by"].clone()]));
    }

    let crit: Vec<&J> = items.iter().filter(|x| x["why"]["level"] == "crit").collect();
    let warn: Vec<&J> = items.iter().filter(|x| x["why"]["level"] == "warn").collect();
    let mut md = vec![format!("# Terrestrial notification: {}", tpl(&intake["file"]["name"])), String::new(),
        format!("{} stations screened. {} need attention, {} are worth a look.", tpl(&lad2["counts"]["notices"]), crit.len(), warn.len()), String::new(),
        "| Concern | Level | Stations |".into(), "|---|---|---|".into()];
    for r in arr(&lad["rungs"]) {
        let n = lad2["counts"]["rungs"].get(js(&r["key"])).filter(|v| !v.is_null()).cloned().unwrap_or(json!(0));
        md.push(format!("| {} | {} | {} |", tpl(&r["rung"]), tpl(&r["level"]), tpl(&n)));
    }
    md.push(String::new());
    let line = |x: &J, i: usize| -> Vec<String> {
        let name = if x["site"].is_null() { format!("Station {}", tpl(&x["terrakey"])) } else { tpl(&x["site"]) };
        let f = &x["field"];
        let field = if f.is_null() { "no field strength".to_string() } else {
            let e = jf(&f["excess"]);
            let at = if f["at"]["kind"] == "sea" { "territorial-sea limit" } else { "border" };
            let by = if e > 0.0 { format!("{} dB over", string(&f["excess"])) } else { format!("{} dB under", string(&number(e.abs()))) };
            format!("{} dB(µV/m) at the {at} against a trigger of {}, {by}", string(&f["e"]), string(&f["limit"]))
        };
        let st = &x["stations"];
        let over = ji(&st["over"]);
        let exposed = if over > 0 { format!("; over the trigger at {over} listed station{} ({})", plural(over), joined(&st["first"], ", ")) } else { String::new() };
        let done = if truth(&x["coordination"]["completed"]) { "; coordination with Finland completed" } else { "" };
        vec![format!("{}. **{name}** ({}), {}, class {}, {} MHz, {} km from Finland.", i + 1, tpl(&x["terrakey"]), tpl(&x["country"]), tpl(&x["class"]),
                string(&x["f_mhz"]), string(&x["distance_km"])),
            format!("   {}: {field}{exposed}{done}.{}", tpl(&x["why"]["wording"]), use_text(&x["finnish_use"], uses_listed)),
            format!("   Next: {}", tpl(&x["next"]))]
    };
    if !crit.is_empty() {
        md.extend(["## Needs attention".to_string(), String::new()]);
        for (i, x) in crit.iter().enumerate() { md.extend(line(x, i)); }
        md.push(String::new());
    }
    if !warn.is_empty() {
        md.extend(["## Worth a look".to_string(), String::new()]);
        for (i, x) in warn.iter().enumerate() { md.extend(line(x, i)); }
        md.push(String::new());
    }

    let files = exports(folder, &lines, &md)?;
    let (nc, nw, ni) = (crit.len(), warn.len(), items.len());
    let result = json!({"schema":"treport/1","rulebook":stamp,"uses":{"tladder":sha(&lad_bytes)},"file":intake["file"]["sha256"],"name":intake["file"]["name"],
        "counts":{"notices":lad2["counts"]["notices"],"items":ni,"crit":nc,"warn":nw,"rungs":lad2["counts"]["rungs"]},
        "files":files,"items":items});
    emit("treport", "done", json!({"items":ni,"crit":nc,"warn":nw}));
    write_stage(folder, "treport", result)
}
