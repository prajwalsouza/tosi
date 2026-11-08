//! Space stage 9: place every filing on the first applicable concern rung.
use crate::{m4::{finnish_use, m4_table}, report_common::*, space_common::*};
use serde_json::{json, Value as J};
use std::collections::{BTreeSet, HashMap, HashSet};

struct Band { id: String, lo: f64, hi: f64, width: f64, lon: Option<f64>, lat: Option<f64> }
fn near_frequency(rows: &[&J], bands: &[Band], longitude: Option<f64>, rules: &J) -> usize {
    let mut near = HashSet::new();
    let g = &rules["geostationary"];
    for r in rows {
        for b in bands {
            if near.contains(&b.id) { continue; }
            let guard = b.width.max(jf(&rules["near_frequency_min_mhz"]));
            let sees = match (longitude, b.lon, b.lat) {
                (Some(l), Some(x), Some(y)) => gso_from(x,y,l,jf(&g["earth_radius_km"]),jf(&g["geostationary_radius_km"])).0 >= jf(&g["horizon_deg"]),
                _ => true,
            };
            if b.lo <= jf(&r[7]) + guard && b.hi >= jf(&r[6]) - guard && sees { near.insert(b.id.clone()); }
        }
    }
    near.len()
}

pub fn run(folder: &str) -> Result<String, String> {
    let intake = require_space(folder, "Ladder")?;
    let (rules, stamp) = rulebook("ladder")?;
    let down = read_json(folder, "downlink.json")?;
    let reach = read_json(folder, "reach.json")?;
    let lim = read_json(folder, "limit.json")?;
    let data = read_json(folder, "data.json")?;
    let cmp = read_json(folder, "compare.json")?;
    let sta = read_json(folder, "stations.json")?;
    emit("ladder", "start", json!({}));
    let mut db = Db::open(folder, "ladder")?;
    let owner: HashMap<_,_> = db.columns("grp", &["grp_id","ntc_id"])?.iter().map(|r| (id(&r[0]),id(&r[1]))).collect();
    let mut itu: HashMap<i64,BTreeSet<String>> = HashMap::new();
    let fin = js(&rules["itu_finland"]["administration"]);
    for (table, key, adm) in [("provn","grp_id","adm"),("tr_aff_ntw","ntc_id","adm"),("srv_area","grp_id","ctry")] {
        for r in db.columns(table, &[key,adm])? {
            if text(&r[1]).unwrap_or_default().trim() != fin { continue; }
            let ntc = if key == "ntc_id" { Some(id(&r[0])) } else { owner.get(&id(&r[0])).copied() };
            if let Some(ntc) = ntc { itu.entry(ntc).or_default().insert(table.into()); }
        }
    }
    let (present, sha256, stations) = station_list(&root().join("state/reference/stations.json"))?;
    let mut bands = Vec::new();
    for s in stations {
        let width = jf(&s["bw_mhz"]);
        let (rx,tx) = (s["rx_mhz"].as_f64(),s["tx_mhz"].as_f64());
        let mut freqs = Vec::new();
        if let Some(f) = rx { freqs.push(f); }
        if let Some(f) = tx { if rx.is_none_or(|rx| (f-rx).abs() > jf(&rules["same_frequency_mhz"])) { freqs.push(f); } }
        for f in freqs { bands.push(Band { id:string(&s["station"]),lo:f-width/2.0,hi:f+width/2.0,width,lon:s["lon"].as_f64(),lat:s["lat"].as_f64() }); }
    }
    let lon: HashMap<_,_> = arr(&reach["notices"]).iter().filter_map(|n| n["longitude"].as_f64().map(|l| (ji(&n["ntc_id"]),l))).collect();
    let mut rows: HashMap<i64,Vec<&J>> = HashMap::new();
    for r in arr(&cmp["rows"]) { rows.entry(ji(&r[1])).or_default().push(r); }
    let (r,l,d,c,s) = (by(&reach,"ntc_id"),by(&lim,"ntc_id"),by(&data,"ntc_id"),by(&cmp,"ntc_id"),by(&sta,"ntc_id"));
    let mut down = arr(&down["notices"]).to_vec();
    down.sort_by_key(|n| ji(&n["ntc_id"]));
    let freq_table = m4_table()?;
    let mut placed = Vec::new();
    for n in down {
        let id = ji(&n["ntc_id"]);
        let (c,s) = (get(&c,id),get(&s,id));
        let hits = arr(&s["stations"]).len();
        let mut o = json!({"ntc_id":id,"rung":"clear","by":"downlink","excess":c["excess"],"stations":hits,"stations_over":arr(&s["over"]).len(),"stations_near":arr(&s["near"]).len(),
            "near_frequency":0,"itu":[],"worst":null,"margin":null});
        if !truth(&n["kept"]) { placed.push(o); continue; }
        if !truth(&get(&r,id)["seen"]) { o["by"] = json!("reach"); placed.push(o); continue; }
        o["itu"] = json!(itu.get(&id).cloned().unwrap_or_default());
        let outcome = js(&c["outcome"]);
        if (outcome == "over" || outcome == "near") && present && hits == 0 {
            o["near_frequency"] = json!(near_frequency(rows.get(&id).map(Vec::as_slice).unwrap_or(&[]),&bands,lon.get(&id).copied(),&rules));
        }
        if outcome == "over" || outcome == "near" {
            // its worst transmission (the first, if two are equal), with the Finnish use (M4) on that band only
            let mut w: Option<&J> = None;
            for r in rows.get(&id).map(Vec::as_slice).unwrap_or(&[]) { if w.is_none_or(|w| jf(&r[5]) > jf(&w[5])) { w = Some(*r); } }
            if let Some(w) = w {
                o["worst"] = json!({"grp_id":w[0],"excess":w[5],"lo_mhz":w[6],"hi_mhz":w[7],"m4":finnish_use(&freq_table,&[(jf(&w[6]),jf(&w[7]))])});
            }
        }
        // The station evidence: the strongest transmission over the limit that reaches a listed station, else the
        // strongest near one, with its own margin, band and Finnish use (M4). A station rung rests on exactly this.
        let ev = if outcome == "over" && !s["at_over"].is_null() { &s["at_over"] } else { &s["at_near"] };
        if !ev.is_null() {
            let mut m = ev.clone();
            m["m4"] = finnish_use(&freq_table, &[(jf(&ev["lo_mhz"]), jf(&ev["hi_mhz"]))]);
            o["margin"] = m;
        }
        let (rung,decided) = if outcome == "over" && !s["at_over"].is_null() { ("exceeds_station","stations") }
            else if !arr(&o["itu"]).is_empty() { ("itu_names_finland","ladder") }
            else if !s["at_near"].is_null() { ("near_station","stations") }
            else if (outcome == "over" || outcome == "near") && ji(&o["near_frequency"]) > 0 { ("near_frequency","ladder") }
            else if outcome == "over" { ("exceeds_no_station","stations") }
            else if !truth(&get(&l,id)["limited"]) { ("no_limit","limit") }
            else if !truth(&get(&d,id)["complete"]) { ("cannot_calculate","data") }
            else if c.is_null() || outcome == "no_result" { ("cannot_calculate","compare") }
            else { ("clear","compare") };
        o["rung"] = json!(rung); o["by"] = json!(decided);
        placed.push(o);
    }
    placed.sort_by(|a,b| placement_order(a,b,&rules,"ntc_id"));
    let counts = rung_counts(&rules,&placed,"rung");
    emit("ladder","done",json!({"notices":placed.len(),"crit":counts["levels"]["crit"],"warn":counts["levels"]["warn"],"none":counts["levels"]["none"]}));
    write_stage(folder,"ladder",json!({"schema":"ladder/1","rulebook":stamp,"file":intake["file"]["sha256"],"list":{"present":present,"sha256":sha256},"tables":{"m4":freq_table.sha256},"counts":counts,"notices":placed}))
}
