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
      (book_code, book_title, nikaya, para_num, para_index UNINDEXED, para_rend, content)
  - Per-language tokenizer is chosen via LANG_TOKENIZE (see below) because a single
    tokenizer does not work well across scripts:
      * vi            - unicode61 remove_diacritics 0  (exact-diacritic search; user
                         must type correct tone marks, e.g. "việt" != "viet")
      * th/km/lo/my/
        my_nissaya/
        hi/ta/si/ne    - unicode61 categories 'L* N* Mn'  (these scripts use combining
                         vowel/tone marks - category Mn - which default unicode61
                         treats as a token BREAK, shattering words into meaningless
                         consonant fragments; widening categories to include Mn keeps
                         the mark attached to its base letter)
      * zh/ja         - trigram  (no whitespace between words at all; default
                         unicode61 would tokenize an entire sentence as ONE token,
                         making sub-string/word search impossible; trigram indexes
                         every 3-character window instead, no prefix= needed)
      * en/de/pt/ru/
        id/ko
        (fallback)    - unicode61 remove_diacritics 2  (accent-insensitive search;
                         verified safe only for Latin/Cyrillic scripts with
                         precomposed diacritics - do NOT add hi/ta/si/th/etc. here)
  - Copies translation_meta table for direct language information
  - Sanitizes HTML/XML tags, decodes HTML entities, collapses whitespace, preserves
    Unicode diacritics/combining marks
  - B-tree optimization ('optimize') & VACUUM for maximum query speed.

Usage:
  python3 build_translation_fts.py                # Build all translation DBs
  python3 build_translation_fts.py --lang en      # Build specific language
  python3 build_translation_fts.py --force        # Overwrite existing FTS DBs
================================================================================
"""

import argparse
import glob
import html
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

#ALL_LANGS = [
 #   "de", "en", "hi", "ja", "km", "lo", "my", "my_nissaya",
  #  "pt", "ru", "si", "ta", "th", "vi", "zh"
#]

ALL_LANGS = [
    "be", "de", "en", "hi", "id", "ja", "km", "ko", "lo", "my", "ne",
    "pt", "ru", "si", "ta", "th", "vi", "zh"
]

# --- Minimum SQLite version required for 'remove_diacritics 2' / 'categories' /
#     'trigram' tokenizer support (added around SQLite 3.27 - 3.34). ---
_MIN_SQLITE = (3, 34, 0)
if sqlite3.sqlite_version_info < _MIN_SQLITE:
    print(
        f"[!] WARNING: bundled SQLite is {sqlite3.sqlite_version} but "
        f"{'.'.join(map(str, _MIN_SQLITE))}+ is required for the tokenizer "
        f"options used below (remove_diacritics 2, custom categories, trigram). "
        f"FTS indexes built with this interpreter may silently misbehave."
    )

# Per-language FTS5 tokenizer configuration.
# See the module docstring above for the reasoning behind each entry.
LANG_TOKENIZE = {
    "vi": "unicode61 remove_diacritics 0",
    "th": "unicode61 categories 'L* N* Mn'",
    "km": "unicode61 categories 'L* N* Mn'",
    "lo": "unicode61 categories 'L* N* Mn'",
    "my": "unicode61 categories 'L* N* Mn'",
    "my_nissaya": "unicode61 categories 'L* N* Mn'",
    "hi": "unicode61 categories 'L* N* Mn'",
    "ne": "unicode61 categories 'L* N* Mn'",
    "ta": "unicode61 categories 'L* N* Mn'",
    "si": "unicode61 categories 'L* N* Mn'",
    "be": "unicode61 categories 'L* N* Mn'",
    "zh": "trigram",
    "ja": "trigram",
}
DEFAULT_TOKENIZE = "unicode61 remove_diacritics 2"  # en, de, pt, ru, and anything unlisted

# Languages that use the 'trigram' tokenizer already index every character
# n-gram, so a separate prefix index is redundant bloat - skip it for those.
TRIGRAM_LANGS = {"zh", "ja"}


def get_tokenize_clause(lang_code: str) -> str:
    """Returns the FTS5 `tokenize = '...'` value for a given language code."""
    return LANG_TOKENIZE.get(lang_code, DEFAULT_TOKENIZE)


def clean_translation_text(raw_text: str) -> str:
    """
    Sanitizes paragraph translation text for FTS5 full-text indexing:
      - Normalizes Unicode to NFC (composed forms)
      - Strips HTML / XML tags (e.g. <i>, </i>, <b>, <span>, <pb.../>)
      - Decodes HTML entities (e.g. &amp; -> &, &nbsp; -> space)
      - Preserves Unicode diacritics and combining marks
      - Strips zero-width spaces and BOMs (preserves ZWJ/ZWNJ for Indic scripts)
      - Collapses multiple whitespace characters.
    """
    if not raw_text:
        return ""
    # Normalize Unicode to NFC
    text = unicodedata.normalize("NFC", raw_text)
    # Strip HTML / XML markup
    text = re.sub(r"<[^>]+>", " ", text)
    # Decode HTML entities (&amp;, &nbsp;, &quot;, numeric refs, etc.)
    text = html.unescape(text)
    # Re-normalize to NFC in case entity decoding introduced decomposed forms
    text = unicodedata.normalize("NFC", text)
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

    tokenize_clause = get_tokenize_clause(lang_code)

    print(f"\n{'='*70}")
    print(f"[*] Indexing translation FTS: {lang_code.upper()} -> {os.path.basename(dst_db)}")
    print(f"[*] Tokenizer: {tokenize_clause}")
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
    dst_conn.execute("PRAGMA journal_mode = MEMORY;")
    dst_conn.execute("PRAGMA temp_store = MEMORY;")
    dst_conn.execute("PRAGMA synchronous = OFF;")
    dst_conn.execute("PRAGMA cache_size = -64000;")  # 64 MB memory cache
    dst_cur = dst_conn.cursor()

    try:
        # Create translation_meta table
        dst_cur.execute("CREATE TABLE IF NOT EXISTS translation_meta (key TEXT PRIMARY KEY, value TEXT);")
        if meta_rows:
            dst_cur.executemany("INSERT OR REPLACE INTO translation_meta (key, value) VALUES (?, ?);", meta_rows)
        dst_cur.execute("INSERT OR REPLACE INTO translation_meta (key, value) VALUES ('fts_built_at', datetime('now'));")
        dst_cur.execute("INSERT OR REPLACE INTO translation_meta (key, value) VALUES ('fts_indexed_rows', ?);", (str(total_rows),))
        dst_cur.execute("INSERT OR REPLACE INTO translation_meta (key, value) VALUES ('fts_tokenize', ?);", (tokenize_clause,))

        # Create paragraphs_fts virtual table using the per-language tokenizer.
        # prefix=3 is skipped for trigram-tokenized languages (zh/ja) since trigram
        # already indexes every 3-char window - a prefix index there is pure bloat.
        #
        # IMPORTANT: tokenize_clause values like "unicode61 categories 'L* N* Mn'"
        # contain their own single quotes (required by FTS5's tokenizer-argument
        # syntax). Since the whole clause is embedded inside a SQL single-quoted
        # string literal (tokenize = '...'), any single quote INSIDE it must be
        # doubled ('' ) or SQLite's parser sees it as the string terminating early
        # and throws a syntax error. Plain values like "unicode61 remove_diacritics 0"
        # or "trigram" have no inner quotes, so doubling is a no-op for them.
        escaped_tokenize = tokenize_clause.replace("'", "''")
        prefix_clause = "" if lang_code in TRIGRAM_LANGS else ",\n            prefix = 3"
        dst_cur.execute(f"""
        CREATE VIRTUAL TABLE paragraphs_fts USING fts5(
            book_code,
            book_title,
            nikaya,
            para_num,
            para_index UNINDEXED,
            para_rend,
            content,
            tokenize = '{escaped_tokenize}'{prefix_clause}
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

        # Move temp file to final destination atomically
        os.replace(tmp_dst_db, dst_db)

        # Clean any leftover WAL files
        for suffix in ("-wal", "-shm"):
            f = dst_db + suffix
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

    except Exception as e:
        try:
            dst_conn.close()
        except Exception:
            pass
        if os.path.exists(tmp_dst_db):
            try:
                os.remove(tmp_dst_db)
            except Exception:
                pass
        print(f"[!] Error building FTS for {lang_code}: {e}", file=sys.stderr)
        raise

    size_mb = os.path.getsize(dst_db) / (1024 * 1024)
    t_total = time.time() - t_start
    print(f"  ✓ {lang_code.upper()} finished: {inserted_count:,} paragraphs, {size_mb:.1f} MB in {t_total:.2f}s.")
    return True


def show_status(db_dir: str):
    """Displays status comparison between translation_*.db and fts_translation_*.db."""
    print(f"\n{'=' * 96}")
    print(f"{'Language':14s} | {'Trans DB':10s} | {'Trans Paras':14s} | {'FTS DB':10s} | {'FTS Rows':14s} | {'Status':14s}")
    print(f"{'-' * 96}")

    available_dbs = sorted(glob.glob(os.path.join(db_dir, "translation_*.db")))
    needs_rebuild = 0

    for p in available_dbs:
        m = re.match(r"translation_([a-z_]+)\.db$", os.path.basename(p))
        if not m:
            continue
        lang = m.group(1)
        fts_p = os.path.join(db_dir, f"fts_translation_{lang}.db")

        t_size_mb = os.path.getsize(p) / (1024 * 1024)
        t_mtime = os.path.getmtime(p)
        try:
            c_t = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            t_paras = c_t.execute("SELECT count(*) FROM paragraph_translations WHERE translation IS NOT NULL AND length(trim(translation)) > 0").fetchone()[0]
            c_t.close()
        except Exception:
            t_paras = -1

        f_paras = None
        f_size_mb = 0.0
        f_mtime = 0
        if os.path.exists(fts_p):
            f_size_mb = os.path.getsize(fts_p) / (1024 * 1024)
            f_mtime = os.path.getmtime(fts_p)
            try:
                c_f = sqlite3.connect(f"file:{fts_p}?mode=ro", uri=True)
                f_paras = c_f.execute("SELECT count(*) FROM paragraphs_fts").fetchone()[0]
                c_f.close()
            except Exception:
                f_paras = -1

        if f_paras is None:
            status = "MISSING"
            needs_rebuild += 1
        elif t_paras != f_paras or t_mtime > f_mtime:
            status = "NEEDS REBUILD"
            needs_rebuild += 1
        else:
            status = "UP TO DATE"

        t_str = f"{t_paras:,}" if t_paras >= 0 else "err"
        f_str = f"{f_paras:,}" if f_paras is not None and f_paras >= 0 else ("missing" if f_paras is None else "err")
        f_size_str = f"{f_size_mb:7.1f} MB" if f_paras is not None else "-"
        print(f"{lang:14s} | {t_size_mb:7.1f} MB | {t_str:>14s} | {f_size_str:>10s} | {f_str:>14s} | {status:14s}")

    print(f"{'=' * 96}")
    if needs_rebuild > 0:
        print(f"{needs_rebuild} FTS database(s) need rebuilding. Run with --updated to rebuild them.\n")
    else:
        print("All FTS databases are up to date.\n")


def main():
    parser = argparse.ArgumentParser(description="Build SQLite FTS5 indexes for translation databases.")
    parser.add_argument("--lang", help="Specific language code to build (e.g. en, vi, de)")
    parser.add_argument("--db-dir", default=DB_DIR, help="Path to database directory")
    parser.add_argument("--force", action="store_true", help="Force rebuild even if destination DB exists")
    parser.add_argument("--all", action="store_true", help="Build all available translation databases")
    parser.add_argument("--status", "--check", action="store_true", dest="status", help="Show status comparison between translation DBs and FTS DBs")
    parser.add_argument("--updated", "--only-newer", action="store_true", dest="updated", help="Rebuild only languages where translation DB is newer or row count differs")
    args = parser.parse_args()

    db_dir = os.path.abspath(args.db_dir)
    print(f"[*] Database directory: {db_dir}")

    if args.status:
        show_status(db_dir)
        return

    # Discover available translation DBs
    available_dbs = glob.glob(os.path.join(db_dir, "translation_*.db"))
    discovered_langs = []
    for p in sorted(available_dbs):
        m = re.match(r"translation_([a-z_]+)\.db$", os.path.basename(p))
        if m:
            discovered_langs.append(m.group(1))

    print(f"[*] Discovered {len(discovered_langs)} translation DBs: {discovered_langs}")

    if args.updated:
        target_langs = []
        for lang in discovered_langs:
            src_db = os.path.join(db_dir, f"translation_{lang}.db")
            dst_db = os.path.join(db_dir, f"fts_translation_{lang}.db")
            if not os.path.exists(dst_db) or os.path.getmtime(src_db) > os.path.getmtime(dst_db) or args.force:
                target_langs.append(lang)
            else:
                # Also check row count difference
                try:
                    c_src = sqlite3.connect(f"file:{src_db}?mode=ro", uri=True)
                    src_cnt = c_src.execute("SELECT count(*) FROM paragraph_translations WHERE translation IS NOT NULL AND length(trim(translation)) > 0").fetchone()[0]
                    c_src.close()
                    c_dst = sqlite3.connect(f"file:{dst_db}?mode=ro", uri=True)
                    dst_cnt = c_dst.execute("SELECT count(*) FROM paragraphs_fts").fetchone()[0]
                    c_dst.close()
                    if src_cnt != dst_cnt:
                        target_langs.append(lang)
                except Exception:
                    target_langs.append(lang)

        if not target_langs:
            print("[*] All FTS databases are up to date with translation DBs. Use --force to rebuild.")
            return
        print(f"[*] Databases needing rebuild: {target_langs}")
    elif args.lang:
        target_langs = [args.lang.lower()]
    else:
        target_langs = discovered_langs

    print(f"[*] Target languages to index: {target_langs}")

    t0 = time.time()
    books_meta, rend_map = load_metadata_maps(db_dir)
    print(f"[*] Loaded metadata for {len(books_meta)} books and {len(rend_map)} rend tags.")

    success_count = 0
    for lang in target_langs:
        ok = build_fts_for_lang(lang, db_dir, books_meta, rend_map, force=(args.force or args.updated))
        if ok:
            success_count += 1

    print(f"\n{'='*70}")
    print(f"[✓] Completed {success_count}/{len(target_langs)} FTS translation databases in {time.time() - t0:.2f}s.")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
