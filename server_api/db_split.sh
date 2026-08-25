#!/bin/bash
set -e

# Change directory to server_api folder
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=========================================="
echo " Tipitaka Database Zip & Split Tool"
echo "=========================================="

DB_FILES=("tipitaka.db" "books_xml.db")

for DB_FILE in "${DB_FILES[@]}"; do
  if [ -f "$DB_FILE" ]; then
    ZIP_FILE="${DB_FILE}.zip"
    
    echo ""
    echo "[+] Processing $DB_FILE ($(du -h "$DB_FILE" | cut -f1))..."
    
    # Remove old zip and part files
    rm -f "$ZIP_FILE" "${ZIP_FILE}.part"*
    
    # Compress into zip
    echo "    -> Zipping $DB_FILE into $ZIP_FILE..."
    zip -9 -q "$ZIP_FILE" "$DB_FILE"
    echo "    -> Created $ZIP_FILE ($(du -h "$ZIP_FILE" | cut -f1))."
    
    # Split zip file into parts of 45MB each
    echo "    -> Splitting $ZIP_FILE into 45M parts..."
    split -b 45M "$ZIP_FILE" "${ZIP_FILE}.part"
    
    # Remove temporary monolithic zip file to keep only parts for Git
    rm -f "$ZIP_FILE"
    
    echo "    ✓ Parts created:"
    ls -lh "${ZIP_FILE}.part"* | awk '{print "       " $9 " (" $5 ")"}'
  else
    echo "[-] $DB_FILE not found, skipping."
  fi
done

echo ""
echo "=========================================="
echo "✓ All databases zipped and split into parts!"
echo "  Ready to commit parts to GitHub."
echo "=========================================="
