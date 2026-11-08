//! Stage 1, intake. See spec/stages/intake/README.md.
//! Fingerprint the file, unpack it, read the database's catalogue, recognise the kind of filing,
//! and check it has what the rules need. Progress goes to stderr as JSON lines; the result to stdout.
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MIB: usize = 1 << 20;

#[derive(Serialize)]
struct FileInfo { name: String, bytes: u64, sha256: String }
#[derive(Serialize)]
struct ArchiveEntry { name: String, bytes: u64, packed: u64 }
#[derive(Serialize)]
struct Archive { entries: Vec<ArchiveEntry> }
#[derive(Serialize)]
struct Table { name: String, rows: u64, columns: Vec<String> }
#[derive(Serialize)]
struct Database { name: String, bytes: u64, sha256: String, rows: u64, tables: Vec<Table> }
#[derive(Serialize)]
struct Check { status: &'static str, missing: Vec<String>, reason: Option<String> }
#[derive(Serialize)]
struct Rulebook { version: u64, sha256: String }
#[derive(Serialize)]
struct Intake { schema: &'static str, rulebook: Rulebook, file: FileInfo, archive: Option<Archive>, database: Option<Database>, kind: String, check: Option<Check> }

fn emit(step: &str, state: &str, fields: Value) {
    let mut m = Map::new();
    m.insert("event".into(), json!("step"));
    m.insert("step".into(), json!(step));
    m.insert("state".into(), json!(state));
    if let Value::Object(f) = fields { m.extend(f); }
    eprintln!("{}", Value::Object(m));
}

fn rules() -> (Value, Rulebook) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let bytes = fs::read(root.join("spec/rulebook/intake.json")).expect("spec/rulebook/intake.json");
    let v: Value = serde_json::from_slice(&bytes).expect("rulebook is JSON");
    let sha: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    let version = v["version"].as_u64().unwrap_or(0);
    (v, Rulebook { version, sha256: sha })
}

fn sha256_of(path: &Path, step: &str) -> std::io::Result<String> {
    let total = fs::metadata(path)?.len();
    emit(step, "start", json!({ "total": total }));
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; MIB];
    let (mut done, mut last) = (0u64, 0u64);
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 { break; }
        h.update(&buf[..n]);
        done += n as u64;
        if done - last >= 16 * MIB as u64 || done == total { emit(step, "progress", json!({ "done": done, "total": total })); last = done; }
    }
    let digest: String = h.finalize().iter().map(|b| format!("{b:02x}")).collect();
    emit(step, "done", json!({ "sha256": digest }));
    Ok(digest)
}

fn refuse(r: &mut Intake, rules: &Value, key: &str, missing: Vec<String>) {
    let text = rules["reasons"][key].as_str().unwrap_or(key).replace("{missing}", &missing.join(", "));
    r.check = Some(Check { status: "refused", missing, reason: Some(text) });
}

fn finish(r: &Intake, out: &Path) -> Result<String, String> {
    let text = serde_json::to_string(r).map_err(|e| e.to_string())?;
    fs::write(out.join("intake.json"), format!("{text}\n")).map_err(|e| e.to_string())?;
    Ok(text)
}

fn catalogue(path: &Path) -> Result<Vec<Table>, String> {
    use jetdb::{find_table, read_catalog, read_table_def, table_names, PageReader};
    let mut reader = PageReader::open(path).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = table_names(&mut reader).map_err(|e| e.to_string())?.into_iter().filter(|n| !n.starts_with("MSys")).collect();
    names.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
    let cat = read_catalog(&mut reader).map_err(|e| e.to_string())?;
    emit("database", "progress", json!({ "done": 0, "total": names.len() }));
    let mut tables = Vec::with_capacity(names.len());
    for (i, n) in names.iter().enumerate() {
        let entry = find_table(&cat, n).map_err(|e| e.to_string())?;
        let def = read_table_def(&mut reader, &entry.name, entry.table_page).map_err(|e| e.to_string())?;
        emit("database", "progress", json!({ "done": i + 1, "total": names.len(), "table": n, "rows": def.num_rows }));
        tables.push(Table { name: n.clone(), rows: def.num_rows as u64, columns: def.columns.iter().map(|c| c.name.clone()).collect() });
    }
    Ok(tables)
}

pub fn run(file: &str, name: &str, out: &str) -> Result<String, String> {
    let (rules, rulebook) = rules();
    let (file, out) = (Path::new(file), Path::new(out));
    fs::create_dir_all(out).map_err(|e| e.to_string())?;
    let bytes = fs::metadata(file).map_err(|e| e.to_string())?.len();
    let sha = sha256_of(file, "fingerprint").map_err(|e| e.to_string())?;
    let mut r = Intake { schema: "intake/1", rulebook, file: FileInfo { name: name.into(), bytes, sha256: sha }, archive: None, database: None, kind: "unknown".into(), check: None };

    emit("unpack", "start", json!({}));
    let mut zip = match zip::ZipArchive::new(File::open(file).map_err(|e| e.to_string())?) {
        Ok(z) => z,
        Err(_) => { emit("unpack", "done", json!({ "refused": true })); refuse(&mut r, &rules, "not_zip", vec![]); return finish(&r, out); }
    };
    let mut entries = Vec::new();
    for i in 0..zip.len() {
        let e = zip.by_index_raw(i).map_err(|e| e.to_string())?;
        entries.push(ArchiveEntry { name: e.name().to_string(), bytes: e.size(), packed: e.compressed_size() });
    }
    let mdb = entries.iter().position(|e| e.name.to_lowercase().ends_with(".mdb"));
    r.archive = Some(Archive { entries });
    let Some(idx) = mdb else { emit("unpack", "done", json!({ "refused": true })); refuse(&mut r, &rules, "no_database", vec![]); return finish(&r, out); };
    let target = out.join("database.mdb");
    let (mdb_name, total) = { let a = r.archive.as_ref().unwrap(); (a.entries[idx].name.clone(), a.entries[idx].bytes) };
    let cap = std::env::var("TOSI_MAX_DATABASE_BYTES").ok().and_then(|v| v.parse::<u64>().ok());
    if cap.is_some_and(|max| total > max) {
        return Err("Uncompressed database exceeds the hosted size limit".into());
    }
    emit("unpack", "progress", json!({ "done": 0, "total": total, "entry": mdb_name }));
    {
        let mut src = zip.by_index(idx).map_err(|e| e.to_string())?;
        let mut dst = File::create(&target).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; MIB];
        let (mut done, mut last) = (0u64, 0u64);
        loop {
            let n = src.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            done += n as u64;
            if cap.is_some_and(|max| done > max) {
                drop(dst);
                let _ = fs::remove_file(&target);
                return Err("Uncompressed database exceeds the hosted size limit".into());
            }
            dst.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            if done - last >= 32 * MIB as u64 || done == total { emit("unpack", "progress", json!({ "done": done, "total": total, "entry": mdb_name })); last = done; }
        }
    }
    emit("unpack", "done", json!({}));

    let db_sha = sha256_of(&target, "database-fingerprint").map_err(|e| e.to_string())?;
    emit("database", "start", json!({}));
    let tables = match catalogue(&target) {
        Ok(t) => t,
        Err(_) => { emit("database", "done", json!({ "refused": true })); refuse(&mut r, &rules, "unreadable", vec![]); return finish(&r, out); }
    };
    let rows: u64 = tables.iter().map(|t| t.rows).sum();
    let db_bytes = fs::metadata(&target).map_err(|e| e.to_string())?.len();
    emit("database", "done", json!({ "tables": tables.len(), "rows": rows }));

    emit("recognise", "start", json!({}));
    let present = |t: &str| tables.iter().find(|x| x.name == t);
    let kinds = rules["kinds"].as_object().cloned().unwrap_or_default();
    let kind = kinds.iter()
        .find(|(_, v)| v["markers"].as_array().map(|m| m.iter().all(|t| present(t.as_str().unwrap_or("")).is_some())).unwrap_or(false))
        .map(|(k, _)| k.clone()).unwrap_or_else(|| "unknown".into());
    emit("recognise", "done", json!({ "kind": kind }));

    emit("check", "start", json!({}));
    let mut missing = Vec::new();
    if kind != "unknown" {
        for (table, entry) in kinds[&kind]["tables"].as_object().cloned().unwrap_or_default() {
            if !entry["read"].as_bool().unwrap_or(false) { continue; }
            let cols = entry["columns"].clone();
            match present(&table) {
                None => missing.push(table.clone()),
                Some(t) => for c in cols.as_array().cloned().unwrap_or_default() {
                    let c = c.as_str().unwrap_or("");
                    if !t.columns.iter().any(|x| x == c) { missing.push(format!("{table}.{c}")); }
                },
            }
        }
    }
    r.database = Some(Database { name: mdb_name, bytes: db_bytes, sha256: db_sha, rows, tables });
    r.kind = kind.clone();
    if kind == "unknown" { emit("check", "done", json!({ "status": "refused" })); refuse(&mut r, &rules, "unknown_kind", vec![]); return finish(&r, out); }
    if !missing.is_empty() { emit("check", "done", json!({ "status": "refused" })); refuse(&mut r, &rules, "missing", missing); return finish(&r, out); }
    r.check = Some(Check { status: "accepted", missing: vec![], reason: None });
    emit("check", "done", json!({ "status": "accepted" }));
    finish(&r, out)
}
