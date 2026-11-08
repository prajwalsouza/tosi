// Stage 1, intake. See spec/stages/intake/README.md.
// Fingerprint the file, unpack it, read the database's catalogue, recognise the kind of filing,
// and check it has what the rules need. Progress goes to stderr as JSON lines; the result to stdout.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, openSync, readSync, closeSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createInflateRaw } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1 << 20;
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RULES_BYTES = readFileSync(join(root, "spec", "rulebook", "intake.json"));
const RULES = JSON.parse(RULES_BYTES.toString("utf8"));
const RULEBOOK = { version: RULES.version ?? 0, sha256: createHash("sha256").update(RULES_BYTES).digest("hex") };

type Table = { name: string; rows: number; columns: string[] };
type Entry = { name: string; bytes: number; packed: number; method: number; offset: number };
type Result = {
  schema: "intake/1";
  rulebook: { version: number; sha256: string };
  file: { name: string; bytes: number; sha256: string };
  archive: { entries: { name: string; bytes: number; packed: number }[] } | null;
  database: { name: string; bytes: number; sha256: string; rows: number; tables: Table[] } | null;
  kind: "space" | "terrestrial" | "unknown";
  check: { status: "accepted" | "refused"; missing: string[]; reason: string | null } | null;
};

function emit(step: string, state: string, fields: Record<string, unknown> = {}) {
  process.stderr.write(JSON.stringify({ event: "step", step, state, ...fields }) + "\n");
}

async function sha256Of(path: string, step: string): Promise<string> {
  const total = statSync(path).size;
  emit(step, "start", { total });
  const h = createHash("sha256");
  let done = 0, last = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: MiB })) {
    h.update(chunk as Buffer);
    done += (chunk as Buffer).length;
    if (done - last >= 16 * MiB || done === total) { emit(step, "progress", { done, total }); last = done; }
  }
  const digest = h.digest("hex");
  emit(step, "done", { sha256: digest });
  return digest;
}

// A minimal zip reader: find the end-of-central-directory record, then read the central directory.
function readZip(path: string): Entry[] | null {
  const size = statSync(path).size;
  if (size < 22) return null;
  const fd = openSync(path, "r");
  try {
    const tail = Math.min(size, 22 + 65535);
    const buf = Buffer.alloc(tail);
    readSync(fd, buf, 0, tail, size - tail);
    let eocd = -1;
    for (let i = tail - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return null;
    const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOffset = buf.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOffset);
    const entries: Entry[] = [];
    for (let p = 0, n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) return null;
      const method = cd.readUInt16LE(p + 10), packed = cd.readUInt32LE(p + 20), bytes = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      const offset = cd.readUInt32LE(p + 42);
      entries.push({ name: cd.toString("utf8", p + 46, p + 46 + nameLen), bytes, packed, method, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

async function extract(path: string, e: Entry, target: string) {
  const fd = openSync(path, "r");
  const head = Buffer.alloc(30);
  readSync(fd, head, 0, 30, e.offset);
  closeSync(fd);
  const start = e.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  let done = 0, last = 0;
  const count = new Transform({
    transform(chunk, _enc, cb) {
      done += chunk.length;
      if (done - last >= 32 * MiB || done === e.bytes) { emit("unpack", "progress", { done, total: e.bytes, entry: e.name }); last = done; }
      cb(null, chunk);
    },
  });
  const src = createReadStream(path, { start, end: start + e.packed - 1, highWaterMark: MiB });
  if (e.method === 8) await pipeline(src, createInflateRaw(), count, createWriteStream(target));
  else await pipeline(src, count, createWriteStream(target));
}

function refuse(r: Result, key: string, missing: string[] = []): Result {
  r.check = { status: "refused", missing, reason: RULES.reasons[key].replace("{missing}", missing.join(", ")) };
  return r;
}

function finish(r: Result, out: string): string {
  const text = JSON.stringify(r);
  writeFileSync(join(out, "intake.json"), text + "\n");
  return text;
}

// Byte order of the names, the same as Python's sorted(key=str.encode) and Rust's sort on bytes.
const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

export async function intake(file: string, name: string, out: string): Promise<string> {
  mkdirSync(out, { recursive: true });
  const r: Result = {
    schema: "intake/1",
    rulebook: RULEBOOK,
    file: { name, bytes: statSync(file).size, sha256: await sha256Of(file, "fingerprint") },
    archive: null, database: null, kind: "unknown", check: null,
  };

  emit("unpack", "start");
  const entries = readZip(file);
  if (!entries) { emit("unpack", "done", { refused: true }); return finish(refuse(r, "not_zip"), out); }
  r.archive = { entries: entries.map(({ name, bytes, packed }) => ({ name, bytes, packed })) };
  const mdb = entries.find((e) => e.name.toLowerCase().endsWith(".mdb"));
  if (!mdb) { emit("unpack", "done", { refused: true }); return finish(refuse(r, "no_database"), out); }
  const target = join(out, "database.mdb");
  emit("unpack", "progress", { done: 0, total: mdb.bytes, entry: mdb.name });
  await extract(file, mdb, target);
  emit("unpack", "done");

  const dbSha = await sha256Of(target, "database-fingerprint");
  emit("database", "start");
  let tables: Table[];
  try {
    const { default: MDBReader } = await import("mdb-reader");   // loaded only now, so fingerprinting starts at once
    const reader = new MDBReader(readFileSync(target));
    const names = reader.getTableNames().filter((n) => !n.startsWith("MSys")).sort(byBytes);
    emit("database", "progress", { done: 0, total: names.length });
    tables = names.map((n, i) => {
      const t = reader.getTable(n);
      emit("database", "progress", { done: i + 1, total: names.length, table: n, rows: t.rowCount });
      return { name: n, rows: t.rowCount, columns: t.getColumnNames() };
    });
  } catch {
    emit("database", "done", { refused: true });
    return finish(refuse(r, "unreadable"), out);
  }
  const rows = tables.reduce((a, t) => a + t.rows, 0);
  r.database = { name: mdb.name, bytes: statSync(target).size, sha256: dbSha, rows, tables };
  emit("database", "done", { tables: tables.length, rows });

  const present = new Map(tables.map((t) => [t.name, t.columns]));
  emit("recognise", "start");
  const kind = (Object.entries(RULES.kinds) as [string, { markers: string[] }][]).find(([, v]) => v.markers.every((m) => present.has(m)))?.[0] ?? "unknown";
  r.kind = kind as Result["kind"];
  emit("recognise", "done", { kind });

  emit("check", "start");
  if (kind === "unknown") { emit("check", "done", { status: "refused" }); return finish(refuse(r, "unknown_kind"), out); }
  const missing: string[] = [];
  for (const [table, entry] of Object.entries(RULES.kinds[kind].tables as Record<string, { read: boolean; columns?: string[] }>)) {
    if (!entry.read) continue;
    const cols = entry.columns ?? [];
    const have = present.get(table);
    if (!have) missing.push(table);
    else for (const c of cols) if (!have.includes(c)) missing.push(`${table}.${c}`);
  }
  if (missing.length) { emit("check", "done", { status: "refused" }); return finish(refuse(r, "missing", missing), out); }
  r.check = { status: "accepted", missing: [], reason: null };
  emit("check", "done", { status: "accepted" });
  return finish(r, out);
}
