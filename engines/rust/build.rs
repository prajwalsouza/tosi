// Record the compiler version so `info` can report the runtime it was built with.
fn main() {
    let v = std::process::Command::new(std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| s.split_whitespace().nth(1).map(str::to_string))
        .unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=TOSI_RUSTC={v}");
}
