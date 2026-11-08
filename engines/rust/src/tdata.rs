//! Filed transmit power and effective height, with explicit assumptions.
use serde_json::json;
use jetdb::Value;
use std::collections::HashMap;
use crate::terra_common::*;
pub fn run(folder:&str)->Result<String,String> {
    let intake=need_terrestrial(folder)?;
    let prev=read_json(folder,"range")?;
    let (rules,stamp)=rulebook("tdata")?;
    emit("tdata","start",json!({}));
    let mut db=Db::open(folder,"tdata")?;
    let by=station_map(&mut db)?;
    let mut ants:HashMap<i64,Vec<Row>>=HashMap::new();
    for a in db.columns("fxm_ant",&["terrakey","ant_key","pwr_dbw","pwr_eiv","tx_rx","hgt_agl","eff_hgtmax"])? {ants.entry(id(&a,"terrakey")).or_default().push(a);}
    let mut hgt:HashMap<i64,f64>=HashMap::new();
    for h in db.columns("fxm_ant_hgt",&["terrakey","eff_hgt"])? {if let Some(v)=num(h.get("eff_hgt")) {hgt.entry(id(&h,"terrakey")).and_modify(|m| *m=m.max(v)).or_insert(v);}}
    let mut left=counts(&rules,"reasons");
    let mut notices=vec![];
    for r in arr(&prev["notices"]).iter().filter(|r| r[3].is_null()) {
        let key=r[0].as_i64().ok_or("Invalid terrakey")?;
        let s=by.get(&key).ok_or("Station missing from database")?;
        let mut tx:Vec<_>=ants.get(&key).into_iter().flatten().filter(|a| matches!(a.get("tx_rx"),Some(Value::Null)) || matches!(a.get("tx_rx"),Some(Value::Text(v)) if v=="TX" || v.is_empty())).collect();
        tx.sort_by_key(|a| id(a,"ant_key"));
        let mut top:Option<&Row>=None;
        for &a in &tx {if let Some(p)=num(a.get("pwr_dbw")) {if top.map_or(true,|b| p>num(b.get("pwr_dbw")).unwrap()) {top=Some(a);}}}
        let max_of=|k:&str| tx.iter().filter_map(|a| num(a.get(k))).reduce(f64::max);
        let mut assumptions=vec![];
        let mut heff=max_of("eff_hgtmax");
        let mut from=heff.map(|_| "eff_hgtmax");
        if heff.is_none() {if let Some(&h)=hgt.get(&key) {heff=Some(h); from=Some("fxm_ant_hgt");}}
        if heff.is_none() {heff=max_of("hgt_agl"); if heff.is_some() {from=Some("hgt_agl"); assumptions.push("height_above_ground");}}
        if heff.is_none() && s.cls=="ML" {heff=Some(f(&rules["mobile_default_m"])); from=Some("default"); assumptions.push("mobile_default_height");}
        let erp=top.map(|a| {
            let mut p=num(a.get("pwr_dbw")).unwrap();
            let reference=text(a.get("pwr_eiv")).trim();
            if reference=="I" {p-=f(&rules["eirp_to_erp_db"]); assumptions.push("eirp_to_erp");} else if reference!="E" {assumptions.push("power_reference_taken_as_erp");} p
        });
        if s.radius>0. {assumptions.push("area_station_edge");}
        let reason=if s.lon.is_none() || s.lat.is_none() {Some("no_position")} else if erp.is_none() {Some("no_power")} else if heff.is_none() {Some("no_height")} else {None};
        if let Some(k)=reason {increment(&mut left,k);}
        notices.push(json!({"terrakey":key,"kept":reason.is_none(),"reason":reason,"erp_dbw":erp.map(round2),"heff_m":heff.map(round2),"heff_from":from,"assumptions":assumptions}));
    }
    let kept=notices.iter().filter(|n| n["kept"]==true).count();
    emit("tdata","done",json!({"kept":kept,"notices":notices.len(),"left":left}));
    write_result(folder,"tdata",json!({"schema":"tdata/1","rulebook":stamp,"file":intake["file"]["sha256"],"counts":{"notices":notices.len(),"kept":kept,"left":left},"notices":notices}))
}
