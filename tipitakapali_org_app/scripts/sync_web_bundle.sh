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
  NEXT_PUBLIC_OFFLINE_APP=true NEXT_EXPORT=true STATIC_EXPORT=true npm run build
)

echo "2/3 Packaging $ASSETS_DIR/web.zip..."
TMP_WEB="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_WEB" "$WEB_DIR/out"
}
trap cleanup EXIT

python3 - "$WEB_DIR/out" "$TMP_WEB" "$ASSETS_DIR/web.zip" <<'PY'
import os
import re
import shutil
import sys
import zipfile

out_dir, staging_dir, zip_path = sys.argv[1], sys.argv[2], sys.argv[3]

skip_top = {'book', 'chapter', 'translation', '.well-known', 'api'}
skip_prefixes = ('sitemap', 'robots.txt', 'Google_Play_Store_badge_EN')
indexnow_key_re = re.compile(r'^[0-9a-f]{32}\.txt$')
skip_font_prefixes = ('Noto_Serif_SC', 'Noto_Serif_JP')
play_store_link_re = re.compile(
    r'\s*<a\b[^>]*href=["\']https://play\.google\.com/[^"\']*["\'][^>]*>.*?</a>\s*',
    re.IGNORECASE | re.DOTALL,
)

count = 0
for root, dirs, files in os.walk(out_dir):
    rel_root = os.path.relpath(root, out_dir)
    if rel_root == '.':
        dirs[:] = [d for d in dirs if d not in skip_top]
    elif rel_root.split(os.sep)[0] in skip_top:
        dirs[:] = []
        continue

    for fname in files:
        if rel_root == '.' and (fname.startswith(skip_prefixes) or indexnow_key_re.match(fname)):
            continue
        if 'fonts' in rel_root.split(os.sep) and fname.startswith(skip_font_prefixes):
            continue
        src = os.path.join(root, fname)
        dst_rel = fname if rel_root == '.' else os.path.join(rel_root, fname)
        dst = os.path.join(staging_dir, dst_rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if rel_root == '.' and fname == 'info.html':
            with open(src, 'r', encoding='utf-8') as f:
                html = f.read()
            html = play_store_link_re.sub('\n', html)
            with open(dst, 'w', encoding='utf-8') as f:
                f.write(html)
        else:
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
const vm = require('vm');
const zlib = require('zlib');

const srcPath = process.argv[2];
const outPath = process.argv[3];
const src = fs.readFileSync(srcPath, 'utf8');

const vmMod = { exports: {} };
const ctx = vm.createContext({ module: vmMod, exports: vmMod.exports });
vm.runInContext(src, ctx, { filename: srcPath });
const mod = vmMod.exports || {};

function isFamilyTable(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  const sample = obj[keys[0]];
  return Boolean(sample && typeof sample === 'object' && Array.isArray(sample.data));
}

function readLexicalOrContext(name) {
  if (Object.prototype.hasOwnProperty.call(ctx, name)) return ctx[name];
  try {
    return vm.runInContext(name, ctx);
  } catch (_) {
    return undefined;
  }
}

function resolveTable({ exportKeys, globalKeys, helperExport }) {
  for (const k of exportKeys) {
    if (isFamilyTable(mod[k])) return mod[k];
  }
  for (const k of globalKeys) {
    const val = readLexicalOrContext(k);
    if (isFamilyTable(val)) return val;
  }
  const helperFn = helperExport ? mod[helperExport] : null;
  if (typeof helperFn === 'function') {
    const seen = new Set();
    for (const match of helperFn.toString().matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\[/g)) {
      const ident = match[1];
      if (seen.has(ident)) continue;
      seen.add(ident);
      const val = readLexicalOrContext(ident);
      if (isFamilyTable(val)) return val;
    }
  }
  return null;
}

const specs = {
  family_compounds: {
    exportKeys: ['family_compounds', 'family_compound_json'],
    globalKeys: ['family_compounds', 'family_compound_json'],
    helperExport: 'makeFamilyCompoundHtml',
  },
  family_idioms: {
    exportKeys: ['family_idioms', 'family_idiom_json'],
    globalKeys: ['family_idioms', 'family_idiom_json'],
    helperExport: 'makeFamilyIdioms',
  },
  family_root: {
    exportKeys: ['family_root', 'family_root_json'],
    globalKeys: ['family_root', 'family_root_json'],
    helperExport: null,
  },
  family_sets: {
    exportKeys: ['family_sets', 'family_set_json'],
    globalKeys: ['family_sets', 'family_set_json'],
    helperExport: 'makeFamilySets',
  },
  family_word: {
    exportKeys: ['family_word', 'family_word_json'],
    globalKeys: ['family_word', 'family_word_json'],
    helperExport: 'makeFamilyWordHtml',
  },
};

const payload = {};
for (const [key, spec] of Object.entries(specs)) {
  const table = resolveTable(spec);
  if (!table) {
    throw new Error(`Missing DPD family table: ${key}`);
  }
  payload[key] = table;
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
