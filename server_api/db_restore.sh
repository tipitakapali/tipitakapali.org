#!/bin/bash
set -e

# Change directory to db folder
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$DIR/db" ]; then
  cd "$DIR/db"
else
  cd "$DIR"
fi

usage() {
  echo "Usage: $0 [-f <db-file>] [db-file ...]"
  echo ""
  echo "Options:"
  echo "  -f, --file <db-file>   Restore only the given database file"
  echo "  -h, --help             Show this help message"
  echo ""
  echo "The <db-file> may be given as the database name (tipitaka.db),"
  echo "the zip name (tipitaka.db.zip), or a part filename (tipitaka.db.zip.partaa)."
  echo ""
  echo "Examples:"
  echo "  $0                          Restore all databases with parts"
  echo "  $0 -f tipitaka.db           Restore only tipitaka.db"
  echo "  $0 tipitaka.db palisinh.db  Restore specific databases"
}

echo "=========================================="
echo " Tipitaka Database Restore Tool"
echo " (Restoring in: $(pwd))"
echo "=========================================="

# Parse CLI options
TARGET=""
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--file)
      if [ -z "$2" ]; then
        echo "[-] $1 requires a database filename"
        usage
        exit 1
      fi
      TARGET="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "[-] Unknown option: $1"
      usage
      exit 1
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

# If -f/--file given, use only that file; otherwise positional args;
# otherwise auto-discover all db part archives in the folder
if [ -n "$TARGET" ]; then
  DB_FILES=("$TARGET")
elif [ ${#POSITIONAL[@]} -gt 0 ]; then
  DB_FILES=("${POSITIONAL[@]}")
else
  DB_FILES=($(ls *.db.zip.part* 2>/dev/null | sed -E 's/\.zip\.part.*//' | sort -u || true))
fi

# Normalize a user-supplied name to the database base name,
# e.g. tipitaka.db.zip.partaa or tipitaka.db.zip -> tipitaka.db
for i in "${!DB_FILES[@]}"; do
  DB_FILES[$i]=$(echo "${DB_FILES[$i]}" | sed -E 's/\.zip\.part.*$//; s/\.zip$//')
done

if [ ${#DB_FILES[@]} -eq 0 ]; then
  echo "[-] No *.db.zip.part* files found to restore in $(pwd)."
  exit 0
fi

echo "Found ${#DB_FILES[@]} database(s) to restore: ${DB_FILES[*]}"
echo ""

for DB_FILE in "${DB_FILES[@]}"; do
  ZIP_FILE="${DB_FILE}.zip"
  
  if ls "${ZIP_FILE}.part"* 1> /dev/null 2>&1; then
    echo "------------------------------------------"
    echo "[+] Restoring $DB_FILE from parts..."
    
    # Reassemble parts into single zip file
    echo "    -> Combining parts into $ZIP_FILE..."
    cat "${ZIP_FILE}.part"* > "$ZIP_FILE"
    
    # Unzip database
    echo "    -> Extracting $DB_FILE..."
    unzip -o -q "$ZIP_FILE"
    
    # Remove temporary zip file
    rm -f "$ZIP_FILE"
    
    echo "    ✓ Restored $DB_FILE ($(du -h "$DB_FILE" | cut -f1))."
    
    # Verify SQLite database integrity if sqlite3 is available
    if command -v sqlite3 >/dev/null 2>&1; then
      echo "    -> Running SQLite integrity check..."
      CHECK=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>&1 || true)
      if [ "$CHECK" = "ok" ]; then
        echo "    ✓ Database integrity: OK"
      else
        echo "    ⚠ Database check warning: $CHECK"
      fi
    fi
  else
    echo "[-] No part files found for $DB_FILE (${ZIP_FILE}.part*), skipping."
  fi
done

echo ""
echo "=========================================="
echo "✓ All databases restored successfully!"
echo "=========================================="
