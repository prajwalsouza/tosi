//! Finland's national frequency allocation table (Traficom Radio Frequency Regulation 4), as spec/tables/m4.json.
//! Used by both ladders to say which Finnish uses, and which licence-exempt uses, share a case's frequencies.
use crate::space_common::{arr, hash, root};
use serde_json::{json, Value as J};

pub struct M4 { pub rows: Vec<(f64, f64, String, bool)>, pub sha256: String }

pub fn m4_table() -> Result<M4, String> {
    let bytes = std::fs::read(root().join("spec/tables/m4.json")).map_err(|e| e.to_string())?;
    let t: J = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let rows = arr(&t["rows"]).iter().map(|r| (r[0].as_f64().unwrap_or(0.0), r[1].as_f64().unwrap_or(0.0),
        r[2].as_str().unwrap_or("").to_string(), r[3].as_bool().unwrap_or(false))).collect();
    Ok(M4 { rows, sha256: hash(&bytes) })
}

/// Every use whose sub-band touches any of the ranges (lo, hi in MHz, ends included), each once, in table order;
/// and, of those, the ones the table marks licence-exempt.
pub fn finnish_use(t: &M4, ranges: &[(f64, f64)]) -> J {
    let (mut uses, mut exempt): (Vec<&str>, Vec<&str>) = (vec![], vec![]);
    for (lo, hi, used, ex) in &t.rows {
        if !ranges.iter().any(|(a, b)| lo <= b && hi >= a) { continue; }
        if !uses.contains(&used.as_str()) { uses.push(used); }
        if *ex && !exempt.contains(&used.as_str()) { exempt.push(used); }
    }
    json!({"uses": uses, "exempt": exempt})
}
