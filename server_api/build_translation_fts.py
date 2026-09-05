#!/usr/bin/env python3
"""
================================================================================
build_translation_fts.py - SQLite FTS5 Builder for Translation Databases
================================================================================

Builds high-performance `paragraphs_fts` SQLite FTS5 virtual tables for all
translated Tipiṭaka corpora:
  - Source DBs: server_api/db/translation_<lang>.db
  - Destination: server_api/db/fts_translation_<lang>.db
  - Schema matches fts_tipitaka.db:
      (book_code, book_title, nikaya, para_num, para_index UNINDEXED, para_rend, content, prefix = 3)
  - Copies translation_meta table for direct language information
  - Sanitizes HTML/XML tags, collapses whitespace, preserves Unicode diacritics
  - B-tree optimization ('optimize') & VACUUM for maximum query speed.

Usage:
  python3 build_translation_fts.py                # Build all 15 translation DBs
  python3 build_translation_fts.py --lang en      # Build specific language
  python3 build_translation_fts.py --force        # Overwrite existing FTS DBs
================================================================================
"""

import argparse
import glob
import os
import re
import sqlite3
import sys
import time
import unicodedata

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DB_DIR = os.path.join(SCRIPT_DIR, "db")
TIPITAKA_DB = os.path.join(DB_DIR, "tipitaka.db")
FTS_TIPITAKA_DB = os.path.join(DB_DIR, "fts_tipitaka.db")

ALL_LANGS = [
    "de", "en", "hi", "ja", "km", "lo", "my", "my_nissaya",
    "pt", "ru", "si", "ta", "th", "vi", "zh"
]


def clean_translation_text(raw_text: str) -> str:
    """
    Sanitizes paragraph translation text for FTS5 full-text indexing:
      - Normalizes Unicode to NFC (composed forms)
      - Strips HTML / XML tags (e.g. <i>, </i>, <b>, <span>, <pb.../>)
      - Preserves Unicode diacritics and text
      - Strips zero-width spaces and BOMs (preserves ZWJ/ZWNJ for Indic scripts)
      - Collapses multiple whitespace characters.
    """
    if not raw_text:
        return ""
    # Normalize Unicode to NFC
    text = unicodedata.normalize("NFC", raw_text)
    # Strip HTML / XML markup
    text = re.sub(r"<[^>]+>", " ", text)
    # Strip zero-width space \u200B and byte order mark \uFEFF and non-breaking space \u00A0
    text = re.sub(r"[\u200B\uFEFF\u00A0]", " ", text)
    # Collapse whitespace
    return re.sub(r"\s+", " ", text).strip()


def load_metadata_maps(db_dir: str):
    """
    Loads book metadata (title, nikaya) from tipitaka.db
    and paragraph rendering tags from fts_tipitaka.db.
    """
    books_meta = {}
    tipitaka_path = os.path.join(db_dir, "tipitaka.db")
    if os.path.exists(tipitaka_path):
        conn = sqlite3.connect(tipitaka_path)
        for code, title, nikaya in conn.execute("SELECT code, title, nikaya FROM books;").fetchall():
            books_meta[code] = (title, nikaya)
        conn.close()

    rend_map = {}
    fts_tipitaka_path = os.path.join(db_dir, "fts_tipitaka.db")
    if os.path.exists(fts_tipitaka_path):
        try:
            conn = sqlite3.connect(fts_tipitaka_path)
            for bcode, pidx, prend in conn.execute("SELECT book_code, para_index, para_rend FROM paragraphs_fts;").fetchall():
                rend_map[(bcode, pidx)] = prend
            conn.close()
        except Exception as e:
            print(f"[*] Warning: Could not load rend_map from fts_tipitaka.db: {e}")

    return books_meta, rend_map


def build_fts_for_lang(lang_code: str, db_dir: str, books_meta: dict, rend_map: dict, force: bool = False):
    """
    Builds fts_translation_<lang_code>.db from translation_<lang_code>.db.
    """
    src_db = os.path.join(db_dir, f"translation_{lang_code}.db")
    dst_db = os.path.join(db_dir, f"fts_translation_{lang_code}.db")

    if not os.path.exists(src_db):
        print(f"[!] Source DB not found: {src_db}, skipping.")
        return False

    if os.path.exists(dst_db) and not force:
        print(f"[*] FTS DB already exists: {dst_db} (use --force to overwrite), skipping.")
        return True

    print(f"\n{'='*70}")
    print(f"[*] Indexing translation FTS: {lang_code.upper()} -> {os.path.basename(dst_db)}")
    print(f"{'='*70}")

    tmp_dst_db = dst_db + ".tmp"
    if os.path.exists(tmp_dst_db):
        os.remove(tmp_dst_db)

    t_start = time.time()

    # 1. Connect to source DB and read translations + metadata
    print(f"  [1] Reading paragraphs from {os.path.basename(src_db)}...")
    src_conn = sqlite3.connect(src_db)
    src_cur = src_conn.cursor()

    # Read translation_meta if present
    meta_rows = []
    try:
        meta_rows = src_cur.execute("SELECT key, value FROM translation_meta;").fetchall()
    except Exception:
        pass

    rows = src_cur.execute("""
        SELECT book_code, para_index, para_num, translation 
        FROM paragraph_translations 
        WHERE translation IS NOT NULL AND length(trim(translation)) > 0
        ORDER BY book_code, para_index;
    """).fetchall()
    src_conn.close()

    total_rows = len(rows)
    print(f"  [1] Loaded {total_rows:,} translation paragraphs ({time.time() - t_start:.2f}s).")

    # 2. Setup destination FTS5 database
    print(f"  [2] Initializing FTS5 virtual table in {os.path.basename(dst_db)}...")
    dst_conn = sqlite3.connect(tmp_dst_db)
    dst_conn.execute("PRAGMA journal_mode = WAL;")
    dst_conn.execute("PRAGMA synchronous = OFF;")
    dst_conn.execute("PRAGMA cache_size = -64000;")  # 64 MB memory cache
    dst_cur = dst_conn.cursor()

    # Create translation_meta table
    dst_cur.execute("CREATE TABLE IF NOT EXISTS translation_meta (key TEXT PRIMARY KEY, value TEXT);")
    if meta_rows:
        dst_cur.executemany("INSERT OR REPLACE INTO translation_meta (key, value) VALUES (?, ?);", meta_rows)
    dst_cur.execute("INSERT OR REPLACE INTO translation_meta (key, value) VALUES ('fts_built_at', datetime('now'));")
    dst_cur.execute("INSERT OR REPLACE INTO translation_meta (key, value) VALUES ('fts_indexed_rows', ?);", (str(total_rows),))

    # Create paragraphs_fts virtual table with prefix = 3
    dst_cur.execute("""
    CREATE VIRTUAL TABLE paragraphs_fts USING fts5(
        book_code,
        book_title,
        nikaya,
        para_num,
        para_index UNINDEXED,
        para_rend,
        content,
        prefix = 3
    );
    """)
    dst_conn.commit()

    # 3. Batch insert clean text into FTS5 virtual table
    print(f"  [3] Indexing {total_rows:,} rows...")
    t_insert = time.time()
    batch = []
    BATCH_SIZE = 10000
    inserted_count = 0

    for book_code, para_index, para_num, raw_trans in rows:
        title, nikaya = books_meta.get(book_code, (book_code, ""))
        rend = rend_map.get((book_code, para_index), "bodytext")
        clean_text = clean_translation_text(raw_trans)
        if clean_text:
            batch.append((
                book_code,
                title,
                nikaya,
                str(para_num) if para_num is not None else "",
                para_index,
                rend,
                clean_text,
            ))

        if len(batch) >= BATCH_SIZE:
            dst_cur.executemany("""
                INSERT INTO paragraphs_fts(book_code, book_title, nikaya, para_num, para_index, para_rend, content)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            """, batch)
            inserted_count += len(batch)
            batch = []

    if batch:
        dst_cur.executemany("""
            INSERT INTO paragraphs_fts(book_code, book_title, nikaya, para_num, para_index, para_rend, content)
            VALUES (?, ?, ?, ?, ?, ?, ?);
        """, batch)
        inserted_count += len(batch)
        batch = []

    dst_conn.commit()
    print(f"  [3] Indexed {inserted_count:,} paragraphs ({time.time() - t_insert:.2f}s).")

    # 4. Optimize FTS5 B-tree index
    print("  [4] Optimizing FTS5 index segments...")
    t_opt = time.time()
    dst_cur.execute("INSERT INTO paragraphs_fts(paragraphs_fts) VALUES('optimize');")
    dst_conn.commit()
    print(f"  [4] Optimize completed ({time.time() - t_opt:.2f}s).")

    # 5. VACUUM database
    print("  [5] Compacting via VACUUM...")
    t_vac = time.time()
    dst_cur.execute("VACUUM;")
    dst_conn.commit()
    print(f"  [5] VACUUM completed ({time.time() - t_vac:.2f}s).")

    dst_conn.close()

    # Move temp file to final destination
    if os.path.exists(dst_db):
        os.remove(dst_db)
    os.rename(tmp_dst_db, dst_db)

    # Clean any leftover WAL files
    for suffix in ("-wal", "-shm"):
        f = dst_db + suffix
        if os.path.exists(f):
            try:
                os.remove(f)
            except Exception:
                pass

    size_mb = os.path.getsize(dst_db) / (1024 * 1024)
    t_total = time.time() - t_start
    print(f"  ✓ {lang_code.upper()} finished: {inserted_count:,} paragraphs, {size_mb:.1f} MB in {t_total:.2f}s.")
    return True


def main():
    parser = argparse.ArgumentParser(description="Build SQLite FTS5 indexes for translation databases.")
    parser.add_argument("--lang", help="Specific language code to build (e.g. en, vi, de)")
    parser.add_argument("--db-dir", default=DB_DIR, help="Path to database directory")
    parser.add_argument("--force", action="store_true", help="Force rebuild even if destination DB exists")
    parser.add_argument("--all", action="store_true", help="Build all available translation databases")
    args = parser.parse_args()

    db_dir = os.path.abspath(args.db_dir)
    print(f"[*] Database directory: {db_dir}")

    # Discover available translation DBs
    available_dbs = glob.glob(os.path.join(db_dir, "translation_*.db"))
    discovered_langs = []
    for p in sorted(available_dbs):
        m = re.match(r"translation_([a-z_]+)\.db$", os.path.basename(p))
        if m:
            discovered_langs.append(m.group(1))

    print(f"[*] Discovered {len(discovered_langs)} translation DBs: {discovered_langs}")

    if args.lang:
        target_langs = [args.lang.lower()]
    else:
        target_langs = discovered_langs

    print(f"[*] Target languages to index: {target_langs}")

    t0 = time.time()
    books_meta, rend_map = load_metadata_maps(db_dir)
    print(f"[*] Loaded metadata for {len(books_meta)} books and {len(rend_map)} rend tags.")

    success_count = 0
    for lang in target_langs:
        ok = build_fts_for_lang(lang, db_dir, books_meta, rend_map, force=args.force)
        if ok:
            success_count += 1

    print(f"\n{'='*70}")
    print(f"[✓] Completed {success_count}/{len(target_langs)} FTS translation databases in {time.time() - t0:.2f}s.")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
