#!/usr/bin/env python3
"""
export_static_pages_translation.py
==================================
Ordered wrapper: runs the two static exporters in the required sequence so
Cloudflare Pages gets the complete all-static distribution (books/chapters +
translations).

  Step 1: export_static_cloudflare_pages.py  (app build, books/chapters/TOC/
          MAT JSON, regenerates dist/_redirects from scratch)
  Step 2: export_static_translations.py      (per-book-per-lang translation
          JSON, appends its _redirects rule idempotently)

Order matters: the main exporter rewrites dist/_redirects wholesale, so the
translation exporter must always run second.

Usage:
  python3 export_static_pages_translation.py
  python3 export_static_pages_translation.py --langs en,vi,my
  python3 export_static_pages_translation.py --skip-build      # skip Next.js build in step 1
  python3 export_static_pages_translation.py --skip-export    # skip DB JSON export in step 1
  python3 export_static_pages_translation.py --with-paragraphs
  python3 export_static_pages_translation.py --keep-chapter
  python3 export_static_pages_translation.py --with-spa-fallback

Step 2 syncs translation JSON + _redirects to next_tipitakapali.org (files
only). Afterwards commit and push manually from that repo, or deploy with:
  npx wrangler pages deploy cloudflare_pages_dist   # direct upload
"""

import argparse
import subprocess
import sys
from pathlib import Path


def run_step(label: str, script: Path, args: list):
    print(f"\n{'=' * 68}\n>>> {label}: python3 {script.name} {' '.join(args)}\n{'=' * 68}")
    res = subprocess.run([sys.executable, str(script), *args])
    if res.returncode != 0:
        print(f"\n[✗] {label} failed (exit {res.returncode}) — aborting.", file=sys.stderr)
        sys.exit(res.returncode)
    print(f"\n[✓] {label} completed.")


def main():
    parser = argparse.ArgumentParser(
        description="Run both static exporters in order (main first, translations second)."
    )
    parser.add_argument('--langs', default=None,
                        help="Comma-separated langs forwarded to export_static_translations.py")
    parser.add_argument('--skip-build', action='store_true',
                        help="Forwarded to export_static_cloudflare_pages.py")
    parser.add_argument('--skip-export', action='store_true',
                        help="Forwarded to export_static_cloudflare_pages.py")
    parser.add_argument('--git-repo', default=None,
                        help="Forwarded to export_static_translations.py")
    parser.add_argument('--wrangler', action='store_true',
                        help="Forwarded to export_static_translations.py (print direct-upload command)")
    parser.add_argument('--with-paragraphs', action='store_true',
                        help="Forwarded to export_static_cloudflare_pages.py")
    parser.add_argument('--keep-chapter', action='store_true',
                        help="Forwarded to export_static_cloudflare_pages.py")
    parser.add_argument('--with-spa-fallback', action='store_true',
                        help="Forwarded to export_static_cloudflare_pages.py")
    parser.add_argument('--no-public-sync', action='store_true',
                        help="Forwarded to export_static_translations.py (skip public/api sync)")
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    main_exporter = script_dir / 'export_static_cloudflare_pages.py'
    trans_exporter = script_dir / 'export_static_translations.py'

    for name, path in (('main exporter', main_exporter), ('translation exporter', trans_exporter)):
        if not path.exists():
            print(f"[✗] {name} not found: {path}", file=sys.stderr)
            sys.exit(1)

    # Step 1: main static export (build + books/chapters/TOC/MAT + fresh _redirects)
    step1_args = []
    if args.skip_build:
        step1_args.append('--skip-build')
    if args.skip_export:
        step1_args.append('--skip-export')
    if args.with_paragraphs:
        step1_args.append('--with-paragraphs')
    if args.keep_chapter:
        step1_args.append('--keep-chapter')
    if args.with_spa_fallback:
        step1_args.append('--with-spa-fallback')
    run_step('Step 1/2 — main static export', main_exporter, step1_args)

    # Step 2: translation static export (must run second — appends _redirects
    # rule) + Git repo file sync (no commit/push — manual afterwards).
    step2_args = []
    if args.langs:
        step2_args += ['--langs', args.langs]
    if args.no_public_sync:
        step2_args.append('--no-public-sync')
    if args.git_repo:
        step2_args += ['--git-repo', args.git_repo]
    if args.wrangler:
        step2_args.append('--wrangler')
    run_step('Step 2/2 — translation static export', trans_exporter, step2_args)

    print("\n" + "=" * 68)
    print("[✓] Full all-static export complete (app + translations, in order).")
    print("Next: cd next_tipitakapali.org && git add . && git commit && git push")
    print("(or: npx wrangler pages deploy cloudflare_pages_dist)")
    print("=" * 68 + "\n")


if __name__ == '__main__':
    main()
