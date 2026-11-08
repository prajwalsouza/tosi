//! Ordered stage rows and byte-stable report exports shared by the two pipelines.
use crate::space_common::{arr, hash, ji, js, number, write};
use serde_json::{json, Map, Value as J};
use std::{cmp::Ordering, collections::HashMap, fs, path::Path};

pub type Index = HashMap<i64, J>;
pub fn by(o: &J, key: &str) -> Index {
    arr(&o["notices"]).iter().map(|n| (ji(&n[key]), n.clone())).collect()
}
pub fn get(m: &Index, key: i64) -> &J { m.get(&key).unwrap_or(&J::Null) }
pub fn expanded(o: &J) -> Vec<J> {
    arr(&o["notices"]).iter().map(|r| J::Object(arr(&o["fields"]).iter().enumerate()
        .map(|(i, k)| (js(k).to_owned(), r[i].clone())).collect())).collect()
}
pub fn truth(v: &J) -> bool {
    match v { J::Null => false, J::Bool(b) => *b, J::Number(n) => n.as_f64().is_some_and(|x| x != 0.0), J::String(s) => !s.is_empty(), _ => true }
}
/// String(number) uses ordinary decimal notation in [1e-6, 1e21).
pub fn string(v: &J) -> String {
    match v {
        J::Null => String::new(), J::String(s) => s.clone(),
        J::Number(n) => {
            let x = n.as_f64().unwrap();
            if x == 0.0 { "0".into() }
            else if (1e-6..1e21).contains(&x.abs()) { x.to_string() }
            else {
                let s = format!("{x:e}");
                let (m, e) = s.split_once('e').unwrap();
                let e: i32 = e.parse().unwrap();
                format!("{m}e{}{e}", if e >= 0 { "+" } else { "" })
            }
        }
        _ => v.to_string(),
    }
}
pub fn yes_no(v: &J) -> J { if v.is_null() { json!("") } else { json!(if truth(v) { "yes" } else { "no" }) } }
pub fn csv_line(cells: &[J]) -> String {
    cells.iter().map(|v| {
        let s = string(v);
        if s.contains(['"', ',', '\n', '\r']) { format!("\"{}\"", s.replace('"', "\"\"")) } else { s }
    }).collect::<Vec<_>>().join(",")
}
pub fn joined(v: &J, sep: &str) -> String { arr(v).iter().map(string).collect::<Vec<_>>().join(sep) }
pub fn first(v: &J, n: usize) -> J { json!(arr(v).iter().take(n).collect::<Vec<_>>()) }
pub fn rung_counts(rules: &J, notices: &[J], key: &str) -> J {
    let mut rungs: Map<String, J> = arr(&rules["rungs"]).iter().map(|r| (js(&r["key"]).into(), json!(0))).collect();
    let mut levels = json!({"crit":0,"warn":0,"none":0});
    for p in notices {
        let k = js(&p[key]);
        rungs[k] = json!(ji(&rungs[k]) + 1);
        let r = arr(&rules["rungs"]).iter().find(|r| r["key"] == k).unwrap();
        let l = js(&r["level"]);
        levels[l] = json!(ji(&levels[l]) + 1);
    }
    json!({"notices":notices.len(),"levels":levels,"rungs":rungs})
}
pub fn placement_order(a: &J, b: &J, rules: &J, key: &str) -> Ordering {
    let pos = |p: &J| arr(&rules["rungs"]).iter().position(|r| r["key"] == p["rung"]).unwrap();
    pos(a).cmp(&pos(b)).then_with(|| {
        b["excess"].as_f64().unwrap_or(f64::NEG_INFINITY)
            .partial_cmp(&a["excess"].as_f64().unwrap_or(f64::NEG_INFINITY)).unwrap()
    }).then_with(|| ji(&a[key]).cmp(&ji(&b[key])))
}
fn normalize(v: &mut J) {
    match v {
        J::Number(n) if n.is_f64() => *v = number(n.as_f64().unwrap()),
        J::Array(a) => a.iter_mut().for_each(normalize),
        J::Object(o) => o.values_mut().for_each(normalize),
        _ => (),
    }
}
pub fn write_stage(folder: &str, stage: &str, mut result: J) -> Result<String, String> {
    normalize(&mut result);
    write(folder, stage, result)
}
pub fn exports(folder: &str, lines: &[String], md: &[String]) -> Result<J, String> {
    let csv = lines.join("\n") + "\n";
    let text = md.join("\n");
    fs::write(Path::new(folder).join("report.csv"), &csv).map_err(|e| e.to_string())?;
    fs::write(Path::new(folder).join("report.md"), &text).map_err(|e| e.to_string())?;
    Ok(json!({"csv":{"name":"report.csv","rows":lines.len()-1,"sha256":hash(csv.as_bytes())},
        "md":{"name":"report.md","sha256":hash(text.as_bytes())}}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_numbers_and_csv_quoting() {
        for (x, expected) in [(66.0,"66"),(-0.0,"0"),(0.000001,"0.000001"),(1e-7,"1e-7"),(1e21,"1e+21")] {
            assert_eq!(string(&json!(x)), expected);
        }
        assert_eq!(csv_line(&[J::Null,json!(66.0),json!("a,\"b\"\r\nc")]), ",66,\"a,\"\"b\"\"\r\nc\"");
    }
}
