//! ECC T/R 25-08 trigger level, channel-width correction and Finnish coordination.
use serde_json::{json,Value as J};
use std::collections::HashMap;
use crate::terra_common::*;
pub fn trigger_level(rules:&J,freq:f64,bw:Option<f64>)->Option<(f64,f64)> {
    let bands=arr(&rules["bands"]);
    let last=bands.last()?;
    let b=bands.iter().find(|b| freq>=f(&b["from_mhz"]) && (freq<f(&b["to_mhz"]) || (b["to_mhz"]==last["to_mhz"] && freq<=f(&b["to_mhz"]))))?;
    let bc=match bw {Some(w) if w>f(&rules["reference_khz"])=>10.*(w/f(&rules["reference_khz"])).log10(), _=>0.};
    Some((f(&b["dbuvm"])+bc,bc))
}
pub fn run(folder:&str)->Result<String,String> {
    let intake=need_terrestrial(folder)?;
    let prev=read_json(folder,"field")?;
    let (rules,stamp)=rulebook("threshold")?;
    emit("threshold","start",json!({}));
    let mut db=Db::open(folder,"threshold")?;
    let by=station_map(&mut db)?;
    let mut coord:HashMap<i64,Vec<String>>=HashMap::new();
    for c in db.columns("fxm_coord",&["terrakey","adm","coord_st"])? {if text(c.get("adm")).trim()=="FIN" {coord.entry(id(&c,"terrakey")).or_default().push(text(c.get("coord_st")).into());}}
    let mut how=counts(&rules,"outcomes");
    let mut notices=vec![];
    for n in arr(&prev["notices"]) {
        let key=n["terrakey"].as_i64().ok_or("Invalid terrakey")?;
        let s=by.get(&key).ok_or("Station missing from database")?;
        let (limit,bc)=trigger_level(&rules,s.freq.ok_or("Missing frequency")?,s.bw_khz).ok_or("No trigger band")?;
        let limit=round2(limit); let excess=round2(f(&n["e"])-f(&limit));
        let st=coord.get(&key).map(Vec::as_slice).unwrap_or(&[]);
        let coordinated=st.iter().any(|x| x.contains("COMPLETED")) && !st.iter().any(|x| x.contains("REQUIRED"));
        let outcome=if f(&excess)>0. {if coordinated {"over_coordinated"} else {"over"}} else if f(&excess)> -f(&rules["near_db"]) {"near"} else {"under"};
        increment(&mut how,outcome);
        notices.push(json!({"terrakey":key,"limit":limit,"bc":round2(bc),"excess":excess,"outcome":outcome,"coordinated":coordinated}));
    }
    emit("threshold","done",json!({"notices":notices.len(),"how":how}));
    write_result(folder,"threshold",json!({"schema":"threshold/1","rulebook":stamp,"file":intake["file"]["sha256"],"counts":{"notices":notices.len(),"how":how},"notices":notices}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn trigger_boundaries_and_wide_channel() {
        let (rules,_)=rulebook("threshold").unwrap();
        for (freq,want) in [(29.7,0.),(47.,6.),(108.,12.),(380.,18.),(400.,20.),(470.,20.),(4000.,20.)] {
            assert_eq!(trigger_level(&rules,freq,None),Some((want,0.)));
        }
        assert_eq!(trigger_level(&rules,4000.01,None),None);
        let (level,bc)=trigger_level(&rules,450.,Some(200.)).unwrap();
        assert_eq!(round2(level),json!(29.03));
        assert_eq!(round2(bc),json!(9.03));
    }
}
