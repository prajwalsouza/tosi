//! Shared terrestrial I/O, station joins, number conventions and path geometry.
use jetdb::{find_table, read_catalog, read_table_def, read_table_rows, PageReader, Value};
use serde_json::{json, Value as J};
use sha2::{Digest, Sha256};
use std::{collections::{BTreeSet, HashMap}, fs, path::{Path, PathBuf}};

pub fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..") }
pub fn sha(bytes: &[u8]) -> String { Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect() }
pub fn rulebook(stage: &str) -> Result<(J, J), String> {
    let bytes = fs::read(root().join(format!("spec/rulebook/{stage}.json"))).map_err(|e| e.to_string())?;
    let rules: J = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let stamp = json!({"version": rules["version"], "sha256": sha(&bytes), "cites": crate::space_common::cites_of(&rules)});
    Ok((rules, stamp))
}
pub fn table(name: &str) -> Result<(J, String), String> {
    let bytes = fs::read(root().join(format!("spec/tables/{name}.json"))).map_err(|e| e.to_string())?;
    Ok((serde_json::from_slice(&bytes).map_err(|e| e.to_string())?, sha(&bytes)))
}
pub fn read_json(folder: &str, name: &str) -> Result<J, String> {
    serde_json::from_slice(&fs::read(Path::new(folder).join(format!("{name}.json"))).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
pub fn need_terrestrial(folder: &str) -> Result<J, String> {
    let intake = read_json(folder, "intake")?;
    if intake["kind"] != "terrestrial" || intake["check"]["status"] != "accepted" { return Err("This stage needs an accepted terrestrial filing".into()); }
    Ok(intake)
}
pub fn write_result(folder: &str, name: &str, result: J) -> Result<String, String> {
    let out = result.to_string();
    fs::write(Path::new(folder).join(format!("{name}.json")), format!("{out}\n")).map_err(|e| e.to_string())?;
    Ok(out)
}
pub fn emit(step: &str, state: &str, fields: J) {
    let mut m = json!({"event":"step", "step":step, "state":state});
    if let Some(f) = fields.as_object() { m.as_object_mut().unwrap().extend(f.clone()); }
    eprintln!("{m}");
}
pub fn number(v: f64) -> J {
    if v == v.trunc() && v.abs() < 1e15 { json!(v as i64) } else { json!(v) }
}
pub fn rounded(v: f64, scale: f64) -> f64 { let x = (v * scale + 0.5).floor() / scale; if x == 0.0 { 0.0 } else { x } }
pub fn round2(v: f64) -> J { number(rounded(v, 100.0)) }
pub fn round3(v: f64) -> J { number(rounded(v, 1000.0)) }
pub fn f(v: &J) -> f64 { v.as_f64().unwrap_or(0.0) }
pub fn arr(v: &J) -> &[J] { v.as_array().map(Vec::as_slice).unwrap_or(&[]) }
pub fn counts(rules: &J, key: &str) -> J {
    J::Object(rules[key].as_object().unwrap().keys().map(|k| (k.clone(), json!(0))).collect())
}
pub fn increment(counts: &mut J, key: &str) { counts[key] = json!(counts[key].as_u64().unwrap_or(0) + 1); }
pub type Row = HashMap<String, Value>;
pub fn num(v: Option<&Value>) -> Option<f64> {
    let x = match v? { Value::Byte(x) => *x as f64, Value::Int(x) => *x as f64, Value::Long(x) => *x as f64, Value::BigInt(x) => *x as f64, Value::Float(x) => *x as f64, Value::Double(x) => *x, _ => return None };
    x.is_finite().then_some(x)
}
pub fn text(v: Option<&Value>) -> &str { match v { Some(Value::Text(s)) => s, _ => "" } }
pub fn id(r: &Row, k: &str) -> i64 { num(r.get(k)).unwrap_or(0.0) as i64 }
pub struct Db { reader: PageReader, step: String }
impl Db {
    pub fn open(folder: &str, step: &str) -> Result<Self, String> {
        Ok(Self { reader: PageReader::open(Path::new(folder).join("database.mdb")).map_err(|e| e.to_string())?, step: step.into() })
    }
    pub fn columns(&mut self, table: &str, want: &[&str]) -> Result<Vec<Row>, String> {
        let cat = read_catalog(&mut self.reader).map_err(|e| e.to_string())?;
        let Ok(entry) = find_table(&cat, table) else { return Ok(vec![]) };
        let def = read_table_def(&mut self.reader, &entry.name, entry.table_page).map_err(|e| e.to_string())?;
        let idx: Vec<_> = want.iter().filter_map(|w| def.columns.iter().position(|c| c.name == *w).map(|i| ((*w).to_string(), i))).collect();
        let res = read_table_rows(&mut self.reader, &def).map_err(|e| e.to_string())?;
        if res.skipped_rows > 0 { return Err(format!("{table}: {} rows could not be read", res.skipped_rows)); }
        emit(&self.step, "progress", json!({"table":table, "rows":res.rows.len()}));
        Ok(res.rows.into_iter().map(|row| idx.iter().map(|(k,i)| (k.clone(), row[*i].clone())).collect()).collect())
    }
    pub fn stations(&mut self) -> Result<Vec<Station>, String> {
        let geo: HashMap<_,_> = self.columns("fxm_geo", &["geo_key","geo_type","long_dec","lat_dec","radius"])?.into_iter().map(|r| (id(&r,"geo_key"),r)).collect();
        let mut out: Vec<_> = self.columns("fxm_terra", &["terrakey","adm","stn_cls","stage","intent","freq_assgn","bdwdth_cde","bdwdth","geo_key"])?.iter().map(|r| {
            let g = geo.get(&id(r,"geo_key"));
            Station { terrakey:id(r,"terrakey"), adm:text(r.get("adm")).trim().into(), cls:text(r.get("stn_cls")).trim().into(), stage:text(r.get("stage")).trim().into(), intent:text(r.get("intent")).trim().into(), freq:num(r.get("freq_assgn")), bw_khz:bandwidth_khz(text(r.get("bdwdth_cde")), num(r.get("bdwdth"))), lon:num(g.and_then(|g| g.get("long_dec"))), lat:num(g.and_then(|g| g.get("lat_dec"))), radius:num(g.and_then(|g| g.get("radius"))).unwrap_or(0.0) }
        }).collect();
        out.sort_by_key(|s| s.terrakey); Ok(out)
    }
}
pub struct Station { pub terrakey:i64, pub adm:String, pub cls:String, pub stage:String, pub intent:String, pub freq:Option<f64>, pub bw_khz:Option<f64>, pub lon:Option<f64>, pub lat:Option<f64>, pub radius:f64 }
pub fn station_map(db: &mut Db) -> Result<HashMap<i64, Station>, String> { Ok(db.stations()?.into_iter().map(|s| (s.terrakey,s)).collect()) }
pub fn bandwidth_khz(code: &str, fallback: Option<f64>) -> Option<f64> {
    let code = code.trim().to_uppercase();
    let a = code.bytes().take_while(u8::is_ascii_digit).count();
    if let Some(unit) = code.as_bytes().get(a) {
        let scale = match unit { b'H' => 1e-3, b'K' => 1.0, b'M' => 1e3, b'G' => 1e6, b'T' => 1e9, _ => return fallback };
        let b = code[a+1..].bytes().take_while(u8::is_ascii_digit).count();
        if a > 0 || b > 0 { return format!("{}.{}", if a == 0 {"0"} else {&code[..a]}, if b == 0 {"0"} else {&code[a+1..a+1+b]}).parse::<f64>().ok().map(|v| v*scale); }
    }
    fallback
}
const RAD:f64 = std::f64::consts::PI / 180.0;
pub fn distance_km(lat1:f64,lon1:f64,lat2:f64,lon2:f64,r:f64) -> f64 {
    let a = ((lat2-lat1)*RAD/2.0).sin().powi(2) + (lat1*RAD).cos()*(lat2*RAD).cos()*((lon2-lon1)*RAD/2.0).sin().powi(2);
    2.0*r*a.sqrt().asin()
}
struct Ring { pts:Vec<(f64,f64)>, bounds:[f64;4] }
impl Ring {
    fn new(pts:Vec<(f64,f64)>) -> Self {
        let mut bounds = [f64::INFINITY,f64::INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY];
        for &(x,y) in &pts { bounds[0]=bounds[0].min(x); bounds[1]=bounds[1].min(y); bounds[2]=bounds[2].max(x); bounds[3]=bounds[3].max(y); }
        Self {pts,bounds}
    }
    fn contains(&self,x:f64,y:f64) -> bool {
        if x<self.bounds[0] || x>self.bounds[2] || y<self.bounds[1] || y>self.bounds[3] { return false }
        let mut c = false;
        let mut j = self.pts.len()-1;
        for (i,&(xi,yi)) in self.pts.iter().enumerate() {
            let (xj,yj)=self.pts[j];
            if (yi>y)!=(yj>y) && x<(xj-xi)*(y-yi)/(yj-yi)+xi { c=!c; }
            j=i;
        }
        c
    }
}
pub struct Finland { pub border:Vec<(f64,f64,String)>, land:Vec<Ring>, outer:Ring, pub sha:String }
impl Finland {
    pub fn load() -> Result<Self,String> {
        let (fin,sha)=table("finland")?;
        let border:Vec<_>=arr(&fin["border"]).iter().map(|p| (f(&p[0]),f(&p[1]),p[2].as_str().unwrap_or("").into())).collect();
        let outer=Ring::new(border.iter().map(|p| (p.0,p.1)).collect());
        let land=arr(&fin["land"]).iter().map(|r| Ring::new(arr(r).iter().map(|p| (f(&p[0]),f(&p[1]))).collect())).collect();
        Ok(Self {border,land,outer,sha})
    }
    pub fn inside(&self,lon:f64,lat:f64)->bool { self.outer.contains(lon,lat) }
    pub fn nearest(&self,lon:f64,lat:f64,r:f64)->(usize,f64) {
        let mut best=(0,f64::INFINITY);
        for (i,p) in self.border.iter().enumerate() { let d=distance_km(lat,lon,p.1,p.0,r); if d<best.1 { best=(i,d); } }
        if self.inside(lon,lat) {best.1=0.0;} best
    }
    pub fn candidates(&self,lon:f64,lat:f64,n:usize,spread:f64,stride:usize,r:f64)->Vec<usize> {
        let d:Vec<_>=self.border.iter().map(|p| distance_km(lat,lon,p.1,p.0,r)).collect();
        let mut order:Vec<_>=(0..d.len()).collect();
        order.sort_by(|&a,&b| d[a].partial_cmp(&d[b]).unwrap().then(a.cmp(&b)));
        let mut pick:BTreeSet<_>=order.iter().take(n).copied().collect();
        for i in (0..d.len()).step_by(stride) { if d[i]<=d[order[0]]+spread {pick.insert(i);} }
        for kind in ["land","sea"] { if let Some(&i)=order.iter().find(|&&i| self.border[i].2==kind) {pick.insert(i);} }
        pick.into_iter().collect()
    }
    pub fn land_sea(&self,lon1:f64,lat1:f64,lon2:f64,lat2:f64,km:f64,samples:usize)->(f64,f64,f64) {
        let mut land=0;
        for k in 0..samples { let t=(k as f64+0.5)/samples as f64; let (lon,lat)=(lon1+(lon2-lon1)*t,lat1+(lat2-lat1)*t); if self.land.iter().fold(false,|c,r| c^r.contains(lon,lat)) {land+=1;} }
        (km*land as f64/samples as f64,km*(samples-land) as f64/samples as f64,land as f64/samples as f64)
    }
}
pub fn finnish_stations()->Result<(J,Vec<J>),String> {
    finnish_stations_from(&root().join("state/reference/stations.json"))
}
fn finnish_stations_from(path: &Path)->Result<(J,Vec<J>),String> {
    if !path.exists() {return Ok((json!({"present":false,"sha256":null,"stations":0}),vec![]));}
    let bytes=fs::read(path).map_err(|e| e.to_string())?;
    let list:J=serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let stations=arr(&list["stations"]).to_vec();
    Ok((json!({"present":true,"sha256":sha(&bytes),"stations":stations.len()}),stations))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_station_list_is_reported() {
        let (info, stations)=finnish_stations_from(&root().join("state/reference/absent-rust-test/stations.json")).unwrap();
        assert_eq!(info,json!({"present":false,"sha256":null,"stations":0}));
        assert!(stations.is_empty());
    }
    #[test]
    fn numeric_conventions() {
        assert_eq!(round2(-0.004).to_string(),"0");
        assert_eq!(round2(66.).to_string(),"66");
        assert_eq!(round2(-1.125).to_string(),"-1.12");
        assert_eq!(bandwidth_khz("16K8",None),Some(16.8));
        assert_eq!(bandwidth_khz("100H",None),Some(0.1));
        assert_eq!(bandwidth_khz("5M00",None),Some(5000.));
        assert_eq!(bandwidth_khz("missing",Some(25.)),Some(25.));
    }
}
