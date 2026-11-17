#!/usr/bin/env node
'use strict';

/**
 * Adds missing B-tree indexes to partitioned dictionary SQLite databases
 * (dpd_synonyms, dpd, dpd_splitter, dpd_inflection, ptsped, abhidhan, palisinh, sanskrit).
 *
 * Without these indexes, every partition table (`saz`, `abz`, etc. up to ~47k rows)
 * falls back to full table scans (`SCAN TABLE`), adding 150-450ms per lookup.
 * With B-tree indexes (`SEARCH USING INDEX`), lookups drop to < 5-15ms.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_SPECS = [
  { file: 'dpd_synonyms_tipitakapali.db', columns: ['synonym', 'word'] },
  { file: 'dpd_tipitakapali.db', columns: ['word'] },
  { file: 'dpd_splitter_tipitakapali.db', columns: ['word'] },
  { file: 'dpd_inflection_tipitakapali.db', columns: ['word'] },
  { file: 'ptsped2015ed_tipitakapali.db', columns: ['word', 'synonyms'] },
  { file: 'abhidhan_tipitakapali.db', columns: ['word'] },
  { file: 'palisinh.db', columns: ['word'] },
  { file: 'ap_bh_mw_sanskrit.db', columns: ['word'] },
];

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function indexDatabase(dbPath, spec) {
  const t0 = process.hrtime.bigint();
  const db = new Database(dbPath);
  db.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -64000;
  `);

  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    )
    .all()
    .map((r) => r.name);

  const existingIndexes = new Set(
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index'`)
      .all()
      .map((r) => r.name)
  );

  let created = 0;

  const runTx = db.transaction(() => {
    for (const table of tables) {
      if (table === 'android_metadata') continue;

      const cols = new Set(
        db
          .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
          .all()
          .map((c) => c.name)
      );

      if (table === 'synonyms') {
        if (cols.has('synonym') && !existingIndexes.has('idx_synonyms_synonym')) {
          db.exec('CREATE INDEX IF NOT EXISTS "idx_synonyms_synonym" ON "synonyms"(synonym)');
          created++;
        }
        if (cols.has('word') && !existingIndexes.has('idx_synonyms_word')) {
          db.exec('CREATE INDEX IF NOT EXISTS "idx_synonyms_word" ON "synonyms"(word)');
          created++;
        }
        continue;
      }

      // Index lookup columns on every partition/lookup table
      const targetCols =
        spec.file === 'dpd_synonyms_tipitakapali.db'
          ? ['synonym', 'word']
          : ['word'];

      for (const col of targetCols) {
        if (!cols.has(col)) continue;
        const idxName = col === 'word' ? `idx_${table}_word` : `idx_${table}_${col}`;
        if (!existingIndexes.has(idxName)) {
          db.exec(
            `CREATE INDEX IF NOT EXISTS ${quoteIdent(idxName)} ON ${quoteIdent(table)}(${quoteIdent(col)})`
          );
          created++;
        }
      }
    }
  });

  runTx();
  if (created > 0) {
    db.exec('ANALYZE;');
  }
  db.close();
  const elapsedMs = (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0);
  return { file: path.basename(dbPath), tables: tables.length, created, elapsedMs };
}

function main() {
  const dbDirArg = process.argv[2];
  const dbDir = path.resolve(dbDirArg || path.join(__dirname, 'db'));

  if (!fs.existsSync(dbDir)) {
    console.error(`[index_dict_dbs] Directory not found: ${dbDir}`);
    process.exit(1);
  }

  for (const spec of DB_SPECS) {
    const dbPath = path.join(dbDir, spec.file);
    if (!fs.existsSync(dbPath)) {
      console.log(`[skip] ${spec.file} (not found in ${dbDir})`);
      continue;
    }
    const res = indexDatabase(dbPath, spec);
    console.log(
      `[done] ${res.file.padEnd(34)} tables=${String(res.tables).padStart(3)} created=${String(res.created).padStart(4)} (${res.elapsedMs}ms)`
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = { indexDatabase, DB_SPECS };
