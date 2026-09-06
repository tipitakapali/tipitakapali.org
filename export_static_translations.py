#!/usr/bin/env python3
"""
export_static_translations.py
============================
Pre-exports Tipitaka translations to per-book-per-lang static JSON files for
Cloudflare Pages (all-static hosting, no R2 needed).

Why this shape:
  - Chapter reads only need `paragraph_translations` (translation strings per
    para_index). The 1.2M-row `sentence_translations` tables are never queried
    by the chapter API and are skipped — the 12.7 GB of translation_*.db files
    collapse to ~3.0 GB of JSON.
  - Per-book-per-lang (217 x langs ≈ 3,255 files, biggest ~13 MB) stays under
    the Pages 20,000-file and 25 MB/file limits, and one cached fetch covers a
    whole book (the reader buffers adjacent chapters anyway).

Output layout (mirrors services/api.js fetchChapterTranslations static-first):
  <dist>/api/book/<code>/translation/<lang>.json
  {"book_code": ..., "lang": ..., "chapters": {"<chapter_index>": {"<para_index>": "<translation>"}}}

The frontend fetches this same-host file first and falls back to the VPS
`/api/book/<code>/chapter/<idx>/translation?lang=` endpoint when missing.

Translation *search* (fts_translation_*.db) stays on the VPS — search cannot
be a static file.

Usage:
  python3 export_static_translations.py                       # all langs, into cloudflare_pages_dist + public/api
  python3 export_static_translations.py --langs en,vi,my      # subset of languages
  python3 export_static_translations.py --out-dir /tmp/tjson  # custom dist dir
  python3 export_static_translations.py --no-public-sync      # skip public/api sync (local dev)

IMPORTANT: this must run AFTER export_static_cloudflare_pages.py (which
regenerates dist/_redirects). This script appends the translation rewrite rule
to dist/_redirects idempotently, then syncs translation JSON + _redirects to
the live Git repo (files only — commit and push manually from
next_tipitakapali.org, or re-run with --wrangler for the direct-upload
command).
"""

import sys
import json
import time
import sqlite3
import argparse
from pathlib import Path


class Color:
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    BOLD = '\033[1m'
    RESET = '\033[0m'


def log_info(msg: str):
    print(f"{Color.BLUE}[*]{Color.RESET} {msg}")


def log_success(msg: str):
    print(f"{Color.GREEN}[✓]{Color.RESET} {Color.BOLD}{msg}{Color.RESET}")


def log_warn(msg: str):
    print(f"{Color.YELLOW}[!]{Color.RESET} {msg}")


def log_error(msg: str):
    print(f"{Color.RED}[✗] {msg}{Color.RESET}")


REDIRECTS_RULE = "/api/book/:code/translation/:lang         /api/book/:code/translation/:lang.json          200"


def find_paths():
    """Resolve project directories (same convention as export_static_cloudflare_pages.py)."""
    script_dir = Path(__file__).resolve().parent
    root_dir = script_dir.parent if (script_dir / 'server_api').exists() else script_dir
    web_app_dir = script_dir if (script_dir / 'package.json').exists() else root_dir / 'web_app_next'
    return {
        'root_dir': root_dir,
        'web_app_dir': web_app_dir,
        'db_dir': web_app_dir / 'server_api' / 'db',
        'dist_dir': web_app_dir / 'cloudflare_pages_dist',
        'public_api_dir': web_app_dir / 'public' / 'api',
        'git_repo_dir': web_app_dir / 'next_tipitakapali.org',
    }


def discover_langs(db_dir: Path):
    """Find available translation_*.db files -> lang codes."""
    langs = []
    if not db_dir.exists():
        return langs
    for f in sorted(db_dir.glob('translation_*.db')):
        code = f.stem[len('translation_'):]
        # Skip FTS index DBs (fts_translation_*.db never matches this glob,
        # but guard anyway) and empty placeholder files.
        if code.startswith('fts_') or f.stat().st_size == 0:
            continue
        langs.append(code)
    return langs


def export_lang(db_path: Path, lang: str, target_api_dir: Path):
    """Export one language: per-book JSON files. Returns (books, chapters, bytes)."""
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Distinct books first so we can stream one book at a time (low memory).
    books = [r[0] for r in cur.execute(
        "SELECT DISTINCT book_code FROM paragraph_translations ORDER BY book_code"
    ).fetchall()]

    n_books = 0
    n_chapters = 0
    n_bytes = 0

    for book_code in books:
        chapters = {}
        for ch_idx, para_idx, translation in cur.execute(
            "SELECT chapter_index, para_index, translation FROM paragraph_translations "
            "WHERE book_code = ? ORDER BY chapter_index, para_index",
            (book_code,)
        ):
            ch = chapters.setdefault(str(ch_idx), {})
            ch[str(para_idx)] = translation

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


def sync_to_git_repo(dist_dir: Path, git_repo_dir: Path):
    """Sync translation JSON + _redirects to the live Git repo (like the pages
    exporter default: files only, no commit/push — you commit manually).
    Only touches what this script owns: api/book/*/translation/*.json and
    _redirects."""
    import shutil

    if not git_repo_dir.exists() or not (git_repo_dir / '.git').exists():
        log_warn(f"Git repo not found at {git_repo_dir}. Skipping auto-sync.")
        return

    log_info(f"Syncing translation JSON + _redirects to live Git repo: {git_repo_dir}...")
    synced = 0
    for src in (dist_dir / 'api' / 'book').glob('*/translation/*.json'):
        rel = src.relative_to(dist_dir)
        dst = git_repo_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        synced += 1

    # Prune repo translation files removed from dist (stale books/langs).
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

    # The translation rewrite rule lives in dist/_redirects (appended above).
    src_redirects = dist_dir / '_redirects'
    if src_redirects.exists():
        shutil.copy2(src_redirects, git_repo_dir / '_redirects')

    log_success(f"Synchronized {synced} translation JSON files into {git_repo_dir}"
                + (f" (pruned {pruned} stale)" if pruned else ""))
    log_info("Files only — commit and push manually from the repo when ready.")


def ensure_redirects_rule(dist_dir: Path):
    """Append the translation rewrite rule to dist/_redirects (idempotent)."""
    redirects_file = dist_dir / '_redirects'
    if not redirects_file.exists():
        log_warn("dist/_redirects not found (run export_static_cloudflare_pages.py first) — creating one with just the translation rule.")
        redirects_file.write_text(
            "# Cloudflare Pages Redirects & Internal Rewrites\n"
            f"{REDIRECTS_RULE}\n",
            encoding='utf-8'
        )
        return True

    content = redirects_file.read_text(encoding='utf-8')
    if 'translation/:lang' in content:
        log_info("dist/_redirects already contains the translation rule.")
        return False

    with open(redirects_file, 'a', encoding='utf-8') as f:
        f.write(f"\n# Translation static JSON (export_static_translations.py)\n{REDIRECTS_RULE}\n")
    log_success("Appended translation rule to dist/_redirects")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Pre-export translations to per-book-per-lang static JSON for Cloudflare Pages."
    )
    parser.add_argument(
        '--langs', default=None,
        help="Comma-separated lang codes to export (default: all translation_*.db found)"
    )
    parser.add_argument(
        '--out-dir', default=None,
        help="Custom output distribution directory (default: cloudflare_pages_dist)"
    )
    parser.add_argument(
        '--no-public-sync', action='store_true',
        help="Skip syncing translation JSON into public/api (local dev)"
    )
    parser.add_argument(
        '--git-repo', default=None,
        help="Custom path to the connected Git repository for auto-sync"
    )
    parser.add_argument(
        '--wrangler', action='store_true',
        help="Print the wrangler direct-upload deploy command at the end"
    )
    args = parser.parse_args()

    paths = find_paths()
    dist_dir = Path(args.out_dir).resolve() if args.out_dir else paths['dist_dir']
    git_repo_dir = Path(args.git_repo).resolve() if args.git_repo else paths['git_repo_dir']
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
        log_error("Nothing to export.")
        sys.exit(1)

    print(f"\n{Color.BOLD}Tipitaka Translations — Static JSON Export for Cloudflare Pages{Color.RESET}")
    print(f"Languages      : {', '.join(langs)}")
    print(f"Target Dist Dir: {dist_dir / 'api'}\n")

    dist_dir.mkdir(parents=True, exist_ok=True)
    target_api_dir = dist_dir / 'api'

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
        # Track valid books for stale pruning
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

    # Sync to public/api for local development (gitignored, like the main exporter).
    if not args.no_public_sync:
        public_api_dir = paths['public_api_dir']
        public_api_dir.mkdir(parents=True, exist_ok=True)
        import shutil
        copied = 0
        for lang in langs:
            for src in (target_api_dir / 'book').glob(f"*/translation/{lang}.json"):
                rel = src.relative_to(target_api_dir)
                dst = public_api_dir / rel
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
                copied += 1
        log_success(f"Synced {copied} translation JSON files to public/api (local dev)")

    ensure_redirects_rule(dist_dir)

    # Sync translation JSON + _redirects to the live Git repo (files only,
    # like the pages exporter default — commit/push manually).
    sync_to_git_repo(dist_dir=dist_dir, git_repo_dir=git_repo_dir)

    print(f"\n{Color.BOLD}Frontend:{Color.RESET} fetchChapterTranslations() tries "
          f"/api/book/<code>/translation/<lang>.json first, VPS fallback covers the rest.")
    if args.wrangler:
        print(f"{Color.BOLD}Wrangler deploy (direct upload, skips git):{Color.RESET}\n"
              f"  npx wrangler pages deploy {dist_dir} --project-name tipitaka-app\n")
    else:
        print(f"{Color.BOLD}Deploy note:{Color.RESET} git-push path synced above; "
              f"or re-run with --wrangler to print the direct-upload command.\n")


if __name__ == '__main__':
    main()
