#!/usr/bin/env node
"use strict";

/**
# Build if missing or outdated (default dir: server_api/db)
node server_api/rebuild_bold_db.js

# Force a full rebuild
node server_api/rebuild_bold_db.js --force

# Target a custom DB directory
node server_api/rebuild_bold_db.js --db-dir /path/to/db --force
**/

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { BoldLinkedEngine } = require("./boldLinkedEngine");

function parseArgs(argv) {
  let force = false;
  let dbDir = path.join(__dirname, "db");
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force" || arg === "-f") {
      force = true;
    } else if (arg === "--db-dir" && argv[i + 1]) {
      dbDir = path.resolve(argv[++i]);
    }
  }
  return { force, dbDir };
}

function main() {
  const { force, dbDir } = parseArgs(process.argv);
  const tipiDbPath = path.join(dbDir, "tipitaka.db");
  const paliSentDbPath = path.join(dbDir, "pali_sentences.db");

  if (!fs.existsSync(tipiDbPath)) {
    console.error(`Missing tipitaka.db at ${tipiDbPath}`);
    process.exit(1);
  }

  const tdb = new Database(tipiDbPath, { readonly: true });
  const pdb = fs.existsSync(paliSentDbPath)
    ? new Database(paliSentDbPath, { readonly: true })
    : null;

  try {
    const eng = new BoldLinkedEngine({
      dbDir,
      tipiDbPath,
      dbTipitaka: tdb,
      getPaliSentDb: () => pdb,
    });
    const dstPath = eng.getBoldDbPath();

    const t0 = Date.now();
    let bdb;
    if (force) {
      eng.buildBoldDb(dstPath);
      bdb = eng.ensureBoldDb();
    } else {
      bdb = eng.ensureBoldDb();
    }
    const elapsedMs = Date.now() - t0;

    const boldCount = bdb
      .prepare("SELECT COUNT(*) AS c FROM bold_definitions")
      .get().c;
    const linkCount = bdb
      .prepare("SELECT COUNT(*) AS c FROM chapter_links")
      .get().c;
    const schemaVer =
      bdb.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
        ?.value || "unknown";

    console.log(
      `Ready: ${dstPath} (schema_version=${schemaVer}, bold_definitions=${boldCount}, chapter_links=${linkCount}, ${elapsedMs} ms)`,
    );
  } finally {
    if (pdb) pdb.close();
    tdb.close();
  }
}

main();
