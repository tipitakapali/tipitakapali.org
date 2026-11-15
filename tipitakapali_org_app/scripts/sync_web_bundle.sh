#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$(cd "$APP_DIR/.." && pwd)"
ASSETS_DIR="$APP_DIR/assets"

if [[ ! -f "$WEB_DIR/package.json" ]]; then
  echo "ERROR: Could not find tipitakapali.org at $WEB_DIR" >&2
  exit 1
fi

mkdir -p "$ASSETS_DIR"

echo "1/3 Exporting static bundle from $WEB_DIR..."
rm -rf "$WEB_DIR/out"
(
  cd "$WEB_DIR"
  NEXT_EXPORT=true STATIC_EXPORT=true npm run build
)

echo "2/3 Packaging $ASSETS_DIR/web.zip..."
TMP_WEB="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_WEB" "$WEB_DIR/out"
}
trap cleanup EXIT

python3 - "$WEB_DIR/out" "$TMP_WEB" "$ASSETS_DIR/web.zip" <<'PY'
import os
import shutil
import sys
import zipfile

out_dir, staging_dir, zip_path = sys.argv[1], sys.argv[2], sys.argv[3]

skip_top = {'book', 'chapter', '.well-known'}
skip_prefixes = ('sitemap', 'robots.txt')
skip_font_prefixes = ('Noto_Serif_SC', 'Noto_Serif_JP')

count = 0
for root, dirs, files in os.walk(out_dir):
    rel_root = os.path.relpath(root, out_dir)
    if rel_root == '.':
        dirs[:] = [d for d in dirs if d not in skip_top]
    elif rel_root.split(os.sep)[0] in skip_top:
        dirs[:] = []
        continue

    for fname in files:
        if rel_root == '.' and fname.startswith(skip_prefixes):
            continue
        if 'fonts' in rel_root.split(os.sep) and fname.startswith(skip_font_prefixes):
            continue
        src = os.path.join(root, fname)
        dst_rel = fname if rel_root == '.' else os.path.join(rel_root, fname)
        dst = os.path.join(staging_dir, dst_rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        count += 1

tmp_zip = zip_path + '.tmp'
with zipfile.ZipFile(tmp_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for root, _, files in os.walk(staging_dir):
        for fname in sorted(files):
            full = os.path.join(root, fname)
            arc = os.path.relpath(full, staging_dir).replace(os.sep, '/')
            zf.write(full, arc)

os.replace(tmp_zip, zip_path)
print(f"Packaged {count} files into {zip_path} ({os.path.getsize(zip_path) / (1024*1024):.2f} MB)")
PY

echo "3/3 Extracting DPD family tables to $ASSETS_DIR/dpd_family_data.json.gz..."
node - "$WEB_DIR/server_api/db/dpd_goldendict.js" "$ASSETS_DIR/dpd_family_data.json.gz" <<'NODE'
const fs = require('fs');
const zlib = require('zlib');

const srcPath = process.argv[2];
const outPath = process.argv[3];
const mod = require(srcPath);

const payload = {};
for (const key of [
  'family_compounds',
  'family_idioms',
  'family_root',
  'family_sets',
  'family_word',
]) {
  if (!mod[key] || typeof mod[key] !== 'object') {
    throw new Error(`Missing DPD family table: ${key}`);
  }
  payload[key] = mod[key];
}

const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
fs.writeFileSync(outPath + '.tmp', gz);
fs.renameSync(outPath + '.tmp', outPath);
console.log(
  `Wrote ${outPath} (${(gz.length / (1024 * 1024)).toFixed(2)} MB): ` +
  Object.entries(payload).map(([k, v]) => `${k}=${Object.keys(v).length}`).join(', ')
);
NODE

echo "Done syncing web bundle assets."
