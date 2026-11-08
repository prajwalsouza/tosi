//! Stage 8: listed Finnish stations sharing an over/near-limit satellite's bands.
use crate::space_common::*;
use serde_json::{json, Value as J};
use std::collections::{HashMap, HashSet};

struct Band { id: String, lo: f64, hi: f64, lon: Option<f64>, lat: Option<f64> }

fn sort_ids(ids: HashSet<String>) -> Vec<String> {
    let mut ids: Vec<_> = ids.into_iter().collect();
    ids.sort_by(|a, b| {
        let numeric = |s: &str| if s.trim().is_empty() { 0.0 } else { s.parse::<f64>().unwrap_or(f64::NAN) };
        let d = numeric(a) - numeric(b);
        if d < 0.0 { std::cmp::Ordering::Less } else if d > 0.0 { std::cmp::Ordering::Greater } else { a.cmp(b) }
    });
    ids
}

pub fn run(folder: &str) -> Result<String, String> {
    let intake = require_space(folder, "Stations")?;
    let (rules, stamp) = rulebook("stations")?;
    let reach = read_json(folder, "reach.json")?;
    let cmp = read_json(folder, "compare.json")?;
    emit("stations", "start", json!({}));
    let (present, sha, list) = station_list(&root().join("state/reference/stations.json"))?;
    emit("stations", "progress", json!({"table": "stations", "rows": list.len()}));
    let mut bands = Vec::new();
    for s in &list {
        let w = jf(&s["bw_mhz"]) / 2.0;
        let rx = s["rx_mhz"].as_f64();
        let tx = s["tx_mhz"].as_f64();
        let mut fs = Vec::new();
        if let Some(f) = rx { fs.push(f); }
        if let Some(f) = tx { if rx.map_or(true, |r| (f - r).abs() > jf(&rules["same_frequency_mhz"])) { fs.push(f); } }
        let station = s["station"].as_str().map(str::to_owned).unwrap_or_else(|| s["station"].to_string());
        for f in fs { bands.push(Band { id: station.clone(), lo: f - w, hi: f + w, lon: s["lon"].as_f64(), lat: s["lat"].as_f64() }); }
    }
    let lon: HashMap<_, _> = arr(&reach["notices"]).iter().filter_map(|n| n["longitude"].as_f64().map(|v| (ji(&n["ntc_id"]), v))).collect();
    let mut rows: HashMap<i64, Vec<&J>> = HashMap::new();
    for r in arr(&cmp["rows"]) { rows.entry(ji(&r[1])).or_default().push(r); }
    let mut how = outcomes(&rules);
    let mut notices = Vec::new();
    let mut stations_hit = HashSet::new();
    for n in arr(&cmp["notices"]).iter().filter(|n| n["outcome"] == "over" || n["outcome"] == "near") {
        let ntc = ji(&n["ntc_id"]);
        // Evidence stays with its transmission: each row (one transmission in one limit band) is matched on its own.
        let (mut hit, mut over) = (HashSet::new(), HashSet::new());
        let (mut at_over, mut at_near): (Option<(f64, J)>, Option<(f64, J)>) = (None, None);
        for r in rows.get(&ntc).into_iter().flatten() {
            let (lo, hi, excess) = (jf(&r[6]), jf(&r[7]), jf(&r[5]));
            let mut here = HashSet::new();
            for b in &bands {
                if b.lo > hi || b.hi < lo { continue; }
                let sees = match (lon.get(&ntc), b.lon, b.lat) {
                    (Some(&l), Some(x), Some(y)) => gso_from(x, y, l, jf(&rules["earth_radius_km"]), jf(&rules["geostationary_radius_km"])).0 >= jf(&rules["horizon_deg"]),
                    _ => true,
                };
                if sees { here.insert(b.id.clone()); }
            }
            hit.extend(here.iter().cloned());
            let is_over = excess > 0.0;
            if is_over { over.extend(here.iter().cloned()); }
            // the strongest transmission of each kind that reaches a listed station (the first, if two are equal)
            let best = if is_over { &mut at_over } else { &mut at_near };
            if !here.is_empty() && best.as_ref().is_none_or(|(x, _)| excess > *x) {
                *best = Some((excess, json!({"grp_id": r[0], "excess": r[5], "lo_mhz": r[6], "hi_mhz": r[7], "stations": sort_ids(here)})));
            }
        }
        let ids = sort_ids(hit);
        let near: Vec<String> = ids.iter().filter(|i| !over.contains(*i)).cloned().collect();
        stations_hit.extend(ids.iter().cloned());
        let k = if !present { "no_list" } else if !ids.is_empty() { "stations" } else { "no_station" };
        bump(&mut how, k);
        notices.push(json!({"ntc_id": n["ntc_id"], "type": n["type"], "outcome": n["outcome"], "how": k, "stations": ids,
            "over": sort_ids(over), "near": near, "at_over": at_over.map_or(J::Null, |x| x.1), "at_near": at_near.map_or(J::Null, |x| x.1)}));
    }
    let result = json!({"schema": "stations/1", "rulebook": stamp, "file": intake["file"]["sha256"],
        "list": {"present": present, "sha256": sha, "stations": list.len()},
        "counts": {"notices": notices.len(), "how": how, "stations_hit": stations_hit.len()}, "notices": notices});
    let mut done = json!({"notices": notices.len()}); done.as_object_mut().unwrap().extend(how);
    emit("stations", "done", done);
    write(folder, "stations", result)
}
