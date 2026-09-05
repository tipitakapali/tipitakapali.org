#!/usr/bin/env python3
"""Normalize Vietnamese homage phrasing in translation_vi.db.

Reproduces the homage unification applied to the Vietnamese Tipitaka
translation database:

  Phase 1: "Nam mô Thế Tôn" -> "Kính lễ Đức Thế Tôn"
           (DB-wide, translation + sentences_json + sentence rows)
  Phase 2: ~80 homage epithet variants -> TARGET
           (DB-wide, longest-match-first so that e.g.
           "Con đảnh lễ Đức Thế Tôn ..." is replaced wholly instead of
           leaving a stray "Con " prefix behind)

Only the core homage phrase is swapped; trailing sentence punctuation
(`.`/`;`/`!`/`"`) is preserved because the match cores carry no
trailing punctuation.

Usage:
    python3 normalize_vi_homage.py [--db PATH] [--dry-run] [--target TEXT]

Exit code is 0 when no listed variant remains, 1 otherwise.
"""

import argparse
import datetime
import os
import shutil
import sqlite3
import sys

TARGET = "Kính lễ Đức Thế Tôn, bậc A-la-hán, đấng Chánh Đẳng Giác"

# Phase-1 replacement: (old, new)
PHASE1 = ("Nam mô Thế Tôn", "Kính lễ Đức Thế Tôn")

# Phase-2 cores: homage variants stripped of trailing ."';! and leading
# quotes. The TARGET itself is deliberately absent.
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

COLUMNS = (
    ("paragraph_translations", "translation"),
    ("paragraph_translations", "sentences_json"),
    ("sentence_translations", "translation"),
)


def default_db_path():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "db", "translation_vi.db")


def count_pattern(cur, pattern):
    """Rows (summed over the three text columns) currently containing pattern."""
    total = 0
    for tbl, col in COLUMNS:
        cur.execute(f"SELECT count(*) FROM {tbl} WHERE {col} LIKE '%' || ? || '%'", (pattern,))
        total += cur.fetchone()[0]
    return total


def count_hits(cur, pattern):
    """Rows containing pattern in any of the three text columns."""
    return count_pattern(cur, pattern)


def apply_replacement(cur, old, new):
    """REPLACE old->new in all three text columns.

    Returns rows actually changed, counted from UPDATE ... RETURNING
    (robust against cursor.rowcount quirks, no extra count scans).
    """
    changed = 0
    for tbl, col in COLUMNS:
        cur.execute(
            f"UPDATE {tbl} SET {col} = REPLACE({col}, ?, ?) "
            "WHERE %s LIKE '%%' || ? || '%%' RETURNING 1" % col,
            (old, new, old),
        )
        changed += len(cur.fetchall())
    return changed


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

    con = sqlite3.connect(args.db)
    cur = con.cursor()

    if args.dry_run:
        p1 = count_hits(cur, PHASE1[0])
        per_core = [(v, count_hits(cur, v)) for v in cores]
        n_cores = sum(1 for _, n in per_core if n)
        print(f"[dry-run] phase-1 {PHASE1[0]!r} hits (rows x cols): {p1}")
        print(f"[dry-run] phase-2 cores with hits: {n_cores}/{len(cores)}")
        for v, n in sorted(per_core, key=lambda r: -r[1]):
            if n:
                print(f"[dry-run]   {n} :: {v}")
        con.close()
        return 0 if (p1 == 0 and n_cores == 0) else 0

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

    cur.execute("BEGIN")
    t1 = apply_replacement(cur, PHASE1[0], PHASE1[1])
    t2 = 0
    for v in cores:
        t2 += apply_replacement(cur, v, args.target)
    con.commit()
    print(f"phase-1 rows updated (x3 cols): {t1}")
    print(f"phase-2 rows updated (x3 cols): {t2}")

    leftover = 0
    for pat in [PHASE1[0]] + cores:
        for tbl, col in COLUMNS:
            cur.execute(f"SELECT count(*) FROM {tbl} WHERE {col} LIKE '%' || ? || '%'", (pat,))
            n = cur.fetchone()[0]
            if n:
                print(f"LEFTOVER {n}x in {tbl}.{col}: {pat}")
                leftover += n
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
