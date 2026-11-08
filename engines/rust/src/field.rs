//! Strongest P.1546 signal among the specified points on Finland's outer limit.
use serde_json::json;
use crate::{terra_common::*,p1546::P1546};
pub fn run(folder:&str)->Result<String,String> {
    let intake=need_terrestrial(folder)?;
    let prev=read_json(folder,"tdata")?;
    let (rules,stamp)=rulebook("field")?;
    emit("field","start",json!({}));
    let by=station_map(&mut Db::open(folder,"field")?)?;
    let fin=Finland::load()?; let model=P1546::load()?;
    let radius=f(&rules["earth_radius_km"]);
    let mut notices=vec![];
    for n in arr(&prev["notices"]).iter().filter(|n| n["kept"]==true) {
        let key=n["terrakey"].as_i64().ok_or("Invalid terrakey")?;
        let s=by.get(&key).ok_or("Station missing from database")?;
        let (lon,lat)=(s.lon.ok_or("Missing longitude")?,s.lat.ok_or("Missing latitude")?);
        let inside=fin.inside(lon,lat);
        let mut best:Option<(f64,usize,f64,f64)>=None;
        for i in fin.candidates(lon,lat,f(&rules["nearest_points"]) as usize,f(&rules["spread_km"]),f(&rules["stride"]) as usize,radius) {
            let p=&fin.border[i];
            let km=(if inside {0.} else {(distance_km(lat,lon,p.1,p.0,radius)-s.radius.max(0.)).max(0.)}).max(f(&rules["min_km"]));
            let (dl,ds,land)=fin.land_sea(lon,lat,p.0,p.1,km,f(&rules["samples"]) as usize);
            let e=model.field_strength(s.freq.ok_or("Missing frequency")?,f(&rules["time_percent"]),f(&n["heff_m"]),f(&rules["receiver_height_m"]),dl,ds,f(&n["erp_dbw"]));
            if best.map_or(true,|b| e>b.0) {best=Some((e,i,km,land));}
        }
        let (e,border,km,land)=best.ok_or("No border candidates")?;
        notices.push(json!({"terrakey":key,"e":round2(e),"border":border,"km":round2(km),"land":round2(land)}));
    }
    emit("field","done",json!({"notices":notices.len()}));
    write_result(folder,"field",json!({"schema":"field/1","rulebook":stamp,"tables":{"p1546":model.sha,"finland":fin.sha},"file":intake["file"]["sha256"],"counts":{"notices":notices.len()},"notices":notices}))
}
