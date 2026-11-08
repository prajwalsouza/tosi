//! Space stage 10, report. See spec/stages/report/README.md.
//! The notification for a space file: filings on crit and warn rungs with what, where, why, how much and what next,
//! plus report.csv (every filing) and report.md (the short notification).
use crate::{report_common::*, space_common::*};
use serde_json::{json, Value as J};
use std::{collections::HashMap, fs};

/// A JavaScript template-literal hole: null prints "null", numbers in shortest form.
pub fn tpl(v: &J) -> String { if v.is_null() { "null".into() } else { string(v) } }
/// Replace each {word} with the value of that key, or nothing when the key is missing.
pub fn fill(s: &str, o: &[(&str, String)]) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        let w = tail.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(tail.len());
        if w > 0 && tail[w..].starts_with('}') {
            let k = &tail[..w];
            out.push_str(o.iter().find(|(n, _)| *n == k).map(|(_, v)| v.as_str()).unwrap_or(""));
            rest = &tail[w + 1..];
        } else { out.push('{'); rest = tail; }
    }
    out + rest
}
/// Finnish use in a sentence: the first few uses the frequency table (M4) lists, then the licence-exempt ones.
pub fn use_text(u: &J, n: usize) -> String {
    if u.is_null() { return String::new(); }
    let few = |l: &J| { let v: Vec<String> = arr(l).iter().map(string).collect(); v.iter().take(n).cloned().collect::<Vec<_>>().join(", ") + if v.len() > n { ", …" } else { "" } };
    if arr(&u["uses"]).is_empty() { return " Finland's frequency table (M4) lists no use on these frequencies.".into(); }
    let exempt = if arr(&u["exempt"]).is_empty() { String::new() } else { format!("; licence-exempt: {}", few(&u["exempt"])) };
    format!(" Finland's frequency table (M4) lists {}{exempt}.", few(&u["uses"]))
}
pub fn use_cells(u: &J) -> [J; 2] {
    if u.is_null() { [J::Null, J::Null] } else { [json!(joined(&u["uses"], "; ")), json!(joined(&u["exempt"], "; "))] }
}
/// A transmission's band; every number beside a margin is about that band.
fn band(e: &J) -> String { format!("{}–{} MHz", string(&e["lo_mhz"]), string(&e["hi_mhz"])) }
fn margin_text(x: &J) -> String { let v = jf(x); if v > 0.0 { format!("{} dB over", string(x)) } else { format!("{} dB under", string(&round2(-v))) } }
/// The Finnish use on one band (M4).
fn band_use(u: &J, n: usize, at: &str) -> String {
    if u.is_null() { return String::new(); }
    let few = |l: &J| { let v: Vec<String> = arr(l).iter().map(string).collect(); v.iter().take(n).cloned().collect::<Vec<_>>().join(", ") + if v.len() > n { ", …" } else { "" } };
    if arr(&u["uses"]).is_empty() { return format!(" At {at}, Finland's frequency table (M4) lists no use."); }
    let exempt = if arr(&u["exempt"]).is_empty() { String::new() } else { format!("; licence-exempt: {}", few(&u["exempt"])) };
    format!(" At {at}, Finland's frequency table (M4) lists {}{exempt}.", few(&u["uses"]))
}
fn deg(v: f64) -> String { format!("{}° {}", string(&number(v.abs())), if v < 0.0 { "W" } else { "E" }) }
fn plural(n: i64) -> &'static str { if n == 1 { "" } else { "s" } }

struct Described { name: J, administration: String, country: String, kind: J, place: String }

pub fn run(folder: &str) -> Result<String, String> {
    let intake = require_space(folder, "Report")?;
    let (rules, stamp) = rulebook("report")?;
    let lad_bytes = fs::read(root().join("spec/rulebook/ladder.json")).map_err(|e| e.to_string())?;
    let lad: J = serde_json::from_slice(&lad_bytes).map_err(|e| e.to_string())?;
    let adm = read_json(root().join("spec/reference").to_str().unwrap(), "administrations.json")?;
    let down = read_json(folder, "downlink.json")?;
    let reach = read_json(folder, "reach.json")?;
    let lim = read_json(folder, "limit.json")?;
    let data = read_json(folder, "data.json")?;
    let pow = read_json(folder, "power.json")?;
    let cmp = read_json(folder, "compare.json")?;
    let sta = read_json(folder, "stations.json")?;
    let ladder = read_json(folder, "ladder.json")?;
    emit("report", "start", json!({}));
    let mut db = Db::open(folder, "report")?;
    let notice: HashMap<i64, String> = db.columns("notice", &["ntc_id", "adm"])?.iter()
        .map(|r| (id(&r[0]), text(&r[1]).unwrap_or_default())).collect();
    let mut names: HashMap<i64, String> = HashMap::new();
    for r in db.columns("geo", &["ntc_id", "sat_name"])? {
        if let Some(s) = text(&r[1]).filter(|s| !s.is_empty()) { names.insert(id(&r[0]), s.trim().into()); }
    }
    for r in db.columns("non_geo", &["ntc_id", "sat_name"])? {
        if let Some(s) = text(&r[1]).filter(|s| !s.is_empty()) { names.entry(id(&r[0])).or_insert_with(|| s.trim().into()); }
    }
    let mut orbit: HashMap<i64, (Option<f64>, Option<f64>)> = HashMap::new();
    for r in db.columns("orbit", &["ntc_id", "inclin_ang", "apog_km"])? {
        let o = orbit.entry(id(&r[0])).or_insert((None, None));
        if let Some(i) = num(&r[1]) { o.0 = Some(o.0.map_or(i, |t| t.max(i))); }
        if let Some(a) = num(&r[2]) { o.1 = Some(o.1.map_or(a, |t| t.max(a))); }
    }

    let (d_, r_, lm_, dt_, p_, c_, s_) = (by(&down, "ntc_id"), by(&reach, "ntc_id"), by(&lim, "ntc_id"), by(&data, "ntc_id"),
        by(&pow, "ntc_id"), by(&cmp, "ntc_id"), by(&sta, "ntc_id"));
    let rung = |k: &J| arr(&lad["rungs"]).iter().find(|r| r["key"] == *k).cloned().unwrap_or(J::Null);
    let w = &rules["words"];
    let describe = |id: i64| -> Described {
        let (r, dn) = (get(&r_, id), get(&d_, id));
        let a = notice.get(&id).map(|s| s.trim().to_string()).unwrap_or_default();
        let ty = &dn["type"];
        let kind = match ty.as_str() { Some("G") => json!("fixed"), Some("N") => json!("moving"), _ if ty.is_null() => json!(""), _ => ty.clone() };
        let o = orbit.get(&id);
        let place = if r["how"] == "beyond_earth" {
            let body = rules["bodies"].get(js(&r["body"])).filter(|b| !b.is_null()).unwrap_or(&r["body"]);
            fill(js(&w["beyond"]), &[("body", string(body))])
        } else if ty == "G" {
            match r["longitude"].as_f64() {
                Some(l) => fill(js(&w["fixed"]), &[("longitude", deg(l))]),
                None => js(&w["moving_unknown"]).replacen("Moving", "Fixed", 1),
            }
        } else if let Some((Some(t), Some(a))) = o {
            fill(js(&w["moving"]), &[("tilt", string(&round2(*t))), ("apogee", string(&round2(*a)))])
        } else { js(&w["moving_unknown"]).into() };
        Described {
            name: names.get(&id).map_or(J::Null, |n| json!(n)),
            country: adm["administrations"].get(&a).and_then(|c| c.as_str()).map_or(a.clone(), String::from),
            administration: a, kind, place,
        }
    };
    let next = |k: &J| rules["next"].get(js(k)).cloned().unwrap_or(J::Null);
    let levels = arr(&rules["levels_reported"]);
    let listed = ji(&rules["stations_listed"]) as usize;
    let uses_listed = ji(&rules["uses_listed"]) as usize;

    // The reported items, in ladder order.
    let mut items = Vec::new();
    for p in arr(&ladder["notices"]) {
        let rg = rung(&p["rung"]);
        if !levels.contains(&rg["level"]) { continue; }
        let id = ji(&p["ntc_id"]);
        let d = describe(id);
        let (r, c, s) = (get(&r_, id), get(&c_, id), get(&s_, id));
        let ids = arr(&s["stations"]);
        let worst = &p["worst"];
        let how_much = if !c.is_null() && !c["excess"].is_null() {
            json!({"excess":c["excess"],"provision":c["provn"],"finding":c["finding"],"angle":c["angle"],"distance_km":c["distance_km"],"pfd":c["pfd"],"limit":c["limit"],
                "lo_mhz":worst["lo_mhz"],"hi_mhz":worst["hi_mhz"],"finnish_use":worst["m4"]})
        } else { J::Null };
        // the transmission the station evidence rests on, with its own margin, band and Finnish use
        let m = &p["margin"];
        let evidence = if m.is_null() { J::Null } else {
            json!({"excess":m["excess"],"lo_mhz":m["lo_mhz"],"hi_mhz":m["hi_mhz"],"count":arr(&m["stations"]).len(),"first":first(&m["stations"], listed),"finnish_use":m["m4"]})
        };
        items.push(json!({
            "ntc_id": id, "name": d.name, "administration": d.administration, "country": d.country, "kind": d.kind, "where": d.place,
            "seen": {"seen": truth(&r["seen"]), "how": r["how"], "elevation": r["elevation"], "north": r["north"]},
            "stations": {"count": ids.len(), "over": p["stations_over"], "near": p["stations_near"], "near_frequency": p["near_frequency"]},
            "evidence": evidence,
            "why": {"rung": p["rung"], "level": rg["level"], "wording": rg["rung"], "means": rg["means"], "cites": rg["cites"], "itu": p["itu"]},
            "how_much": how_much,
            "next": next(&p["rung"]),
        }));
    }

    // Every filing as one row of the processed file, in ascending ntc_id order.
    let head = ["Filing (ntc_id)", "Satellite", "Administration", "Country", "Kind", "Where", "Sends signals down", "Seen from Finland", "Has a limit",
        "Calculable", "Worst e.i.r.p. (dBW)", "Over the limit by (dB)", "Provision", "Arrival angle (deg)", "Distance (km)", "Outcome",
        "Worst band (MHz)", "Listed stations", "At a transmission over the limit", "Only at a transmission near the limit", "Near-frequency stations",
        "Finnish use in the worst band (M4)", "Licence-exempt use in the worst band (M4)", "ITU names Finland", "Concern", "Level", "Decided by"];
    let lad_index = by(&ladder, "ntc_id");
    let mut lines = vec![csv_line(&head.iter().map(|h| json!(h)).collect::<Vec<_>>())];
    let mut all = arr(&down["notices"]).to_vec();
    all.sort_by_key(|n| ji(&n["ntc_id"]));
    for n in &all {
        let id = ji(&n["ntc_id"]);
        let d = describe(id);
        let (r, lm, dt, pw, c, s, p) = (get(&r_, id), get(&lm_, id), get(&dt_, id), get(&p_, id), get(&c_, id), get(&s_, id), get(&lad_index, id));
        let rg = rung(&p["rung"]);
        let outcome = js(&c["outcome"]);
        let near = if truth(&p["near_frequency"]) { p["near_frequency"].clone() }
            else if !c.is_null() && (outcome == "over" || outcome == "near") { json!(0) } else { J::Null };
        let [uses, exempt] = use_cells(&p["worst"]["m4"]);
        let wb = if p["worst"].is_null() { J::Null } else { json!(format!("{}–{}", string(&p["worst"]["lo_mhz"]), string(&p["worst"]["hi_mhz"]))) };
        let count = |k: &str| if s.is_null() { J::Null } else { json!(arr(&s[k]).len()) };
        lines.push(csv_line(&[json!(id), d.name, json!(d.administration), json!(d.country), d.kind, json!(d.place), yes_no(&n["kept"]),
            yes_no(&r["seen"]), yes_no(&lm["limited"]), yes_no(&dt["complete"]), pw["eirp"].clone(), c["excess"].clone(), c["provn"].clone(),
            c["angle"].clone(), c["distance_km"].clone(), c["outcome"].clone(),
            wb, count("stations"), count("over"), count("near"), near, uses, exempt, json!(joined(&p["itu"], " ")),
            rg["rung"].clone(), rg["level"].clone(), p["by"].clone()]));
    }

    // The short notification.
    let crit: Vec<&J> = items.iter().filter(|x| x["why"]["level"] == "crit").collect();
    let warn: Vec<&J> = items.iter().filter(|x| x["why"]["level"] == "warn").collect();
    let mut md = vec![format!("# Space notification: {}", tpl(&intake["file"]["name"])), String::new(),
        format!("{} filings screened. {} need attention, {} are worth a look.", tpl(&ladder["counts"]["notices"]), crit.len(), warn.len()), String::new(),
        "| Concern | Level | Filings |".into(), "|---|---|---|".into()];
    for r in arr(&lad["rungs"]) {
        let n = ladder["counts"]["rungs"].get(js(&r["key"])).filter(|v| !v.is_null()).cloned().unwrap_or(json!(0));
        md.push(format!("| {} | {} | {} |", tpl(&r["rung"]), tpl(&r["level"]), tpl(&n)));
    }
    md.push(String::new());
    let line = |x: &J, i: usize| -> Vec<String> {
        let name = if x["name"].is_null() { format!("Filing {}", tpl(&x["ntc_id"])) } else { tpl(&x["name"]) };
        let seen = if truth(&x["seen"]["seen"]) { tpl(&w["seen"]) } else { tpl(&w["clear"]) };
        let head = format!("{}. **{}** ({}), {}. {}. {}.", i + 1, name, tpl(&x["ntc_id"]), tpl(&x["country"]), tpl(&x["where"]), seen);
        let h = &x["how_much"];
        let much = if h.is_null() { "No calculated margin".to_string() } else {
            let e = jf(&h["excess"]);
            let over = if e > 0.0 { format!("{} dB over", string(&h["excess"])) } else { format!("{} dB under", string(&round2(-e))) };
            let prov = if truth(&h["provision"]) { format!(" ({})", tpl(&h["provision"])) } else { String::new() };
            let at = if h["lo_mhz"].is_null() { String::new() } else { format!(", at {}", band(h)) };
            format!("{over} the limit{prov} at {}° above the horizon{at}", string(&h["angle"]))
        };
        let st = &x["stations"];
        let ev = &x["evidence"];
        let num_eq = |a: &J, b: &J| !a.is_null() && !b.is_null() && jf(a) == jf(b);
        // station evidence stays with its own transmission: said apart when it is not the worst one
        let same = !h.is_null() && !ev.is_null() && num_eq(&ev["lo_mhz"], &h["lo_mhz"]) && num_eq(&ev["hi_mhz"], &h["hi_mhz"]) && num_eq(&ev["excess"], &h["excess"]);
        let nf = &st["near_frequency"];
        let stations = if !ev.is_null() {
            let count = ji(&ev["count"]);
            let more = if count as usize > arr(&ev["first"]).len() { ", …" } else { "" };
            let on = format!("on the frequencies of {count} listed station{} ({}{more})", plural(count), joined(&ev["first"], ", "));
            if same { on } else {
                let none_over = if !h.is_null() && jf(&h["excess"]) > 0.0 && jf(&ev["excess"]) <= 0.0 { "; no listed station is on a transmission over the limit" } else { "" };
                format!("{} the limit at {}, {on}{none_over}", margin_text(&ev["excess"]), band(ev))
            }
        } else if truth(nf) { format!("{} listed station{} near its frequencies", tpl(nf), plural(ji(nf))) }
        else { "no listed station on its frequencies".into() };
        let itu = &x["why"]["itu"];
        let itu = if arr(itu).is_empty() { String::new() } else { format!(" The ITU's records name Finland ({}).", joined(itu, ", ")) };
        let uses = (if !h.is_null() && !h["lo_mhz"].is_null() { band_use(&h["finnish_use"], uses_listed, &band(h)) } else { String::new() })
            + &(if !ev.is_null() && !same { band_use(&ev["finnish_use"], uses_listed, &band(ev)) } else { String::new() });
        vec![head, format!("   {}: {much}; {stations}.{itu}{uses}", tpl(&x["why"]["wording"])), format!("   Next: {}", tpl(&x["next"]))]
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
    let result = json!({"schema":"report/1","rulebook":stamp,"uses":{"ladder":hash(&lad_bytes)},"file":intake["file"]["sha256"],"name":intake["file"]["name"],
        "counts":{"notices":ladder["counts"]["notices"],"items":ni,"crit":nc,"warn":nw,"rungs":ladder["counts"]["rungs"]},
        "files":files,"items":items});
    emit("report", "done", json!({"items":ni,"crit":nc,"warn":nw}));
    write_stage(folder, "report", result)
}
