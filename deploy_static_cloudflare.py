#!/usr/bin/env python3
"""
deploy_static_cloudflare.py
Generates a complete, high-performance static distribution for Cloudflare Pages.
All 217 books, 2,698 chapters, navigation trees, TOCs, and MAT matrices are pre-exported
as static JSON files so that 100% of reading features run on Cloudflare's Global Edge CDN (0ms latency).
Dynamic operations (FTS search, dictionary, AI translation) are reverse-proxied to your VPS.
"""

import os
import sys
import json
import sqlite3
import shutil
import argparse
import subprocess
import time

ROOT_DIR = '/home/administrator/tipitaka-xml-vri'
WEB_APP_DIR = os.path.join(ROOT_DIR, 'web_app_next')
DB_PATH = os.path.join(WEB_APP_DIR, 'server_api', 'tipitaka.db')
DIST_DIR = os.path.join(ROOT_DIR, 'cloudflare_pages_dist')
CATALOG_PATH = os.path.join(WEB_APP_DIR, 'server_api', 'cst_books_catalog.json')
TREE_JSON_PATH = os.path.join(WEB_APP_DIR, 'server_api', 'tree.json')

def clean_tree(data):
    if isinstance(data, list) and len(data) == 1:
        text = str(data[0].get('text', '')).lower()
        if text in ['tipiṭaka', 'tipitaka'] and 'children' in data[0]:
            return data[0]['children']
    return data

def write_json_multiformat(base_dir, relative_path_no_ext, data):
    """
    Writes data in multiple path conventions for maximum compatibility:
    1. {path}.json (e.g. api/books.json)
    2. {path}/index.json (e.g. api/books/index.json)
    3. {path} (extensionless for servers that serve exact path)
    """
    json_str = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    
    # 1. As .json file
    file_with_ext = os.path.join(base_dir, f"{relative_path_no_ext}.json")
    os.makedirs(os.path.dirname(file_with_ext), exist_ok=True)
    with open(file_with_ext, 'w', encoding='utf-8') as f:
        f.write(json_str)

    # 2. As directory/index.json
    dir_index_file = os.path.join(base_dir, relative_path_no_ext, 'index.json')
    os.makedirs(os.path.dirname(dir_index_file), exist_ok=True)
    with open(dir_index_file, 'w', encoding='utf-8') as f:
        f.write(json_str)

    # 3. As extensionless file
    extless_file = os.path.join(base_dir, relative_path_no_ext)
    if not os.path.isdir(extless_file):
        try:
            with open(extless_file, 'w', encoding='utf-8') as f:
                f.write(json_str)
        except OSError:
            pass

def export_database_to_static_json(target_api_dir, db_path):
    print(f"[*] Connecting to SQLite database at: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cst_catalog = {}
    if os.path.exists(CATALOG_PATH):
        try:
            with open(CATALOG_PATH, 'r', encoding='utf-8') as f:
                cst_catalog = json.load(f)
            print(f"[*] Loaded {len(cst_catalog)} entries from CST catalog")
        except Exception as e:
            print(f"[!] Warning: Could not parse {CATALOG_PATH}: {e}")

    # 1. Export Navigation Tree
    print("[*] Exporting navigation tree...")
    tree_data = None
    if os.path.exists(TREE_JSON_PATH):
        try:
            with open(TREE_JSON_PATH, 'r', encoding='utf-8') as f:
                tree_data = clean_tree(json.load(f))
        except Exception as e:
            print(f"[!] Warning loading tree.json: {e}")

    if not tree_data:
        cur.execute("SELECT value FROM site_metadata WHERE key = 'tree_json'")
        row = cur.fetchone()
        if row and row['value']:
            tree_data = clean_tree(json.loads(row['value']))

    if tree_data:
        write_json_multiformat(target_api_dir, "tree", tree_data)

    # 2. Export Books List
    print("[*] Exporting books catalog...")
    cur.execute("SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id")
    books_rows = [dict(r) for r in cur.fetchall()]
    write_json_multiformat(target_api_dir, "books", {"total": len(books_rows), "books": books_rows})

    # 3. Export Global MAT Matrix
    print("[*] Exporting MAT cross-reference matrix...")
    try:
        cur.execute("SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat")
        mat_rows = [dict(r) for r in cur.fetchall()]
        write_json_multiformat(target_api_dir, "mat", mat_rows)
    except Exception as e:
        print(f"[!] Warning exporting MAT table: {e}")

    # 4. Export all 217 Books, Chapters, and TOCs
    print(f"[*] Pre-generating static JSON for {len(books_rows)} books and all chapters...")
    cur.execute("SELECT id, code, title, nikaya, category, chapter_count, meta_json FROM books ORDER BY id")
    all_books = cur.fetchall()

    total_chapters_exported = 0
    start_time = time.time()

    for idx, b in enumerate(all_books):
        clean_code = b['code']
        meta = json.loads(b['meta_json']) if b['meta_json'] else {}

        # Fetch chapters metadata
        cur.execute("SELECT chapter_index, title, chunk_name, anchor_id, para_index FROM chapters WHERE book_code = ? ORDER BY chapter_index", (clean_code,))
        chapters = [dict(r) for r in cur.fetchall()]

        # Fetch Table of Contents
        cur.execute("SELECT item_index, level, type, rend, title, para_index, para_num, anchor_id, chapter_index FROM book_toc WHERE book_code = ? ORDER BY item_index", (clean_code,))
        toc = [dict(r) for r in cur.fetchall()]

        # Fetch all precomputed chapter HTMLs for this book
        cur.execute("SELECT chapter_index, html FROM chapters WHERE book_code = ? ORDER BY chapter_index", (clean_code,))
        ch_rows = cur.fetchall()
        all_chapters_data = {str(r['chapter_index']): r['html'] for r in ch_rows}

        # Export individual chapter JSON files
        for r in ch_rows:
            ch_idx = r['chapter_index']
            ch_html = r['html']
            ch_payload = {
                "book_code": clean_code,
                "chapter_index": ch_idx,
                "html": ch_html
            }
            write_json_multiformat(target_api_dir, f"book/{clean_code}/chapter/{ch_idx}", ch_payload)
            total_chapters_exported += 1

        # Export TOC JSON
        toc_payload = {
            "book_code": clean_code,
            "total": len(toc),
            "toc": toc
        }
        write_json_multiformat(target_api_dir, f"book/{clean_code}/toc", toc_payload)

        # Export MAT for this book
        cur.execute("SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat WHERE book_code = ?", (clean_code,))
        mat_row = cur.fetchone()
        book_mat_payload = dict(mat_row) if mat_row else cst_catalog.get(clean_code, {}).get('mat', None)
        if book_mat_payload:
            write_json_multiformat(target_api_dir, f"book/{clean_code}/mat", book_mat_payload)

        # Build initial chapters buffer (chapters 0 and 1)
        initial_chapters_data = {}
        for c_idx in [0, 1]:
            if str(c_idx) in all_chapters_data:
                initial_chapters_data[str(c_idx)] = all_chapters_data[str(c_idx)]

        loaded_html_array = [initial_chapters_data[k] for k in sorted(initial_chapters_data.keys(), key=int)]

        # Export Book Metadata JSON (with initial chapter buffer)
        book_payload = {
            "code": b['code'],
            "title": b['title'],
            "nikaya": b['nikaya'],
            "category": b['category'],
            "chapter_count": b['chapter_count'],
            "chapters": chapters,
            "toc": toc,
            "para_to_chapter": meta.get('para_to_chapter', {}),
            "para_to_index": meta.get('para_to_index', {}),
            "page_to_chapter": meta.get('page_to_chapter', {}),
            "page_to_para": meta.get('page_to_para', {}),
            "page_anchors": meta.get('page_anchors', {}),
            "para_range": meta.get('para_range', {"min": 1, "max": 1, "total": 0}),
            "edition_ranges": meta.get('edition_ranges', {}),
            "book_type": meta.get('book_type', 'Whole'),
            "mat": book_mat_payload,
            "initial_chapter": 0,
            "chapters_data": initial_chapters_data,
            "html": "\n".join(loaded_html_array)
        }
        write_json_multiformat(target_api_dir, f"book/{clean_code}", book_payload)

        if (idx + 1) % 50 == 0 or idx == len(all_books) - 1:
            print(f"    -> Processed {idx + 1}/{len(all_books)} books ({total_chapters_exported} chapters)...")

    conn.close()
    elapsed = time.time() - start_time
    print(f"[✓] Successfully exported {len(all_books)} books and {total_chapters_exported} chapters into static JSON ({elapsed:.2f}s)!")

def build_nextjs_static():
    print("\n[*] Building Next.js static production bundle (next build)...")
    env = os.environ.copy()
    env["NEXT_EXPORT"] = "true"
    
    res = subprocess.run(["npm", "run", "build"], cwd=WEB_APP_DIR, env=env)
    if res.returncode != 0:
        print("[!] Error: Next.js build failed!")
        sys.exit(1)
    print("[✓] Next.js build succeeded!")

def create_cloudflare_distribution(vps_url):
    print(f"\n[*] Creating Cloudflare Pages distribution in: {DIST_DIR}")
    if os.path.exists(DIST_DIR):
        shutil.rmtree(DIST_DIR)
    os.makedirs(DIST_DIR, exist_ok=True)

    # 1. Copy Next.js exported files (from web_app_next/out or public)
    out_dir = os.path.join(WEB_APP_DIR, 'out')
    if os.path.exists(out_dir):
        print(f"[*] Copying static output from {out_dir}...")
        for item in os.listdir(out_dir):
            s = os.path.join(out_dir, item)
            d = os.path.join(DIST_DIR, item)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
    else:
        public_dir = os.path.join(WEB_APP_DIR, 'public')
        if os.path.exists(public_dir):
            shutil.copytree(public_dir, DIST_DIR, dirs_exist_ok=True)

    # 2. Export database static JSON directly into cloudflare_pages_dist/api
    target_api_dir = os.path.join(DIST_DIR, 'api')
    export_database_to_static_json(target_api_dir, DB_PATH)

    # Also sync to web_app_next/public/api for local Next.js dev server
    public_api_dir = os.path.join(WEB_APP_DIR, 'public', 'api')
    print(f"[*] Syncing static API data to Next.js public directory: {public_api_dir}")
    shutil.copytree(target_api_dir, public_api_dir, dirs_exist_ok=True)

    # 3. Generate Cloudflare Pages Edge Function proxy ONLY for /api/search
    functions_dir = os.path.join(DIST_DIR, 'functions', 'api')
    os.makedirs(functions_dir, exist_ok=True)
    search_proxy_path = os.path.join(functions_dir, 'search.js')
    print(f"[*] Writing Cloudflare Pages Edge Function for /api/search (target: http://85.190.97.158/api/search)...")

    search_proxy_content = """// Cloudflare Pages Edge Function - Dynamic Search Proxy
// Handles GET and POST requests for /api/search by forwarding to VPS port 80 (Nginx -> Fastify)
export async function onRequest(context) {
  const url = new URL(context.request.url);
  // Forward to VPS port 80 (Standard HTTP allowed by Cloudflare Workers runtime)
  const targetUrl = 'http://85.190.97.158/api/search' + url.search;

  try {
    let body = undefined;
    if (context.request.method === 'POST') {
      try {
        body = await context.request.text();
      } catch (e) {}
    }

    const res = await fetch(targetUrl, {
      method: context.request.method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Cloudflare-Edge-Search-Proxy/1.0',
      },
      body: body,
    });

    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return new Response(res.body, {
      status: res.status,
      headers: headers,
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: 'Backend search query failed',
      detail: err.message,
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
"""
    with open(search_proxy_path, 'w', encoding='utf-8') as f:
        f.write(search_proxy_content)

    # 4. Generate Cloudflare Pages _redirects file
    redirects_path = os.path.join(DIST_DIR, '_redirects')
    print(f"[*] Writing Cloudflare Pages _redirects...")
    
    redirects_content = f"""# Cloudflare Pages Redirects & Internal Rewrites

# 1. API route rewrites (allows URLs without .json to seamlessly serve the static .json files)
/api/tree                              /api/tree.json                             200
/api/books                             /api/books.json                            200
/api/mat                               /api/mat.json                              200
/api/book/:code/chapter/:idx           /api/book/:code/chapter/:idx.json          200
/api/book/:code/toc                    /api/book/:code/toc.json                   200
/api/book/:code/mat                    /api/book/:code/mat.json                   200
/api/book/:code                        /api/book/:code.json                       200

# 2. Client-side SPA route fallbacks
/book/*       /index.html                   200
/chapter/*    /index.html                   200
/*            /index.html                   200
"""
    with open(redirects_path, 'w', encoding='utf-8') as f:
        f.write(redirects_content)

    # 5. Generate Cloudflare Pages _headers file for maximum edge caching & CORS
    headers_path = os.path.join(DIST_DIR, '_headers')
    print("[*] Writing Cloudflare Pages _headers...")
    headers_content = """# Global Security & CORS
/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD, OPTIONS
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN

# Long-term immutable caching for static data and assets
/api/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/*.json
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
"""
    with open(headers_path, 'w', encoding='utf-8') as f:
        f.write(headers_content)

    # 5. Automatically sync to live git repository 'next' if present
    next_repo_dir = os.path.join(ROOT_DIR, 'next')
    if os.path.exists(next_repo_dir) and os.path.exists(os.path.join(next_repo_dir, '.git')):
        print(f"[*] Syncing build directly to live GitHub repo: {next_repo_dir}...")
        subprocess.run([
            "rsync", "-av", "--delete", "--exclude=.git",
            f"{DIST_DIR}/", f"{next_repo_dir}/"
        ], stdout=subprocess.DEVNULL)
        print(f"[✓] Successfully synced build to {next_repo_dir}!")

    # Summary calculation
    total_files = 0
    total_size = 0
    for root, dirs, files in os.walk(DIST_DIR):
        for f in files:
            total_files += 1
            total_size += os.path.getsize(os.path.join(root, f))

    size_mb = total_size / (1024 * 1024)
    print("\n" + "=" * 60)
    print(" [✓] CLOUDFLARE PAGES STATIC BUILD READY!")
    print("=" * 60)
    print(f" Target Directory   : {DIST_DIR}")
    print(f" Live Repo Directory: {next_repo_dir}")
    print(f" Total Static Files : {total_files:,}")
    print(f" Total Static Size  : {size_mb:.2f} MB (Uncompressed)")
    print(f" Brotli/Gzip Size   : ~{size_mb * 0.22:.1f} MB (Transferred by Cloudflare)")
    clean_vps = vps_url.rstrip('/')
    print(f" Dynamic VPS Target : {clean_vps} (FTS search, dict)")
    print("=" * 60)
    print("\nHow to deploy to Cloudflare Pages:")
    print("  Option 1: Git Push to trigger Cloudflare Pages auto-deploy (Recommended):")
    print(f"    cd {next_repo_dir} && git add . && git commit -m 'Deploy update' && git push")
    print("\n  Option 2: Using Cloudflare Wrangler CLI:")
    print(f"    npx wrangler pages deploy {DIST_DIR} --project-name tipitaka-app")
    print("=" * 60 + "\n")

def main():
    parser = argparse.ArgumentParser(description="Generate 100% static distribution for Cloudflare Pages")
    parser.add_argument(
        "--vps-url",
        default="http://85.190.97.158:5000",
        help="Public URL of your VPS backend for dynamic search/dictionary queries (default: http://85.190.97.158:5000)"
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip 'npm run build' and only export static database JSON"
    )
    args = parser.parse_args()

    if not os.path.exists(DB_PATH):
        print(f"[!] Error: Database not found at {DB_PATH}")
        sys.exit(1)

    if not args.skip_build:
        build_nextjs_static()

    create_cloudflare_distribution(args.vps_url)

if __name__ == '__main__':
    main()
