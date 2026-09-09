#!/usr/bin/env python3
"""
export_static_cloudflare.py
===========================
Unified high-performance static generator for Cloudflare Pages.
Consolidates website static export, CST database static JSON export,
and per-book translation static JSON export into a single script.

Interactive Menu Options:
  Press 1: Export ONLY static website files for Cloudflare Pages
  Press 2: Export ONLY static translation JSON files
  Press 3: Export BOTH static website and translation JSON files

Safety Guarantees:
  - In Option 1: Translation directories (--filter=P /api/book/*/translation/***)
    are protected from rsync --delete so translation JSONs in next_tipitakapali.org
    are never deleted when exporting website files.
  - In Option 2: Existing translation JSON files for the selected languages are
    cleaned first and regenerated fresh, guaranteeing 0 obsolete translation files.
  - In Option 3: Runs Option 1 followed by Option 2 for a complete, clean release.
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


TRANSLATION_REDIRECT_RULE = "/api/book/:code/translation/:lang         /api/book/:code/translation/:lang.json          200"


def find_paths():
    """Resolve project directory structure and critical database files."""
    script_dir = Path(__file__).resolve().parent
    root_dir = script_dir.parent if (script_dir / 'server_api').exists() else script_dir
    web_app_dir = script_dir if (script_dir / 'package.json').exists() else root_dir / 'web_app_next'

    db_candidates = [
        web_app_dir / 'dev_build_vri_db_2026' / 'output' / 'tipitaka.db',
        web_app_dir / 'server_api' / 'db' / 'tipitaka.db',
    ]

    db_path = None
    for cand in db_candidates:
        if cand.exists():
            db_path = cand
            break

    db_dir = web_app_dir / 'server_api' / 'db'
    catalog_path = web_app_dir / 'server_api' / 'cst_books_catalog.json'
    book_mat_path = web_app_dir / 'server_api' / 'book_mat.json'
    if not book_mat_path.exists():
        book_mat_path = web_app_dir / 'dev_build_vri_db_2026' / 'metadata' / 'book_mat.json'
    tree_json_path = web_app_dir / 'server_api' / 'tree.json'
    dist_dir = web_app_dir / 'cloudflare_pages_dist'
    public_api_dir = web_app_dir / 'public' / 'api'
    git_repo_dir = web_app_dir / 'next_tipitakapali.org'

    return {
        'root_dir': root_dir,
        'web_app_dir': web_app_dir,
        'db_path': db_path,
        'db_dir': db_dir,
        'catalog_path': catalog_path,
        'book_mat_path': book_mat_path,
        'tree_json_path': tree_json_path,
        'dist_dir': dist_dir,
        'public_api_dir': public_api_dir,
        'git_repo_dir': git_repo_dir,
    }

def clean_tree(data):
    """Normalize top-level navigation tree if wrapped in a single root element."""
    if isinstance(data, list) and len(data) == 1:
        text = str(data[0].get('text', '')).lower()
        if text in ['tipiṭaka', 'tipitaka'] and 'children' in data[0]:
            return data[0]['children']
    return data

def load_pali_sentences_db(web_app_dir):
    """Open the prebuilt Pāḷi sentence store (build_pali_sentences_db.py).

    Returns (conn, {book_code: {chapter: {para_index: [{line, text}]}}})
    with the whole table read once — far cheaper than per-book queries.
    Line numbers align with translation line_ids by construction.
    """
    import sqlite3 as _sqlite3
    db_path = web_app_dir / 'server_api' / 'db' / 'pali_sentences.db'
    if not db_path.exists():
        log_warn(f"pali_sentences.db not found at {db_path} — skipping Pāḷi sentence export (run server_api/build_pali_sentences_db.py)")
        return None, {}
    conn = _sqlite3.connect(str(db_path))
    conn.row_factory = _sqlite3.Row
    books = {}
    for r in conn.execute(
        'SELECT book_code, chapter_index, para_index, line_id, sentence FROM pali_sentences '
        'ORDER BY book_code, chapter_index, para_index, line_id'
    ):
        chmap = books.setdefault(r['book_code'], {})
        pmap = chmap.setdefault(str(r['chapter_index']), {})
        pmap.setdefault(str(r['para_index']), []).append({'line': r['line_id'], 'text': r['sentence']})
    return conn, books

def write_json_multiformat(base_dir: Path, relative_path_no_ext: str, data):
    """
    Writes data as a single {path}.json file.
    Previously wrote a duplicate {path}/index.json copy for server compat;
    removed to halve file count — _redirects rewrites
    (/api/book/:code -> /api/book/:code.json) already cover clean URLs,
    and the SPA fetches the .json variant directly (services/api.js).
    """
    json_str = json.dumps(data, ensure_ascii=False, separators=(',', ':'))

    # Single canonical file
    file_with_ext = base_dir / f"{relative_path_no_ext}.json"
    file_with_ext.parent.mkdir(parents=True, exist_ok=True)
    with open(file_with_ext, 'w', encoding='utf-8') as f:
        f.write(json_str)


def cleanup_stale_index_json(target_api_dir: Path):
    """Remove legacy {path}/index.json duplicates from earlier dual-write exports."""
    removed = 0
    if not target_api_dir.exists():
        return removed
    for idx_file in target_api_dir.rglob('index.json'):
        try:
            idx_file.unlink()
            removed += 1
            # Prune now-empty parent dirs (e.g. api/book/<code>/chapter/0/)
            # without touching dirs that still hold the canonical .json file.
            parent = idx_file.parent
            try:
                if parent != target_api_dir and not any(parent.iterdir()):
                    parent.rmdir()
            except OSError:
                pass
        except OSError:
            pass
    if removed:
        log_info(f"Removed {removed} stale index.json duplicates")
    return removed

def export_database_to_static_json(target_api_dir: Path, db_path: Path, catalog_path: Path, tree_json_path: Path, book_mat_path: Path = None, include_paragraphs: bool = False):
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

    book_mat_catalog = {}
    if book_mat_path and book_mat_path.exists():
        try:
            with open(book_mat_path, 'r', encoding='utf-8') as f:
                book_mat_catalog = json.load(f)
            log_info(f"Loaded {len(book_mat_catalog)} entries from book_mat.json")
        except Exception as e:
            log_warn(f"Could not parse book_mat.json {book_mat_path}: {e}")

    # Pāḷi sentence splits for sentence display mode (epitaka segmentation).
    pali_sent_conn, pali_sent_books = load_pali_sentences_db(Path(catalog_path).parent.parent)
    if pali_sent_books:
        log_info(f"Loaded Pāḷi sentences for {len(pali_sent_books)} books")

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

    # 3b. Export Global MAT Chapter Map (/api/mat/chapter_map)
    log_info("Exporting canonical MAT chapter map (/api/mat/chapter_map)...")
    try:
        cur.execute(
            "SELECT source_book, source_chapter, mula_book, mula_chapter, mula_title, "
            "attha_book, attha_chapter, attha_title, tika_book, tika_chapter, tika_title "
            "FROM mat_chapter_map ORDER BY source_book, source_chapter"
        )
        mat_chap_rows = [dict(r) for r in cur.fetchall()]
        write_json_multiformat(target_api_dir, "mat/chapter_map", {"total": len(mat_chap_rows), "chapters": mat_chap_rows})
    except Exception as e:
        log_warn(f"MAT chapter map export note: {e}")

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
        written_chapter_idxs = set()
        for r in ch_rows:
            ch_idx = r['chapter_index']
            ch_html = r['html']
            ch_payload = {
                "book_code": clean_code,
                "chapter_index": ch_idx,
                "html": ch_html
            }
            write_json_multiformat(target_api_dir, f"book/{clean_code}/chapter/{ch_idx}", ch_payload)
            written_chapter_idxs.add(str(ch_idx))
            total_chapters_exported += 1

        # Prune orphan chapter files left over from earlier database builds
        # (e.g. chapter indexes that no longer exist in the current DB).
        # Without this, stale chapter JSONs accumulate in the deployment and can
        # surface as phantom 404-capable URLs.
        chapter_dir = target_api_dir / 'book' / clean_code / 'chapter'
        if chapter_dir.exists():
            for stale_ch in chapter_dir.glob('*.json'):
                if stale_ch.stem.isdigit() and stale_ch.stem not in written_chapter_idxs:
                    try:
                        stale_ch.unlink()
                    except OSError:
                        pass
            # Drop the directory entirely if this book now has zero chapters.
            if not any(chapter_dir.iterdir()):
                try:
                    chapter_dir.rmdir()
                except OSError:
                    pass

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
        mat_entry = book_mat_catalog.get(clean_code, {})
        book_mat_payload = dict(mat_row) if mat_row else dict(mat_entry) if mat_entry else cst_catalog.get(clean_code, {}).get('mat', None)
        if book_mat_payload and mat_entry:
            for k in ['chapter_has_own_paras', 'attha_start_chapter', 'tika_start_chapter', 'mula_chapter_offset', 'attha_chapter_offset', 'tika_chapter_offset', 'sub_books', 'sub_book', 'split_targets']:
                if k in mat_entry and k not in book_mat_payload:
                    book_mat_payload[k] = mat_entry[k]
        if book_mat_payload:
            write_json_multiformat(target_api_dir, f"book/{clean_code}/mat", book_mat_payload)
        else:
            # Book no longer has MAT relations — remove any stale previous export.
            stale_mat_file = target_api_dir / 'book' / clean_code / 'mat.json'
            try:
                if stale_mat_file.exists():
                    stale_mat_file.unlink()
            except OSError:
                pass

        # Export book-specific MAT chapter map (/api/book/{code}/mat_chapter_map)
        try:
            cur.execute(
                "SELECT source_chapter, mula_book, mula_chapter, mula_title, "
                "attha_book, attha_chapter, attha_title, tika_book, tika_chapter, tika_title "
                "FROM mat_chapter_map WHERE source_book = ? ORDER BY source_chapter",
                (clean_code,)
            )
            b_chap_rows = [dict(r) for r in cur.fetchall()]
            if b_chap_rows:
                write_json_multiformat(target_api_dir, f"book/{clean_code}/mat_chapter_map", {
                    "book_code": clean_code,
                    "total": len(b_chap_rows),
                    "chapters": b_chap_rows
                })
            else:
                stale_map_file = target_api_dir / 'book' / clean_code / 'mat_chapter_map.json'
                try:
                    if stale_map_file.exists():
                        stale_map_file.unlink()
                except OSError:
                    pass
        except Exception as e:
            pass

        # Export book-specific MAT para map (/api/book/{code}/mat_para_map)
        try:
            cur.execute(
                "SELECT source_chapter, source_para, sub_book, mula_book, mula_chapter, mula_para, mula_title, "
                "attha_book, attha_chapter, attha_para, attha_title, tika_book, tika_chapter, tika_para, tika_title "
                "FROM mat_para_map WHERE source_book = ? ORDER BY source_chapter, CAST(source_para AS INTEGER)",
                (clean_code,)
            )
            b_para_rows = [dict(r) for r in cur.fetchall()]
            if b_para_rows:
                write_json_multiformat(target_api_dir, f"book/{clean_code}/mat_para_map", {
                    "book_code": clean_code,
                    "total": len(b_para_rows),
                    "paras": b_para_rows
                })
            else:
                stale_map_file = target_api_dir / 'book' / clean_code / 'mat_para_map.json'
                try:
                    if stale_map_file.exists():
                        stale_map_file.unlink()
                except OSError:
                    pass
        except Exception as e:
            pass

        # Export book-specific Pāḷi sentence splits (/api/book/{code}/pali_sentences)
        # Sentence display mode payload: chapters -> para_index -> [{line, text}],
        # from the prebuilt pali_sentences.db (epitaka segmentation; line numbers
        # align with translation line_ids). Same payload as VPS /api/book/:code/pali_sentences.
        try:
            sent_chapters = pali_sent_books.get(clean_code)
            if sent_chapters:
                write_json_multiformat(target_api_dir, f"book/{clean_code}/pali_sentences", {
                    "book_code": clean_code,
                    "chapters": sent_chapters
                })
            else:
                stale_sent_file = target_api_dir / 'book' / clean_code / 'pali_sentences.json'
                try:
                    if stale_sent_file.exists():
                        stale_sent_file.unlink()
                except OSError:
                    pass
        except Exception as e:
            pass

        # Export book-specific canon paragraphs with GUIDs (/api/book/{code}/paragraphs)
        # Opt-in only (--with-paragraphs): nothing in services/api.js fetches this;
        # it is an LLM/GUID dump (~140MB unique, ~280MB with legacy dup).
        if include_paragraphs:
            try:
                cur.execute(
                    "SELECT guid, sub_book, chapter_index, chapter_title, sutta_title, para_index, para_num, rend, pali_text, word_count, mula_guid, attha_guid, tika_guid, match_quality "
                    "FROM canon_paragraphs WHERE book_code = ? ORDER BY para_index",
                    (clean_code,)
                )
                canon_p_rows = [dict(r) for r in cur.fetchall()]
                if canon_p_rows:
                    write_json_multiformat(target_api_dir, f"book/{clean_code}/paragraphs", {
                        "book_code": clean_code,
                        "total": len(canon_p_rows),
                        "paragraphs": canon_p_rows
                    })
                else:
                    stale_par_file = target_api_dir / 'book' / clean_code / 'paragraphs.json'
                    try:
                        if stale_par_file.exists():
                            stale_par_file.unlink()
                    except OSError:
                        pass
            except Exception as e:
                pass

        # Build initial chapters buffer (chapters 0 and 1)
        initial_chapters_data = {}
        for c_idx in [0, 1]:
            if str(c_idx) in all_chapters_data:
                initial_chapters_data[str(c_idx)] = all_chapters_data[str(c_idx)]

        loaded_html_array = [initial_chapters_data[k] for k in sorted(initial_chapters_data.keys(), key=int)]

        cat_entry = cst_catalog.get(clean_code, {})

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
            "mat": meta.get('mat') or book_mat_payload,
            "chapter_to_mat": meta.get('chapter_to_mat', None),
            "para_to_mat": meta.get('para_to_mat', None),
            "sub_books_para_to_mat": meta.get('sub_books_para_to_mat', None),
            "sub_books": meta.get('sub_books') or cat_entry.get('sub_books', None),
            "sub_book": meta.get('sub_book') or cat_entry.get('sub_book', None),
            "chapter_to_sub_book": meta.get('chapter_to_sub_book') or cat_entry.get('chapter_to_sub_book', None),
            "sub_books_para_to_chapter": meta.get('sub_books_para_to_chapter') or cat_entry.get('sub_books_para_to_chapter', None),
            "chapter_to_paras": meta.get('chapter_to_paras', None),
            "chapter_has_own_paras": meta.get('chapter_has_own_paras', None) or (book_mat_payload.get('chapter_has_own_paras') if book_mat_payload else False),
            "attha_start_chapter": meta.get('attha_start_chapter', None) or (book_mat_payload.get('attha_start_chapter') if book_mat_payload else None),
            "tika_start_chapter": meta.get('tika_start_chapter', None) or (book_mat_payload.get('tika_start_chapter') if book_mat_payload else None),
            "split_targets": meta.get('split_targets') or cat_entry.get('split_targets', None),
            "mula_chapter": meta.get('mula_chapter', None),
            "mula_chapter_offset": meta.get('mula_chapter_offset', None) or (book_mat_payload.get('mula_chapter_offset') if book_mat_payload else None),
            "attha_chapter_offset": meta.get('attha_chapter_offset', None) or (book_mat_payload.get('attha_chapter_offset') if book_mat_payload else None),
            "initial_chapter": 0,
            "chapters_data": initial_chapters_data,
            "html": "\n".join(loaded_html_array)
        }
        write_json_multiformat(target_api_dir, f"book/{clean_code}", book_payload)

        if (idx + 1) % 50 == 0 or idx == len(all_books) - 1:
            log_info(f"  Processed {idx + 1}/{len(all_books)} books ({total_chapters_exported} chapters)...")

    # Prune per-book directories for books that no longer exist in the current DB.
    books_dir = target_api_dir / 'book'
    if books_dir.exists():
        valid_codes = {str(b['code']) for b in all_books}
        for stale_dir in books_dir.iterdir():
            if stale_dir.is_dir() and stale_dir.name not in valid_codes:
                try:
                    shutil.rmtree(stale_dir)
                    log_info(f"Removed orphan book export dir: {stale_dir.name}")
                except OSError as e:
                    log_warn(f"Could not remove orphan book export dir {stale_dir.name}: {e}")

    conn.close()
    if pali_sent_conn:
        try:
            pali_sent_conn.close()
        except Exception:
            pass
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

def generate_spa_fallback_functions(dist_dir: Path):
    """
    LEGACY OPT-IN backup (--with-spa-fallback). Minimal scoped Functions: ONLY
    /book/* and /chapter/* SPA fallback. Not generated by default: every hit on
    those paths costs 1 Workers invocation, and search/AI crawlers following the
    49k-URL sitemap can single-handedly exhaust the 100k/day Free quota
    (Error 1027 for everyone). Prefer the zero-quota URL Rewrite rules (README §4).

    Why Functions (not _redirects) when the backup IS needed:
    - Cloudflare's validator rejects `/book/* /index.html 200` as an infinite
      loop (deploy log: rules ignored), so _redirects cannot do SPA fallback.
    - Even if accepted, _redirects 200 rewrites always win over static files,
      which would shadow the 217 pre-rendered SEO pages. Functions try the
      real asset first and serve the shell only on 404.
    Quota containment: _routes.json includes ONLY /book/* and /chapter/*, so
    /api/*, /_next/*, fonts, and / stay pure static (unlimited). No middleware,
    no dict/search/health proxies — the browser calls api.tipitakapali.org
    and static JSON directly (services/api.js:getApiBase + fetchMatStaticMap).
    """
    functions_dir = dist_dir / 'functions'
    # Remove legacy quota-burning functions (middleware, api proxies)
    for stale in [
        functions_dir / '_middleware.js',
        functions_dir / 'api',
    ]:
        if stale.exists():
            shutil.rmtree(stale) if stale.is_dir() else stale.unlink()

    chapter_redirect_code = r'''// Cloudflare Pages Edge Function - Legacy Chapter URL Redirects
// The pre-Next.js static site used 0-indexed chapter suffixes, e.g.
//   /chapter/abh03m10.mul8  ->  301  /book/abh03m10.mul/9
// Other /chapter/* paths serve the SPA shell (client router takes over).
// NOTE: fetch "/" and NOT "/index.html" (Cloudflare 308-canonicalizes
// /index.html -> /, which would bounce the URL to the homepage).
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const match = url.pathname.match(/^\/chapter\/(.+?\.(?:mul|att|tik|nrf))(\d+)\/?$/i);
  if (match) {
    const target = url.origin + '/book/' + match[1] + '/' + (parseInt(match[2], 10) + 1);
    return Response.redirect(target, 301);
  }
  const shellUrl = new URL('/', url.origin);
  return context.env.ASSETS.fetch(new Request(shellUrl, context.request));
}
'''
    book_shell_code = r'''// Cloudflare Pages Edge Function - /book/* SPA Shell & Script-Prefix Fallback
// Pre-rendered SEO pages serve directly when the file exists; otherwise the
// SPA shell at "/" is served so the client router (window.location.pathname)
// opens script-prefixed codes (/book/si.s0102m.mul) and chapter deep-links
// (/book/s0102m.mul/5). Fetch "/" and NOT "/index.html" (308 canonicalization).
export async function onRequest(context) {
  const asset = await context.env.ASSETS.fetch(context.request);
  if (asset.status !== 404) {
    return asset;
  }
  const url = new URL(context.request.url);
  const shellUrl = new URL('/', url.origin);
  return context.env.ASSETS.fetch(new Request(shellUrl, context.request));
}
'''
    functions_chapter_dir = functions_dir / 'chapter'
    functions_chapter_dir.mkdir(parents=True, exist_ok=True)
    with open(functions_chapter_dir / '[[path]].js', 'w', encoding='utf-8') as f:
        f.write(chapter_redirect_code)

    functions_book_dir = functions_dir / 'book'
    functions_book_dir.mkdir(parents=True, exist_ok=True)
    with open(functions_book_dir / '[[path]].js', 'w', encoding='utf-8') as f:
        f.write(book_shell_code)

    log_success("Generated scoped SPA fallback Functions: /book/* + /chapter/* only")


def generate_routes_json(dist_dir: Path):
    """Scope Function invocation to page navigations; everything else stays static (unlimited)."""
    routes = {
        "version": 1,
        "include": ["/book/*", "/chapter/*"],
        "exclude": [],
    }
    with open(dist_dir / '_routes.json', 'w', encoding='utf-8') as f:
        json.dump(routes, f, separators=(',', ':'))
    log_success("Wrote _routes.json (Functions only on /book/*, /chapter/*)")



def generate_cloudflare_redirects(dist_dir: Path):
    """Generate '_redirects' file for Cloudflare Pages routing, SPA fallbacks, and legacy 404->homepage redirect."""
    redirects_file = dist_dir / '_redirects'
    log_info("Generating Cloudflare Pages '_redirects'...")

    content = """# Cloudflare Pages Redirects & Internal Rewrites
# =================================================

# 1. API Static Route Rewrites (Seamless JSON Serving)
/api/tree                              /api/tree.json                             200
/api/books                             /api/books.json                            200
/api/mat                               /api/mat.json                              200
/api/mat/chapter_map                   /api/mat/chapter_map.json                  200
/api/book/:code/chapter/:idx           /api/book/:code/chapter/:idx.json          200
/api/book/:code/toc                    /api/book/:code/toc.json                   200
/api/book/:code/mat                    /api/book/:code/mat.json                   200
/api/book/:code/mat_chapter_map        /api/book/:code/mat_chapter_map.json       200
/api/book/:code/mat_para_map           /api/book/:code/mat_para_map.json          200
/api/book/:code/pali_sentences          /api/book/:code/pali_sentences.json         200
/api/book/:code/paragraphs             /api/book/:code/paragraphs.json            200
/api/book/:code/translation/:lang      /api/book/:code/translation/:lang.json     200
/api/book/:code                        /api/book/:code.json                       200

# 2. SPA Fallbacks are handled by scoped Functions (functions/book + functions/chapter)
# 3. Legacy URLs - handled by 404.html (Lost in Samsara)
"""
    with open(redirects_file, 'w', encoding='utf-8') as f:
        f.write(content)
    log_success("Created Cloudflare Pages '_redirects' (with translation rewrite rule)")

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
  Link: </.well-known/api-catalog>; rel="api-catalog", </.well-known/ai-catalog.json>; rel="ai-catalog", </openapi.json>; rel="service-desc"; type="application/openapi+json", </llms.txt>; rel="describedby"; type="text/plain"

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

/.well-known/oauth-protected-resource
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *

/.well-known/oauth-authorization-server
  Content-Type: application/json; charset=utf-8
  Access-Control-Allow-Origin: *

/.well-known/api-catalog
  Content-Type: application/linkset+json; charset=utf-8
  Access-Control-Allow-Origin: *

"""
    with open(headers_file, 'w', encoding='utf-8') as f:
        f.write(content)
    log_success("Created Cloudflare Pages '_headers'")


def backfill_translations_to_dist(dist_dir: Path, git_repo_dir: Path):
    """
    If dist_dir lacks translation files that exist in git_repo_dir,
    backfill them so dist_dir (used by direct wrangler upload) is complete.
    """
    if not git_repo_dir.exists():
        return 0
    repo_trans_dir = git_repo_dir / 'api' / 'book'
    if not repo_trans_dir.exists():
        return 0

    restored = 0
    for src in repo_trans_dir.glob('*/translation/*.json'):
        rel = src.relative_to(git_repo_dir)
        dst = dist_dir / rel
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            restored += 1
    if restored:
        log_info(f"Preserved/backfilled {restored} translation JSON files from {git_repo_dir.name} into {dist_dir.name}")
    return restored


def sync_website_to_git_repo(dist_dir: Path, git_repo_dir: Path, auto_commit: bool, commit_msg: str, auto_push: bool):
    """
    Sync distribution to live Git repository.
    CRITICAL: Uses '--filter=P /api/book/*/translation/***' so translation JSON files
    in next_tipitakapali.org are NEVER deleted by rsync.
    Obsolete website JSONs and obsolete JS/HTML chunks ARE cleanly pruned.
    """
    if not git_repo_dir.exists() or not (git_repo_dir / '.git').exists():
        log_warn(f"Git repo not found at {git_repo_dir}. Skipping auto-sync.")
        return

    log_info(f"Syncing static build directly to live Git repo: {git_repo_dir}...")
    res = subprocess.run([
        "rsync", "-av", "--delete", "--exclude=.git",
        "--filter=P /api/book/*/translation/***",
        f"{dist_dir}/", f"{git_repo_dir}/"
    ], capture_output=True, text=True)

    if res.returncode != 0:
        log_error(f"Rsync failed: {res.stderr}")
        return

    log_success(f"Synchronized distribution into {git_repo_dir} (translation JSON files protected)")

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

# ==============================================================================
# Translation Export Functions
# ==============================================================================

def discover_langs(db_dir: Path):
    """Find available translation_*.db files -> lang codes."""
    langs = []
    if not db_dir.exists():
        return langs
    for f in sorted(db_dir.glob('translation_*.db')):
        code = f.stem[len('translation_'):]
        if code.startswith('fts_') or f.stat().st_size == 0:
            continue
        langs.append(code)
    return langs


def clean_stale_translations(target_dirs: list, langs: list, clean_all: bool = False):
    """
    Remove existing translation JSON files across dist_dir, public/api, and git_repo_dir
    before export so that no obsolete translation files remain.
    If clean_all is True, removes all files inside */translation directories.
    Otherwise removes {lang}.json for each lang in langs.
    """
    cleaned = 0
    for base in target_dirs:
        if not base or not base.exists():
            continue
        book_dir = base / 'api' / 'book' if (base / 'api' / 'book').exists() else base / 'book' if (base / 'book').exists() else None
        if not book_dir or not book_dir.exists():
            continue
        for trans_dir in book_dir.glob('*/translation'):
            if clean_all:
                for jf in trans_dir.glob('*.json'):
                    try:
                        jf.unlink()
                        cleaned += 1
                    except OSError:
                        pass
            else:
                for lang in langs:
                    lang_file = trans_dir / f"{lang}.json"
                    if lang_file.exists():
                        try:
                            lang_file.unlink()
                            cleaned += 1
                        except OSError:
                            pass
                    # Nissaya langs ship no sentence payloads — clean stale
                    # files from previous exports so they don't linger.
                    sent_file = trans_dir / f"{lang}.sentences.json"
                    if sent_file.exists():
                        try:
                            sent_file.unlink()
                            cleaned += 1
                        except OSError:
                            pass
            try:
                if trans_dir.exists() and not any(trans_dir.iterdir()):
                    trans_dir.rmdir()
            except OSError:
                pass
    if cleaned:
        log_info(f"Cleaned {cleaned} existing translation JSON files prior to fresh export")
    return cleaned


def export_lang(db_path: Path, lang: str, target_api_dir: Path):
    """Export one language from SQLite DB to per-book JSON files.

    Writes two files per book:
      {lang}.json           — chapters -> para_index -> translation (paragraph mode)
      {lang}.sentences.json — chapters -> para_index -> [{line_id, translation}]
                              (sentence mode; only paras that have sentences).
    The .sentences.json name reuses the existing _redirects
    `/api/book/:code/translation/:lang` rewrite (no new routing rules needed).
    Nissaya langs (*_nissaya) are paragraph-only: no sentence files are
    written, and any stale ones are removed (see the per-book write below).
    """
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    books = [r[0] for r in cur.execute(
        "SELECT DISTINCT book_code FROM paragraph_translations ORDER BY book_code"
    ).fetchall()]

    n_books = 0
    n_chapters = 0
    n_bytes = 0

    for book_code in books:
        chapters = {}
        sent_chapters = {}
        has_sentences = False
        for ch_idx, para_idx, translation, sentences_json in cur.execute(
            "SELECT chapter_index, para_index, translation, sentences_json FROM paragraph_translations "
            "WHERE book_code = ? ORDER BY chapter_index, para_index",
            (book_code,)
        ):
            ch = chapters.setdefault(str(ch_idx), {})
            ch[str(para_idx)] = translation
            if sentences_json:
                try:
                    sents = json.loads(sentences_json)
                except Exception:
                    sents = None
                if isinstance(sents, list) and len(sents) > 0:
                    sch = sent_chapters.setdefault(str(ch_idx), {})
                    sch[str(para_idx)] = sents
                    has_sentences = True

        if not chapters:
            continue

        payload = {"book_code": book_code, "lang": lang, "chapters": chapters}
        out_file = target_api_dir / 'book' / book_code / 'translation' / f"{lang}.json"
        out_file.parent.mkdir(parents=True, exist_ok=True)
        json_str = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
        out_file.write_text(json_str, encoding='utf-8')

        n_books += 1
        n_chapters += len(chapters)
        n_bytes += len(json_str.encode('utf-8'))

        # Nissaya translations render as full paragraphs only — word-by-word
        # interlinear, sentence display doesn't apply, and the split payloads
        # are far too large for static hosting (some exceed Cloudflare Pages'
        # 25 MiB asset limit). Ship the paragraph file only and drop any
        # stale sentence file from previous exports.
        if has_sentences and not lang.lower().endswith('_nissaya'):
            sent_payload = {"book_code": book_code, "lang": lang, "chapters": sent_chapters}
            sent_file = target_api_dir / 'book' / book_code / 'translation' / f"{lang}.sentences.json"
            sent_str = json.dumps(sent_payload, ensure_ascii=False, separators=(',', ':'))
            sent_file.write_text(sent_str, encoding='utf-8')
            n_bytes += len(sent_str.encode('utf-8'))
        elif has_sentences:
            sent_file = target_api_dir / 'book' / book_code / 'translation' / f"{lang}.sentences.json"
            try:
                if sent_file.exists():
                    sent_file.unlink()
            except OSError:
                pass

    conn.close()
    return n_books, n_chapters, n_bytes


def prune_stale_books(target_api_dir: Path, valid_per_lang: dict):
    """Remove translation JSONs for books that no longer exist in the DBs."""
    book_dir = target_api_dir / 'book'
    if not book_dir.exists():
        return 0
    removed = 0
    for trans_dir in book_dir.glob('*/translation'):
        for jf in trans_dir.glob('*.json'):
            lang = jf.stem
            book_code = trans_dir.parent.name
            if lang in valid_per_lang and book_code not in valid_per_lang[lang]:
                try:
                    jf.unlink()
                    removed += 1
                except OSError:
                    pass
        try:
            if not any(trans_dir.iterdir()):
                trans_dir.rmdir()
        except OSError:
            pass
    return removed


def ensure_redirects_rule(dist_dir: Path):
    """Append the translation rewrite rule to dist/_redirects (idempotent)."""
    redirects_file = dist_dir / '_redirects'
    if not redirects_file.exists():
        redirects_file.write_text(
            "# Cloudflare Pages Redirects & Internal Rewrites\n"
            f"{TRANSLATION_REDIRECT_RULE}\n",
            encoding='utf-8'
        )
        return True

    content = redirects_file.read_text(encoding='utf-8')
    if 'translation/:lang' in content:
        return False

    with open(redirects_file, 'a', encoding='utf-8') as f:
        f.write(f"\n# Translation static JSON rewrite\n{TRANSLATION_REDIRECT_RULE}\n")
    log_success("Appended translation rewrite rule to dist/_redirects")
    return True


def sync_translations_to_targets(dist_dir: Path, public_api_dir: Path, git_repo_dir: Path, langs: list, no_public_sync: bool):
    """Sync newly exported translation JSONs to public/api and next_tipitakapali.org."""
    target_api_dir = dist_dir / 'api'

    # 1. Sync to public/api for local offline dev
    if not no_public_sync:
        public_api_dir.mkdir(parents=True, exist_ok=True)
        copied_local = 0
        for lang in langs:
            for src in (target_api_dir / 'book').glob(f"*/translation/{lang}.json"):
                rel = src.relative_to(target_api_dir)
                dst = public_api_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                copied_local += 1
        log_success(f"Synced {copied_local} translation JSON files to local {public_api_dir.name}")

    # 2. Sync to next_tipitakapali.org
    if git_repo_dir.exists() and (git_repo_dir / '.git').exists():
        synced_repo = 0
        for src in (target_api_dir / 'book').glob("*/translation/*.json"):
            rel = src.relative_to(dist_dir)
            dst = git_repo_dir / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            synced_repo += 1

        # Prune repo translation files removed from dist (stale books/langs)
        pruned = 0
        repo_book_dir = git_repo_dir / 'api' / 'book'
        if repo_book_dir.exists():
            for repo_jf in repo_book_dir.glob('*/translation/*.json'):
                if not (dist_dir / repo_jf.relative_to(git_repo_dir)).exists():
                    try:
                        repo_jf.unlink()
                        pruned += 1
                    except OSError:
                        pass
            # Prune empty translation dirs in repo
            for trans_dir in repo_book_dir.glob('*/translation'):
                try:
                    if trans_dir.exists() and not any(trans_dir.iterdir()):
                        trans_dir.rmdir()
                except OSError:
                    pass

        src_redirects = dist_dir / '_redirects'
        if src_redirects.exists():
            shutil.copy2(src_redirects, git_repo_dir / '_redirects')

        log_success(f"Synchronized {synced_repo} translation JSON files into {git_repo_dir}"
                    + (f" (pruned {pruned} stale)" if pruned else ""))

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


# ==============================================================================
# Pipeline Runners (Options 1, 2, 3)
# ==============================================================================

def export_website(args, paths):
    """Option 1: Export ONLY static website files for Cloudflare Pages."""
    dist_dir = paths['dist_dir']
    git_repo_dir = paths['git_repo_dir']
    web_app_dir = paths['web_app_dir']
    db_path = paths['db_path']

    if not db_path or not db_path.exists():
        log_error(f"Database not found. Checked: {paths['root_dir']}")
        sys.exit(1)

    print(f"\n{Color.BOLD}>>> Option 1: Exporting Static Website Files for Cloudflare Pages{Color.RESET}")
    print(f"Target Dist Dir  : {dist_dir}")
    print(f"Live Git Repo    : {git_repo_dir}\n")

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

    # Backfill any existing translation JSONs if present in git_repo_dir but missing in dist_dir
    backfill_translations_to_dist(dist_dir, git_repo_dir)

    # 3. Export Database to Static JSON directly into cloudflare_pages_dist/api
    target_api_dir = dist_dir / 'api'
    if not args.skip_export:
        export_database_to_static_json(
            target_api_dir=target_api_dir,
            db_path=db_path,
            catalog_path=paths['catalog_path'],
            tree_json_path=paths['tree_json_path'],
            book_mat_path=paths.get('book_mat_path'),
            include_paragraphs=args.with_paragraphs,
        )
        cleanup_stale_index_json(target_api_dir)
        if not args.with_paragraphs and target_api_dir.exists():
            for stale_para in target_api_dir.rglob('paragraphs.json'):
                try:
                    stale_para.unlink()
                except OSError:
                    pass

        # Sync static API data to public/api for offline local dev
        public_api_dir = paths['public_api_dir']
        log_info(f"Syncing static API data to local development folder: {public_api_dir}")
        public_api_dir.mkdir(parents=True, exist_ok=True)
        shutil.copytree(target_api_dir, public_api_dir, dirs_exist_ok=True)
        cleanup_stale_index_json(public_api_dir)
        if not args.with_paragraphs:
            for stale_para in public_api_dir.rglob('paragraphs.json'):
                try:
                    stale_para.unlink()
                except OSError:
                    pass

    # 3b. Prune duplicate chapter/ prerender (canonical SEO lives on /book/*)
    if not args.keep_chapter:
        pruned_chapter = dist_dir / 'chapter'
        if pruned_chapter.exists():
            shutil.rmtree(pruned_chapter)
            log_info("Pruned duplicate chapter/ prerender output (served via SPA shell + _redirects)")

    # 4. Pure static by default
    if args.with_spa_fallback:
        generate_spa_fallback_functions(dist_dir)
        generate_routes_json(dist_dir)
    else:
        functions_dir = dist_dir / 'functions'
        if functions_dir.exists():
            shutil.rmtree(functions_dir)
            log_info("Removed legacy functions/ (pure static unlimited mode)")
        routes_json = dist_dir / '_routes.json'
        if routes_json.exists():
            routes_json.unlink()
            log_info("Removed legacy _routes.json (pure static unlimited mode)")

    # 5. Generate _redirects & _headers
    generate_cloudflare_redirects(dist_dir)
    generate_cloudflare_headers(dist_dir)

    # 6. Generate SEO & AI Agent Metadata
    try:
        from generate_seo_ai_metadata import (
            generate_all_sitemaps,
            generate_robots_txt,
            generate_llms_txt,
            generate_llms_full_txt,
            generate_schema_jsonld,
            PALI_SCRIPTS,
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
        sitemaps = generate_all_sitemaps(seo_books, seo_chapters, s_url)
        robots_content = generate_robots_txt(s_url)
        llms_content = generate_llms_txt(s_url, len(seo_books), len(seo_chapters))
        llms_full_content = generate_llms_full_txt(s_url, seo_books, seo_catalog)
        jsonld_content = generate_schema_jsonld(s_url, seo_books)

        for target in [dist_dir, paths['web_app_dir'] / 'public', git_repo_dir]:
            if target.exists():
                for s_name, s_xml in sitemaps.items():
                    with open(target / s_name, 'w', encoding='utf-8') as f:
                        f.write(s_xml)
                with open(target / 'robots.txt', 'w', encoding='utf-8') as f:
                    f.write(robots_content)
                with open(target / 'llms.txt', 'w', encoding='utf-8') as f:
                    f.write(llms_content)
                with open(target / 'llms-full.txt', 'w', encoding='utf-8') as f:
                    f.write(llms_full_content)
                with open(target / 'site.jsonld', 'w', encoding='utf-8') as f:
                    f.write(jsonld_content)

        total_indexed_urls = 1 + len(seo_books) + len(seo_chapters) + len(PALI_SCRIPTS) * (len(seo_books) + len(seo_chapters))
        log_success(f"Generated {len(sitemaps)} XML sitemaps ({total_indexed_urls:,} URLs across 17 scripts), robots.txt, llms.txt, llms-full.txt, site.jsonld")

        for target in [dist_dir, git_repo_dir]:
            if target.exists():
                src_wk = paths['web_app_dir'] / 'public' / '.well-known'
                dst_wk = target / '.well-known'
                if src_wk.exists():
                    shutil.copytree(src_wk, dst_wk, dirs_exist_ok=True)
                src_auth = paths['web_app_dir'] / 'public' / 'auth.md'
                if src_auth.exists():
                    shutil.copy2(src_auth, target / 'auth.md')
    except Exception as e:
        log_warn(f"SEO/AI metadata generation note: {e}")

    # 7. Synchronize with Git repository (protecting /api/book/*/translation/***)
    sync_website_to_git_repo(
        dist_dir=dist_dir,
        git_repo_dir=git_repo_dir,
        auto_commit=args.git_push or bool(args.commit_msg),
        commit_msg=args.commit_msg,
        auto_push=args.git_push
    )

    print_summary(dist_dir, git_repo_dir, args.vps_url)


def export_translations(args, paths):
    """Option 2: Export ONLY static translation JSON files (cleans stale files first)."""
    dist_dir = paths['dist_dir']
    git_repo_dir = paths['git_repo_dir']
    public_api_dir = paths['public_api_dir']
    db_dir = paths['db_dir']

    all_langs = discover_langs(db_dir)
    if not all_langs:
        log_error(f"No translation_*.db found in {db_dir}")
        sys.exit(1)

    if args.langs:
        wanted = [l.strip().lower() for l in args.langs.split(',') if l.strip()]
        langs = [l for l in wanted if l in all_langs]
        missing = [l for l in wanted if l not in all_langs]
        if missing:
            log_warn(f"No DB for langs (skipped): {', '.join(missing)}")
    else:
        langs = all_langs

    if not langs:
        log_error("No valid translation languages to export.")
        sys.exit(1)

    print(f"\n{Color.BOLD}>>> Option 2: Exporting Static Translation JSON Files{Color.RESET}")
    print(f"Languages      : {', '.join(langs)}")
    print(f"Target Dist Dir: {dist_dir / 'api'}\n")

    dist_dir.mkdir(parents=True, exist_ok=True)
    target_api_dir = dist_dir / 'api'

    # Clean existing translation files for the target languages first to eliminate stale files
    clean_all = (args.langs is None)
    clean_stale_translations([dist_dir, paths['web_app_dir'] / 'public', git_repo_dir], langs, clean_all=clean_all)

    total_books = 0
    total_chapters = 0
    total_bytes = 0
    valid_per_lang = {}
    start_time = time.time()

    for lang in langs:
        db_path = db_dir / f"translation_{lang}.db"
        log_info(f"Exporting '{lang}' from {db_path.name}...")
        n_books, n_chapters, n_bytes = export_lang(db_path, lang, target_api_dir)
        total_books += n_books
        total_chapters += n_chapters
        total_bytes += n_bytes

        conn = sqlite3.connect(str(db_path))
        valid_per_lang[lang] = {r[0] for r in conn.execute(
            "SELECT DISTINCT book_code FROM paragraph_translations").fetchall()}
        conn.close()
        log_success(f"  {lang}: {n_books} books, {n_chapters} chapters, {n_bytes / 1048576:.1f} MB")

    removed = prune_stale_books(target_api_dir, valid_per_lang)
    if removed:
        log_info(f"Removed {removed} stale translation JSON files")

    elapsed = time.time() - start_time
    log_success(
        f"Exported {len(langs)} langs / {total_books} book-files / {total_chapters} chapters "
        f"({total_bytes / 1073741824:.2f} GB, {elapsed:.1f}s)"
    )

    ensure_redirects_rule(dist_dir)

    # Sync fresh translation files to public/api and next_tipitakapali.org
    sync_translations_to_targets(
        dist_dir=dist_dir,
        public_api_dir=public_api_dir,
        git_repo_dir=git_repo_dir,
        langs=langs,
        no_public_sync=args.no_public_sync
    )


def export_both(args, paths):
    """Option 3: Export BOTH static website and translation JSON files."""
    print(f"\n{Color.BOLD}>>> Option 3: Exporting BOTH Static Website & Translation JSON Files{Color.RESET}")
    export_website(args, paths)
    export_translations(args, paths)
    log_success("All static website and translation JSON files exported and synchronized successfully!")


# ==============================================================================
# Main Entrypoint
# ==============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="Unified Cloudflare Pages Static Exporter (Website + Translations)."
    )
    parser.add_argument(
        "mode_pos",
        nargs="?",
        choices=["1", "2", "3"],
        default=None,
        help="Optional positional mode (1=Website, 2=Translations, 3=Both)"
    )
    parser.add_argument(
        "--mode",
        choices=["1", "2", "3"],
        default=None,
        help="Export mode: 1=Website, 2=Translations, 3=Both"
    )
    parser.add_argument(
        "--vps-url",
        default=os.environ.get("VPS_URL", "http://85.190.97.158"),
        help="Public URL of VPS backend for dynamic search/dictionary queries"
    )
    parser.add_argument(
        "--site-url",
        default=os.environ.get("SITE_URL", "https://tipitakapali.org"),
        help="Canonical public site URL for sitemap and SEO"
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
        "--langs",
        default=None,
        help="Comma-separated lang codes to export for translations (e.g. en,vi,my)"
    )
    parser.add_argument(
        "--no-public-sync",
        action="store_true",
        help="Skip syncing translation JSON into public/api"
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
    parser.add_argument(
        "--with-paragraphs",
        action="store_true",
        help="Also export per-book canon paragraphs JSON"
    )
    parser.add_argument(
        "--keep-chapter",
        action="store_true",
        help="Keep duplicate chapter/ prerender output"
    )
    parser.add_argument(
        "--with-spa-fallback",
        action="store_true",
        help="Opt-in legacy backup SPA functions"
    )

    args = parser.parse_args()

    paths = find_paths()
    if args.out_dir:
        paths['dist_dir'] = Path(args.out_dir).resolve()
    if args.git_repo:
        paths['git_repo_dir'] = Path(args.git_repo).resolve()

    mode = args.mode or args.mode_pos

    if not mode:
        print("\n" + "=" * 68)
        print(f" {Color.BOLD}Chaṭṭha Saṅgāyana Tipiṭaka - Cloudflare Pages Static Generator{Color.RESET}")
        print("=" * 68)
        print("Please select an export option:\n")
        print("  Press 1: Export ONLY static website files for Cloudflare Pages")
        print("  Press 2: Export ONLY static translation JSON files")
        print("  Press 3: Export BOTH static website and translation JSON files\n")

        try:
            choice = input(f"{Color.BOLD}Select [1/2/3] (or q to quit): {Color.RESET}").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nAborted.")
            sys.exit(0)

        if choice in ['1', '2', '3']:
            mode = choice
        elif choice.lower() in ['q', 'quit', 'exit']:
            print("Exiting.")
            sys.exit(0)
        else:
            log_error(f"Invalid option: '{choice}'. Expected 1, 2, or 3.")
            sys.exit(1)

    if mode == '1':
        export_website(args, paths)
    elif mode == '2':
        export_translations(args, paths)
    elif mode == '3':
        export_both(args, paths)


if __name__ == '__main__':
    main()
