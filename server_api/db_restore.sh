#!/bin/bash
set -e

# Change directory to server_api folder
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo " Tipitaka Database Restore Tool"
echo "=========================================="

DB_FILES=("tipitaka.db" "books_xml.db")

for DB_FILE in "${DB_FILES[@]}"; do
  ZIP_FILE="${DB_FILE}.zip"
  
  # Check if part files exist
  if ls "${ZIP_FILE}.part"* 1> /dev/null 2>&1; then
    echo ""
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
echo "✓ Database restore complete!"
echo "=========================================="
