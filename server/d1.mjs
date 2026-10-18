/* The journal's database on a VPS: a D1 look-alike over a SQLite file (node:sqlite). The Worker's code (src/) runs
   its SQL as it does on Cloudflare: prepare → bind → first / all / run, and batch (in one transaction, as D1's). */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const plain = (r) => (r ? { ...r } : r);

export function openD1(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  const cache = new Map();
  const statement = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  // D1 takes null and numbers and strings; booleans as 1 / 0, undefined is refused there too
  const arg = (v) => (typeof v === 'boolean' ? Number(v) : v instanceof ArrayBuffer ? new Uint8Array(v) : v);
  const make = (sql, args) => ({
    sql, args,
    bind: (...a) => make(sql, a.map(arg)),
    async first(col) {
      const r = plain(statement(sql).get(...args));
      if (!r) return null;
      return col === undefined ? r : r[col] ?? null;
    },
    async all() {
      const results = statement(sql).all(...args).map(plain);
      return { success: true, results, meta: { rows_read: results.length } };
    },
    async raw() { return statement(sql).all(...args).map((r) => Object.values(r)); },
    async run() {
      const r = statement(sql).run(...args);
      return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    db,
    prepare: (sql) => make(sql, []),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
  };
}

/** statements of a .sql file: comments taken off, split at the semicolons that end a line */
export const statements = (sql) => sql.replace(/--[^\n]*/g, '').split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

/** a new database gets schema.sql; an older one the migrations it doesn't have yet (a column already there is
    skipped: the migrations only add tables and columns). Run at every start: it changes nothing the second time. */
export function migrate(d1, root) {
  for (const s of statements(readFileSync(join(root, 'schema.sql'), 'utf8'))) d1.db.exec(s);
  const dir = join(root, 'migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    for (const s of statements(readFileSync(join(dir, f), 'utf8'))) {
      try { d1.db.exec(s); } catch (e) { if (!/duplicate column name/i.test(String(e))) throw new Error(`${f}: ${e.message}`); }
    }
  }
}

/** the database as SQL that `wrangler d1 execute --file` takes (moving to Cloudflare): every table and index made if
    it isn't there (a deploy may have made them already), every row put in (replacing one with the same key). No
    transaction statements, which D1 refuses in a file. */
export function dumpSql(db) {
  const q = (v) => v === null || v === undefined ? 'NULL'
    : typeof v === 'number' || typeof v === 'bigint' ? String(v)
    : v instanceof Uint8Array ? `X'${Buffer.from(v).toString('hex')}'`
    : `'${String(v).replace(/'/g, "''")}'`;
  const id = (n) => `"${n.replace(/"/g, '""')}"`;
  const out = [];
  const objs = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type DESC, name").all();
  for (const o of objs.filter((o) => o.type === 'table')) {
    out.push(o.sql.replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS ') + ';');
    for (const r of db.prepare(`SELECT * FROM ${id(o.name)}`).all()) {
      const cols = Object.keys(r);
      out.push(`INSERT OR REPLACE INTO ${id(o.name)} (${cols.map(id).join(', ')}) VALUES (${cols.map((c) => q(r[c])).join(', ')});`);
    }
  }
  for (const o of objs.filter((o) => o.type === 'index')) out.push(o.sql.replace(/^CREATE (UNIQUE )?INDEX\s+(IF NOT EXISTS\s+)?/i, (m, u) => `CREATE ${u || ''}INDEX IF NOT EXISTS `) + ';');
  return out.join('\n') + '\n';
}
