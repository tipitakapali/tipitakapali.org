#!/usr/bin/env python3
"""Zip & split Tipitaka database files into 45MB parts (aa, ab, ...)."""

import argparse
import glob
import os
import zipfile

PART_SIZE = 45 * 1024 * 1024  # 45 MB


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


def excel_col(n: int) -> str:
    """1-based base-26 column name: 1 -> a, 27 -> aa (like spreadsheet columns)."""
    s = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(ord("a") + rem) + s
    return s


def part_suffix(index: int) -> str:
    """GNU split style part suffix: 0 -> aa, 1 -> ab, ..., 26 -> ba, ..."""
    return excel_col(index + 27)


def split_file(db_file: str) -> None:
    zip_file = f"{db_file}.zip"
    print("-" * 42)
    print(f"[+] Processing: {db_file} ({human_size(os.path.getsize(db_file))})")

    # Remove old zip and part files for this db
    for old in glob.glob(zip_file) + glob.glob(f"{zip_file}.part*"):
        os.remove(old)

    # Compress into zip (level 9, like `zip -9`)
    print(f"    -> Zipping {db_file} into {zip_file}...")
    with zipfile.ZipFile(zip_file, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        zf.write(db_file, os.path.basename(db_file))
    print(f"    -> Created {zip_file} ({human_size(os.path.getsize(zip_file))})")

    # Split zip file into parts of 45MB each
    print(f"    -> Splitting {zip_file} into 45M parts...")
    with open(zip_file, "rb") as src:
        index = 0
        while True:
            chunk = src.read(PART_SIZE)
            if not chunk:
                break
            part = f"{zip_file}.part{part_suffix(index)}"
            with open(part, "wb") as dst:
                dst.write(chunk)
            index += 1

    # Remove temporary monolithic zip file to keep only parts for Git
    os.remove(zip_file)

    print("    ✓ Parts created:")
    for part in sorted(glob.glob(f"{zip_file}.part*")):
        print(f"       {os.path.basename(part)} ({human_size(os.path.getsize(part))})")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="db_split.py",
        description="Tipitaka Database Zip & Split Tool",
        epilog=(
            "Examples:\n"
            "  db_split.py                     Split all *.db files\n"
            "  db_split.py -f tipitaka.db      Split only tipitaka.db\n"
            "  db_split.py tipitaka.db palisinh.db\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "-f", "--file", dest="target", metavar="DB_FILE",
        help="split only the given database file",
    )
    parser.add_argument(
        "files", nargs="*", metavar="DB_FILE",
        help="database files to split (default: all *.db)",
    )
    args = parser.parse_args()

    os.chdir(find_db_dir())

    if args.target:
        db_files = [args.target]
    elif args.files:
        db_files = list(args.files)
    else:
        db_files = sorted(glob.glob("*.db"))

    print("=" * 42)
    print(" Tipitaka Database Zip & Split Tool")
    print(f" (Databases directory: {os.getcwd()})")
    print("=" * 42)
    print(f"Found {len(db_files)} database file(s) to process: {', '.join(db_files)}")
    print()

    for db_file in db_files:
        if os.path.isfile(db_file):
            split_file(db_file)
        else:
            print(f"[-] {db_file} is not a regular file, skipping.")

    print()
    print("=" * 42)
    print(f"✓ All ({len(db_files)}) databases zipped and split into parts!")
    print("  Ready to commit parts to GitHub.")
    print("=" * 42)


if __name__ == "__main__":
    main()
