//! Stage 2, downlink. See spec/stages/downlink/README.md.
//! Which space filings send signals down towards the ground: a satellite with at least one transmitting group goes on,
//! with only its transmitting groups. Progress goes to stderr as JSON lines; the result to stdout and downlink.json.
use jetdb::{find_table, read_catalog, read_table_def, read_table_rows, PageReader, Value};
use serde::Serialize;
use serde_json::{json, Map, Value as J};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

fn emit(state: &str, fields: J) {
    let mut m = Map::new();
    m.insert("event".into(), json!("step"));
    m.insert("step".into(), json!("downlink"));
    m.insert("state".into(), json!(state));
    if let J::Object(f) = fields { m.extend(f); }
    eprintln!("{}", J::Object(m));
}

#[derive(Serialize)]
struct Rulebook { version: u64, sha256: String, cites: serde_json::Value }
#[derive(Serialize)]
struct Notice { ntc_id: i64, #[serde(rename = "type")] kind: String, kept: bool, reason: Option<String>, transmit: u64, receive: u64 }
#[derive(Serialize)]
struct Counts { notices: usize, kept: usize, left: Map<String, J>, groups: usize, groups_kept: usize }
#[derive(Serialize)]
struct Downlink { schema: &'static str, rulebook: Rulebook, file: String, counts: Counts, notices: Vec<Notice>, groups: Vec<i64> }

fn int(v: &Value) -> Option<i64> {
    match v { Value::Byte(x) => Some(*x as i64), Value::Int(x) => Some(*x as i64), Value::Long(x) => Some(*x as i64), Value::BigInt(x) => Some(*x), _ => None }
}
fn text(v: &Value) -> String { if let Value::Text(s) = v { s.clone() } else { String::new() } }

/// Read the named columns of a table, refusing to go on if any row could not be read.
fn columns(reader: &mut PageReader, table: &str, want: &[&str]) -> Result<Vec<Vec<Value>>, String> {
    let cat = read_catalog(reader).map_err(|e| e.to_string())?;
    let entry = find_table(&cat, table).map_err(|e| e.to_string())?;
    let def = read_table_def(reader, &entry.name, entry.table_page).map_err(|e| e.to_string())?;
    let idx: Vec<usize> = want.iter().map(|w| def.columns.iter().position(|c| c.name == *w).ok_or(format!("{table}.{w} missing"))).collect::<Result<_, _>>()?;
    let res = read_table_rows(reader, &def).map_err(|e| e.to_string())?;
    if res.skipped_rows > 0 { return Err(format!("{table}: {} rows could not be read", res.skipped_rows)); }
    Ok(res.rows.into_iter().map(|row| idx.iter().map(|&i| row[i].clone()).collect()).collect())
}

pub fn run(folder: &str) -> Result<String, String> {
    let folder = Path::new(folder);
    let intake: J = serde_json::from_str(&fs::read_to_string(folder.join("intake.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if intake["kind"] != "space" || intake["check"]["status"] != "accepted" { return Err("Downlink needs an accepted space filing".into()); }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let bytes = fs::read(root.join("spec/rulebook/downlink.json")).map_err(|e| e.to_string())?;
    let rules: J = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let rulebook = Rulebook { version: rules["version"].as_u64().unwrap_or(0), sha256: Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect(), cites: crate::space_common::cites_of(&rules) };
    let (tx_code, rx_code) = (rules["transmit"].as_str().unwrap_or("E"), rules["receive"].as_str().unwrap_or("R"));

    emit("start", json!({}));
    let mut reader = PageReader::open(folder.join("database.mdb")).map_err(|e| e.to_string())?;
    let n = columns(&mut reader, "notice", &["ntc_id", "ntc_type"])?;
    emit("progress", json!({ "table": "notice", "rows": n.len() }));
    let g = columns(&mut reader, "grp", &["grp_id", "ntc_id", "emi_rcp"])?;
    emit("progress", json!({ "table": "grp", "rows": g.len() }));

    let (mut tx, mut rx, mut by): (HashMap<i64, u64>, HashMap<i64, u64>, HashMap<i64, Vec<i64>>) = (HashMap::new(), HashMap::new(), HashMap::new());
    for r in &g {
        let (gid, nid, er) = (int(&r[0]).unwrap_or(0), int(&r[1]).unwrap_or(0), text(&r[2]));
        if er == tx_code { *tx.entry(nid).or_default() += 1; by.entry(nid).or_default().push(gid); }
        else if er == rx_code { *rx.entry(nid).or_default() += 1; }
    }
    let reasons: Vec<String> = rules["reasons"].as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
    let mut left: BTreeMap<usize, (String, u64)> = reasons.iter().enumerate().map(|(i, k)| (i, (k.clone(), 0))).collect();
    let sats = rules["satellite_types"].as_object().cloned().unwrap_or_default();
    let mut rows: Vec<(i64, String)> = n.iter().map(|r| (int(&r[0]).unwrap_or(0), text(&r[1]))).collect();
    rows.sort_by_key(|r| r.0);
    let (mut notices, mut groups) = (Vec::new(), Vec::new());
    for (nid, typ) in rows {
        let (t, v) = (*tx.get(&nid).unwrap_or(&0), *rx.get(&nid).unwrap_or(&0));
        let reason = if !sats.contains_key(&typ) { Some("not_satellite") } else if t == 0 && v == 0 { Some("nothing_filed") } else if t == 0 { Some("receive_only") } else { None };
        match reason {
            Some(k) => { if let Some(i) = reasons.iter().position(|x| x == k) { left.get_mut(&i).unwrap().1 += 1; } }
            None => groups.extend(by.get(&nid).cloned().unwrap_or_default()),
        }
        notices.push(Notice { ntc_id: nid, kind: typ, kept: reason.is_none(), reason: reason.map(String::from), transmit: t, receive: v });
    }
    groups.sort();
    let mut left_map = Map::new();
    for (_, (k, c)) in left { left_map.insert(k, json!(c)); }
    let kept = notices.iter().filter(|x| x.kept).count();
    let result = Downlink { schema: "downlink/1", rulebook, file: intake["file"]["sha256"].as_str().unwrap_or("").into(),
        counts: Counts { notices: notices.len(), kept, left: left_map.clone(), groups: g.len(), groups_kept: groups.len() }, notices, groups };
    emit("done", json!({ "kept": kept, "notices": result.notices.len(), "left": J::Object(left_map) }));
    let out = serde_json::to_string(&result).map_err(|e| e.to_string())?;
    fs::write(folder.join("downlink.json"), format!("{out}\n")).map_err(|e| e.to_string())?;
    Ok(out)
}
