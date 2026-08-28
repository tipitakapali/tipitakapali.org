#!/usr/bin/env python3
"""
deploy_static_cloudflare.py
===========================
Generates a complete, high-performance static distribution of the Next.js Tipitaka
web application for Cloudflare Pages.

Features:
  1. Builds Next.js in static export mode (output: 'export') with Turbopack.
  2. Pre-exports all 217 books, 2,695+ chapters, navigation trees, TOCs, and MAT matrices
     as multi-format static JSON files so 100% of reading features run on Cloudflare's
     Global Edge CDN (0ms serverless latency).
  3. Generates Cloudflare Pages Edge Functions for dynamic backend operations:
     - Full-Text Search (/api/search)
     - Dictionary Lookups (/api/dict/lookup, /api/dict/inf, /api/dict/*)
     - Health status (/api/health)
     - Legacy dictionary endpoints (/api/dpd, /api/pts, etc.)
  4. Generates Cloudflare Pages '_redirects' for instant SPA client-side routing.
  5. Generates Cloudflare Pages '_headers' for global edge caching and CORS.
  6. Synchronizes to live Git repository for Cloudflare Pages auto-deployment.
  7. Syncs static API data to 'public/api' for local development.

Usage:
  python3 deploy_static_cloudflare.py                       # Full build & export
  python3 deploy_static_cloudflare.py --skip-build          # Skip Next.js build (data export only)
  python3 deploy_static_cloudflare.py --skip-export         # Skip JSON export (Next.js build only)
  python3 deploy_static_cloudflare.py --vps-url http://...  # Custom VPS backend URL
  python3 deploy_static_cloudflare.py --git-push            # Auto commit & push to GitHub
"""

import os
import sys
import json
import time
import shutil
import sqlite3
import argparse
import subprocess
from pathlib import Path

# Color styling for CLI output
class Color:
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BOLD = '\033[1m'
    DIM = '\033[2m'
    RESET = '\033[0m'

def log_info(msg: str):
    print(f"{Color.BLUE}[*]{Color.RESET} {msg}")

def log_success(msg: str):
    print(f"{Color.GREEN}[✓]{Color.RESET} {Color.BOLD}{msg}{Color.RESET}")

def log_warn(msg: str):
    print(f"{Color.YELLOW}[!]{Color.RESET} {msg}")

def log_error(msg: str):
    print(f"{Color.RED}[✗] {msg}{Color.RESET}")

def find_paths():
    """Resolve project directory structure and critical database files."""
    script_dir = Path(__file__).resolve().parent
    root_dir = script_dir.parent if (script_dir / 'server_api').exists() else script_dir
    web_app_dir = script_dir if (script_dir / 'package.json').exists() else root_dir / 'web_app_next'
    
    db_candidates = [
        web_app_dir / 'server_api' / 'db' / 'tipitaka.db',
        web_app_dir / 'server_api' / 'tipitaka.db',
        root_dir / 'tipitaka.db',
        root_dir / 'tipitaka_latin2.db',
    ]
    
    db_path = None
    for cand in db_candidates:
        if cand.exists():
            db_path = cand
            break

    catalog_path = web_app_dir / 'server_api' / 'cst_books_catalog.json'
    tree_json_path = web_app_dir / 'server_api' / 'tree.json'
    dist_dir = root_dir / 'cloudflare_pages_dist'
    git_repo_dir = root_dir / 'next_tipitakapali.org'

    return {
        'root_dir': root_dir,
        'web_app_dir': web_app_dir,
        'db_path': db_path,
        'catalog_path': catalog_path,
        'tree_json_path': tree_json_path,
        'dist_dir': dist_dir,
        'git_repo_dir': git_repo_dir,
    }

def clean_tree(data):
    """Normalize top-level navigation tree if wrapped in a single root element."""
    if isinstance(data, list) and len(data) == 1:
        text = str(data[0].get('text', '')).lower()
        if text in ['tipiṭaka', 'tipitaka'] and 'children' in data[0]:
            return data[0]['children']
    return data

def write_json_multiformat(base_dir: Path, relative_path_no_ext: str, data):
    """
    Writes data in multiple path conventions for maximum web server compatibility:
    1. {path}.json (e.g. api/books.json)
    2. {path}/index.json (e.g. api/books/index.json)
    """
    json_str = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    
    # 1. As .json file
    file_with_ext = base_dir / f"{relative_path_no_ext}.json"
    file_with_ext.parent.mkdir(parents=True, exist_ok=True)
    with open(file_with_ext, 'w', encoding='utf-8') as f:
        f.write(json_str)

    # 2. As directory/index.json
    dir_index_file = base_dir / relative_path_no_ext / 'index.json'
    dir_index_file.parent.mkdir(parents=True, exist_ok=True)
    with open(dir_index_file, 'w', encoding='utf-8') as f:
        f.write(json_str)

def export_database_to_static_json(target_api_dir: Path, db_path: Path, catalog_path: Path, tree_json_path: Path):
    """Export navigation, books, chapters, TOCs, and MAT cross-references into static JSON."""
    log_info(f"Connecting to SQLite database: {db_path}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cst_catalog = {}
    if catalog_path.exists():
        try:
            with open(catalog_path, 'r', encoding='utf-8') as f:
                cst_catalog = json.load(f)
            log_info(f"Loaded {len(cst_catalog)} entries from CST catalog: {catalog_path.name}")
        except Exception as e:
            log_warn(f"Could not parse catalog {catalog_path}: {e}")

    # 1. Export Navigation Tree
    log_info("Exporting navigation tree (/api/tree)...")
    tree_data = None
    if tree_json_path.exists():
        try:
            with open(tree_json_path, 'r', encoding='utf-8') as f:
                tree_data = clean_tree(json.load(f))
        except Exception as e:
            log_warn(f"Failed to read tree.json: {e}")

    if not tree_data:
        try:
            cur.execute("SELECT value FROM site_metadata WHERE key = 'tree_json'")
            row = cur.fetchone()
            if row and row['value']:
                tree_data = clean_tree(json.loads(row['value']))
        except Exception as e:
            log_warn(f"Failed to query tree_json from metadata: {e}")

    if tree_data:
        write_json_multiformat(target_api_dir, "tree", tree_data)

    # 2. Export Books List
    log_info("Exporting books catalog (/api/books)...")
    cur.execute("SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id")
    books_rows = [dict(r) for r in cur.fetchall()]
    write_json_multiformat(target_api_dir, "books", {"total": len(books_rows), "books": books_rows})

    # 3. Export Global MAT Matrix
    log_info("Exporting MAT cross-reference matrix (/api/mat)...")
    try:
        cur.execute("SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat")
        mat_rows = [dict(r) for r in cur.fetchall()]
        write_json_multiformat(target_api_dir, "mat", mat_rows)
    except Exception as e:
        log_warn(f"MAT table export note: {e}")

    # 4. Export all Books, Chapters, and TOCs
    log_info(f"Pre-generating static JSON for {len(books_rows)} books and chapters...")
    cur.execute("SELECT id, code, title, nikaya, category, chapter_count, meta_json FROM books ORDER BY id")
    all_books = cur.fetchall()

    total_chapters_exported = 0
    start_time = time.time()

    for idx, b in enumerate(all_books):
        clean_code = b['code']
        meta = json.loads(b['meta_json']) if b['meta_json'] else {}

        # Fetch chapters metadata
        cur.execute(
            "SELECT chapter_index, title, chunk_name, anchor_id, para_index FROM chapters WHERE book_code = ? ORDER BY chapter_index",
            (clean_code,)
        )
        chapters = [dict(r) for r in cur.fetchall()]

        # Fetch Table of Contents
        cur.execute(
            "SELECT item_index, level, type, rend, title, para_index, para_num, anchor_id, chapter_index FROM book_toc WHERE book_code = ? ORDER BY item_index",
            (clean_code,)
        )
        toc = [dict(r) for r in cur.fetchall()]

        # Fetch precomputed chapter HTMLs for this book
        cur.execute("SELECT chapter_index, html FROM chapters WHERE book_code = ? ORDER BY chapter_index", (clean_code,))
        ch_rows = cur.fetchall()
        all_chapters_data = {str(r['chapter_index']): r['html'] for r in ch_rows}

        # Export individual chapter JSON files (/api/book/{code}/chapter/{idx})
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

        # Export TOC JSON (/api/book/{code}/toc)
        toc_payload = {
            "book_code": clean_code,
            "total": len(toc),
            "toc": toc
        }
        write_json_multiformat(target_api_dir, f"book/{clean_code}/toc", toc_payload)

        # Export MAT for this book (/api/book/{code}/mat)
        cur.execute(
            "SELECT book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title FROM book_mat WHERE book_code = ?",
            (clean_code,)
        )
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

        # Export Book Metadata JSON with initial buffer (/api/book/{code})
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
            log_info(f"  Processed {idx + 1}/{len(all_books)} books ({total_chapters_exported} chapters)...")

    conn.close()
    elapsed = time.time() - start_time
    log_success(f"Exported {len(all_books)} books and {total_chapters_exported} chapters into static JSON ({elapsed:.2f}s)!")

def build_nextjs_static(web_app_dir: Path):
    """Run optimized production build of Next.js app in static export mode."""
    log_info("Building Next.js static production bundle (NEXT_EXPORT=true npm run build)...")
    env = os.environ.copy()
    env["NEXT_EXPORT"] = "true"
    env["STATIC_EXPORT"] = "true"
    
    start_time = time.time()
    res = subprocess.run(["npm", "run", "build"], cwd=str(web_app_dir), env=env)
    if res.returncode != 0:
        log_error("Next.js static export build failed!")
        sys.exit(1)
        
    elapsed = time.time() - start_time
    log_success(f"Next.js build and static export completed ({elapsed:.2f}s)!")

def generate_cloudflare_edge_functions(dist_dir: Path, vps_url: str):
    """
    Generate Cloudflare Pages Edge Functions (/functions/api/...)
    Dynamic ops (dict lookup/inf + FTS search) are now fetched DIRECTLY from
    https://api.tipitakapali.org (see web_app_next/services/api.js:getApiBase)
    to eliminate extra Worker hop. Only health proxy is kept.
    """
    functions_api_dir = dist_dir / 'functions' / 'api'
    functions_api_dir.mkdir(parents=True, exist_ok=True)
    # Remove stale proxy files/dirs (Worker hop eliminated — direct VPS)
    functions_dict_dir = functions_api_dir / 'dict'
    if functions_dict_dir.exists():
        shutil.rmtree(functions_dict_dir)
    stale_search = functions_api_dir / 'search.js'
    if stale_search.exists():
        stale_search.unlink()

    # If raw IP is provided, default to domain https://api.tipitakapali.org for Cloudflare Worker compliance
    configured_vps = vps_url.rstrip('/')
    if '85.190.97.158' in configured_vps:
        fallback_vps = 'https://api.tipitakapali.org'
    else:
        fallback_vps = configured_vps

    log_info(f"Generating Cloudflare Pages Edge Functions (VPS Target: {fallback_vps}) — dict+search directly via VPS, only health Worker")

    # 2 & 3. Dict + Search proxies REMOVED — served directly from https://api.tipitakapali.org
    # (see services/api.js:getApiBase). No functions/api/search.js or functions/api/dict/* generated.

    # 4. Health Proxy Function (/functions/api/health.js)
    health_proxy_code = f"""// Cloudflare Pages Edge Function - Health Status Proxy
export async function onRequest(context) {{
  const url = new URL(context.request.url);
  const vpsBase = (context.env && context.env.VPS_URL) || '{fallback_vps}';
  const cleanBase = vpsBase.replace(/\\/+$/, '');
  const targetUrl = cleanBase + '/api/health' + url.search;

  try {{
    const res = await fetch(targetUrl, {{
      headers: {{ 'User-Agent': 'Cloudflare-Edge-Health-Proxy/2.0' }}
    }});
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, {{
      status: res.status,
      headers: headers,
    }});
  }} catch (err) {{
    return new Response(JSON.stringify({{
      status: 'degraded',
      edge: 'online',
      vps_backend: 'unreachable',
      target: targetUrl,
      detail: err.message,
    }}), {{
      status: 200,
      headers: {{
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      }},
    }});
  }}
}}
"""
    with open(functions_api_dir / 'health.js', 'w', encoding='utf-8') as f:
        f.write(health_proxy_code)

    log_success("Generated all Cloudflare Pages Edge Functions in /functions/api")


def generate_cloudflare_redirects(dist_dir: Path):
    """Generate '_redirects' file for Cloudflare Pages routing and SPA fallbacks."""
    redirects_file = dist_dir / '_redirects'
    log_info("Generating Cloudflare Pages '_redirects'...")

    content = """# Cloudflare Pages Redirects & Internal Rewrites
# =================================================

# 1. API Static Route Rewrites (Seamless JSON Serving)
/api/tree                              /api/tree.json                             200
/api/books                             /api/books.json                            200
/api/mat                               /api/mat.json                              200
/api/book/:code/chapter/:idx           /api/book/:code/chapter/:idx.json          200
/api/book/:code/toc                    /api/book/:code/toc.json                   200
/api/book/:code/mat                    /api/book/:code/mat.json                   200
/api/book/:code                        /api/book/:code.json                       200

# 2. Client-side Single Page Application (SPA) Route Fallbacks
/book/*       /index.html                   200
/chapter/*    /index.html                   200
/*            /index.html                   200
"""
    with open(redirects_file, 'w', encoding='utf-8') as f:
        f.write(content)
    log_success("Created Cloudflare Pages '_redirects'")

def generate_cloudflare_headers(dist_dir: Path):
    """Generate '_headers' file for global Edge caching, CORS, and security."""
    headers_file = dist_dir / '_headers'
    log_info("Generating Cloudflare Pages '_headers'...")

    content = """# Global Security & CORS Policies
/*
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET, HEAD, OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin

# Long-term Immutable Caching for Next.js Static JS/CSS Assets & Fonts (1 Year)
/_next/static/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/icons/*
  Cache-Control: public, max-age=2592000, immutable

# Static API JSON Data (1 Day Edge Cache + 7 Days Stale-While-Revalidate)
/api/*
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
  Access-Control-Allow-Origin: *

/*.json
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800
  Access-Control-Allow-Origin: *

"""
    with open(headers_file, 'w', encoding='utf-8') as f:
        f.write(content)
    log_success("Created Cloudflare Pages '_headers'")

def sync_to_git_repo(dist_dir: Path, git_repo_dir: Path, auto_commit: bool, commit_msg: str, auto_push: bool):
    """Sync distribution to live Git repository and optionally commit and push."""
    if not git_repo_dir.exists() or not (git_repo_dir / '.git').exists():
        log_warn(f"Git repo not found at {git_repo_dir}. Skipping auto-sync.")
        return

    log_info(f"Syncing static build directly to live Git repo: {git_repo_dir}...")
    res = subprocess.run([
        "rsync", "-av", "--delete", "--exclude=.git",
        f"{dist_dir}/", f"{git_repo_dir}/"
    ], capture_output=True, text=True)

    if res.returncode != 0:
        log_error(f"Rsync failed: {res.stderr}")
        return

    log_success(f"Synchronized distribution into {git_repo_dir}")

    if auto_commit or auto_push:
        log_info(f"Staging and committing in {git_repo_dir}...")
        subprocess.run(["git", "add", "."], cwd=str(git_repo_dir), check=False)
        
        status_res = subprocess.run(["git", "status", "--porcelain"], cwd=str(git_repo_dir), capture_output=True, text=True)
        if status_res.stdout.strip():
            msg = commit_msg or f"Static release deploy: {time.strftime('%Y-%m-%d %H:%M:%S')}"
            subprocess.run(["git", "commit", "-m", msg], cwd=str(git_repo_dir), check=False)
            log_success(f"Committed changes: '{msg}'")
        else:
            log_info("No new changes detected in Git repository.")

        if auto_push:
            log_info("Pushing updates to remote origin...")
            push_res = subprocess.run(["git", "push", "origin", "main"], cwd=str(git_repo_dir), capture_output=True, text=True)
            if push_res.returncode == 0:
                log_success("Pushed to origin main! Cloudflare Pages build triggered.")
            else:
                log_warn(f"Git push warning: {push_res.stderr or push_res.stdout}")

def print_summary(dist_dir: Path, git_repo_dir: Path, vps_url: str):
    """Print comprehensive build & deployment summary."""
    total_files = 0
    total_size = 0
    for root, _, files in os.walk(str(dist_dir)):
        for f in files:
            total_files += 1
            total_size += os.path.getsize(os.path.join(root, f))

    size_mb = total_size / (1024 * 1024)
    clean_vps = vps_url.rstrip('/')

    print("\n" + "=" * 68)
    print(f" {Color.GREEN}{Color.BOLD}[✓] CLOUDFLARE PAGES STATIC BUILD READY!{Color.RESET}")
    print("=" * 68)
    print(f" Output Directory   : {dist_dir}")
    if git_repo_dir.exists():
        print(f" Live Git Repo      : {git_repo_dir}")
    print(f" Total Static Files : {total_files:,}")
    print(f" Total Static Size  : {size_mb:.2f} MB (Uncompressed)")
    print(f" Brotli/Gzip Size   : ~{size_mb * 0.22:.1f} MB (Transferred by Cloudflare)")
    print(f" Dynamic VPS Target : {clean_vps} (FTS search, dict, inf)")
    print("=" * 68)
    print("\nHow to deploy to Cloudflare Pages:")
    print("  Option 1: Git Push (Automatic Cloudflare Pages Deploy):")
    print(f"    cd {git_repo_dir} && git add . && git commit -m 'Deploy update' && git push")
    print("\n  Option 2: Cloudflare Wrangler CLI:")
    print(f"    npx wrangler pages deploy {dist_dir} --project-name tipitaka-app")
    print("=" * 68 + "\n")

def main():
    parser = argparse.ArgumentParser(
        description="Generate high-performance static distribution for Cloudflare Pages."
    )
    parser.add_argument(
        "--vps-url",
        default=os.environ.get("VPS_URL", "http://85.190.97.158"),
        help="Public URL of VPS backend for dynamic search/dictionary queries (default: http://85.190.97.158)"
    )
    parser.add_argument(
        "--site-url",
        default=os.environ.get("SITE_URL", "https://tipitakapali.org"),
        help="Canonical public site URL for sitemap and SEO (default: https://tipitakapali.org)"
    )


    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip 'npm run build' and only export static database JSON"
    )
    parser.add_argument(
        "--skip-export",
        action="store_true",
        help="Skip database static JSON export and only build Next.js frontend"
    )
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Custom output distribution directory path"
    )
    parser.add_argument(
        "--git-repo",
        default=None,
        help="Custom path to the connected Git repository for auto-sync"
    )
    parser.add_argument(
        "--git-push",
        action="store_true",
        help="Automatically commit and push to remote origin"
    )
    parser.add_argument(
        "--commit-msg",
        default=None,
        help="Custom Git commit message"
    )
    args = parser.parse_args()

    paths = find_paths()
    dist_dir = Path(args.out_dir).resolve() if args.out_dir else paths['dist_dir']
    git_repo_dir = Path(args.git_repo).resolve() if args.git_repo else paths['git_repo_dir']
    web_app_dir = paths['web_app_dir']
    db_path = paths['db_path']

    if not db_path or not db_path.exists():
        log_error(f"Database not found. Checked: {paths['root_dir']}")
        sys.exit(1)

    print(f"\n{Color.BOLD}Chaṭṭha Saṅgāyana Tipiṭaka - Cloudflare Pages Static Generator{Color.RESET}")
    print(f"Web App Directory: {web_app_dir}")
    print(f"Database Path    : {db_path}")
    print(f"Target Dist Dir  : {dist_dir}\n")

    # 1. Build Next.js static bundle
    if not args.skip_build:
        build_nextjs_static(web_app_dir)

    # 2. Prepare distribution directory
    dist_dir.mkdir(parents=True, exist_ok=True)
    out_dir = web_app_dir / 'out'
    if out_dir.exists():
        log_info(f"Copying Next.js static files from {out_dir} to {dist_dir}...")
        for item in os.listdir(str(out_dir)):
            s = out_dir / item
            d = dist_dir / item
            if s.is_dir():
                shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
    else:
        log_warn(f"Directory {out_dir} not found. Copying public/ assets instead...")
        public_dir = web_app_dir / 'public'
        if public_dir.exists():
            shutil.copytree(public_dir, dist_dir, dirs_exist_ok=True)

    # 3. Export Database to Static JSON directly into cloudflare_pages_dist/api
    target_api_dir = dist_dir / 'api'
    if not args.skip_export:
        export_database_to_static_json(
            target_api_dir=target_api_dir,
            db_path=db_path,
            catalog_path=paths['catalog_path'],
            tree_json_path=paths['tree_json_path']
        )

        # Sync static API data to public/api for offline local dev
        public_api_dir = web_app_dir / 'public' / 'api'
        log_info(f"Syncing static API data to local development folder: {public_api_dir}")
        shutil.copytree(target_api_dir, public_api_dir, dirs_exist_ok=True)

    # 4. Generate Cloudflare Edge Functions
    generate_cloudflare_edge_functions(dist_dir, args.vps_url)

    # 5. Generate _redirects & _headers
    generate_cloudflare_redirects(dist_dir)
    generate_cloudflare_headers(dist_dir)

    # 6. Generate SEO & AI Agent Metadata (sitemap.xml, robots.txt, llms.txt, llms-full.txt, site.jsonld)
    try:
        from generate_seo_ai_metadata import (
            generate_sitemap_xml,
            generate_robots_txt,
            generate_llms_txt,
            generate_llms_full_txt,
            generate_schema_jsonld,
        )

        log_info(f"Generating SEO & AI Agent metadata files for {args.site_url}...")
        conn_seo = sqlite3.connect(str(db_path))
        conn_seo.row_factory = sqlite3.Row
        cur_seo = conn_seo.cursor()
        cur_seo.execute("SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id")
        seo_books = [dict(r) for r in cur_seo.fetchall()]
        cur_seo.execute("SELECT book_code, chapter_index, title FROM chapters ORDER BY book_code, chapter_index")
        seo_chapters = [dict(r) for r in cur_seo.fetchall()]
        conn_seo.close()

        seo_catalog = {}
        if paths['catalog_path'].exists():
            try:
                with open(paths['catalog_path'], 'r', encoding='utf-8') as f:
                    seo_catalog = json.load(f)
            except Exception:
                pass

        s_url = args.site_url.rstrip('/')
        sitemap_content = generate_sitemap_xml(seo_books, seo_chapters, s_url)
        robots_content = generate_robots_txt(s_url)
        llms_content = generate_llms_txt(s_url, len(seo_books), len(seo_chapters))
        llms_full_content = generate_llms_full_txt(s_url, seo_books, seo_catalog)
        jsonld_content = generate_schema_jsonld(s_url, seo_books)

        for target in [dist_dir, web_app_dir / 'public', git_repo_dir]:
            if target.exists():
                with open(target / 'sitemap.xml', 'w', encoding='utf-8') as f:
                    f.write(sitemap_content)
                with open(target / 'robots.txt', 'w', encoding='utf-8') as f:
                    f.write(robots_content)
                with open(target / 'llms.txt', 'w', encoding='utf-8') as f:
                    f.write(llms_content)
                with open(target / 'llms-full.txt', 'w', encoding='utf-8') as f:
                    f.write(llms_full_content)
                with open(target / 'site.jsonld', 'w', encoding='utf-8') as f:
                    f.write(jsonld_content)

        log_success(f"Generated sitemap.xml ({len(seo_books) + len(seo_chapters) + 1:,} URLs), robots.txt, llms.txt, llms-full.txt, site.jsonld")
    except Exception as e:
        log_warn(f"SEO/AI metadata generation note: {e}")

    # 7. Synchronize with Git repository
    sync_to_git_repo(
        dist_dir=dist_dir,
        git_repo_dir=git_repo_dir,
        auto_commit=args.git_push or bool(args.commit_msg),
        commit_msg=args.commit_msg,
        auto_push=args.git_push
    )

    # 8. Display complete summary
    print_summary(dist_dir, git_repo_dir, args.vps_url)

if __name__ == '__main__':
    main()


