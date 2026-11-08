//! New foreign land mobile filings, with every station retained as a compact map row.
use serde_json::{json, Value as J};
use crate::terra_common::*;
pub fn run(folder:&str)->Result<String,String> {
    let intake=need_terrestrial(folder)?;
    let (rules,stamp)=rulebook("mobile")?;
    emit("mobile","start",json!({}));
    let all=Db::open(folder,"mobile")?.stations()?;
    let mut left=counts(&rules,"reasons");
    let notices:Vec<_>=all.iter().map(|s| {
        let reason=if s.stage!=rules["notice_stage"].as_str().unwrap_or("") {Some("recorded")} else if s.adm==rules["own_administration"].as_str().unwrap_or("") {Some("finnish")} else if rules["classes"].get(&s.cls).is_none() {Some("not_land_mobile")} else {None};
        if let Some(k)=reason {increment(&mut left,k);}
        json!([s.terrakey,s.adm,s.cls,s.freq.map(number),s.lon.map(round3),s.lat.map(round3),reason])
    }).collect();
    let kept=notices.iter().filter(|n| n[6]==J::Null).count();
    emit("mobile","done",json!({"kept":kept,"notices":notices.len(),"left":left}));
    write_result(folder,"mobile",json!({"schema":"mobile/1","rulebook":stamp,"file":intake["file"]["sha256"],"counts":{"notices":notices.len(),"kept":kept,"left":left},"fields":["terrakey","adm","cls","f_mhz","lon","lat","reason"],"notices":notices}))
}
