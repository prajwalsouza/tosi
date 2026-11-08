//! Tosi engine, Rust. Commands print one JSON document on stdout; see dev/docs/modules.md.
use std::{env, fs, path::{Path, PathBuf}, process::exit};

mod downlink;
mod intake;
mod reach;
mod space_common;
mod limit;
mod data;
mod power;
mod compare;
mod stations;
mod terra_common;
mod p1546;
mod mobile;
mod range;
mod tdata;
mod field;
mod threshold;
mod tstations;
mod ladder;
mod report;
mod tladder;
mod treport;
mod report_common;
mod m4;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn spec_version() -> Result<String, String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    fs::read_to_string(root.join("spec").join("VERSION")).map(|s| s.trim().to_string()).map_err(|e| format!("cannot read spec/VERSION: {e}"))
}

fn info() -> Result<String, String> {
    let runtime = format!("Rust {} ({}-{})", option_env!("TOSI_RUSTC").unwrap_or("compiled"), env::consts::ARCH, env::consts::OS);
    Ok(serde_json::json!({
        "schema": "engine-info/1", "engine": "rust", "language": "Rust", "version": VERSION,
        "runtime": runtime, "spec": spec_version()?, "stages": ["intake", "downlink", "reach", "limit", "data", "power", "compare", "stations", "mobile", "range", "tdata", "field", "threshold", "tstations", "ladder", "report", "tladder", "treport"]
    }).to_string())
}

/// The value after `name` on the command line; exits with code 2 if it is missing.
fn arg(args: &[String], name: &str) -> String {
    match args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)) {
        Some(v) => v.clone(),
        None => { eprintln!("{}", serde_json::json!({ "error": format!("missing {name}") })); exit(2) }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let result = match args.get(1).map(String::as_str) {
        Some("info") => info(),
        Some("downlink") => downlink::run(&arg(&args, "--in")),
        Some("reach") => reach::run(&arg(&args, "--in")),
        Some("limit") => limit::run(&arg(&args, "--in")),
        Some("data") => data::run(&arg(&args, "--in")),
        Some("power") => power::run(&arg(&args, "--in")),
        Some("compare") => compare::run(&arg(&args, "--in")),
        Some("stations") => stations::run(&arg(&args, "--in")),
        Some("mobile") => mobile::run(&arg(&args, "--in")),
        Some("range") => range::run(&arg(&args, "--in")),
        Some("tdata") => tdata::run(&arg(&args, "--in")),
        Some("field") => field::run(&arg(&args, "--in")),
        Some("threshold") => threshold::run(&arg(&args, "--in")),
        Some("tstations") => tstations::run(&arg(&args, "--in")),
        Some("ladder") => ladder::run(&arg(&args, "--in")),
        Some("report") => report::run(&arg(&args, "--in")),
        Some("tladder") => tladder::run(&arg(&args, "--in")),
        Some("treport") => treport::run(&arg(&args, "--in")),
        Some("intake") => {
            let file = arg(&args, "--file");
            let name = if args.iter().any(|a| a == "--name") { arg(&args, "--name") } else {
                Path::new(&file).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
            };
            intake::run(&file, &name, &arg(&args, "--out"))
        }
        other => {
            eprintln!("{}", serde_json::json!({ "error": "unknown command", "command": other, "known": ["info", "intake", "downlink", "reach", "limit", "data", "power", "compare", "stations", "mobile", "range", "tdata", "field", "threshold", "tstations", "ladder", "report", "tladder", "treport"] }));
            exit(2);
        }
    };
    match result {
        Ok(json) => println!("{json}"),
        Err(e) => { eprintln!("{}", serde_json::json!({ "error": e })); exit(1); }
    }
}
