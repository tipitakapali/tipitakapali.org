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
  echo "  -f, --file <db-file>   Split only the given database file"
  echo "  -h, --help             Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0                          Split all *.db files"
  echo "  $0 -f tipitaka.db           Split only tipitaka.db"
  echo "  $0 tipitaka.db palisinh.db  Split specific files"
}

echo "=========================================="
echo " Tipitaka Database Zip & Split Tool"
echo " (Databases directory: $(pwd))"
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
# otherwise automatically find all *.db files
if [ -n "$TARGET" ]; then
  DB_FILES=("$TARGET")
elif [ ${#POSITIONAL[@]} -gt 0 ]; then
  DB_FILES=("${POSITIONAL[@]}")
else
  DB_FILES=(*.db)
fi

echo "Found ${#DB_FILES[@]} database file(s) to process: ${DB_FILES[*]}"
echo ""

for DB_FILE in "${DB_FILES[@]}"; do
  if [ -f "$DB_FILE" ]; then
    ZIP_FILE="${DB_FILE}.zip"
    
    echo "------------------------------------------"
    echo "[+] Processing: $DB_FILE ($(du -h "$DB_FILE" | cut -f1))"
    
    # Remove old zip and part files for this db
    rm -f "$ZIP_FILE" "${ZIP_FILE}.part"*
    
    # Compress into zip
    echo "    -> Zipping $DB_FILE into $ZIP_FILE..."
    zip -9 -q "$ZIP_FILE" "$DB_FILE"
    echo "    -> Created $ZIP_FILE ($(du -h "$ZIP_FILE" | cut -f1))"
    
    # Split zip file into parts of 45MB each
    echo "    -> Splitting $ZIP_FILE into 45M parts..."
    split -b 45M "$ZIP_FILE" "${ZIP_FILE}.part"
    
    # Remove temporary monolithic zip file to keep only parts for Git
    rm -f "$ZIP_FILE"
    
    echo "    ✓ Parts created:"
    ls -lh "${ZIP_FILE}.part"* | awk '{print "       " $9 " (" $5 ")"}'
  else
    echo "[-] $DB_FILE is not a regular file, skipping."
  fi
done

echo ""
echo "=========================================="
echo "✓ All (${#DB_FILES[@]}) databases zipped and split into parts!"
echo "  Ready to commit parts to GitHub."
echo "=========================================="
