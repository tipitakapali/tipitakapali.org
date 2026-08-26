#!/usr/bin/env python3
"""Restore Tipitaka database files from their 45MB zip parts."""

import argparse
import glob
import os
import re
import sqlite3
import zipfile


def find_db_dir() -> str:
    """Return the db folder next to this script, or the script folder."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    db_dir = os.path.join(script_dir, "db")
    return db_dir if os.path.isdir(db_dir) else script_dir


def human_size(size: int) -> str:
    for unit in ("B", "K", "M", "G", "T"):
        if size < 1024 or unit == "T":
            return f"{size}B" if unit == "B" else f"{size:.1f}{unit}"
        size /= 1024
    return f"{size}T"


def normalize_name(name: str) -> str:
    """tipitaka.db.zip.partaa or tipitaka.db.zip -> tipitaka.db"""
    return re.sub(r"\.zip(\.part.*)?$", "", name)


def part_order(part_path: str) -> int:
    """Sort parts by their suffix: aa -> 0, ab -> 1, ..., ba -> 26, ..."""
    m = re.search(r"\.part([a-z]+)$", part_path)
    suffix = m.group(1) if m else ""
    n = 0
    for ch in suffix:
        n = n * 26 + (ord(ch) - ord("a") + 1)
    return n - 27


def restore_db(db_file: str) -> None:
    zip_file = f"{db_file}.zip"
    parts = sorted(glob.glob(f"{zip_file}.part*"), key=part_order)

    if not parts:
        print(f"[-] No part files found for {db_file} ({zip_file}.part*), skipping.")
        return

    print("-" * 42)
    print(f"[+] Restoring {db_file} from parts...")

    # Reassemble parts into single zip file
    print(f"    -> Combining parts into {zip_file}...")
    with open(zip_file, "wb") as out:
        for part in parts:
            with open(part, "rb") as src:
                out.write(src.read())

    # Extract database
    print(f"    -> Extracting {db_file}...")
    with zipfile.ZipFile(zip_file) as zf:
        zf.extractall()

    # Remove temporary zip file
    os.remove(zip_file)

    print(f"    ✓ Restored {db_file} ({human_size(os.path.getsize(db_file))}).")

    # Verify SQLite database integrity
    try:
        conn = sqlite3.connect(db_file)
        check = conn.execute("PRAGMA integrity_check;").fetchone()[0]
        conn.close()
        if check == "ok":
            print("    ✓ Database integrity: OK")
        else:
            print(f"    ⚠ Database check warning: {check}")
    except sqlite3.Error as exc:
        print(f"    ⚠ SQLite check failed: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="db_restore.py",
        description="Tipitaka Database Restore Tool",
        epilog=(
            "The DB_FILE may be given as the database name (tipitaka.db),\n"
            "the zip name (tipitaka.db.zip), or a part filename (tipitaka.db.zip.partaa).\n"
            "\n"
            "Examples:\n"
            "  db_restore.py                          Restore all databases with parts\n"
            "  db_restore.py -f tipitaka.db           Restore only tipitaka.db\n"
            "  db_restore.py tipitaka.db palisinh.db\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-f", "--file", dest="target", metavar="DB_FILE",
        help="restore only the given database file",
    )
    parser.add_argument(
        "files", nargs="*", metavar="DB_FILE",
        help="databases to restore (default: all found parts)",
    )
    args = parser.parse_args()

    os.chdir(find_db_dir())

    if args.target:
        db_files = [normalize_name(args.target)]
    elif args.files:
        db_files = [normalize_name(f) for f in args.files]
    else:
        db_files = sorted({normalize_name(p) for p in glob.glob("*.db.zip.part*")})

    if not db_files:
        print(f"[-] No *.db.zip.part* files found to restore in {os.getcwd()}.")
        return

    print("=" * 42)
    print(" Tipitaka Database Restore Tool")
    print(f" (Restoring in: {os.getcwd()})")
    print("=" * 42)
    print(f"Found {len(db_files)} database(s) to restore: {', '.join(db_files)}")
    print()

    for db_file in db_files:
        restore_db(db_file)

    print()
    print("=" * 42)
    print("✓ All databases restored successfully!")
    print("=" * 42)


if __name__ == "__main__":
    main()
