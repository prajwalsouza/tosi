//! Distance from Finland's outer limit, withdrawal and propagation frequency limits.
use serde_json::json;
use crate::terra_common::*;
pub fn run(folder:&str)->Result<String,String> {
    let intake=need_terrestrial(folder)?;
    let prev=read_json(folder,"mobile")?;
    let (rules,stamp)=rulebook("range")?;
    emit("range","start",json!({}));
    let by=station_map(&mut Db::open(folder,"range")?)?;
    let fin=Finland::load()?;
    let mut left=counts(&rules,"reasons");
    let mut notices=vec![];
    for n in arr(&prev["notices"]).iter().filter(|n| n[6].is_null()) {
        let s=by.get(&n[0].as_i64().unwrap()).ok_or("Station missing from database")?;
        let (km,border)=match (s.lon,s.lat) {
            (Some(lon),Some(lat))=>{let (i,d)=fin.nearest(lon,lat,f(&rules["earth_radius_km"])); (Some((d-s.radius.max(0.)).max(0.)),Some(i))},
            _=>(None,None)
        };
        let reason=if s.intent==rules["withdrawn_intent"].as_str().unwrap_or("") {Some("withdrawn")} else if km.is_some_and(|k| k>f(&rules["max_km"])) {Some("too_far")} else if s.freq.map_or(true,|v| v<f(&rules["f_min_mhz"]) || v>f(&rules["f_max_mhz"])) {Some("out_of_band")} else {None};
        if let Some(k)=reason {increment(&mut left,k);}
        notices.push(json!([s.terrakey,km.map(round2),border,reason]));
    }
    let kept=notices.iter().filter(|n| n[3].is_null()).count();
    emit("range","done",json!({"kept":kept,"notices":notices.len(),"left":left}));
    write_result(folder,"range",json!({"schema":"range/1","rulebook":stamp,"file":intake["file"]["sha256"],"counts":{"notices":notices.len(),"kept":kept,"left":left},"fields":["terrakey","km","border","reason"],"notices":notices}))
}
