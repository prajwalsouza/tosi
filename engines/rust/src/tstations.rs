//! Signals at listed Finnish stations sharing the channel; a missing local list is a result.
use serde_json::{json,Value as J};
use std::collections::HashMap;
use crate::{terra_common::*,p1546::P1546};
struct Band {id:String,lo:f64,hi:f64,lon:f64,lat:f64}
pub fn run(folder:&str)->Result<String,String> {
    let intake=need_terrestrial(folder)?;
    let thr=read_json(folder,"threshold")?; let data=read_json(folder,"tdata")?;
    let (rules,stamp)=rulebook("tstations")?; let (field,_)=rulebook("field")?;
    emit("tstations","start",json!({}));
    let by=station_map(&mut Db::open(folder,"tstations")?)?;
    let dat:HashMap<_,_>=arr(&data["notices"]).iter().map(|n| (n["terrakey"].as_i64().unwrap_or(0),n)).collect();
    let (list,stations)=finnish_stations()?;
    let mut bands=vec![];
    for st in &stations {
        if st["lon"].is_null() || st["lat"].is_null() {continue;}
        let half=f(&st["bw_mhz"])/2.;
        let mut freqs=vec![&st["rx_mhz"]];
        if !st["tx_mhz"].is_null() && st["tx_mhz"]!=st["rx_mhz"] {freqs.push(&st["tx_mhz"]);}
        for freq in freqs.into_iter().filter(|v| !v.is_null()) {
            bands.push(Band {id:st["station"].as_str().unwrap_or("").into(),lo:f(freq)-half,hi:f(freq)+half,lon:f(&st["lon"]),lat:f(&st["lat"])});
        }
    }
    let fin=Finland::load()?; let model=P1546::load()?;
    let mut how=counts(&rules,"outcomes"); let mut notices=vec![];
    for n in arr(&thr["notices"]) {
        let key=n["terrakey"].as_i64().ok_or("Invalid terrakey")?;
        let s=by.get(&key).ok_or("Station missing from database")?;
        let d=dat.get(&key).ok_or("Station missing from tdata")?;
        if list["present"]==false {
            increment(&mut how,"no_list");
            notices.push(json!({"terrakey":key,"outcome":"no_list","checked":0,"over":[],"worst":null})); continue;
        }
        let half=s.bw_khz.unwrap_or(0.)/2000.; let freq=s.freq.ok_or("Missing frequency")?;
        let lo=freq-half; let hi=freq+half;
        // Preserve first matching band per station, then numeric station-id order for ties.
        let mut seen:HashMap<String,J>=HashMap::new(); let mut ids=vec![];
        for b in &bands {
            if b.hi<lo || b.lo>hi || seen.contains_key(&b.id) {continue;}
            let km=distance_km(s.lat.ok_or("Missing latitude")?,s.lon.ok_or("Missing longitude")?,b.lat,b.lon,f(&field["earth_radius_km"]));
            if km>f(&rules["max_km"]) {continue;}
            let k=km.max(f(&field["min_km"]));
            let (dl,ds,_)=fin.land_sea(s.lon.unwrap(),s.lat.unwrap(),b.lon,b.lat,k,f(&field["samples"]) as usize);
            let e=round2(model.field_strength(freq,f(&field["time_percent"]),f(&d["heff_m"]),f(&rules["receiver_height_m"]),dl,ds,f(&d["erp_dbw"])));
            let excess=round2(f(&e)-f(&n["limit"]));
            ids.push(b.id.clone()); seen.insert(b.id.clone(),json!({"e":e,"excess":excess,"km":round2(k)}));
        }
        ids.sort_by(|a,b| a.parse::<f64>().unwrap_or(f64::NAN).partial_cmp(&b.parse::<f64>().unwrap_or(f64::NAN)).unwrap_or(std::cmp::Ordering::Equal));
        let over:Vec<_>=ids.iter().filter(|id| f(&seen[*id]["excess"])>0.).cloned().collect();
        let mut worst:Option<&String>=None;
        for id in &ids {if worst.map_or(true,|w| f(&seen[id]["excess"])>f(&seen[w]["excess"])) {worst=Some(id);}}
        let outcome=if ids.is_empty() {"no_station"} else if !over.is_empty() {"exposed"} else {"not_exposed"};
        increment(&mut how,outcome);
        let worst=worst.map(|w| json!({"station":w,"e":seen[w]["e"],"excess":seen[w]["excess"],"km":seen[w]["km"]}));
        notices.push(json!({"terrakey":key,"outcome":outcome,"checked":ids.len(),"over":over,"worst":worst}));
    }
    emit("tstations","done",json!({"notices":notices.len(),"how":how}));
    write_result(folder,"tstations",json!({"schema":"tstations/1","rulebook":stamp,"list":list,"file":intake["file"]["sha256"],"counts":{"notices":notices.len(),"how":how},"notices":notices}))
}
