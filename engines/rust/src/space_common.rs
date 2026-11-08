//! Shared database, rulebook and numeric operations for the space stages after Reach.
use jetdb::{find_table, read_catalog, read_table_def, read_table_rows, PageReader, Value};
use serde_json::{json, Map, Value as J};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeMap, HashMap, HashSet}, fs, path::{Path, PathBuf}};

pub const RAD: f64 = std::f64::consts::PI / 180.0;
pub const DEG: f64 = 180.0 / std::f64::consts::PI;
/// The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them.
pub fn cites_of(rules: &serde_json::Value) -> serde_json::Value {
    serde_json::Value::Object(rules.as_object().map(|o| o.iter().filter(|(k, _)| *k == "method" || *k == "basis" || k.ends_with("_basis")).map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default())
}
pub fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..") }
pub fn hash(bytes: &[u8]) -> String { Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect() }
pub fn read_json(folder: &str, name: &str) -> Result<J, String> {
    let bytes = fs::read(Path::new(folder).join(name)).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}
pub fn rulebook(stage: &str) -> Result<(J, J), String> {
    let bytes = fs::read(root().join(format!("spec/rulebook/{stage}.json"))).map_err(|e| e.to_string())?;
    let rules: J = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let stamp = json!({"version": rules["version"], "sha256": hash(&bytes), "cites": cites_of(&rules)});
    Ok((rules, stamp))
}
pub fn table(name: &str) -> Result<J, String> { read_json(root().join("spec/tables").to_str().unwrap(), &format!("{name}.json")) }
pub fn require_space(folder: &str, stage: &str) -> Result<J, String> {
    let intake = read_json(folder, "intake.json")?;
    if intake["kind"] != "space" || intake["check"]["status"] != "accepted" { return Err(format!("{stage} needs an accepted space filing")); }
    Ok(intake)
}
pub fn emit(step: &str, state: &str, fields: J) {
    let mut out = json!({"event": "step", "step": step, "state": state});
    if let Some(fields) = fields.as_object() { out.as_object_mut().unwrap().extend(fields.clone()); }
    eprintln!("{out}");
}
pub fn number(x: f64) -> J {
    if x == x.trunc() && x.abs() < 1e15 { json!(x as i64) } else { json!(x) }
}
pub fn round2(x: f64) -> J { number((x * 100.0 + 0.5).floor() / 100.0) }
pub fn write(folder: &str, stage: &str, result: J) -> Result<String, String> {
    let out = serde_json::to_string(&result).map_err(|e| e.to_string())?;
    fs::write(Path::new(folder).join(format!("{stage}.json")), format!("{out}\n")).map_err(|e| e.to_string())?;
    Ok(out)
}
pub fn int(v: &Value) -> Option<i64> {
    match v { Value::Byte(x) => Some(*x as i64), Value::Int(x) => Some(*x as i64), Value::Long(x) => Some(*x as i64), Value::BigInt(x) => Some(*x), _ => None }
}
pub fn num(v: &Value) -> Option<f64> {
    let x = match v { Value::Float(x) => *x as f64, Value::Double(x) => *x, _ => return int(v).map(|x| x as f64) };
    x.is_finite().then_some(x)
}
pub fn text(v: &Value) -> Option<String> { if let Value::Text(s) = v { Some(s.clone()) } else { None } }
pub fn id(v: &Value) -> i64 { int(v).unwrap_or(0) }
pub fn ji(v: &J) -> i64 { v.as_i64().or_else(|| v.as_f64().map(|v| v as i64)).unwrap_or(0) }
pub fn jf(v: &J) -> f64 { v.as_f64().unwrap_or(0.0) }
pub fn js(v: &J) -> &str { v.as_str().unwrap_or("") }
pub fn arr(v: &J) -> &[J] { v.as_array().map(Vec::as_slice).unwrap_or(&[]) }
pub fn counts(keys: impl IntoIterator<Item = impl AsRef<str>>) -> Map<String, J> {
    keys.into_iter().map(|k| (k.as_ref().to_owned(), json!(0))).collect()
}
pub fn outcomes(rules: &J) -> Map<String, J> { counts(rules["outcomes"].as_object().unwrap().keys()) }
pub fn bump(m: &mut Map<String, J>, k: &str) { let n = ji(&m[k]); m.insert(k.into(), json!(n + 1)); }

/// Access dates are days since 1899-12-30. Match the reader's JS Date construction
/// (round to milliseconds), then use a civil UTC day, without local-time conversions.
pub fn ymd(v: &Value) -> Option<i64> {
    let Value::Timestamp(days) = v else { return None };
    if !days.is_finite() { return None; }
    let ms = ((days - 25569.0) * 86400.0 * 1000.0 + 0.5).floor();
    if ms.abs() > 8.64e15 { return None; }
    let z = (ms / 86400000.0).floor() as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 { year += 1; }
    (year > 1900).then_some(year * 10000 + month * 100 + day)
}

pub struct Db { reader: PageReader, stage: String }
impl Db {
    pub fn open(folder: &str, stage: &str) -> Result<Self, String> {
        Ok(Self { reader: PageReader::open(Path::new(folder).join("database.mdb")).map_err(|e| e.to_string())?, stage: stage.into() })
    }
    /// Missing tables and columns count as unfiled, just as in the reference reader.
    pub fn columns(&mut self, table: &str, want: &[&str]) -> Result<Vec<Vec<Value>>, String> {
        let cat = read_catalog(&mut self.reader).map_err(|e| e.to_string())?;
        let Ok(entry) = find_table(&cat, table) else { return Ok(Vec::new()) };
        let def = read_table_def(&mut self.reader, &entry.name, entry.table_page).map_err(|e| e.to_string())?;
        let idx: Vec<_> = want.iter().map(|w| def.columns.iter().position(|c| c.name == *w)).collect();
        let res = read_table_rows(&mut self.reader, &def).map_err(|e| e.to_string())?;
        if res.skipped_rows > 0 { return Err(format!("{table}: {} rows could not be read", res.skipped_rows)); }
        emit(&self.stage, "progress", json!({"table": table, "rows": res.rows.len()}));
        Ok(res.rows.into_iter().map(|r| idx.iter().map(|i| i.map(|i| r[i].clone()).unwrap_or(Value::Null)).collect()).collect())
    }
}

#[derive(Default, Clone)]
pub struct Orbit { pub incl: Option<f64>, pub apog: Option<f64>, pub perig: Option<f64> }
pub fn orbits(db: &mut Db) -> Result<HashMap<i64, Orbit>, String> {
    let mut out: HashMap<i64, Orbit> = HashMap::new();
    for r in db.columns("orbit", &["ntc_id", "inclin_ang", "apog_km", "perig_km"])? {
        let o = out.entry(id(&r[0])).or_default();
        if let Some(i) = num(&r[1]) { o.incl = Some(o.incl.map_or(i, |v| v.max(i))); }
        if let Some(a) = num(&r[2]) { o.apog = Some(o.apog.map_or(a, |v| v.max(a))); }
        if let Some(p) = num(&r[3]) { o.perig = Some(o.perig.map_or(p, |v| v.min(p))); }
    }
    Ok(out)
}
pub fn spans(db: &mut Db, want: &HashSet<i64>) -> Result<HashMap<i64, (f64, f64)>, String> {
    let mut out: HashMap<i64, (f64, f64)> = HashMap::new();
    for r in db.columns("freq", &["grp_id", "freq_mhz", "freq_min", "freq_max"])? {
        let g = id(&r[0]);
        if !want.contains(&g) { continue; }
        let (Some(lo), Some(hi)) = (num(&r[2]).or_else(|| num(&r[1])), num(&r[3]).or_else(|| num(&r[1]))) else { continue };
        out.entry(g).and_modify(|s| { s.0 = s.0.min(lo); s.1 = s.1.max(hi); }).or_insert((lo, hi));
    }
    Ok(out)
}
pub struct Group { pub grp: i64, pub ntc: i64, pub typ: String, pub span: Option<(f64, f64)>, pub classes: HashSet<String>, pub date: Option<i64> }
pub fn groups(db: &mut Db, reach: &J) -> Result<(Vec<Group>, BTreeMap<i64, String>), String> {
    let seen: BTreeMap<i64, String> = arr(&reach["notices"]).iter().filter(|n| n["seen"] == true).map(|n| (ji(&n["ntc_id"]), js(&n["type"]).into())).collect();
    let want = arr(&reach["groups"]).iter().map(ji).collect();
    let rcv: HashMap<_, _> = db.columns("notice", &["ntc_id", "d_rcv"])?.iter().map(|r| (id(&r[0]), ymd(&r[1]))).collect();
    let span = spans(db, &want)?;
    let mut cls: HashMap<i64, HashSet<String>> = HashMap::new();
    for r in db.columns("srv_cls", &["grp_id", "stn_cls"])? {
        if want.contains(&id(&r[0])) { if let Some(c) = text(&r[1]) { cls.entry(id(&r[0])).or_default().insert(c.trim().into()); } }
    }
    let mut out = Vec::new();
    for r in db.columns("grp", &["grp_id", "ntc_id", "beam_name", "d_prot_eff"])? {
        let (g, n) = (id(&r[0]), id(&r[1]));
        if !want.contains(&g) || !seen.contains_key(&n) { continue; }
        out.push(Group { grp: g, ntc: n, typ: seen[&n].clone(), span: span.get(&g).copied(), classes: cls.get(&g).cloned().unwrap_or_default(), date: ymd(&r[3]).or_else(|| rcv.get(&n).copied().flatten()) });
    }
    out.sort_by_key(|g| g.grp);
    Ok((out, seen))
}
pub fn beams(db: &mut Db, want: &HashSet<i64>) -> Result<HashMap<i64, String>, String> {
    Ok(db.columns("grp", &["grp_id", "beam_name"])?.iter().filter(|r| want.contains(&id(&r[0]))).map(|r| (id(&r[0]), text(&r[1]).unwrap_or("null".into()))).collect())
}
pub fn gains(db: &mut Db, ntcs: &HashSet<i64>, transmit: &str) -> Result<HashMap<(i64, String), f64>, String> {
    let mut out: HashMap<(i64, String), f64> = HashMap::new();
    for r in db.columns("s_beam", &["ntc_id", "beam_name", "emi_rcp", "gain"])? {
        let n = id(&r[0]);
        if !ntcs.contains(&n) || text(&r[2]).as_deref() != Some(transmit) { continue; }
        if let Some(g) = num(&r[3]) { out.entry((n, text(&r[1]).unwrap_or("null".into()))).and_modify(|v| *v = v.max(g)).or_insert(g); }
    }
    Ok(out)
}

pub struct LimitTable { pub exam: Vec<J>, pub provision: HashMap<i64, J>, pub mask: HashMap<i64, Vec<J>> }
pub struct Limits { pub source: J, pub area: HashMap<i64, String>, pub classes: HashMap<i64, HashSet<String>>, pub tables: HashMap<String, LimitTable> }
pub fn limits() -> Result<Limits, String> {
    let t = table("pfd")?;
    let area = arr(&t["prot_area"]).iter().map(|r| (ji(&r["ix_prot_area"]), js(&r["area_name"]).trim().into())).collect();
    let mut classes: HashMap<i64, HashSet<String>> = HashMap::new();
    for r in arr(&t["classes_of_stn"]) {
        let s = classes.entry(ji(&r["ix_serv"])).or_default();
        let c: Vec<_> = js(&r["class_of_stn"]).chars().collect();
        for c in c.chunks_exact(2) { s.insert(c.iter().collect()); }
    }
    let mut tables = HashMap::new();
    for (name, prefix) in [("G", ""), ("N", "ngso_")] {
        let provision = arr(&t[format!("{prefix}provisions")]).iter().map(|r| (ji(&r["ix_provn"]), r.clone())).collect();
        let mut mask: HashMap<i64, Vec<J>> = HashMap::new();
        for r in arr(&t[format!("{prefix}pfd_mask")]) { mask.entry(ji(&r["mask_code"])).or_default().push(r.clone()); }
        for v in mask.values_mut() { v.sort_by_key(|s| ji(&s["mask_segment"])); }
        tables.insert(name.into(), LimitTable { exam: arr(&t[format!("{prefix}freq_exam")]).to_vec(), provision, mask });
    }
    Ok(Limits { source: t["source"].clone(), area, classes, tables })
}
pub fn usable(s: &J) -> bool { jf(&s["c4"]) == 0.0 && jf(&s["c5"]) == 0.0 }
pub fn mask_at(segs: &[J], delta: f64) -> Option<f64> {
    let mut out = None;
    for s in segs {
        if !usable(s) { continue; }
        let x = (delta + jf(&s["c3"])).max(1e-9);
        let term = if jf(&s["ang_log"]) != 0.0 { x.log10() } else if jf(&s["ang_square"]) != 0.0 { x * x } else if jf(&s["ang"]) != 0.0 { x } else { 0.0 };
        let (lo, hi) = (jf(&s["ang_min"]), jf(&s["ang_max"]));
        if (lo == 0.0 && hi == 0.0) || (delta >= lo && delta <= hi) { out = Some(jf(&s["c1"]) + jf(&s["c2"]) * term); }
    }
    out
}
pub fn bandwidth_hz(design: &str) -> Option<f64> {
    let s = design.trim().to_uppercase();
    let p = s.bytes().take_while(u8::is_ascii_digit).count();
    let unit = match s.as_bytes().get(p)? { b'H' => 1.0, b'K' => 1e3, b'M' => 1e6, b'G' => 1e9, b'T' => 1e12, _ => return None };
    let q = s[p + 1..].bytes().take_while(u8::is_ascii_digit).count();
    if p == 0 && q == 0 { return None; }
    format!("{}.{}", if p == 0 { "0" } else { &s[..p] }, if q == 0 { "0" } else { &s[p + 1..p + 1 + q] }).parse::<f64>().ok().map(|n| n * unit)
}
pub fn power_in(pep: Option<f64>, dens: Option<f64>, b: Option<f64>, f: f64, bref: f64, rules: &J) -> Option<f64> {
    if bref <= 0.0 { return pep; }
    let Some(dens) = dens else { return pep };
    let d = dens + 10.0 * bref.log10();
    let (Some(p), Some(b)) = (pep, b) else { return Some(d) };
    let a = &rules["averaging"];
    let avg = if f < jf(&a["below_mhz"]) { jf(&a["below_hz"]) } else { jf(&a["above_hz"]) };
    Some(if avg == bref { d } else if avg < bref { if b >= bref { d.min(p) } else { p } } else if b < bref { p } else { d })
}
pub fn gso_from(lon: f64, lat: f64, satellite: f64, re: f64, rg: f64) -> (f64, f64) {
    let c = (lat * RAD).cos() * ((lon - satellite) * RAD).cos();
    let s = (1.0 - c * c).max(0.0).sqrt();
    ((c - re / rg).atan2(s) * DEG, (re * re + rg * rg - 2.0 * re * rg * c).sqrt())
}
pub fn station_list(path: &Path) -> Result<(bool, J, Vec<J>), String> {
    match fs::read(path) {
        Ok(bytes) => { let v: J = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?; Ok((true, json!(hash(&bytes)), arr(&v["stations"]).to_vec())) }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((false, J::Null, Vec::new())),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_access_dates_and_sentinels() {
        for (days, expected) in [
            (0.0, None), (2.0, None), (366.999, None),
            (367.0, Some(19010101)), (25568.5, Some(19691231)),
            (25569.0, Some(19700101)), (36585.0, Some(20000229)),
            (37623.75, Some(20030102)),
            (37623.0 - 0.0004 / 86400.0, Some(20030102)),
            (37623.0 - 0.0006 / 86400.0, Some(20030101)),
        ] {
            assert_eq!(ymd(&Value::Timestamp(days)), expected, "Access day {days}");
        }
        assert_eq!(ymd(&Value::Timestamp(f64::NAN)), None);
        assert_eq!(ymd(&Value::Null), None);
    }

    #[test]
    fn rounded_numbers_use_reference_half_up_and_integer_format() {
        for (n, expected) in [(66.0, "66"), (-0.001, "0"), (-1.125, "-1.12"), (1.125, "1.13")] {
            assert_eq!(round2(n).to_string(), expected);
        }
    }

    #[test]
    fn power_conformance_cases() {
        let (rules, _) = rulebook("power").unwrap();
        let cases = read_json(root().join("spec/cases/power").to_str().unwrap(), "cases.json").unwrap();
        for c in arr(&cases["cases"]) {
            let input = &c["input"];
            if input["sample"].is_string() { continue; }
            let p = power_in(input["pep"].as_f64(), input["dens"].as_f64(), input["b_hz"].as_f64(), jf(&input["f_mhz"]), jf(&input["bref_hz"]), &rules);
            assert_eq!(p.map(round2), Some(c["expect"]["power_dbw"].clone()), "{}", c["id"]);
        }
        assert_eq!(bandwidth_hz("14M0F2D--"), Some(14e6));
        assert_eq!(bandwidth_hz(" 2k70J3E "), Some(2700.0));
        assert_eq!(bandwidth_hz("100H"), Some(100.0));
        assert_eq!(bandwidth_hz("M25"), Some(250000.0));
        assert_eq!(bandwidth_hz("M"), None);
        assert_eq!(bandwidth_hz("F3E"), None);
    }

    #[test]
    fn masks_match_cases_and_later_segment_wins_at_shared_edge() {
        let l = limits().unwrap();
        let segs = &l.tables["G"].mask[&50];
        assert_eq!(mask_at(segs, 40.0).map(round2), Some(json!(-121)));
        assert_eq!(mask_at(segs, 10.0).map(round2), Some(json!(-129)));
        let segs = vec![json!({"ang_min": 0, "ang_max": 10, "c1": -100}), json!({"ang_min": 10, "ang_max": 90, "c1": -90})];
        assert_eq!(mask_at(&segs, 10.0), Some(-90.0));
        assert_eq!(mask_at(&[json!({"ang_min": 0, "ang_max": 0, "c1": -50})], 70.0), Some(-50.0));
        assert_eq!(mask_at(&[json!({"ang_min": 0, "ang_max": 90, "c1": -50, "c4": 1})], 70.0), None);
    }

    #[test]
    fn missing_station_list_is_reported_without_failure() {
        let (present, sha, list) = station_list(&root().join("engines/rust/target/nonexistent-station-list.json")).unwrap();
        assert!(!present); assert_eq!(sha, J::Null); assert!(list.is_empty());
    }
}
