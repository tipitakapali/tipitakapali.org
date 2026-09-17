#!/usr/bin/env python3
"""Normalize Vietnamese homage phrasing in translation_vi.db.

Replaces ~80 homage epithet variants with a single canonical TARGET:

    Kính lễ Đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác

DB-wide (paragraph_translations.translation +
paragraph_translations.sentences_json +
sentence_translations.translation), longest-match-first so that e.g.
"Con đảnh lễ Đức Thế Tôn ..." is replaced wholly instead of leaving a
stray "Con " prefix behind.

Only the core homage phrase is swapped; trailing sentence punctuation
(`.`/`;`/`!`/`"`) is preserved because the match cores carry no
trailing punctuation.

Why this rewrite: the previous version issued one full-table
UPDATE ... WHERE col LIKE <variant> per variant per column
(82 variants x 3 columns = 246 full scans of 464k + 1.2M-row tables),
which never finishes in practice.  This version does ONE candidate
scan per column (`WHERE col LIKE '%A-la-hán%' OR col LIKE '%Araha%'`),
applies all variants in Python (single longest-first regex), and
UPDATEs only rows that actually changed.

Usage:
    python3 normalize_vi_homage.py [--db PATH] [--dry-run] [--target TEXT]

Exit code is 0 when no listed variant remains, 1 otherwise.
"""

import argparse
import datetime
import os
import re
import shutil
import sqlite3
import sys

TARGET = "Kính lễ Đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác"

# Homage variants stripped of trailing ."';! and leading quotes.
# The TARGET itself is deliberately absent.
VARIANTS = [
    "Con xin đảnh lễ Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Con xin đảnh lễ Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Con xin đảnh lễ bậc Thế Tôn, bậc Araha, bậc Chánh Đẳng Giác",
    "Con xin đảnh lễ Đấng Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Con xin đảnh lễ Đức Thế Tôn, Bậc A-la-hán, Bậc Chánh Đẳng Giác",
    "Con xin đảnh lễ Đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Con xin đảnh lễ Đức Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Con xin đảnh lễ đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Con xin đảnh lễ đức Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Con đảnh lễ Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Con đảnh lễ Đấng Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Con đảnh lễ Đức Thế Tôn, bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Con đảnh lễ Đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Con đảnh lễ đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Kính lễ Bậc Thế Tôn, Bậc A-la-hán, Đấng Chánh Biến Tri",
    "Kính lễ Bậc Thế Tôn, Bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Kính lễ Bậc Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Kính lễ Ngài Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Kính lễ Ngài, bậc Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Kính lễ Thế Tôn, Bậc A-la-hán, Đấng Chánh Biến Tri",
    "Kính lễ Thế Tôn, Bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Kính lễ Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Kính lễ Thế Tôn, bậc A-la-hán, Đấng Chánh Biến Tri",
    "Kính lễ Thế Tôn, bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Kính lễ Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Kính lễ Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Kính lễ bậc A-la-hán, Đấng Chánh Đẳng Giác, Đấng Thế Tôn",
    "Kính lễ bậc Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Kính lễ bậc Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Kính lễ bậc Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Kính lễ Đấng Thế Tôn, Bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Kính lễ Đấng Thế Tôn, bậc A-la-hán, Chánh Đẳng Giác",
    "Kính lễ Đấng Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Kính lễ Đức Thế Tôn ấy, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Kính lễ Đức Thế Tôn, Bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Kính lễ Đức Thế Tôn, bậc A-la-hán, bậc Chánh Biến Tri",
    "Kính lễ Đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Kính lễ Đức Thế Tôn, bậc A-la-hán, Đấng Chánh Biến Tri",
    "Kính lễ Đức Thế Tôn, bậc A-la-hán, Đấng Chánh Đẳng Chánh Giác",
    "Kính lễ Đức Thế Tôn, bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Kính lễ Đức Thế Tôn, bậc A-la-hán, Đấng Toàn Giác",
    "Kính lễ Đức Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Kính lễ Đức Thế Tôn, bậc A-la-hán, đấng Toàn Giác",
    "Kính lễ đấng Thế Tôn, bậc A-la-hán, Chánh Biến Tri",
    "Kính lễ đấng Thế Tôn, bậc A-la-hán, Chánh Đẳng Giác",
    "Kính lễ đấng Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Kính lễ đấng Thế Tôn, bậc A-la-hán, vị Chánh Đẳng Giác",
    "Kính lễ đấng Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Kính lễ đấng Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Kính lễ đức Thế Tôn ấy, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Kính lễ đức Thế Tôn, Bậc A-la-hán, Chánh Đẳng Chánh Giác",
    "Kính lễ đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Kính lễ đức Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Kính lễ đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Kính lễ đức Thế Tôn, bậc A-la-hán, đấng Toàn Giác",
    "Nam mô Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Nam mô Thế Tôn, bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Nam mô Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Nam mô Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Nam mô bậc A-la-hán, bậc Chánh Đẳng Giác, Đấng Thế Tôn",
    "Nam mô đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Nam mô đức Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Nam mô đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Namô Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Năm lễ Đức Thế Tôn, bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Ngọn lúa vàng rực rỡ, thành kính đảnh lễ đức Thế Tôn, bậc A-la-hán, "
    "đấng Chánh Biến Tri",
    "Tôn kính Đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Tôn kính đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Tôn vinh Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Đảnh lễ Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Đảnh lễ bậc Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Đảnh lễ Đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Đảnh lễ Đức Thế Tôn, bậc A-la-hán, Đấng Chánh Biến Tri",
    "Đảnh lễ Đức Thế Tôn, bậc A-la-hán, Đấng Chánh Đẳng Giác",
    "Đảnh lễ Đức Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Đảnh lễ Đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Đảnh lễ Đức Thế Tôn, bậc A-la-hán, đấng Toàn Giác",
    "Đảnh lễ đấng Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Đảnh lễ đức Thế Tôn, bậc A-la-hán, bậc Chánh Đẳng Giác",
    "Đảnh lễ đức Thế Tôn, bậc A-la-hán, đấng Chánh Biến Tri",
    "Đảnh lễ đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác",
    "Đảnh lễ đức Thế Tôn, bậc A-la-hán, đấng Toàn Giác",
    "Kính lạy Thế Tôn, Bậc A-la-hán, Đấng Chánh Biến Tri",
]

# (table, column) text columns to normalize. sentences_json holds JSON
# but the variants contain no '"' or '\\', so a raw substring replace on
# the JSON text is safe and preserves formatting.
COLUMNS = (
    ("paragraph_translations", "translation"),
    ("paragraph_translations", "sentences_json"),
    ("sentence_translations", "translation"),
)

# Narrowing filter: every variant contains 'A-la-hán' except the single
# 'Araha' one, so candidates are rows matching either. One scan per
# column instead of one scan per variant per column.
CANDIDATE_WHERE = "({col} LIKE '%A-la-hán%' OR {col} LIKE '%Araha%')"


def default_db_path():
    here = os.path.dirname(os.path.abspath(__file__))
    same_dir = os.path.join(here, "translation_vi.db")
    if os.path.exists(same_dir):
        return same_dir
    return os.path.join(here, "db", "translation_vi.db")


def build_pattern(variants):
    """Single longest-match-first regex over all variants."""
    cores = sorted(set(variants), key=len, reverse=True)
    return re.compile("|".join(re.escape(v) for v in cores))


def iter_candidates(cur, table, col, chunksize=2000):
    """Yield (rowid, text) candidate rows possibly containing a variant."""
    cur.execute(
        f"SELECT rowid, {col} FROM {table} WHERE " + CANDIDATE_WHERE.format(col=col)
    )
    while True:
        batch = cur.fetchmany(chunksize)
        if not batch:
            return
        for rowid, text in batch:
            if text:
                yield rowid, text


def apply_to_text(text, pattern, target):
    """Replace all variant occurrences; return (new_text, n_replacements)."""
    new_text, n = pattern.subn(target, text)
    return new_text, n


def count_variants_in_texts(texts, variants):
    """Per-variant hit counts over an in-memory list of texts (dry-run)."""
    per_core = []
    for v in variants:
        n = sum(t.count(v) for t in texts)
        per_core.append((v, n))
    return per_core


def backup_db(db_path):
    """Copy the DB (plus any SQLite sidecar files) to a timestamped backup."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = f"{db_path}.bak-{stamp}"
    shutil.copy2(db_path, backup_path)
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = db_path + suffix
        if os.path.exists(sidecar):
            shutil.copy2(sidecar, backup_path + suffix)
    size_mb = os.path.getsize(backup_path) / (1024 * 1024)
    print(f"backup written: {backup_path} ({size_mb:.1f} MB)")
    return backup_path


def confirm_overwrite(db_path):
    """Ask the user before modifying the DB; return True only on yes."""
    try:
        answer = input(f"Overwrite {db_path} with normalized text? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print("\naborted.")
        return False
    if answer not in ("y", "yes"):
        print("aborted.")
        return False
    return True


def main():
    ap = argparse.ArgumentParser(description="Normalize Vietnamese homage phrasing.")
    ap.add_argument("--db", default=default_db_path(), help="path to translation_vi.db")
    ap.add_argument("--dry-run", action="store_true", help="report only, change nothing")
    ap.add_argument("--target", default=TARGET, help="canonical homage phrase")
    ap.add_argument("-y", "--yes", action="store_true",
                    help="skip the overwrite confirmation prompt")
    ap.add_argument("--no-backup", action="store_true",
                    help="skip writing a timestamped backup before modifying")
    args = ap.parse_args()

    assert args.target not in VARIANTS, "TARGET must not be one of the variants"
    cores = sorted(set(VARIANTS), key=len, reverse=True)  # longest first
    pattern = build_pattern(cores)

    if not os.path.exists(args.db):
        print(f"error: DB not found: {args.db}", file=sys.stderr)
        return 2
    con = sqlite3.connect(args.db)
    cur = con.cursor()

    # Single candidate scan per column; everything else is in-memory.
    candidates = {}  # (table, col) -> list[(rowid, text)]
    for tbl, col in COLUMNS:
        rows = list(iter_candidates(cur, tbl, col))
        candidates[(tbl, col)] = rows
        print(f"scan {tbl}.{col}: {len(rows)} candidate rows")

    if args.dry_run:
        all_texts = [t for rows in candidates.values() for _, t in rows]
        per_core = count_variants_in_texts(all_texts, cores)
        n_cores = sum(1 for _, n in per_core if n)
        total_hits = sum(n for _, n in per_core)
        print(f"[dry-run] variant cores with hits: {n_cores}/{len(cores)} "
              f"({total_hits} occurrences in candidate rows)")
        for v, n in sorted(per_core, key=lambda r: -r[1]):
            if n:
                print(f"[dry-run]   {n} :: {v}")
        con.close()
        return 0 if total_hits == 0 else 1

    if not args.yes and not confirm_overwrite(args.db):
        con.close()
        return 2

    if not args.no_backup:
        con.close()  # release any read handle before copying the file
        backup_db(args.db)
        con = sqlite3.connect(args.db)
        cur = con.cursor()
    else:
        print("warning: proceeding WITHOUT a backup (--no-backup given)")

    total_rows = 0
    total_repl = 0
    cur.execute("BEGIN")
    for tbl, col in COLUMNS:
        changed = []
        n_repl = 0
        for rowid, text in candidates[(tbl, col)]:
            new_text, n = apply_to_text(text, pattern, args.target)
            if n:
                changed.append((new_text, rowid))
                n_repl += n
        if changed:
            cur.executemany(
                f"UPDATE {tbl} SET {col} = ? WHERE rowid = ?", changed
            )
        print(f"updated {tbl}.{col}: {len(changed)} rows, {n_repl} replacements")
        total_rows += len(changed)
        total_repl += n_repl
    con.commit()
    print(f"total rows updated: {total_rows} ({total_repl} replacements)")

    leftover = 0
    for tbl, col in COLUMNS:
        cur.execute(
            f"SELECT rowid, {col} FROM {tbl} WHERE " + CANDIDATE_WHERE.format(col=col)
        )
        for _, text in cur.fetchall():
            if not text:
                continue
            for pat in cores:
                n = text.count(pat)
                if n:
                    if leftover == 0:
                        print(f"LEFTOVER in {tbl}.{col}: {pat} ({n}x in one row)")
                    leftover += n
                    break  # one report line per row is enough; keep counting
    cur.execute(
        "SELECT count(*) FROM paragraph_translations WHERE translation LIKE '%' || ? || '%'",
        (args.target,),
    )
    print(f"paragraphs now containing TARGET: {cur.fetchone()[0]}")
    print("LEFTOVERS:", leftover)
    con.close()
    return 1 if leftover else 0


if __name__ == "__main__":
    sys.exit(main())
