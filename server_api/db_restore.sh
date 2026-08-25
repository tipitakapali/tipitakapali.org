#!/bin/bash
set -e

# Change directory to db folder
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$DIR/db" ]; then
  cd "$DIR/db"
else
  cd "$DIR"
fi

echo "=========================================="
echo " Tipitaka Database Restore Tool"
echo " (Restoring in: $(pwd))"
echo "=========================================="

# Auto-discover all db part archives in the folder
if [ $# -gt 0 ]; then
  DB_FILES=("$@")
else
  DB_FILES=($(ls *.db.zip.part* 2>/dev/null | sed -E 's/\.zip\.part.*//' | sort -u || true))
fi

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
