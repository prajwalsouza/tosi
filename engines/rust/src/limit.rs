//! Stage 4: match transmitting groups to the international limits protecting Finland.
use crate::space_common::*;
use serde_json::json;
use std::collections::{HashMap, HashSet};

#[derive(Default)]
struct Per { groups: usize, rows: usize, named: usize, nofreq: usize, all: usize }

pub fn run(folder: &str) -> Result<String, String> {
    let intake = require_space(folder, "Limit")?;
    let (rules, stamp) = rulebook("limit")?;
    let reach = read_json(folder, "reach.json")?;
    let _down = read_json(folder, "downlink.json")?;
    emit("limit", "start", json!({}));
    let mut db = Db::open(folder, "limit")?;
    let (gs, seen) = groups(&mut db, &reach)?;
    let orb = orbits(&mut db)?;
    let l = limits()?;
    let finland: HashSet<_> = arr(&rules["areas_protecting_finland"]).iter().map(js).collect();
    let mut per: HashMap<i64, Per> = HashMap::new();
    let (mut rows, mut named_rows) = (Vec::new(), 0);
    for g in &gs {
        let p = per.entry(g.ntc).or_default();
        p.all += 1;
        let Some((lo, hi)) = g.span else { p.nofreq += 1; continue };
        let t = if g.typ == "G" { "G" } else { "N" };
        let lt = &l.tables[t];
        let o = orb.get(&g.ntc);
        let mut mine = Vec::new();
        for x in &lt.exam {
            if !(jf(&x["freq_min"]) < hi && jf(&x["freq_max"]) > lo) { continue; }
            if !l.classes.get(&ji(&x["ix_serv"])).map_or(false, |cs| cs.iter().any(|c| g.classes.contains(c))) { continue; }
            if let Some(d) = g.date { if !(ji(&x["date_min"]) <= d && d <= ji(&x["date_max"])) { continue; } }
            if t == "N" {
                if let Some(i) = o.and_then(|o| o.incl) { if !(jf(&x["inclin_fr"]) <= i && i <= jf(&x["inclin_to"])) { continue; } }
                if let Some(a) = o.and_then(|o| o.apog) { if !(jf(&x["apog_fr"]) <= a && a <= jf(&x["apog_to"])) { continue; } }
            }
            let area = l.area.get(&ji(&x["ix_prot_area"])).map(String::as_str).unwrap_or("");
            if !finland.contains(area) {
                if area.contains(js(&rules["named_countries_marker"])) { p.named += 1; named_rows += 1; }
                continue;
            }
            let Some(pv) = lt.provision.get(&ji(&x["ix_provn"])) else { continue };
            if pv["ang_type"] == rules["skip_angle_type"] { continue; }
            mine.push(json!([g.grp, g.ntc, t, x["ix_freq"], x["ix_provn"]]));
        }
        if !mine.is_empty() { p.groups += 1; p.rows += mine.len(); rows.extend(mine); }
    }
    rows.sort_by(|a, b| ji(&a[0]).cmp(&ji(&b[0])).then_with(|| js(&a[2]).cmp(js(&b[2]))).then_with(|| ji(&a[3]).cmp(&ji(&b[3]))).then_with(|| ji(&a[4]).cmp(&ji(&b[4]))));
    let mut how = outcomes(&rules);
    let mut notices = Vec::new();
    let mut groups_limited = 0;
    for (ntc, typ) in &seen {
        let empty = Per::default();
        let p = per.get(ntc).unwrap_or(&empty);
        let k = if p.rows > 0 { "limited" } else if p.all == 0 || p.nofreq == p.all { "no_frequency" } else if p.named > 0 { "named_countries_only" } else { "no_limit" };
        bump(&mut how, k);
        groups_limited += p.groups;
        notices.push(json!({"ntc_id": ntc, "type": typ, "limited": k == "limited", "how": k, "groups": p.groups, "rows": p.rows}));
    }
    let limited = ji(&how["limited"]);
    let result = json!({"schema": "limit/1", "rulebook": stamp, "tables": l.source["sha256"], "file": intake["file"]["sha256"],
        "counts": {"notices": notices.len(), "limited": limited, "left": notices.len() as i64 - limited, "how": how, "groups": gs.len(), "groups_limited": groups_limited, "rows": rows.len(), "named_countries_rows": named_rows},
        "notices": notices, "rows": rows});
    emit("limit", "done", json!({"limited": limited, "notices": notices.len(), "rows": rows.len()}));
    write(folder, "limit", result)
}
