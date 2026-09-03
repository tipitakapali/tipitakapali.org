#!/usr/bin/env python3
"""
build_pipeline.py - Standalone 1-File Tipitaka Database Generator (2026)

Reproduces identical:
  1. output/tipitaka.db     (Modern SQLite database for web_app_next, ~205 MB)
  2. output/fts_tipitaka.db (Full-Text Search FTS5 prefix index database, ~274 MB)
  3. output/books_xml.db    (Optional XML archive database, ~141 MB)

Key Design:
  - Step 1: Checks or clones upstream https://github.com/VipassanaTech/tipitaka-xml.git
  - Step 2: Always transliterates fresh Roman Latin XML books from Devanagari master (deva/)
            into '_latest_romn/' (bypassing the outdated repo 'romn/'), and compares differences.
  - Step 3: Generates 'tipitaka.db' using '_latest_romn/' with precomputed chapter HTML,
            CST4 meta_json, and hierarchical book_toc.
  - Step 4: Generates 'fts_tipitaka.db' using '_latest_romn/' with FTS5 prefix = 3 index.
  - Step 5: Verifies data integrity across all tables and rows.
  - Step 6: Automatically syncs to parent web_app_next if present.

Usage:
  python3 build_pipeline.py             # Run all steps from scratch
  ./run.sh                              # Shell wrapper
  python3 build_pipeline.py --help      # Show options
"""

import os
import sys
import glob
import json
import re
import shutil
import sqlite3
import argparse
import subprocess
import time
import urllib.request
import urllib.parse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
METADATA_DIR = os.path.join(SCRIPT_DIR, 'metadata')
OUTPUT_DIR = os.path.join(SCRIPT_DIR, 'output')
XML_REPO_DIR = os.path.join(SCRIPT_DIR, 'tipitaka-xml')

# Upstream directories
DEVA_DIR = os.path.join(XML_REPO_DIR, 'deva')
OLD_ROMN_DIR = os.path.join(XML_REPO_DIR, 'romn')

# Freshly converted Roman Latin directory
LATEST_ROMN_DIR = os.path.join(XML_REPO_DIR, '_latest_romn')
ROMN_DIR = LATEST_ROMN_DIR  # Primary source for all database stages

CONV_SCRIPTS_DIR = os.path.join(SCRIPT_DIR, 'conversion_scripts')

# Output databases
TIPITAKA_DB = os.path.join(OUTPUT_DIR, 'tipitaka.db')
FTS_DB = os.path.join(OUTPUT_DIR, 'fts_tipitaka.db')
BOOKS_XML_DB = os.path.join(OUTPUT_DIR, 'books_xml.db')

# Metadata files
TREE_JSON_FILE = os.path.join(METADATA_DIR, 'tree.json')
CST_CATALOG_FILE = os.path.join(METADATA_DIR, 'cst_books_catalog.json')
CHAPTERS_CATALOG_FILE = os.path.join(METADATA_DIR, 'chapters_catalog.json')

REMOTE_REPO_URL = "https://github.com/VipassanaTech/tipitaka-xml.git"

if os.path.exists(CONV_SCRIPTS_DIR):
    sys.path.append(CONV_SCRIPTS_DIR)


def log(section: str, msg: str):
    print(f"\n[{time.strftime('%H:%M:%S')}] \033[1;34m=== {section}: {msg} ===\033[0m")


def log_step(msg: str):
    print(f"  \033[1;32m✓\033[0m {msg}")


def log_warn(msg: str):
    print(f"  \033[1;33m⚠\033[0m {msg}")


# ===========================================================================
# Helpers: Encoding, Span Parsing, Text Normalization
# ===========================================================================
def read_text_auto(file_path: str) -> str:
    """Multi-encoding text reader handling UTF-8, UTF-16LE, UTF-16BE, and BOMs."""
    with open(file_path, "rb") as f:
        raw = f.read()
    if raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16be", errors="replace")
    elif raw.startswith(b"\xff\xfe"):
        return raw.decode("utf-16le", errors="replace")
    elif raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig", errors="replace")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-16le", errors="replace")


def try_parse_paragraph_span(n: str):
    """
    CST4-compliant Paragraph Span Parser.
    Expands single numbers (21), full ranges (16-26), and abbreviated continuation
    ranges (196-7 -> 196..197, 266-7-8 -> 266..268, etc.).
    Returns (first, last) tuple of integers or None.
    """
    if not n or not isinstance(n, str):
        return None
    raw_parts = n.split('-')
    previous = None
    first = 0
    last = 0
    any_num = False
    for raw in raw_parts:
        part = raw.strip()
        if not part or not part.isdigit():
            break
        expanded = part
        if previous and len(part) < len(previous):
            expanded = previous[:len(previous) - len(part)] + part
        val = int(expanded)
        if not any_num:
            first = val
            any_num = True
        last = val
        previous = expanded
    if any_num and last < first:
        last = first
    if not any_num:
        return None
    return (first, last)


def clean_xml_to_plain(xml_text: str) -> str:
    """Strips XML tags and cleans text for indexing or search."""
    text = re.sub(r'<pb[^>]*/>', ' ', xml_text)
    text = re.sub(r'<span class="pagebreak"[^>]*>.*?</span>', ' ', text, flags=re.DOTALL)
    text = re.sub(r'<strong class="paranum"[^>]*>.*?</strong>', ' ', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('ṁ', 'ṃ').replace('Ṁ', 'ṃ')
    text = re.sub(r'[\u200B-\u200D\uFEFF\u00A0]', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()


# ===========================================================================
# Step 1: Ensure Upstream Repository (Clone if needed)
# ===========================================================================
def ensure_upstream_repo():
    log("STEP 1", f"Checking Upstream Tipitaka XML Repository ({REMOTE_REPO_URL})")

    if os.path.exists(XML_REPO_DIR) and os.path.exists(DEVA_DIR):
        deva_files = glob.glob(os.path.join(DEVA_DIR, '*.xml'))
        if len(deva_files) >= 217:
            log_step(f"Found existing repository at '{XML_REPO_DIR}' with {len(deva_files)} Devanagari master books.")
            return

    log_step(f"Cloning {REMOTE_REPO_URL} into '{XML_REPO_DIR}'...")
    os.makedirs(XML_REPO_DIR, exist_ok=True)
    subprocess.run(
        ['git', 'clone', '--depth', '1', REMOTE_REPO_URL, XML_REPO_DIR],
        check=True
    )
    log_step(f"Cloned repository successfully into '{XML_REPO_DIR}'.")


# ===========================================================================
# Step 2: Convert Devanagari to _latest_romn and Compare with Old romn
# ===========================================================================
def convert_and_verify_romn(force: bool = False):
    log("STEP 2", "Converting Devanagari Master to '_latest_romn' (Bypassing Outdated Repo 'romn')")

    os.makedirs(LATEST_ROMN_DIR, exist_ok=True)
    existing_latest = glob.glob(os.path.join(LATEST_ROMN_DIR, '*.xml'))

    if len(existing_latest) >= 217 and not force:
        log_step(f"Using existing {len(existing_latest)} converted Roman Latin books in '{LATEST_ROMN_DIR}'.")
    else:
        log_step(f"Converting all 217 books from '{DEVA_DIR}' to '{LATEST_ROMN_DIR}' using Deva2Latn...")
        t0 = time.time()
        try:
            from deva2latn import Deva2Latn
            conv = Deva2Latn()
            count = conv.convert_directory(DEVA_DIR, LATEST_ROMN_DIR)
            elapsed = time.time() - t0
            log_step(f"Converted {count} books in {elapsed:.2f}s to '{LATEST_ROMN_DIR}'.")
        except Exception as e:
            log_warn(f"Deva2Latn conversion error: {e}")
            raise

    # Compare _latest_romn with repository's old romn directory
    compare_latest_with_old_romn()


def compare_latest_with_old_romn():
    """Compares _latest_romn with the repo's old romn directory to report upstream updates and UTF-8 standardization."""
    if not os.path.exists(OLD_ROMN_DIR) or not os.path.exists(LATEST_ROMN_DIR):
        return

    log_step("Comparing '_latest_romn' (UTF-8) with repository 'romn' (legacy UTF-16)...")
    latest_files = sorted([f for f in os.listdir(LATEST_ROMN_DIR) if f.endswith('.xml')])
    content_diffs = []

    def normalize_body(xml_str: str) -> str:
        s = xml_str.replace('\ufeff', '')
        s = re.sub(r'<\?xml[^>]*\?>', '', s)
        return s.replace('\r\n', '\n').strip()

    for f in latest_files:
        p_latest = os.path.join(LATEST_ROMN_DIR, f)
        p_old = os.path.join(OLD_ROMN_DIR, f)
        if not os.path.exists(p_old):
            content_diffs.append((f, "Not found in old repo romn/"))
            continue

        t_latest = normalize_body(read_text_auto(p_latest))
        t_old = normalize_body(read_text_auto(p_old))

        if t_latest != t_old:
            content_diffs.append((f, "Textual content updated/corrected from Devanagari master"))

    log_step(f"All {len(latest_files)} XML books successfully standardized to pure UTF-8 Unicode.")
    if content_diffs:
        log_step(f"Detected {len(content_diffs)} file(s) with master text corrections:")
        for f, desc in content_diffs:
            print(f"      • {f}: {desc}")
    else:
        log_step("No textual body differences found.")


def precompute_canonical_mat_mappings(cur, conn, book_mat_catalog):
    """
    Precompute exact, database-wide paragraph-level and chapter-level MAT mappings
    for all 217 books in the Tipitaka canon. Populates mat_para_map and mat_chapter_map,
    and enriches books.meta_json with chapter_to_mat and para_to_mat.
    """
    log_step("Precomputing canon-wide MAT chapter and paragraph mappings...")
    t0 = time.time()

    cur.execute("SELECT id, code, category, title, meta_json FROM books ORDER BY id")
    books = {}
    for r in cur.fetchall():
        meta = json.loads(r[4]) if r[4] else {}
        books[r[1]] = {
            'id': r[0],
            'code': r[1],
            'category': r[2],
            'title': r[3],
            'meta': meta,
            'para_to_chapter': meta.get('para_to_chapter', {}),
            'chapter_to_sub_book': meta.get('chapter_to_sub_book', {}),
            'sub_books_para_to_chapter': meta.get('sub_books_para_to_chapter', {}),
            'sub_books': meta.get('sub_books', {}),
            'sub_book': meta.get('sub_book'),
            'split_targets': meta.get('split_targets'),
            'mat': meta.get('mat', {}) or book_mat_catalog.get(r[1], {})
        }

    chapters_by_book = {}
    cur.execute("SELECT book_code, chapter_index, title FROM chapters ORDER BY book_code, chapter_index")
    for r in cur.fetchall():
        bcode = r[0]
        if bcode not in chapters_by_book:
            chapters_by_book[bcode] = []
        chapters_by_book[bcode].append({'index': r[1], 'title': r[2]})

    def resolve_target(src_code, target_layer, src_chap_idx, src_para_num=None):
        src_b = books.get(src_code)
        if not src_b:
            return None

        clean_p = str(src_para_num).replace('para', '').replace('p', '').strip() if src_para_num else None
        p_int = int(clean_p) if clean_p and clean_p.isdigit() else None

        mat = src_b['mat']
        split_targets = src_b['split_targets'] or mat.get('split_targets')

        target_code = None
        target_chap = None

        # Case 1: Split targets (e.g. vin01m.mul -> vin01t1/t2, s0508m -> s0508a1/a2, s0513m -> s0513a1..a4)
        if split_targets and target_layer in split_targets:
            rules = split_targets[target_layer]
            for rule in rules:
                in_chap = rule.get('chapter_range') and (rule['chapter_range'][0] <= src_chap_idx <= rule['chapter_range'][1])
                in_para = True
                if rule.get('para_range') and p_int is not None:
                    in_para = (rule['para_range'][0] <= p_int <= rule['para_range'][1])
                if in_chap and in_para:
                    target_code = rule.get('code')
                    if rule.get('target_chapter') is not None:
                        target_chap = rule['target_chapter']
                    elif rule.get('target_chapter_offset') is not None:
                        target_chap = max(0, src_chap_idx + rule['target_chapter_offset'])
                    break

        sub_key = None

        # Case 2: Multi-volume parent book with sub_books (e.g. vin02t.tik, s0402a.att, s0402t.tik, s0403a.att, s0403t.tik, s0404a.att, s0404t.tik, s0510a.att, abh03a.att, abh03t.tik)
        if not target_code and src_b.get('sub_books'):
            if src_b.get('chapter_to_sub_book'):
                sub_key = src_b['chapter_to_sub_book'].get(str(src_chap_idx)) or src_b['chapter_to_sub_book'].get(src_chap_idx)

            if not sub_key:
                for k, sinfo in src_b['sub_books'].items():
                    cr = sinfo.get('tika_chapter_range') or sinfo.get('chapter_range')
                    if cr and cr[0] <= src_chap_idx <= cr[1]:
                        sub_key = k
                        break

            if sub_key and sub_key in src_b['sub_books']:
                sinfo = src_b['sub_books'][sub_key]
                if target_layer == 'mula':
                    target_code = sinfo.get('mula_code')
                    if sinfo.get('chapter_range'):
                        target_chap = max(0, src_chap_idx - sinfo['chapter_range'][0])
                    elif sinfo.get('tika_chapter_range'):
                        start_t = sinfo['tika_chapter_range'][0]
                        if start_t in [8, 19, 32]:
                            target_chap = max(0, src_chap_idx - (start_t + 1))
                        else:
                            target_chap = max(0, src_chap_idx - start_t)
                elif target_layer == 'attha':
                    target_code = sinfo.get('attha_code')
                    if sinfo.get('chapter_range'):
                        target_chap = max(0, src_chap_idx - sinfo['chapter_range'][0])
                    elif sinfo.get('tika_chapter_range'):
                        start_t = sinfo['tika_chapter_range'][0]
                        if start_t in [8, 19, 32]:
                            target_chap = max(0, src_chap_idx - (start_t + 1))
                        else:
                            target_chap = max(0, src_chap_idx - start_t)
                elif target_layer == 'tika':
                    target_code = sinfo.get('tika_code')
                    if sinfo.get('tika_chapter') is not None:
                        target_chap = sinfo['tika_chapter']
                    elif sinfo.get('tika_chapter_range') and sinfo.get('chapter_range'):
                        start_c = sinfo['chapter_range'][0]
                        start_t = sinfo['tika_chapter_range'][0]
                        target_chap = start_t + (src_chap_idx - start_c)

        # Case 3: Sub-book single volume forward jump (e.g. s0402m2.mul -> s0402a.att an3, vin02m2.mul -> vin02t.tik, s0510m2.mul -> s0510a.att apadana2)
        if not target_code and src_b.get('sub_book'):
            src_sub = src_b['sub_book']
            if target_layer == 'mula':
                target_code = mat.get('mula_code')
                offset = src_b['meta'].get('mula_start_chapter', mat.get('mula_start_chapter', 0))
                if target_chap is None:
                    target_chap = offset + src_chap_idx
            elif target_layer == 'attha':
                target_code = mat.get('attha_code')
                offset = src_b['meta'].get('attha_start_chapter', mat.get('attha_start_chapter', 0))
                if target_chap is None:
                    target_chap = offset + src_chap_idx
            elif target_layer == 'tika':
                target_code = mat.get('tika_code')
                offset = src_b['meta'].get('tika_start_chapter', mat.get('tika_start_chapter', 0))
                if target_chap is None:
                    target_chap = offset + src_chap_idx

        # Case 3: Reverse offset from split/multi book (e.g. s0508a2.att -> s0508m.mul, s0510a.att -> s0510m2.mul)
        if not target_code:
            if target_layer == 'mula':
                target_code = mat.get('mula_code')
                if src_b['meta'].get('mula_chapter') is not None:
                    target_chap = src_b['meta']['mula_chapter']
                elif src_b['meta'].get('mula_chapter_offset') is not None:
                    target_chap = max(0, src_chap_idx + src_b['meta']['mula_chapter_offset'])
            elif target_layer == 'attha':
                target_code = mat.get('attha_code')
                if src_b['meta'].get('attha_chapter') is not None:
                    target_chap = src_b['meta']['attha_chapter']
                elif src_b['meta'].get('attha_chapter_offset') is not None:
                    target_chap = max(0, src_chap_idx + src_b['meta']['attha_chapter_offset'])
                elif src_b['meta'].get('attha_start_chapter') is not None:
                    target_chap = max(0, src_chap_idx + src_b['meta']['attha_start_chapter'])
                elif mat.get('attha_start_chapter') is not None:
                    target_chap = max(0, src_chap_idx + mat['attha_start_chapter'])
            elif target_layer == 'tika':
                target_code = mat.get('tika_code')
                if src_b['meta'].get('tika_chapter') is not None:
                    target_chap = src_b['meta']['tika_chapter']
                elif src_b['meta'].get('tika_chapter_offset') is not None:
                    target_chap = max(0, src_chap_idx + src_b['meta']['tika_chapter_offset'])
                elif src_b['meta'].get('tika_start_chapter') is not None:
                    target_chap = max(0, src_chap_idx + src_b['meta']['tika_start_chapter'])
                elif mat.get('tika_start_chapter') is not None:
                    target_chap = max(0, src_chap_idx + mat['tika_start_chapter'])

        # Fallback to standard mat codes
        if not target_code and mat:
            target_code = mat.get(f'{target_layer}_code')

        if not target_code or target_code == src_code:
            return None

        target_b = books.get(target_code)
        if not target_b:
            return None

        target_title = target_b['title']
        target_para = clean_p

        # Special handling for books where every chapter has its own 1..N paragraph numbering (e.g. s0511 Buddhavaṃsa, s0512 Cariyāpiṭaka)
        is_chap_paras_book = src_b['meta'].get('chapter_has_own_paras') or target_b['meta'].get('chapter_has_own_paras') or src_code in ['s0511m.mul', 's0511a.att', 's0512m.mul', 's0512a.att']
        if is_chap_paras_book:
            if src_code == 's0511m.mul' and target_layer == 'attha':
                max_chap = max(0, len(chapters_by_book.get(target_code, [])) - 1)
                target_chap = min(src_chap_idx + 1, max_chap)
                return {
                    'book': target_code,
                    'chapter': target_chap,
                    'para': clean_p,
                    'title': target_title
                }
            elif src_code == 's0511a.att' and target_layer == 'mula':
                if src_chap_idx == 0:
                    return None
                target_chap = src_chap_idx - 1
                return {
                    'book': target_code,
                    'chapter': target_chap,
                    'para': clean_p,
                    'title': target_title
                }
            elif src_code == 's0512m.mul' and target_layer == 'attha':
                max_chap = max(0, len(chapters_by_book.get(target_code, [])) - 1)
                target_chap = min(src_chap_idx + 1, max_chap)
                return {
                    'book': target_code,
                    'chapter': target_chap,
                    'para': clean_p,
                    'title': target_title
                }
            elif src_code == 's0512a.att' and target_layer == 'mula':
                if src_chap_idx == 0:
                    return None
                target_chap = src_chap_idx - 1
                return {
                    'book': target_code,
                    'chapter': target_chap,
                    'para': clean_p,
                    'title': target_title
                }

        # Refine target chapter using paragraph alignment if available
        src_p2c = src_b.get('sub_books_para_to_chapter', {}).get(sub_key, {}) if sub_key else src_b.get('para_to_chapter', {})
        if not src_p2c:
            src_p2c = src_b.get('para_to_chapter', {})
        paras_in_chap = [int(p) for p, c in src_p2c.items() if c == src_chap_idx and p.isdigit() and int(p) > 0]
        paras_in_chap.sort()

        target_sub_hint = sub_key or target_b.get('sub_book') or src_b.get('sub_book')
        target_p2c = target_b.get('sub_books_para_to_chapter', {}).get(target_sub_hint, {}) if target_sub_hint else target_b.get('para_to_chapter', {})
        if not target_p2c:
            target_p2c = target_b.get('para_to_chapter', {})

        para_matched_chap = None
        for p in paras_in_chap:
            str_p = str(p)
            if str_p in target_p2c:
                para_matched_chap = target_p2c[str_p]
                break
        if para_matched_chap is not None:
            target_chap = para_matched_chap

        # Find target chapter and exact/nearest paragraph in target book
        if clean_p and target_b['para_to_chapter']:
            target_sub = target_b['sub_book'] or (target_b['chapter_to_sub_book'].get(str(target_chap)) if target_chap is not None else None)
            if not target_sub and src_b.get('sub_book'):
                target_sub = src_b['sub_book']
            if not target_sub and sub_key:
                target_sub = sub_key

            # Priority A: Check sub_books_para_to_chapter
            if target_sub and target_b['sub_books_para_to_chapter'].get(target_sub):
                sub_p2c = target_b['sub_books_para_to_chapter'][target_sub]
                if clean_p in sub_p2c:
                    target_chap = sub_p2c[clean_p]
                    target_para = clean_p
                else:
                    target_para = None
            # Priority B: Check target book's standard para_to_chapter
            elif clean_p in target_b['para_to_chapter']:
                target_chap = target_b['para_to_chapter'][clean_p]
                target_para = clean_p
            else:
                target_para = None

        if target_chap is None:
            target_chap = 0

        return {
            'book': target_code,
            'chapter': target_chap,
            'para': target_para,
            'title': target_title
        }

    cur.execute("DELETE FROM mat_para_map")
    cur.execute("DELETE FROM mat_chapter_map")

    para_rows = []
    chapter_rows = []

    for bcode, b in books.items():
        chaps = chapters_by_book.get(bcode, [{'index': 0, 'title': b['title']}])
        p2c = b['para_to_chapter']

        chapter_to_mat = {}
        para_to_mat = {}

        # 1. Compute chapter mappings
        for ch in chaps:
            c_idx = ch['index']
            c_mat = {}
            for layer in ['mula', 'attha', 'tika']:
                t = resolve_target(bcode, layer, c_idx)
                if t:
                    c_mat[layer] = t

            if c_mat:
                chapter_to_mat[str(c_idx)] = c_mat
                chapter_rows.append((
                    bcode,
                    c_idx,
                    c_mat.get('mula', {}).get('book'),
                    c_mat.get('mula', {}).get('chapter'),
                    c_mat.get('mula', {}).get('title'),
                    c_mat.get('attha', {}).get('book'),
                    c_mat.get('attha', {}).get('chapter'),
                    c_mat.get('attha', {}).get('title'),
                    c_mat.get('tika', {}).get('book'),
                    c_mat.get('tika', {}).get('chapter'),
                    c_mat.get('tika', {}).get('title'),
                ))

        # 2. Compute paragraph mappings (including all sub-book occurrences)
        para_entries = []
        seen_para_chap = set()

        sub_p2c = b.get('sub_books_para_to_chapter', {})
        chapter_to_sub = b.get('chapter_to_sub_book', {})
        chap_to_ps = b.get('meta', {}).get('chapter_to_paras', {})

        if chap_to_ps:
            for c_idx_str, p_list in chap_to_ps.items():
                c_idx = int(c_idx_str)
                s_key = chapter_to_sub.get(str(c_idx)) or chapter_to_sub.get(c_idx) or b.get('sub_book')
                for p_str in p_list:
                    key = (c_idx, str(p_str))
                    if key not in seen_para_chap:
                        seen_para_chap.add(key)
                        para_entries.append((c_idx, str(p_str), s_key))

        if sub_p2c:
            for s_key, s_pmap in sub_p2c.items():
                for p_str, c_idx in s_pmap.items():
                    key = (c_idx, str(p_str))
                    if key not in seen_para_chap:
                        seen_para_chap.add(key)
                        para_entries.append((c_idx, str(p_str), s_key))

        for p_str, c_idx in p2c.items():
            key = (c_idx, str(p_str))
            if key not in seen_para_chap:
                seen_para_chap.add(key)
                s_key = chapter_to_sub.get(str(c_idx)) or chapter_to_sub.get(c_idx) or b.get('sub_book')
                para_entries.append((c_idx, str(p_str), s_key))

        sub_books_para_to_mat = {}
        for c_idx, p_str, s_key in para_entries:
            p_mat = {}
            for layer in ['mula', 'attha', 'tika']:
                t = resolve_target(bcode, layer, c_idx, p_str)
                if t:
                    p_mat[layer] = t

            if p_mat:
                if str(p_str) not in para_to_mat:
                    para_to_mat[str(p_str)] = p_mat
                if s_key:
                    if s_key not in sub_books_para_to_mat:
                        sub_books_para_to_mat[s_key] = {}
                    sub_books_para_to_mat[s_key][str(p_str)] = p_mat

                para_rows.append((
                    bcode,
                    c_idx,
                    str(p_str),
                    s_key,
                    p_mat.get('mula', {}).get('book'),
                    p_mat.get('mula', {}).get('chapter'),
                    p_mat.get('mula', {}).get('para'),
                    p_mat.get('mula', {}).get('title'),
                    p_mat.get('attha', {}).get('book'),
                    p_mat.get('attha', {}).get('chapter'),
                    p_mat.get('attha', {}).get('para'),
                    p_mat.get('attha', {}).get('title'),
                    p_mat.get('tika', {}).get('book'),
                    p_mat.get('tika', {}).get('chapter'),
                    p_mat.get('tika', {}).get('para'),
                    p_mat.get('tika', {}).get('title'),
                ))

        b['meta']['chapter_to_mat'] = chapter_to_mat
        b['meta']['para_to_mat'] = para_to_mat
        if sub_books_para_to_mat:
            b['meta']['sub_books_para_to_mat'] = sub_books_para_to_mat
        new_meta_json = json.dumps(b['meta'], ensure_ascii=False)
        cur.execute("UPDATE books SET meta_json = ? WHERE code = ?", (new_meta_json, bcode))

    cur.executemany("""
    INSERT INTO mat_chapter_map (
        source_book, source_chapter,
        mula_book, mula_chapter, mula_title,
        attha_book, attha_chapter, attha_title,
        tika_book, tika_chapter, tika_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, chapter_rows)

    cur.executemany("""
    INSERT INTO mat_para_map (
        source_book, source_chapter, source_para, sub_book,
        mula_book, mula_chapter, mula_para, mula_title,
        attha_book, attha_chapter, attha_para, attha_title,
        tika_book, tika_chapter, tika_para, tika_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, para_rows)

    elapsed = time.time() - t0
    log_step(f"  ✓ Precomputed {len(chapter_rows)} chapter and {len(para_rows)} paragraph MAT mappings in {elapsed:.2f}s.")


# ===========================================================================
# Step 3: Build tipitaka.db from _latest_romn
# ===========================================================================
def build_tipitaka_database(output_path: str = TIPITAKA_DB):
    log("STEP 3", f"Building Primary SQLite Database at '{output_path}' from '_latest_romn'")
    t0 = time.time()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    temp_db = output_path + '.tmp'
    if os.path.exists(temp_db):
        os.remove(temp_db)

    conn = sqlite3.connect(temp_db)
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA cache_size = -64000;")
    cur = conn.cursor()

    cur.execute("""
    CREATE TABLE site_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        nikaya TEXT,
        category TEXT,
        xml_filename TEXT NOT NULL,
        chapter_count INTEGER DEFAULT 0,
        meta_json TEXT
    );
    """)

    cur.execute("""
    CREATE TABLE chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        chunk_name TEXT NOT NULL,
        anchor_id TEXT NOT NULL,
        para_index INTEGER DEFAULT 0,
        html TEXT,
        FOREIGN KEY (book_id) REFERENCES books(id)
    );
    """)

    cur.execute("""
    CREATE TABLE tree_nodes (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        parent_id INTEGER,
        node_type TEXT,
        book_code TEXT,
        chapter_index INTEGER,
        href TEXT
    );
    """)

    cur.execute("""
    CREATE TABLE book_mat (
        book_code TEXT PRIMARY KEY,
        category TEXT,
        mula_code TEXT,
        mula_title TEXT,
        attha_code TEXT,
        attha_title TEXT,
        tika_code TEXT,
        tika_title TEXT
    );
    """)

    cur.execute("""
    CREATE TABLE mat_para_map (
        source_book TEXT NOT NULL,
        source_chapter INTEGER NOT NULL,
        source_para TEXT NOT NULL,
        sub_book TEXT,
        mula_book TEXT,
        mula_chapter INTEGER,
        mula_para TEXT,
        mula_title TEXT,
        attha_book TEXT,
        attha_chapter INTEGER,
        attha_para TEXT,
        attha_title TEXT,
        tika_book TEXT,
        tika_chapter INTEGER,
        tika_para TEXT,
        tika_title TEXT,
        PRIMARY KEY (source_book, source_chapter, source_para)
    );
    """)

    cur.execute("""
    CREATE TABLE mat_chapter_map (
        source_book TEXT NOT NULL,
        source_chapter INTEGER NOT NULL,
        mula_book TEXT,
        mula_chapter INTEGER,
        mula_title TEXT,
        attha_book TEXT,
        attha_chapter INTEGER,
        attha_title TEXT,
        tika_book TEXT,
        tika_chapter INTEGER,
        tika_title TEXT,
        PRIMARY KEY (source_book, source_chapter)
    );
    """)

    cur.execute("""
    CREATE TABLE book_toc (
        book_id INTEGER,
        book_code TEXT,
        item_index INTEGER,
        level INTEGER,
        type TEXT,
        rend TEXT,
        title TEXT,
        para_index INTEGER,
        para_num TEXT,
        anchor_id TEXT,
        chapter_index INTEGER
    );
    """)

    # Load metadata
    with open(TREE_JSON_FILE, 'r', encoding='utf-8') as f:
        tree_data = json.load(f)

    with open(CST_CATALOG_FILE, 'r', encoding='utf-8') as f:
        cst_catalog = json.load(f)

    with open(CHAPTERS_CATALOG_FILE, 'r', encoding='utf-8') as f:
        chapters_list = json.load(f)

    book_mat_file = os.path.join(METADATA_DIR, 'book_mat.json')
    book_mat_catalog = {}
    if os.path.exists(book_mat_file):
        with open(book_mat_file, 'r', encoding='utf-8') as f:
            book_mat_catalog = json.load(f)

    # Insert site_metadata
    cur.execute("INSERT OR REPLACE INTO site_metadata (key, value) VALUES (?, ?);",
                ('tree_json', json.dumps(tree_data, ensure_ascii=False)))
    cur.execute("INSERT OR REPLACE INTO site_metadata (key, value) VALUES (?, ?);",
                ('version', '1.0'))

    # Extract book titles from tree
    book_titles_from_tree = {}
    def extract_titles(node):
        if 'children' in node and node['children']:
            for c in node['children']:
                href = c.get('a_attr', {}).get('href', '') or c.get('href', '')
                if href and href.startswith('cscd/'):
                    m = re.match(r'cscd/([a-z0-9\._]+?)(?:\d+)?\.xml', href)
                    if m:
                        code = m.group(1)
                        if code not in book_titles_from_tree:
                            book_titles_from_tree[code] = node['text']
            for c in node['children']:
                extract_titles(c)

    for root in tree_data:
        extract_titles(root)

    # Insert tree_nodes
    node_seq = 0
    def insert_nodes(nodes, parent_id=None):
        nonlocal node_seq
        for n in nodes:
            node_seq += 1
            nid = n.get('id', node_seq)
            text = n.get('text', '')
            href = n.get('a_attr', {}).get('href', '') or n.get('href', '')

            b_code = None
            c_idx = None
            if href and href.startswith('cscd/'):
                m = re.match(r'cscd/([a-z0-9\._]+?)(?:(\d+))?\.xml', href)
                if m:
                    b_code = m.group(1)
                    c_idx = int(m.group(2)) if m.group(2) is not None else None

            ntype = 'category' if not b_code else ('book' if c_idx is None else 'chapter')

            cur.execute("""
            INSERT OR REPLACE INTO tree_nodes (id, text, parent_id, node_type, book_code, chapter_index, href)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """, (nid, text, parent_id, ntype, b_code, c_idx, href))

            if 'children' in n and n['children']:
                insert_nodes(n['children'], nid)

    insert_nodes(tree_data)
    log_step(f"Populated {node_seq} tree nodes.")

    # Group chapters by book_code
    chaps_by_book = {}
    for c in chapters_list:
        chaps_by_book.setdefault(c['book_code'], []).append(c)

    # Parse and insert books from _latest_romn
    book_files = sorted([f for f in os.listdir(ROMN_DIR) if f.endswith('.xml')])
    log_step(f"Parsing and rendering chapter HTML for {len(book_files)} books from '{ROMN_DIR}'...")

    p_regex = re.compile(r'<(p|head|trailer)\s+rend="([^"]+)"(?:\s+n="([^"]+)")?\s*>([\s\S]*?)</\1>')
    level_map = {'nikaya': 0, 'book': 0, 'chapter': 1, 'subhead': 2, 'title': 2, 'subsubhead': 3}

    total_paras_processed = 0
    total_chapters_inserted = 0
    total_toc_rows = 0

    for bf in book_files:
        book_code = bf[:-4]
        cst_entry = cst_catalog.get(book_code, {})

        if '.mul' in book_code:
            cat = 'mūla'
        elif '.att' in book_code:
            cat = 'aṭṭhakathā'
        elif '.tik' in book_code:
            cat = 'ṭīkā'
        else:
            cat = 'añña'

        xml_path = os.path.join(ROMN_DIR, bf)
        xml_content = read_text_auto(xml_path)

        title = book_titles_from_tree.get(book_code)
        if not title:
            bm = re.search(r'<(?:p|head)\s+rend="book"[^>]*>([^<]+)</(?:p|head)>', xml_content)
            title = bm.group(1).strip() if bm else cst_entry.get('mat', {}).get('mula_title', book_code)

        nm = re.search(r'<(?:p|head)\s+rend="nikaya"[^>]*>([^<]+)</(?:p|head)>', xml_content)
        nikaya = nm.group(1).strip() if nm else ''

        chaps = chaps_by_book.get(book_code, [])
        chaps.sort(key=lambda x: x['chapter_index'])
        chap_by_para = {c['para_index']: c for c in chaps}

        body_match = re.search(r'<body[^>]*>([\s\S]*?)</body>', xml_content)
        body = body_match.group(1) if body_match else xml_content

        chapter_paras = {c['chapter_index']: [] for c in chaps}
        if 0 not in chapter_paras:
            chapter_paras[0] = []

        mat_entry = book_mat_catalog.get(book_code, {})
        has_sub_books = 'sub_books' in mat_entry
        sub_books_def = mat_entry.get('sub_books', {})
        chapter_to_sub_book = {}
        sub_books_para_to_chapter = {}
        if has_sub_books:
            for sub_key, sub_info in sub_books_def.items():
                sub_books_para_to_chapter[sub_key] = {}
                cr = sub_info.get('chapter_range')
                if cr:
                    for c_i in range(cr[0], cr[1] + 1):
                        chapter_to_sub_book[c_i] = sub_key
                elif 'tika_chapter_range' in sub_info:
                    cr = sub_info['tika_chapter_range']
                    for c_i in range(cr[0], cr[1] + 1):
                        chapter_to_sub_book[c_i] = sub_key
                elif 'tika_chapter' in sub_info:
                    c_i = sub_info['tika_chapter']
                    chapter_to_sub_book[c_i] = sub_key

        para_to_chapter = {}
        para_to_index = {}
        chapter_to_paras = {c['chapter_index']: set() for c in chaps}
        if 0 not in chapter_to_paras:
            chapter_to_paras[0] = set()
        page_to_chapter = {'V': {}, 'P': {}, 'T': {}, 'M': {}, 'O': {}}
        page_to_para = {'V': {}, 'P': {}, 'T': {}, 'M': {}, 'O': {}}
        page_anchors = {'V': {}, 'P': {}, 'T': {}, 'M': {}, 'O': {}}

        current_chap_idx = 0
        para_counter = 0

        book_toc_items = []
        toc_item_counter = 0

        for match in p_regex.finditer(body):
            if para_counter in chap_by_para:
                current_chap_idx = chap_by_para[para_counter]['chapter_index']

            rend = match.group(2)
            n_attr = match.group(3)
            inner = match.group(4)

            # Hierarchical TOC collection
            if rend in level_map:
                t_inner = re.sub(r'<note[\s\S]*?</note>', '', inner)
                t_inner = re.sub(r'<pb[^>]*/>', '', t_inner)
                clean_title = re.sub(r'<[^>]+>', '', t_inner).strip()
                clean_title = re.sub(r'\s+', ' ', clean_title)
                book_toc_items.append((
                    None,
                    book_code,
                    toc_item_counter,
                    level_map[rend],
                    rend,
                    rend,
                    clean_title,
                    para_counter,
                    None,
                    f'para-{para_counter}',
                    current_chap_idx
                ))
                toc_item_counter += 1

            # Page Break extraction & indexing (V, P, T, M, O)
            pb_matches = re.finditer(r'<pb\s+ed="([^"]+)"\s+n="([^"]+)"\s*/?>', inner)
            for pbm in pb_matches:
                ed = pbm.group(1).upper()
                page = pbm.group(2)
                if ed not in page_to_chapter:
                    page_to_chapter[ed] = {}
                    page_to_para[ed] = {}
                    page_anchors[ed] = {}
                pb_anchor_id = f'{ed}{page}'
                page_to_chapter[ed][page] = current_chap_idx
                page_anchors[ed][page] = pb_anchor_id
                if n_attr:
                    page_to_para[ed][page] = n_attr

                if '.' in page:
                    parts = page.split('.')
                    vol = int(parts[0])
                    num = int(parts[1]) if parts[1].isdigit() else 0
                    short_num = str(num)
                    vol_dot_num = f'{vol}.{short_num}'
                    page_to_chapter[ed][vol_dot_num] = current_chap_idx
                    page_to_chapter[ed][short_num] = current_chap_idx
                    page_anchors[ed][vol_dot_num] = pb_anchor_id
                    if short_num not in page_anchors[ed]:
                        page_anchors[ed][short_num] = pb_anchor_id
                    if n_attr:
                        page_to_para[ed][vol_dot_num] = n_attr
                        if short_num not in page_to_para[ed]:
                            page_to_para[ed][short_num] = n_attr

            # Inline transformations
            inner = re.sub(r'<hi\s+rend="bold">([^<]+)</hi>', r'<strong class="bld">\1</strong>', inner)
            if n_attr:
                inner = re.sub(r'<hi\s+rend="paranum">([^<]+)</hi>', rf'<strong class="paranum" id="para-{n_attr}">\1</strong>', inner)
            else:
                inner = re.sub(r'<hi\s+rend="paranum">([^<]+)</hi>', r'<strong class="paranum">\1</strong>', inner)
            inner = re.sub(r'<hi\s+rend="dot">([^<]+)</hi>', r'<span class="dot">\1</span>', inner)
            inner = re.sub(r'<pb\s+ed="([^"]+)"\s+n="([^"]+)"\s*/?>',
                           lambda m: f'<span id="{m.group(1).upper()}{m.group(2)}" class="pb" title="Page {m.group(1).upper()} {m.group(2)}" data-ed="{m.group(1).upper()}\" data-page="{m.group(2)}">[{m.group(1).upper()} {m.group(2)}]</span>', inner)
            inner = re.sub(r'<note>([\s\S]*?)</note>', r'<span class="note" title="Footnote">[\1]</span>', inner)

            current_sub_key = chapter_to_sub_book.get(current_chap_idx) if has_sub_books else mat_entry.get('sub_book')
            guid = f"{book_code}:c{current_chap_idx}:n{n_attr or '0'}:p{para_counter}"
            attr_parts = [f'data-pindex="{para_counter}"', f'data-guid="{guid}"']
            if current_sub_key:
                attr_parts.append(f'data-sub-book="{current_sub_key}"')

            if n_attr:
                if current_chap_idx not in chapter_to_paras:
                    chapter_to_paras[current_chap_idx] = set()
                chapter_to_paras[current_chap_idx].add(n_attr)
                attr_parts.append(f'id="para{n_attr}"')
                attr_parts.append(f'data-para="{n_attr}"')
                span = try_parse_paragraph_span(n_attr)
                if span:
                    attr_parts.append(f'data-para-first="{span[0]}"')
                    attr_parts.append(f'data-para-last="{span[1]}"')
                    for p_num in range(span[0], span[1] + 1):
                        str_num = str(p_num)
                        chapter_to_paras[current_chap_idx].add(str_num)
                        if str_num not in para_to_chapter:
                            para_to_chapter[str_num] = current_chap_idx
                            para_to_index[str_num] = para_counter
                        if has_sub_books and current_sub_key:
                            if str_num not in sub_books_para_to_chapter[current_sub_key]:
                                sub_books_para_to_chapter[current_sub_key][str_num] = current_chap_idx
                else:
                    if n_attr not in para_to_chapter:
                        para_to_chapter[n_attr] = current_chap_idx
                        para_to_index[n_attr] = para_counter
                    if has_sub_books and current_sub_key:
                        if n_attr not in sub_books_para_to_chapter[current_sub_key]:
                            sub_books_para_to_chapter[current_sub_key][n_attr] = current_chap_idx
            else:
                attr_parts.append(f'id="pindex-{para_counter}"')

            attrs = ' ' + ' '.join(attr_parts)
            p_tag = f'<p class="{rend or "bodytext"}"{attrs}>{inner}</p>'
            chapter_paras[current_chap_idx].append(p_tag)
            para_counter += 1

        total_paras_processed += para_counter

        # Calculate ranges
        para_nums = [int(k) for k in para_to_chapter.keys() if k.isdigit()]
        para_range = {
            'min': min(para_nums) if para_nums else 1,
            'max': max(para_nums) if para_nums else 1,
            'total': len(para_nums)
        }

        edition_ranges = {}
        for sys_ed in ['V', 'P', 'T', 'M', 'O']:
            p_map = page_to_chapter.get(sys_ed, {})
            unique_pages = set()
            min_num = float('inf')
            max_num = float('-inf')
            for p in p_map.keys():
                n = float('nan')
                if '.' in p:
                    parts = p.split('.')
                    if parts[1].isdigit():
                        n = int(parts[1])
                elif p.isdigit():
                    n = int(p)
                if not (n != n):
                    unique_pages.add(int(n))
                    if n < min_num: min_num = int(n)
                    if n > max_num: max_num = int(n)
            if not unique_pages:
                edition_ranges[sys_ed] = {
                    'available': False,
                    'count': 0,
                    'minNum': 1,
                    'maxNum': 1,
                    'label': 'Unavailable',
                    'hint': '1'
                }
            else:
                edition_ranges[sys_ed] = {
                    'available': True,
                    'count': len(unique_pages),
                    'minNum': min_num,
                    'maxNum': max_num,
                    'label': f'Page {min_num} – {max_num}',
                    'hint': f'e.g. {min_num} to {max_num}'
                }

        book_type = cst_entry.get('bookType', 'Whole')
        mat = cst_entry.get('mat', None)

        meta_mat = mat_entry if mat_entry else (mat or {})
        meta_obj = {
            'para_to_chapter': para_to_chapter,
            'chapter_to_paras': {str(c): sorted(list(ps), key=lambda x: (int(x.split('-')[0]) if x.split('-')[0].isdigit() else 999999, x)) for c, ps in chapter_to_paras.items() if ps},
            'para_to_index': para_to_index,
            'page_to_chapter': page_to_chapter,
            'page_to_para': page_to_para,
            'page_anchors': page_anchors,
            'para_range': para_range,
            'edition_ranges': edition_ranges,
            'book_type': book_type,
            'mat': meta_mat
        }
        if has_sub_books:
            meta_obj['sub_books'] = sub_books_def
            meta_obj['chapter_to_sub_book'] = chapter_to_sub_book
            meta_obj['sub_books_para_to_chapter'] = sub_books_para_to_chapter
        if 'sub_book' in mat_entry:
            meta_obj['sub_book'] = mat_entry['sub_book']
        if mat_entry.get('attha_start_chapter') is not None:
            meta_obj['attha_start_chapter'] = mat_entry.get('attha_start_chapter')
        if mat_entry.get('tika_start_chapter') is not None:
            meta_obj['tika_start_chapter'] = mat_entry.get('tika_start_chapter')
        if 'split_targets' in mat_entry:
            meta_obj['split_targets'] = mat_entry['split_targets']
        if 'mula_chapter' in mat_entry:
            meta_obj['mula_chapter'] = mat_entry['mula_chapter']
        if 'mula_chapter_offset' in mat_entry:
            meta_obj['mula_chapter_offset'] = mat_entry['mula_chapter_offset']
        if 'attha_chapter_offset' in mat_entry:
            meta_obj['attha_chapter_offset'] = mat_entry['attha_chapter_offset']

        cur.execute("""
        INSERT INTO books (code, title, nikaya, category, xml_filename, chapter_count, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (book_code, title, nikaya, cat, bf, len(chaps), json.dumps(meta_obj, ensure_ascii=False)))
        book_id = cur.lastrowid

        # Insert book_toc items
        if book_toc_items:
            cur.executemany("""
            INSERT INTO book_toc (book_id, book_code, item_index, level, type, rend, title, para_index, para_num, anchor_id, chapter_index)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, [(book_id, *item[1:]) for item in book_toc_items])
            total_toc_rows += len(book_toc_items)

        # Insert chapters
        for c in chaps:
            c_idx = c['chapter_index']
            c_title = c['title']
            chunk_name = c['chunk_name']
            anchor_id = c['anchor_id']
            p_idx = c['para_index']
            header_html = f'<div id="chap-{c_idx}" class="chapter-anchor" data-chapter="{c_idx}"></div>'
            chap_html = f'{header_html}\n' + '\n'.join(chapter_paras[c_idx])
            cur.execute("""
            INSERT INTO chapters (book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index, html)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """, (book_id, book_code, c_idx, c_title, chunk_name, anchor_id, p_idx, chap_html))
            total_chapters_inserted += 1

        # Populate book_mat
        mat_entry = book_mat_catalog.get(book_code)
        if mat_entry:
            cur.execute("""
            INSERT OR REPLACE INTO book_mat (book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """, (book_code, mat_entry.get('category', cat), mat_entry.get('mula_code'), mat_entry.get('mula_title'), mat_entry.get('attha_code'), mat_entry.get('attha_title'), mat_entry.get('tika_code'), mat_entry.get('tika_title')))
        elif mat:
            cur.execute("""
            INSERT OR REPLACE INTO book_mat (book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
            """, (book_code, cat, mat.get('mula_code'), mat.get('mula_title'), mat.get('attha_code'), mat.get('attha_title'), mat.get('tika_code'), mat.get('tika_title')))

    # Precompute Canon-wide MAT mappings (Chapter and Paragraph Level)
    precompute_canonical_mat_mappings(cur, conn, book_mat_catalog)

    # Create Performance Indexes
    log_step("Creating database indexes...")
    cur.execute("CREATE INDEX idx_books_code ON books(code);")
    cur.execute("CREATE INDEX idx_chapters_book ON chapters(book_code);")
    cur.execute("CREATE INDEX idx_chapters_book_idx ON chapters(book_code, chapter_index);")
    cur.execute("CREATE INDEX idx_chapters_chunk ON chapters(chunk_name);")
    cur.execute("CREATE INDEX idx_book_mat_code ON book_mat(book_code);")
    cur.execute("CREATE INDEX idx_mat_para_lookup ON mat_para_map(source_book, source_chapter, source_para);")
    cur.execute("CREATE INDEX idx_mat_para_src ON mat_para_map(source_book, source_para);")
    cur.execute("CREATE INDEX idx_mat_chap_src ON mat_chapter_map(source_book, source_chapter);")
    cur.execute("CREATE INDEX idx_book_toc_code ON book_toc(book_code, item_index);")
    cur.execute("CREATE INDEX idx_tree_parent ON tree_nodes(parent_id);")

    cur.execute("ANALYZE;")
    conn.commit()
    conn.close()

    if os.path.exists(output_path):
        os.remove(output_path)
    shutil.move(temp_db, output_path)

    elapsed = time.time() - t0
    db_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    log_step(f"Built '{output_path}' ({db_size_mb:.1f} MB) in {elapsed:.2f} seconds.")
    log_step(f"Stats: {len(book_files)} books, {total_chapters_inserted} chapters (100% HTML), {total_toc_rows} TOC rows, {total_paras_processed} paragraphs.")


# ===========================================================================
# Step 4: Build fts_tipitaka.db from _latest_romn
# ===========================================================================
def build_fts_database(fts_path: str = FTS_DB):
    log("STEP 4", f"Building FTS5 Search Database at '{fts_path}' from '_latest_romn'")
    t0 = time.time()
    os.makedirs(os.path.dirname(fts_path), exist_ok=True)
    temp_db = fts_path + '.tmp'
    if os.path.exists(temp_db):
        os.remove(temp_db)

    conn = sqlite3.connect(temp_db)
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA cache_size = -64000;")
    cur = conn.cursor()

    cur.execute("""
    CREATE VIRTUAL TABLE paragraphs_fts USING fts5(
        book_code,
        book_title,
        nikaya,
        para_num,
        para_index UNINDEXED,
        para_rend,
        content,
        prefix = 3
    );
    """)

    # Load authentic title and nikaya from tipitaka.db books table
    books_meta = {}
    if os.path.exists(TIPITAKA_DB):
        tconn = sqlite3.connect(TIPITAKA_DB)
        books_meta = {r[0]: (r[1], r[2]) for r in tconn.execute("SELECT code, title, nikaya FROM books;").fetchall()}
        tconn.close()

    book_files = sorted([f for f in os.listdir(ROMN_DIR) if f.endswith('.xml')])
    p_regex = re.compile(r'<(?:p|head|trailer)\s+rend="([^"]+)"(?:\s+n="([^"]+)")?\s*>([\s\S]*?)</(?:p|head|trailer)>')

    batch = []
    total = 0

    log_step(f"Indexing paragraphs across {len(book_files)} books in '{ROMN_DIR}'...")
    for bf in book_files:
        code = bf[:-4]
        title, nikaya = books_meta.get(code, (code, ''))
        content = read_text_auto(os.path.join(ROMN_DIR, bf))

        for p_idx, (rend, pnum, pcontent) in enumerate(p_regex.findall(content)):
            clean_text = clean_xml_to_plain(pcontent)
            if clean_text:
                batch.append((code, title, nikaya, pnum or '', p_idx, rend, clean_text))
            if len(batch) >= 10000:
                cur.executemany("INSERT INTO paragraphs_fts VALUES (?, ?, ?, ?, ?, ?, ?);", batch)
                total += len(batch)
                batch = []

    if batch:
        cur.executemany("INSERT INTO paragraphs_fts VALUES (?, ?, ?, ?, ?, ?, ?);", batch)
        total += len(batch)

    log_step(f"Inserted {total:,} paragraphs into FTS5 index. Optimizing B-tree...")
    cur.execute("INSERT INTO paragraphs_fts(paragraphs_fts) VALUES('optimize');")
    conn.commit()
    log_step("Reclaiming disk space via VACUUM...")
    cur.execute("VACUUM;")
    conn.commit()
    conn.close()

    if os.path.exists(fts_path):
        os.remove(fts_path)
    shutil.move(temp_db, fts_path)

    elapsed = time.time() - t0
    size_mb = os.path.getsize(fts_path) / (1024 * 1024)
    log_step(f"Built '{fts_path}' ({size_mb:.1f} MB) in {elapsed:.2f}s with {total:,} paragraphs.")


# ===========================================================================
# Step 5: Optional Build books_xml.db from _latest_romn
# ===========================================================================
def build_books_xml_database(db_path: str = BOOKS_XML_DB):
    log("STEP 5 (Optional)", f"Building Raw XML Storage Database at '{db_path}' from '_latest_romn'")
    t0 = time.time()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    temp_db = db_path + '.tmp'
    if os.path.exists(temp_db):
        os.remove(temp_db)

    conn = sqlite3.connect(temp_db)
    conn.execute("PRAGMA journal_mode = OFF;")
    conn.execute("PRAGMA synchronous = OFF;")
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE books_xml (
        book_code TEXT PRIMARY KEY,
        xml_filename TEXT NOT NULL,
        xml_content TEXT NOT NULL
    );
    """)

    book_files = sorted([f for f in os.listdir(ROMN_DIR) if f.endswith('.xml')])
    for bf in book_files:
        code = bf[:-4]
        content = read_text_auto(os.path.join(ROMN_DIR, bf))
        content_utf8 = content.replace('encoding="UTF-16"', 'encoding="UTF-8"').replace('encoding="utf-16"', 'encoding="UTF-8"')
        cur.execute("INSERT INTO books_xml (book_code, xml_filename, xml_content) VALUES (?, ?, ?);",
                    (code, bf, content_utf8))

    conn.commit()
    conn.close()

    if os.path.exists(db_path):
        os.remove(db_path)
    shutil.move(temp_db, db_path)

    elapsed = time.time() - t0
    size_mb = os.path.getsize(db_path) / (1024 * 1024)
    log_step(f"Archived {len(book_files)} books into '{db_path}' ({size_mb:.1f} MB) in {elapsed:.2f}s.")


# ===========================================================================
# Step 6: Verification
# ===========================================================================
def verify_multi_volume_mat(conn):
    log_step("Testing Multi-Volume MAT Navigation & Disambiguation across all 5 groups...")

    def get_meta(code):
        row = conn.execute("SELECT meta_json FROM books WHERE code = ?;", (code,)).fetchone()
        return json.loads(row[0]) if row else None

    def get_chap(code, chap_idx):
        row = conn.execute("SELECT title, html FROM chapters WHERE book_code = ? AND chapter_index = ?;", (code, chap_idx)).fetchone()
        return row if row else (None, None)

    def get_para_text(html, para_num):
        if not html: return None
        m = re.search(rf'<p[^>]*data-para=\"{para_num}\"[^>]*>([\s\S]*?)</p>', html)
        return re.sub(r'<[^>]+>', '', m.group(1)).strip() if m else None

    # Suite 1: AN 2-3-4
    att402 = get_meta('s0402a.att')
    sub_p2c = att402['sub_books_para_to_chapter']
    assert sub_p2c['an2']['2'] == 0
    assert sub_p2c['an3']['2'] == 19
    assert sub_p2c['an4']['2'] == 36
    assert att402['sub_books']['an3']['mula_code'] == 's0402m2.mul'
    assert att402['sub_books']['an4']['mula_code'] == 's0402m3.mul'
    _, h19 = get_chap('s0402a.att', 19)
    p19 = get_para_text(h19, '2')
    assert p19 and "lakkhaṇ" in p19.lower()

    # Suite 2: AN 5-6-7
    att403 = get_meta('s0403a.att')
    p2c_403 = att403['sub_books_para_to_chapter']
    assert p2c_403['an5']['1'] == 0
    assert p2c_403['an6']['1'] == 26
    assert p2c_403['an7']['1'] == 39
    assert att403['sub_books']['an6']['mula_code'] == 's0403m2.mul'
    assert att403['sub_books']['an7']['mula_code'] == 's0403m3.mul'

    # Suite 3: AN 8-9-10-11
    att404 = get_meta('s0404a.att')
    p2c_404 = att404['sub_books_para_to_chapter']
    assert p2c_404['an8']['1'] == 0
    assert p2c_404['an9']['1'] == 10
    assert p2c_404['an10']['1'] == 15
    assert p2c_404['an11']['1'] == 31
    assert att404['sub_books']['an9']['mula_code'] == 's0404m2.mul'
    assert att404['sub_books']['an10']['mula_code'] == 's0404m3.mul'
    assert att404['sub_books']['an11']['mula_code'] == 's0404m4.mul'

    # Suite 4: Abhidhamma Pancapakarana
    att_abh = get_meta('abh03a.att')
    tik_abh = get_meta('abh03t.tik')
    for k, m_code, a_c, t_c in [
        ('dhatukatha', 'abh03m1.mul', 0, 0),
        ('puggalapannatti', 'abh03m2.mul', 3, 1),
        ('kathavatthu', 'abh03m3.mul', 6, 2),
        ('yamaka', 'abh03m4.mul', 39, 3),
        ('patthana', 'abh03m7.mul', 50, 4)
    ]:
        assert att_abh['sub_books'][k]['mula_code'] == m_code
        assert att_abh['sub_books'][k]['chapter_range'][0] == a_c
        assert tik_abh['sub_books'][k]['tika_chapter'] == t_c

    # Suite 5: Vinaya Saratthadipani
    tik_vin = get_meta('vin02t.tik')
    for k, m_code, t_c in [
        ('pacittiya', 'vin02m1.mul', 0),
        ('mahavagga', 'vin02m2.mul', 8),
        ('culavagga', 'vin02m3.mul', 19),
        ('parivara', 'vin02m4.mul', 32)
    ]:
        assert tik_vin['sub_books'][k]['mula_code'] == m_code
        assert tik_vin['sub_books'][k]['tika_chapter_range'][0] == t_c

    # Suite 6: HTML DOM Tag Integrity
    _, h19 = get_chap('s0402a.att', 19)
    m_tag19 = re.search(r'<p[^>]*id=\"para2\"[^>]*>', h19)
    assert m_tag19 and 'data-sub-book="an3"' in m_tag19.group(0)
    assert m_tag19.group(0).count(' id="') == 1

    _, h36 = get_chap('s0402a.att', 36)
    m_tag36 = re.search(r'<p[^>]*id=\"para2\"[^>]*>', h36)
    assert m_tag36 and 'data-sub-book="an4"' in m_tag36.group(0)
    assert m_tag36.group(0).count(' id="') == 1

    # Suite 7: Patthana 4 & 5 Fix in abh03
    m10_meta = get_meta('abh03m10.mul')
    m11_meta = get_meta('abh03m11.mul')
    assert m10_meta['sub_book'] == 'patthana' and m10_meta['attha_start_chapter'] == 50
    assert m11_meta['sub_book'] == 'patthana' and m11_meta['attha_start_chapter'] == 50

    # Suite 8: Apadana (s0510)
    att_510 = get_meta('s0510a.att')
    assert 'apadana1' in att_510['sub_books'] and 'apadana2' in att_510['sub_books']
    assert att_510['sub_books_para_to_chapter']['apadana1']['1'] == 2
    assert att_510['sub_books_para_to_chapter']['apadana2']['1'] == 37
    m2_510 = get_meta('s0510m2.mul')
    assert m2_510['sub_book'] == 'apadana2' and m2_510['attha_start_chapter'] == 37

    # Suite 9: Theragatha (s0508)
    m_508 = get_meta('s0508m.mul')
    assert 'split_targets' in m_508 and 'attha' in m_508['split_targets']
    assert m_508['split_targets']['attha'][0]['code'] == 's0508a1.att'
    assert m_508['split_targets']['attha'][1]['code'] == 's0508a2.att'

    # Suite 10: Jataka 1 & 2 (s0513, s0514)
    m_513 = get_meta('s0513m.mul')
    assert len(m_513['split_targets']['attha']) == 4
    m_514 = get_meta('s0514m.mul')
    assert len(m_514['split_targets']['attha']) == 3

    # Suite 11: Parajika (vin01)
    m_vin01 = get_meta('vin01m.mul')
    assert m_vin01['attha_start_chapter'] == 1
    assert len(m_vin01['split_targets']['tika']) == 2

    # Suite 12: Precomputed Canonical MAT Tables Verification
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM mat_para_map;")
    total_mat_paras = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM mat_chapter_map;")
    total_mat_chaps = cur.fetchone()[0]

    assert total_mat_paras >= 70000, f"Expected >= 70000 mat_para_map rows, found {total_mat_paras}"
    assert total_mat_chaps >= 2000, f"Expected >= 2000 mat_chapter_map rows, found {total_mat_chaps}"

    # Verify vin01m.mul para 443 -> vin01t2.tik ch 2 para 443
    cur.execute("SELECT tika_book, tika_chapter, tika_para FROM mat_para_map WHERE source_book = 'vin01m.mul' AND source_para = '443'")
    r = cur.fetchone()
    assert r and r[0] == 'vin01t2.tik' and r[1] == 2 and r[2] == '443', f"vin01m.mul para 443 mapping failed: {r}"

    # Verify vin01m.mul para 1 -> vin01t1.tik ch 1 para 1
    cur.execute("SELECT tika_book, tika_chapter, tika_para FROM mat_para_map WHERE source_book = 'vin01m.mul' AND source_para = '1'")
    r = cur.fetchone()
    assert r and r[0] == 'vin01t1.tik' and r[1] == 1 and r[2] == '1', f"vin01m.mul para 1 mapping failed: {r}"

    # Verify s0402m2.mul para 2 -> s0402a.att ch 19 para 2
    cur.execute("SELECT attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 's0402m2.mul' AND source_para = '2'")
    r = cur.fetchone()
    assert r and r[0] == 's0402a.att' and r[1] == 19 and r[2] == '2', f"s0402m2.mul para 2 mapping failed: {r}"

    # Verify s0508m.mul para 443 -> s0508a2.att ch 2 para 443
    cur.execute("SELECT attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 's0508m.mul' AND source_para = '443'")
    r = cur.fetchone()
    assert r and r[0] == 's0508a2.att' and r[1] == 2 and r[2] == '443', f"s0508m.mul para 443 mapping failed: {r}"

    # Verify vin02m2.mul para 184 -> vin02t.tik ch 11 para 184, vin02a2.att ch 2 para 184
    cur.execute("SELECT tika_book, tika_chapter, tika_para, attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 'vin02m2.mul' AND source_para = '184'")
    r = cur.fetchone()
    assert r and r[0] == 'vin02t.tik' and r[1] == 11 and r[2] == '184' and r[3] == 'vin02a2.att' and r[4] == 2 and r[5] == '184', f"vin02m2.mul para 184 mapping failed: {r}"

    # Verify reverse jump: vin02t.tik ch 11 para 184 -> vin02m2.mul ch 2 para 184, vin02a2.att ch 2 para 184
    cur.execute("SELECT mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 'vin02t.tik' AND source_chapter = 11 AND source_para = '184'")
    r = cur.fetchone()
    assert r and r[0] == 'vin02m2.mul' and r[1] == 2 and r[2] == '184' and r[3] == 'vin02a2.att' and r[4] == 2 and r[5] == '184', f"vin02t.tik para 184 mapping failed: {r}"

    # Verify chapter-scoped disambiguation: vin02t.tik ch 13 (Mahavagga) para 243 -> vin02m2.mul ch 4 para 243
    cur.execute("SELECT mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 'vin02t.tik' AND source_chapter = 13 AND source_para = '243'")
    r = cur.fetchone()
    assert r and r[0] == 'vin02m2.mul' and r[1] == 4 and r[2] == '243' and r[3] == 'vin02a2.att' and r[4] == 4 and r[5] == '243', f"vin02t.tik ch 13 para 243 mapping failed: {r}"

    # Verify chapter-scoped disambiguation: vin02t.tik ch 0 (Pacittiya) para 243 -> vin02m1.mul ch 0 para 243
    cur.execute("SELECT mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 'vin02t.tik' AND source_chapter = 0 AND source_para = '243'")
    r = cur.fetchone()
    assert r and r[0] == 'vin02m1.mul' and r[1] == 0 and r[2] == '243' and r[3] == 'vin02a1.att' and r[4] == 0 and r[5] == '243', f"vin02t.tik ch 0 para 243 mapping failed: {r}"

    # Verify Anguttara Nikaya Tikanipata para 9 (Khatasuttam): has Atthakatha ch 19 para 9, Tika ch 18 (Balavagga)
    cur.execute("SELECT attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para FROM mat_para_map WHERE source_book = 's0402m2.mul' AND source_chapter = 0 AND source_para = '9'")
    r = cur.fetchone()
    assert r and r[0] == 's0402a.att' and r[1] == 19 and r[2] == '9' and r[3] == 's0402t.tik' and r[4] == 18, f"s0402m2.mul para 9 mapping failed: {r}"

    # Verify Anguttara Nikaya Tikanipata para 2 (Lakkhanasuttam): has Tika ch 18 para 2
    cur.execute("SELECT tika_book, tika_chapter, tika_para FROM mat_para_map WHERE source_book = 's0402m2.mul' AND source_chapter = 0 AND source_para = '2'")
    r = cur.fetchone()
    assert r and r[0] == 's0402t.tik' and r[1] == 18 and r[2] == '2', f"s0402m2.mul para 2 mapping failed: {r}"

    # Verify Catukkanipata s0402m3.mul para 1 -> s0402t.tik ch 34 para 1
    cur.execute("SELECT tika_book, tika_chapter, tika_para FROM mat_para_map WHERE source_book = 's0402m3.mul' AND source_chapter = 0 AND source_para = '1'")
    r = cur.fetchone()
    assert r and r[0] == 's0402t.tik' and r[1] == 34 and r[2] == '1', f"s0402m3.mul para 1 mapping failed: {r}"

    # Verify s0402t.tik ch 32 (Acelakavagga, URL /33) reverse jumps to Mula ch 15 (URL /16) and Attha ch 34 (URL /35)
    cur.execute("SELECT mula_book, mula_chapter, attha_book, attha_chapter FROM mat_chapter_map WHERE source_book = 's0402t.tik' AND source_chapter = 32")
    r = cur.fetchone()
    assert r and r[0] == 's0402m2.mul' and r[1] == 15 and r[2] == 's0402a.att' and r[3] == 34, f"s0402t.tik ch 32 chapter mapping failed: {r}"

    # Verify s0402t.tik ch 32 para 157 reverse jumps to Mula ch 15 para 157 and Attha ch 34 para 157
    cur.execute("SELECT mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 's0402t.tik' AND source_chapter = 32 AND source_para = '157'")
    r = cur.fetchone()
    assert r and r[0] == 's0402m2.mul' and r[1] == 15 and r[2] == '157' and r[3] == 's0402a.att' and r[4] == 34 and r[5] == '157', f"s0402t.tik ch 32 para 157 mapping failed: {r}"

    # Suite 13: Buddhavaṃsa (s0511) & Cariyāpiṭaka (s0512) Chapter-Scoped MAT Verification
    # Verify s0511m.mul ch 2 (Dīpaṅkarabuddhavaṃso) para 1 -> s0511a.att ch 3 para 1
    cur.execute("SELECT attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 's0511m.mul' AND source_chapter = 2 AND source_para = '1'")
    r = cur.fetchone()
    assert r and r[0] == 's0511a.att' and r[1] == 3 and r[2] == '1', f"s0511m.mul ch 2 para 1 mapping failed: {r}"

    # Verify reverse jump: s0511a.att ch 3 para 1 -> s0511m.mul ch 2 para 1
    cur.execute("SELECT mula_book, mula_chapter, mula_para FROM mat_para_map WHERE source_book = 's0511a.att' AND source_chapter = 3 AND source_para = '1'")
    r = cur.fetchone()
    assert r and r[0] == 's0511m.mul' and r[1] == 2 and r[2] == '1', f"s0511a.att ch 3 para 1 mapping failed: {r}"

    # Verify s0511m.mul ch 26 (Gotamabuddhavaṃso) para 5 -> s0511a.att ch 27 para 5
    cur.execute("SELECT attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 's0511m.mul' AND source_chapter = 26 AND source_para = '5'")
    r = cur.fetchone()
    assert r and r[0] == 's0511a.att' and r[1] == 27 and r[2] == '5', f"s0511m.mul ch 26 para 5 mapping failed: {r}"

    # Verify s0512m.mul ch 1 para 1 -> s0512a.att ch 2 para 1
    cur.execute("SELECT attha_book, attha_chapter, attha_para FROM mat_para_map WHERE source_book = 's0512m.mul' AND source_chapter = 1 AND source_para = '1'")
    r = cur.fetchone()
    assert r and r[0] == 's0512a.att' and r[1] == 2 and r[2] == '1', f"s0512m.mul ch 1 para 1 mapping failed: {r}"

    log_step(f"  ✓ Multi-Volume MAT Navigation: 100% assertions PASSED across all collections ({total_mat_chaps} chapters, {total_mat_paras} paras verified).")


def verify_databases():
    log("STEP 6", "Verifying Database Integrity")

    if not os.path.exists(TIPITAKA_DB):
        log_warn(f"'{TIPITAKA_DB}' not found!")
        return False

    conn = sqlite3.connect(TIPITAKA_DB)
    cur = conn.cursor()

    cur.execute("SELECT count(*) FROM books;")
    b_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM chapters;")
    c_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM chapters WHERE html IS NOT NULL AND length(html) > 0;")
    c_html_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM book_toc;")
    toc_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM tree_nodes;")
    nodes_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM book_mat;")
    mat_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM mat_para_map;")
    mat_para_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM mat_chapter_map;")
    mat_chap_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM site_metadata WHERE key = 'tree_json';")
    tree_meta_count = cur.fetchone()[0]

    cur.execute("SELECT count(*) FROM books WHERE meta_json IS NOT NULL;")
    meta_json_count = cur.fetchone()[0]

    # Run multi-volume MAT navigation test suite
    verify_multi_volume_mat(conn)

    conn.close()

    assert b_count == 217, f"Expected 217 books, found {b_count}"
    assert c_count >= 2500, f"Expected >= 2500 chapters, found {c_count}"
    assert c_html_count == c_count, f"All chapters must contain HTML! (found {c_html_count}/{c_count})"
    assert toc_count >= 35000, f"Expected >= 35000 book_toc items, found {toc_count}"
    assert nodes_count >= 2500, f"Expected >= 2500 tree nodes, found {nodes_count}"
    assert mat_count == 217, f"Expected 217 book_mat rows, found {mat_count}"
    assert mat_para_count >= 70000, f"Expected >= 70000 mat_para_map entries, found {mat_para_count}"
    assert mat_chap_count >= 2000, f"Expected >= 2000 mat_chapter_map entries, found {mat_chap_count}"
    assert tree_meta_count == 1, "site_metadata must contain 'tree_json'"
    assert meta_json_count == 217, f"All books must contain valid meta_json"

    log_step(f"tipitaka.db PASSED: {b_count} books, {c_count} chapters (100% with HTML), {toc_count:,} TOC entries, {mat_count} MAT relations, {mat_para_count:,} para links.")

    if os.path.exists(FTS_DB):
        fconn = sqlite3.connect(FTS_DB)
        fcur = fconn.cursor()
        fcur.execute("SELECT count(*) FROM paragraphs_fts;")
        p_count = fcur.fetchone()[0]
        fconn.close()
        assert p_count > 500000, f"Expected >500000 paragraphs in FTS5, found {p_count}"
        log_step(f"fts_tipitaka.db PASSED: {p_count:,} paragraphs indexed in FTS5 index.")

    log("COMPLETE", "All databases successfully generated from '_latest_romn' and verified!")
    return True


# ===========================================================================
# CLI & Main Entrypoint
# ===========================================================================
def main():
    parser = argparse.ArgumentParser(
        description="Tipitaka Database Builder (2026) - Reproduce tipitaka.db & fts_tipitaka.db from Devanagari master (_latest_romn)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--all', action='store_true', help="Run all pipeline stages (default)")
    parser.add_argument('--clone-only', action='store_true', help="Clone upstream repository only")
    parser.add_argument('--translit-only', action='store_true', help="Convert Devanagari to _latest_romn and compare only")
    parser.add_argument('--db-only', action='store_true', help="Build tipitaka.db only")
    parser.add_argument('--fts-only', action='store_true', help="Build fts_tipitaka.db only")
    parser.add_argument('--xml-only', action='store_true', help="Build books_xml.db only")
    parser.add_argument('--verify-only', action='store_true', help="Verify output databases only")
    parser.add_argument('--compare-romn', action='store_true', help="Compare _latest_romn with repository romn")
    parser.add_argument('--force-translit', action='store_true', help="Force re-transliteration from Devanagari to _latest_romn")

    args = parser.parse_args()

    explicit_flag = (args.clone_only or args.translit_only or args.db_only or
                     args.fts_only or args.xml_only or args.verify_only or args.compare_romn)

    t0 = time.time()

    if not explicit_flag or args.clone_only:
        ensure_upstream_repo()

    if not explicit_flag or args.translit_only:
        convert_and_verify_romn(force=args.force_translit)
    elif args.compare_romn:
        compare_latest_with_old_romn()

    if not explicit_flag or args.db_only:
        build_tipitaka_database(TIPITAKA_DB)

    if not explicit_flag or args.fts_only:
        build_fts_database(FTS_DB)

    if args.xml_only:
        build_books_xml_database(BOOKS_XML_DB)

    if not explicit_flag or args.verify_only or args.db_only:
        verify_databases()

    elapsed = time.time() - t0
    print(f"\n✨ Total Pipeline Execution Time: {elapsed:.2f} seconds.\n")


if __name__ == '__main__':
    main()
