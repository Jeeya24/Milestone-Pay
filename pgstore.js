// Postgres persistence for the in-memory store (see db.js). Knows nothing about the app: it stores rows as
// { rid, project_id, data jsonb } per collection table and applies diffs in one transaction.
// Methods live on one object so tests can swap a method (e.g. flush) without touching db.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(HERE, 'migrations');
const IDENT = /^[a-z_][a-z0-9_]*$/;

let pool = null;
let schema = 'public';

function ident(name) {
  if (!IDENT.test(name)) throw new Error(`pgstore: bad identifier ${name}`);
  return `"${name}"`;
}

const pgstore = {
  async connect({ url, schema: s = 'public' }) {
    ident(s);
    if (pool) await pool.end();
    const host = new URL(url).hostname;
    const local = host === 'localhost' || host === '127.0.0.1';
    schema = s;
    pool = new pg.Pool({
      connectionString: url,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 5,
      options: `-c search_path=${s}`,
    });
    pool.on('error', (e) => console.error('pg pool error:', e.message));
    await pgstore.migrate();
  },

  async migrate() {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(4242)');
      await c.query(`CREATE SCHEMA IF NOT EXISTS ${ident(schema)}`);
      await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
      const done = new Set((await c.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
      for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
        if (done.has(f)) continue;
        await c.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  },

  /** -> { [coll]: [{ rid, data }] } in insertion order. */
  async loadAll(collections) {
    const out = {};
    for (const coll of collections) {
      const r = await pool.query(`SELECT rid, data FROM ${ident(coll)} ORDER BY seq`);
      out[coll] = r.rows;
    }
    return out;
  },

  /** Apply upserts and deletes atomically. */
  async flush({ upserts = [], deletes = [] }) {
    if (!upserts.length && !deletes.length) return;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const u of upserts) {
        await c.query(
          `INSERT INTO ${ident(u.coll)} (rid, project_id, data) VALUES ($1, $2, $3)
           ON CONFLICT (rid) DO UPDATE SET project_id = EXCLUDED.project_id, data = EXCLUDED.data, updated_at = now()`,
          [u.rid, u.project_id ?? null, JSON.stringify(u.data)],
        );
      }
      for (const d of deletes) await c.query(`DELETE FROM ${ident(d.coll)} WHERE rid = $1`, [d.rid]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  },

  async ping() {
    await pool.query('SELECT 1');
  },

  async count(coll) {
    return Number((await pool.query(`SELECT count(*)::int AS n FROM ${ident(coll)}`)).rows[0].n);
  },

  /** Tests only. */
  async dropSchema(s) {
    if (!/^mp_test_/.test(s)) throw new Error('pgstore: refusing to drop a non-test schema');
    await pool.query(`DROP SCHEMA IF EXISTS ${ident(s)} CASCADE`);
  },

  async close() {
    if (pool) await pool.end();
    pool = null;
  },
};

export default pgstore;
