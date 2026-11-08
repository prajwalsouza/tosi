//! Stage 3, reach. See spec/stages/reach/README.md.
//! Which transmitting satellites can ever be seen from Finland: a fixed satellite must rise above the horizon somewhere
//! in the box around Finland; a moving one must pass far enough north. Every choice leans to "seen".
//! Progress goes to stderr as JSON lines; the result to stdout and reach.json.
use jetdb::{find_table, read_catalog, read_table_def, read_table_rows, PageReader, Value};
use serde_json::{json, Map, Value as J};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

fn emit(state: &str, fields: J) {
    let mut m = Map::new();
    m.insert("event".into(), json!("step"));
    m.insert("step".into(), json!("reach"));
    m.insert("state".into(), json!(state));
    if let J::Object(f) = fields { m.extend(f); }
    eprintln!("{}", J::Object(m));
}

// Shared with the other engines, exactly: degrees to radians and back, wrapping, rounding to two decimals.
const RAD: f64 = std::f64::consts::PI / 180.0;
const DEG: f64 = 180.0 / std::f64::consts::PI;
fn wrap(x: f64) -> f64 { ((x % 360.0) + 360.0) % 360.0 }
/// Rounded to two decimals and written in shortest form: 66, not 66.0; never -0.
fn round2(x: f64) -> J {
    let v = (x * 100.0 + 0.5).floor() / 100.0;
    if v == v.trunc() && v.abs() < 1e15 { json!(v as i64) } else { json!(v) }
}
fn int(v: &Value) -> Option<i64> {
    match v { Value::Byte(x) => Some(*x as i64), Value::Int(x) => Some(*x as i64), Value::Long(x) => Some(*x as i64), Value::BigInt(x) => Some(*x), _ => None }
}
fn num(v: &Value) -> Option<f64> {
    let x = match v { Value::Float(x) => *x as f64, Value::Double(x) => *x, _ => return int(v).map(|i| i as f64) };
    if x.is_finite() { Some(x) } else { None }
}
fn text(v: &Value) -> Option<String> { if let Value::Text(s) = v { Some(s.clone()) } else { None } }

/// Read the named columns of a table. A table that is missing counts as filing nothing.
fn columns(reader: &mut PageReader, table: &str, want: &[&str]) -> Result<Vec<Vec<Value>>, String> {
    let cat = read_catalog(reader).map_err(|e| e.to_string())?;
    let Ok(entry) = find_table(&cat, table) else { return Ok(Vec::new()) };
    let def = read_table_def(reader, &entry.name, entry.table_page).map_err(|e| e.to_string())?;
    let idx: Vec<usize> = want.iter().map(|w| def.columns.iter().position(|c| c.name == *w).ok_or(format!("{table}.{w} missing"))).collect::<Result<_, _>>()?;
    let res = read_table_rows(reader, &def).map_err(|e| e.to_string())?;
    if res.skipped_rows > 0 { return Err(format!("{table}: {} rows could not be read", res.skipped_rows)); }
    emit("progress", json!({ "table": table, "rows": res.rows.len() }));
    Ok(res.rows.into_iter().map(|row| idx.iter().map(|&i| row[i].clone()).collect()).collect())
}

pub fn run(folder: &str) -> Result<String, String> {
    let folder = Path::new(folder);
    let read_json = |name: &str| -> Result<J, String> { serde_json::from_str(&fs::read_to_string(folder.join(name)).map_err(|e| e.to_string())?).map_err(|e| e.to_string()) };
    let intake = read_json("intake.json")?;
    if intake["kind"] != "space" || intake["check"]["status"] != "accepted" { return Err("Reach needs an accepted space filing".into()); }
    let down = read_json("downlink.json")?;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let bytes = fs::read(root.join("spec/rulebook/reach.json")).map_err(|e| e.to_string())?;
    let rules: J = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let sha: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    let f = |k: &str| rules["finland"][k].as_f64().unwrap_or(0.0);
    let (south, west, east) = (f("south"), f("west"), f("east"));
    let (re, rg, horizon) = (rules["earth"]["radius_km"].as_f64().unwrap_or(0.0), rules["geostationary_radius_km"].as_f64().unwrap_or(0.0), rules["horizon_deg"].as_f64().unwrap_or(0.0));
    let earth = rules["earth_body"].as_str().unwrap_or("T");

    emit("start", json!({}));
    let mut reader = PageReader::open(folder.join("database.mdb")).map_err(|e| e.to_string())?;
    let geo: HashMap<i64, Vec<Value>> = columns(&mut reader, "geo", &["ntc_id", "long_nom", "tol_east", "tol_west"])?.into_iter().map(|r| (int(&r[0]).unwrap_or(0), r)).collect();
    let ngeo: HashMap<i64, Option<String>> = columns(&mut reader, "non_geo", &["ntc_id", "ref_body"])?.into_iter().map(|r| (int(&r[0]).unwrap_or(0), text(&r[1]))).collect();
    let mut orbits: HashMap<i64, Vec<(i64, Option<f64>, Option<f64>)>> = HashMap::new();
    for r in columns(&mut reader, "orbit", &["ntc_id", "orb_id", "inclin_ang", "apog_km"])? {
        orbits.entry(int(&r[0]).unwrap_or(0)).or_default().push((int(&r[1]).unwrap_or(0), num(&r[2]), num(&r[3])));
    }
    let owner: HashMap<i64, i64> = columns(&mut reader, "grp", &["grp_id", "ntc_id"])?.into_iter().map(|r| (int(&r[0]).unwrap_or(0), int(&r[1]).unwrap_or(0))).collect();

    let mut how = Map::new();
    for side in ["seen", "clear"] { if let Some(o) = rules["outcomes"][side].as_object() { for k in o.keys() { how.insert(k.clone(), json!(0)); } } }
    let mut kept: Vec<(i64, String)> = down["notices"].as_array().cloned().unwrap_or_default().iter()
        .filter(|n| n["kept"] == true).map(|n| (n["ntc_id"].as_i64().unwrap_or(0), n["type"].as_str().unwrap_or("").to_string())).collect();
    kept.sort_by_key(|n| n.0);
    let (mut notices, mut seen_ids) = (Vec::new(), HashSet::new());
    for (nid, typ) in kept {
        let (mut seen, mut out) = (true, "assumed");
        let (mut longitude, mut elevation, mut north, mut orbit, mut body) = (J::Null, J::Null, J::Null, J::Null, J::Null);
        if rules["satellite_types"][&typ] == "geostationary" {
            if let Some(g) = geo.get(&nid) { if let Some(l) = num(&g[1]) {
                let (te, tw) = (num(&g[2]).unwrap_or(0.0), num(&g[3]).unwrap_or(0.0));
                let in_box = wrap(l - west) <= east - west;
                let gap = if in_box { 0.0 } else { (wrap(west - l) - te).min(wrap(l - east) - tw).max(0.0).min(180.0) };
                let c = (south * RAD).cos() * (gap * RAD).cos();
                let el = (c - re / rg).atan2((1.0 - c * c).sqrt()) * DEG;
                seen = el >= horizon; out = if seen { "above_horizon" } else { "below_horizon" };
                longitude = round2(l); elevation = round2(el);
            } }
        } else {
            match ngeo.get(&nid).cloned().flatten() {
                Some(b) if b != earth => { out = "beyond_earth"; body = json!(b); }
                _ => {
                    let mut os = orbits.get(&nid).cloned().unwrap_or_default();
                    os.sort_by_key(|o| o.0);
                    let mut best: Option<(f64, i64)> = None;
                    for (id, i, a) in os {
                        let (Some(i), Some(a)) = (i, a) else { continue };
                        if a < 0.0 { continue; }
                        let n = i.min(180.0 - i) + (re / (re + a)).acos() * DEG;
                        if best.map_or(true, |(b, _)| n > b) { best = Some((n, id)); }
                    }
                    if let Some((b, id)) = best { seen = b >= south; out = if seen { "reaches_north" } else { "too_far_south" }; north = round2(b); orbit = json!(id); }
                }
            }
        }
        if let Some(c) = how.get_mut(out) { *c = json!(c.as_u64().unwrap_or(0) + 1); }
        if seen { seen_ids.insert(nid); }
        let mut o = Map::new();
        o.insert("ntc_id".into(), json!(nid)); o.insert("type".into(), json!(typ)); o.insert("seen".into(), json!(seen)); o.insert("how".into(), json!(out));
        o.insert("longitude".into(), longitude); o.insert("elevation".into(), elevation); o.insert("north".into(), north); o.insert("orbit".into(), orbit); o.insert("body".into(), body);
        notices.push(J::Object(o));
    }
    let all: Vec<i64> = down["groups"].as_array().cloned().unwrap_or_default().iter().filter_map(|g| g.as_i64()).collect();
    let mut groups: Vec<i64> = all.iter().copied().filter(|g| owner.get(g).map_or(false, |n| seen_ids.contains(n))).collect();
    groups.sort();
    let (total, seen) = (notices.len(), seen_ids.len());
    let result = json!({
        "schema": "reach/1", "rulebook": { "version": rules["version"].as_u64().unwrap_or(0), "sha256": sha, "cites": crate::space_common::cites_of(&rules) }, "file": intake["file"]["sha256"],
        "counts": { "notices": total, "seen": seen, "clear": total - seen, "how": J::Object(how), "groups": all.len(), "groups_kept": groups.len() },
        "notices": notices, "groups": groups
    });
    emit("done", json!({ "seen": seen, "clear": total - seen, "notices": total }));
    let out = serde_json::to_string(&result).map_err(|e| e.to_string())?;
    fs::write(folder.join("reach.json"), format!("{out}\n")).map_err(|e| e.to_string())?;
    Ok(out)
}
