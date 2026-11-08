//! Terrestrial stage 7: first applicable concern rung, ordered by excess and key.
use crate::{m4::{finnish_use, m4_table}, report_common::*, space_common::{arr, ji}, terra_common::*};
use serde_json::{json, Value as J};

pub fn run(folder: &str) -> Result<String, String> {
    let intake = need_terrestrial(folder)?;
    let (rules, stamp) = rulebook("tladder")?;
    let mob = read_json(folder, "mobile")?;
    let rng = read_json(folder, "range")?;
    let tda = read_json(folder, "tdata")?;
    let thr = read_json(folder, "threshold")?;
    let tst = read_json(folder, "tstations")?;
    emit("tladder", "start", json!({}));
    let r: Index = expanded(&rng).into_iter().map(|n| (ji(&n["terrakey"]), n)).collect();
    let (d, t, s) = (by(&tda, "terrakey"), by(&thr, "terrakey"), by(&tst, "terrakey"));
    let mut mobile = expanded(&mob);
    mobile.sort_by_key(|m| ji(&m["terrakey"]));
    let freq_table = m4_table()?;
    let mut placed = Vec::new();
    for m in mobile {
        let key = ji(&m["terrakey"]);
        let (t, s) = (get(&t, key), get(&s, key));
        let (rung, decided) = if !m["reason"].is_null() { ("out_of_scope", "mobile") }
            // JS undefined !== null also puts a missing Range row on this branch.
            else if !r.contains_key(&key) || !get(&r, key)["reason"].is_null() { ("clear", "range") }
            else if !truth(&get(&d, key)["kept"]) { ("cannot_calculate", "tdata") }
            else if t["outcome"] == "over" { ("exceeds", "threshold") }
            else if s["outcome"] == "exposed" && t["outcome"] != "over_coordinated" { ("station_exposed", "tstations") }
            else if t["outcome"] == "near" { ("near_threshold", "threshold") }
            else if t["outcome"] == "over_coordinated" { ("exceeds_coordinated", "threshold") }
            else { ("clear", "threshold") };
        // Finnish use on its frequency, from the national frequency table (M4), for every station over or near the trigger
        let checked = ["over","over_coordinated","near"].iter().any(|o| t["outcome"] == *o);
        let m4 = match m["f_mhz"].as_f64() { Some(f) if checked => finnish_use(&freq_table, &[(f, f)]), _ => J::Null };
        placed.push(json!({"terrakey":key,"rung":rung,"by":decided,"excess":t["excess"],"stations":arr(&s["over"]).len(),"m4":m4}));
    }
    placed.sort_by(|a,b| placement_order(a,b,&rules,"terrakey"));
    let counts = rung_counts(&rules, &placed, "rung");
    let notices: Vec<_> = placed.iter().map(|p| json!([p["terrakey"],p["rung"],p["by"],p["excess"],p["stations"],p["m4"]])).collect();
    let result = json!({"schema":"tladder/1","rulebook":stamp,"file":intake["file"]["sha256"],"tables":{"m4":freq_table.sha256},"counts":counts,
        "fields":["terrakey","rung","by","excess","stations_over","m4"],"notices":notices});
    emit("tladder", "done", json!({"notices":placed.len(),"crit":counts["levels"]["crit"],"warn":counts["levels"]["warn"],"none":counts["levels"]["none"]}));
    write_stage(folder, "tladder", result)
}
