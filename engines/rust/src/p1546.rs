//! ITU-R P.1546-6 without terrain: reference steps 6–11, 14 and 19.
//! Arithmetic and curve selection follow engines/ts/src/p1546.ts in order.
use serde::Deserialize;
use crate::terra_common::table;

const DIST: &[f64] = &[1.,2.,3.,4.,5.,6.,7.,8.,9.,10.,11.,12.,13.,14.,15.,16.,17.,18.,19.,20.,25.,30.,35.,40.,45.,50.,55.,60.,65.,70.,75.,80.,85.,90.,95.,100.,110.,120.,130.,140.,150.,160.,170.,180.,190.,200.,225.,250.,275.,300.,325.,350.,375.,400.,425.,450.,475.,500.,525.,550.,575.,600.,625.,650.,675.,700.,725.,750.,775.,800.,825.,850.,875.,900.,925.,950.,975.,1000.];
const HEIGHTS: &[f64] = &[10.,20.,37.5,75.,150.,300.,600.,1200.];
const FREQS: &[f64] = &[100.,600.,2000.];
const TIMES: &[f64] = &[1.,10.,50.];
#[derive(Deserialize)]
struct Row { d:f64, e:Vec<f64> }
#[derive(Deserialize)]
struct Curve { time:f64, path:String, f_mhz:f64, h1:Vec<f64>, rows:Vec<Row> }
pub struct P1546 { curves:Vec<Curve>, pub sha:String }
fn closest(x:&[f64],v:f64)->(f64,f64) {
    if x[x.len()-1]<v {return (x[x.len()-2],x[x.len()-1]);}
    if x[0]>v {return (x[0],x[1]);}
    for (i,&a) in x.iter().enumerate() {if a==v {return (v,v);} if a>v {return (x[i-1],a);}}
    (x[x.len()-2],x[x.len()-1])
}
pub fn emax(t:f64,dland:f64,dsea:f64)->f64 {
    let d=dland+dsea;
    let efs=106.9-20.*d.log10();
    let ese=2.38*(1.-(-d/8.94).exp())*(50./t).log10();
    efs+dsea*ese/d
}
fn d06(f:f64,h1:f64,h2:f64)->f64 {
    let h1=h1.max(0.);
    let df=0.0000389*f*h1*h2;
    let dh=4.1*(h1.sqrt()+h2.sqrt());
    (df*dh/(df+dh)).max(0.001)
}
fn qi(x:f64)->f64 {
    let t=|y:f64| (-2.*y.ln()).sqrt();
    let c=|z:f64| {let t=t(z); ((0.010328*t+0.802853)*t+2.515517)/(((0.001308*t+0.189269)*t+1.432788)*t+1.)};
    if x<=0.5 {t(x)-c(x)} else {-(t(1.-x)-c(1.-x))}
}
fn v(fnom:f64,h1:f64)->f64 {
    let k=if fnom==100. {1.35} else if fnom==600. {3.31} else {6.};
    k*((-h1/9000.).atan()*180./std::f64::consts::PI)
}
fn j_of(nu:f64)->f64 {if nu> -0.7806 {6.9+20.*(((nu-0.1).powi(2)+1.).sqrt()+nu-0.1).log10()} else {0.}}
fn at_height(c:&Curve,h:f64,di:f64,ds:f64,d:f64)->f64 {
    let k=c.h1.iter().position(|&x| x==h).unwrap();
    let ei=c.rows.iter().find(|r| r.d==di).unwrap().e[k];
    let es=c.rows.iter().find(|r| r.d==ds).unwrap().e[k];
    if ds!=di {ei+(es-ei)*(d/di).log10()/(ds/di).log10()} else {es}
}
fn step81(c:&Curve,h1:f64,di:f64,ds:f64,d:f64,em:f64)->f64 {
    let (hi,hs)=closest(HEIGHTS,h1);
    let e=if hi!=hs {at_height(c,hi,di,ds,d)+(at_height(c,hs,di,ds,d)-at_height(c,hi,di,ds,d))*(h1/hi).log10()/(hs/hi).log10()} else {at_height(c,hs,di,ds,d)};
    e.min(em)
}
#[allow(clippy::too_many_arguments)]
fn step82(c:&Curve,h1:f64,di:f64,ds:f64,d:f64,sea:bool,fnom:f64,em:f64,t:f64)->f64 {
    let e10=at_height(c,10.,di,ds,d); let e20=at_height(c,20.,di,ds,d);
    let ch=6.03-j_of(v(fnom,-10.));
    let ezero=e10+0.5*(e10-e20+ch);
    if !sea {return if h1>=0. {ezero+0.1*h1*(e10-ezero)} else {ezero+6.03-j_of(v(fnom,h1))};}
    let dh1=d06(fnom,h1,10.); let d20=d06(fnom,20.,10.);
    if d<=dh1 {return em;}
    if d<d20 {
        let (a,b)=closest(DIST,d20);
        let e10d=at_height(c,10.,a,b,d20); let e20d=at_height(c,20.,a,b,d20);
        let ed20=e10d+(e20d-e10d)*(h1/10.).log10()/2_f64.log10();
        let edh1=emax(t,0.,dh1);
        return edh1+(ed20-edh1)*(d/dh1).log10()/(d20/dh1).log10();
    }
    // The ITU reference intentionally uses ln(2), not log10(2), here.
    let e1=e10+(e20-e10)*(h1/10.).log10()/2_f64.ln();
    let e2=ezero+0.1*h1*(e10-ezero);
    let fs=(d-d20)/d;
    e1*(1.-fs)+e2*fs
}
#[allow(clippy::too_many_arguments)]
fn step7(curves:&[&Curve],h1:f64,di:f64,ds:f64,d:f64,sea:bool,f:f64,em:f64,t:f64)->f64 {
    let (fi,fs)=closest(FREQS,f);
    let at=|freq| {let c=curves.iter().find(|c| c.f_mhz==freq).unwrap(); if h1>=10. {step81(c,h1,di,ds,d,em).min(em)} else {step82(c,h1,di,ds,d,sea,freq,em,t)}};
    if fi==fs {return at(fs);}
    let mut e=at(fi)+(at(fs)-at(fi))*(f/fi).log10()/(fs/fi).log10();
    if f>2000. {e=e.min(em);} e
}
impl P1546 {
    pub fn load()->Result<Self,String> {
        let (data,sha)=table("p1546")?;
        Ok(Self {curves:serde_json::from_value(data["curves"].clone()).map_err(|e| e.to_string())?,sha})
    }
    #[allow(clippy::too_many_arguments)]
    fn step6to10(&self,kind:&str,h1:f64,di:f64,ds:f64,d:f64,f:f64,em:f64,t:f64)->f64 {
        let sea=kind!="land";
        let (ti,ts)=closest(TIMES,t);
        let at=|tn| {
            let set:Vec<_>=self.curves.iter().filter(|c| (if sea {c.path!="land"} else {c.path=="land"}) && c.time==tn && (!(kind=="warm" && tn!=50.) || c.path=="warm_sea")).collect();
            let df=d06(f,h1,10.); let d600=d06(600.,h1,10.);
            if sea && f<100. && d<d600 {
                if d<=df {return emax(t,0.,d);}
                let edf=emax(t,0.,df);
                let (a,b)=closest(DIST,d600);
                let ed600=step7(&set,h1,a,b,d600,sea,f,em,t);
                return edf+(ed600-edf)*(d/df).log10()/(d600/df).log10();
            }
            step7(&set,h1,di,ds,d,sea,f,em,t)
        };
        if ti==ts {return at(ts);}
        let qs=qi(ts/100.); let qn=qi(ti/100.); let qt=qi(t/100.);
        at(ts)*(qn-qt)/(qn-qs)+at(ti)*(qt-qs)/(qn-qs)
    }
    /// Field strength after step 11, for comparison with ITU validation logs.
    #[allow(clippy::too_many_arguments)]
    pub fn e11(&self,f:f64,t:f64,h1:f64,dland:f64,dsea:f64,sea:&str,em:f64)->f64 {
        let d=dland+dsea;
        let (di,ds)=if d<1. {(1.,1.)} else {closest(DIST,d)};
        let dd=d.max(1.);
        let el=if dland>0. {self.step6to10("land",h1,di,ds,dd,f,em,t)} else {0.};
        let es=if dsea>0. {self.step6to10(sea,h1.max(3.),di,ds,dd,f,em,t)} else {0.};
        if dsea==0. {return el;} if dland==0. {return es;}
        let fsea=dsea/d; let delta=es-el;
        let a=(1.-(1.-fsea).powf(2./3.)).powf((1.+delta/40.).max(1.));
        (1.-a)*el+a*es
    }
    #[allow(clippy::too_many_arguments)]
    pub fn field_strength(&self,f:f64,t:f64,h1:f64,h2:f64,dland:f64,dsea:f64,erp:f64)->f64 {
        let d=dland+dsea;
        let h1=(if dsea>0. && dland==0. {h1.max(3.)} else {h1}).min(3000.);
        let em=emax(t,dland,dsea);
        let mut e=self.e11(f,t,h1,dland,dsea,"cold",em);
        e+=step14(h1,d.max(1.),h2,f,"rural");
        if e>em {e=em;} e+erp-30.
    }
}
fn step14(h1:f64,d:f64,h2:f64,f:f64,area:&str)->f64 {
    let k=3.2+6.2*f.log10();
    if area=="rural" || h2>=10. {return k*(h2/10.).log10();}
    let d10=d06(f,h1,10.); let dh2=d06(f,h1,h2); let c10=k*(h2/10.).log10();
    if d>=d10 {c10} else if d<=dh2 {0.} else {c10*(d/dh2).log10()/(d10/dh2).log10()}
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Fixed outputs from the TypeScript reference, covering exact curves and
    /// distance/height/frequency/time interpolation, low heights and mixed paths.
    #[test]
    fn reference_examples() {
        let model=P1546::load().unwrap();
        let cases=[
            (100.,50.,10.,100.,0.,"cold",66.9,10.3885),
            (600.,10.,75.,40.,60.,"cold",67.89811532075588,25.667201368844452),
            (2000.,1.,1200.,0.,1000.,"warm",50.94354861031973,24.3572),
            (50.,5.,3.,0.,0.5,"cold",113.05005566283975,93.60982762923985),
            (450.,25.,-10.,80.,0.,"cold",68.83820026016113,11.150108166802086),
            (3000.,2.,2500.,70.,30.,"cold",67.89811532075588,60.06629368481315),
            (80.,10.,5.,0.,2.,"cold",101.21286829744483,85.69346315704064),
            (150.,10.,3.,100.,0.,"cold",66.9,18.782545453397123),
            (100.,1.,1.,20.,80.,"warm",70.1347940165536,33.168074143231365),
            (30.,40.,5.,0.,1.,"cold",106.92440872403216,88.27012980654229),
            (2000.,50.,37.5,10.,0.,"cold",86.9,60.4064),
            (600.,10.,20.,0.,20.,"cold",82.36534194440661,65.5989),
        ];
        for (f,t,h,dl,ds,sea,em,want) in cases {
            assert!((emax(t,dl,ds)-em).abs()<1e-10);
            let got=model.e11(f,t,h,dl,ds,sea,em);
            assert!((got-want).abs()<1e-10,"f={f}, t={t}, h={h}, land={dl}, sea={ds}: want {want}, got {got}");
        }
    }
    /// TOSI_P1546_VALIDATION=/path/to/validation_results cargo test p1546::tests::itu_logs -- --ignored --nocapture
    /// Replays the same *_log.csv inputs and 0.1 dB tolerance as compare/p1546_check.ts.
    #[test]
    #[ignore = "requires external ITU validation CSVs; set TOSI_P1546_VALIDATION"]
    fn itu_logs() {
        let dir=std::env::var("TOSI_P1546_VALIDATION").expect("Set TOSI_P1546_VALIDATION");
        let mut files:Vec<_>=std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().path()).filter(|p| p.to_string_lossy().ends_with("_log.csv")).collect();
        files.sort(); let model=P1546::load().unwrap(); let mut n=0;
        for file in files {
            let text=std::fs::read_to_string(&file).unwrap();
            let rows:Vec<Vec<_>>=text.lines().map(|l| l.split(',').collect()).collect();
            let get=|k:&str| rows.iter().find(|r| r[0].starts_with(k));
            let num=|k:&str| get(k).and_then(|r| r.get(3)).and_then(|v| v.parse::<f64>().ok()).unwrap_or(f64::NAN);
            let want=num("Field strength (dBuV/m)"); if !want.is_finite() {continue;}
            let sea=if get("Sea path").and_then(|r| r.get(1)).map(|v| v.to_lowercase())==Some("warm".into()) {"warm"} else {"cold"};
            let got=model.e11(num("Frequency f"),num("Percentage time"),num("Tx antenna height h1"),num("Land path"),num("Sea path"),sea,num("Maximum field strength Emax"));
            assert!((got-want).abs()<=0.1,"{}: want {want}, got {got}",file.display()); n+=1;
        }
        assert!(n>0,"No ITU examples found"); eprintln!("{n} ITU examples match within 0.1 dB at step 11");
    }
}
