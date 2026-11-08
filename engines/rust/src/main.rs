//! Tosi engine, Rust. Commands print one JSON document on stdout; see dev/docs/modules.md.
use std::{env, fs, path::{Path, PathBuf}, process::exit};

mod intake;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn spec_version() -> Result<String, String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    fs::read_to_string(root.join("spec").join("VERSION")).map(|s| s.trim().to_string()).map_err(|e| format!("cannot read spec/VERSION: {e}"))
}

fn info() -> Result<String, String> {
    let runtime = format!("Rust {} ({}-{})", option_env!("TOSI_RUSTC").unwrap_or("compiled"), env::consts::ARCH, env::consts::OS);
    Ok(serde_json::json!({
        "schema": "engine-info/1", "engine": "rust", "language": "Rust", "version": VERSION,
        "runtime": runtime, "spec": spec_version()?, "stages": ["intake"]
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
        Some("intake") => {
            let file = arg(&args, "--file");
            let name = if args.iter().any(|a| a == "--name") { arg(&args, "--name") } else {
                Path::new(&file).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
            };
            intake::run(&file, &name, &arg(&args, "--out"))
        }
        other => {
            eprintln!("{}", serde_json::json!({ "error": "unknown command", "command": other, "known": ["info", "intake"] }));
            exit(2);
        }
    };
    match result {
        Ok(json) => println!("{json}"),
        Err(e) => { eprintln!("{}", serde_json::json!({ "error": e })); exit(1); }
    }
}
