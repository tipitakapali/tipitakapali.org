#!/usr/bin/env python3
"""Build and manage Tipiṭaka Pāḷi sentence storage (`pali_sentences.db` and
embedded `chapter_text_pack` inside `tipitaka.db`).

Primary source:
  epitaka_app/assets/db/epitaka.db :: sentences(book_id, para_id, line_id, pali)
  — the same segmentation pass that produced every translation_*.db line, so
  Pāḷi line_ids align with translation line_ids (~99.71% exact para match).

Fallback source (`--from-html` or when epitaka.db is unavailable):
  tipitaka.db :: chapters(html / html_z) <p data-pindex="..."> elements,
  preserving <b>...</b> bold definitions and balanced sentence boundaries.

Mapping:
  epitaka book_id -> VRI book_code via books.vri_id
  epitaka para_id (1-based) -> para_index (0-based, handling 7 shifted books)
  chapter_index via tipitaka.db canon_paragraphs lookup.

Usage:
  python3 build_pali_sentences_db.py [--epitaka-db PATH] [--embed] [--verify]
  python3 build_pali_sentences_db.py --from-html [--embed] [--verify]
"""
from __future__ import annotations

import argparse
import html as html_mod
import os
import re
import sqlite3
import sys
import time
import zlib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_APP_DIR = os.path.dirname(BASE_DIR)
WORKSPACE_ROOT = os.path.dirname(WEB_APP_DIR)

EPITAKA_CANDIDATES = [
    os.path.join(WORKSPACE_ROOT, 'epitaka_app', 'assets', 'db', 'epitaka.db'),
    os.path.join(WEB_APP_DIR, 'ref', 'epitaka_app', 'assets', 'db', 'epitaka.db'),
    '/home/administrator/freebuff_run/data/epitaka.db',
]
TIPI_DB = os.path.join(BASE_DIR, 'db', 'tipitaka.db')
OUT_DB = os.path.join(BASE_DIR, 'db', 'pali_sentences.db')

_P_TAG_RE = re.compile(r'<p\b([^>]*)>([\s\S]*?)</p>', re.IGNORECASE)
_PINDEX_RE = re.compile(r'\bdata-pindex="(\d+)"', re.IGNORECASE)
_CLS_RE = re.compile(r'\bclass="([^"]*)"', re.IGNORECASE)
_PB_RE = re.compile(r'<span\b[^>]*\bclass=["\']?pb["\']?[^>]*>[\s\S]*?</span>', re.IGNORECASE)
_PARANUM_RE = re.compile(
    r'<strong\b[^>]*\bclass=["\']?paranum["\']?[^>]*>[\s\S]*?</strong>'
    r'(?:\s*<span\b[^>]*\bclass=["\']?dot["\']?[^>]*>[\s\S]*?</span>)?\s*\.?\s*',
    re.IGNORECASE,
)
_BLD_RE = re.compile(r'<strong\b[^>]*\bclass=["\']?bld["\']?[^>]*>([\s\S]*?)</strong>', re.IGNORECASE)
_ANY_OTHER_TAG_RE = re.compile(r'<(?!/?b\b)[^>]+>', re.IGNORECASE)


def resolve_epitaka_db(explicit_path: str | None = None) -> str | None:
    if explicit_path:
        return explicit_path if os.path.exists(explicit_path) else None
    for cand in EPITAKA_CANDIDATES:
        if os.path.exists(cand):
            return cand
    return None


def get_para_index(book_id: str, para_id: int) -> int | None:
    b = (book_id or '').strip()
    if b == 'Ps-i':
        return (para_id - 1) if para_id < 6 else (para_id - 2)
    elif b in ('Sv-i', 'Spk-i', 'Spk-t-i'):
        return (para_id - 1) if para_id < 5 else (para_id - 2)
    elif b == 'Ps-t-i':
        return (para_id - 1) if para_id < 6 else (para_id - 2)
    elif b == 'Sp-iii':
        if para_id < 113:
            return para_id - 1
        elif para_id == 113:
            return None
        else:
            return para_id - 2
    elif b == 'Sas':
        return (para_id - 1) if para_id < 3 else (para_id - 2)
    return para_id - 1


def normalize_pali_sentence(text: str) -> str:
    s = (text or '').strip()
    if not s:
        return ''
    s = _BLD_RE.sub(lambda m: f"<b>{re.sub(r'<[^>]+>', '', m.group(1))}</b>", s)
    s = re.sub(r'\*\*([^*\n]+)\*\*', r'<b>\1</b>', s)
    s = _ANY_OTHER_TAG_RE.sub('', s)
    s = s.replace('ṁ', 'ṃ').replace('Ṁ', 'Ṃ')
    s = re.sub(r'[\u200B-\u200D\uFEFF\u00A0]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def _clean_html_para_with_b(inner_html: str) -> str:
    s = _PB_RE.sub(' ', inner_html or '')
    s = _PARANUM_RE.sub(' ', s)
    s = _BLD_RE.sub(lambda m: f"<b>{re.sub(r'<[^>]+>', '', m.group(1))}</b>", s)
    s = re.sub(r'<br\s*/?>', ' ', s, flags=re.IGNORECASE)
    s = _ANY_OTHER_TAG_RE.sub('', s)
    s = html_mod.unescape(s)
    s = s.replace('ṁ', 'ṃ').replace('Ṁ', 'Ṃ')
    s = re.sub(r'[\u200B-\u200D\uFEFF\u00A0]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def split_html_sentences(html_str: str) -> list[str]:
    """Balanced sentence splitter preserving <b>...</b> and (...) citations."""
    if not html_str:
        return []
    out: list[str] = []
    paren_depth = 0
    in_bold = False
    start = 0
    n = len(html_str)
    i = 0
    while i < n:
        if html_str.startswith('<b>', i):
            in_bold = True
            i += 3
            continue
        if html_str.startswith('</b>', i):
            in_bold = False
            i += 4
            continue
        ch = html_str[i]
        if ch in ('(', '['):
            paren_depth += 1
        elif ch in (')', ']') and paren_depth > 0:
            paren_depth -= 1
        elif not in_bold and paren_depth == 0 and ch in ('.', '?', '!', '।'):
            j = i + 1
            while j < n and html_str[j] in "’”\"')":
                j += 1
            if j == n or html_str[j] == ' ':
                seg = html_str[start:j].strip()
                if seg:
                    out.append(seg)
                start = j
                while start < n and html_str[start] == ' ':
                    start += 1
                i = start
                continue
        i += 1
    if start < n:
        tail = html_str[start:].strip()
        if tail:
            out.append(tail)
    return out


def build_from_epitaka(epi_path: str, tipi_path: str, out_path: str) -> dict:
    tipi = sqlite3.connect(f'file:{tipi_path}?mode=ro', uri=True)
    canon = {}
    book_max_chap = {}
    for bcode, pidx, cidx in tipi.execute(
        'SELECT book_code, para_index, chapter_index FROM canon_paragraphs'
    ):
        canon[(bcode, pidx)] = cidx
        if cidx is not None:
            book_max_chap[bcode] = max(book_max_chap.get(bcode, 0), cidx)
    tipi.close()
    print(f'[pali_sent] canon lookup: {len(canon):,} paras')

    epi = sqlite3.connect(f'file:{epi_path}?mode=ro', uri=True)
    book_map = dict(
        epi.execute(
            "SELECT book_id, vri_id FROM books WHERE vri_id IS NOT NULL AND vri_id != ''"
        ).fetchall()
    )
    print(f'[pali_sent] book mappings: {len(book_map)} (source: {epi_path})')

    tmp = out_path + '.tmp'
    for ext in ('', '-wal', '-shm'):
        if os.path.exists(tmp + ext):
            os.remove(tmp + ext)

    out = sqlite3.connect(tmp)
    out.execute('PRAGMA synchronous = OFF')
    out.execute('PRAGMA journal_mode = MEMORY')
    out.execute('PRAGMA cache_size = -65536')
    out.execute('''
    CREATE TABLE pali_sentences (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        line_id INTEGER NOT NULL,
        sentence TEXT NOT NULL,
        PRIMARY KEY (book_code, chapter_index, para_index, line_id)
    )
    ''')

    batch = []
    n_sent = 0
    n_paras = 0
    books = set()
    unmapped_books = set()
    last_key = None
    cur = epi.execute(
        'SELECT book_id, para_id, line_id, pali FROM sentences ORDER BY book_id, para_id, line_id'
    )
    for bid, pid, lid, pali in cur:
        text = normalize_pali_sentence(pali)
        if not text:
            continue
        bcode = book_map.get(bid)
        if not bcode:
            unmapped_books.add(bid)
            continue
        pidx = get_para_index(bid, pid)
        if pidx is None or pidx < 0:
            continue
        cidx = canon.get((bcode, pidx))
        if cidx is None:
            cidx = book_max_chap.get(bcode, 0)
        key = (bcode, cidx, pidx)
        if key != last_key:
            n_paras += 1
            last_key = key
        books.add(bcode)
        batch.append((bcode, cidx, pidx, lid, text))
        n_sent += 1
        if len(batch) >= 20000:
            out.executemany('INSERT OR REPLACE INTO pali_sentences VALUES (?,?,?,?,?)', batch)
            out.commit()
            batch.clear()
    if batch:
        out.executemany('INSERT OR REPLACE INTO pali_sentences VALUES (?,?,?,?,?)', batch)
        out.commit()
    epi.close()

    out.execute('CREATE INDEX idx_ps_book_chap ON pali_sentences (book_code, chapter_index)')
    out.execute('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    out.executemany('INSERT OR REPLACE INTO meta VALUES (?, ?)', [
        ('source', 'epitaka.db sentences.pali'),
        ('built_at', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())),
        ('total_sentences', str(n_sent)),
        ('total_paragraphs', str(n_paras)),
        ('total_books', str(len(books))),
    ])
    out.commit()
    out.close()

    for ext in ('', '-wal', '-shm'):
        old = out_path + ext
        if os.path.exists(old):
            os.remove(old)
    os.rename(tmp, out_path)
    if unmapped_books:
        print(f'[pali_sent] unmapped epitaka book_ids skipped: {sorted(unmapped_books)[:10]}')
    return {'sentences': n_sent, 'paragraphs': n_paras, 'books': len(books)}


def build_from_tipitaka_html(tipi_path: str, out_path: str) -> dict:
    tipi = sqlite3.connect(f'file:{tipi_path}?mode=ro', uri=True)
    chap_cols = {r[1] for r in tipi.execute('PRAGMA table_info(chapters)')}
    has_html_z = 'html_z' in chap_cols
    sel = (
        'SELECT book_code, chapter_index, html, html_z FROM chapters ORDER BY book_code, chapter_index'
        if has_html_z
        else 'SELECT book_code, chapter_index, html, NULL FROM chapters ORDER BY book_code, chapter_index'
    )

    tmp = out_path + '.tmp'
    for ext in ('', '-wal', '-shm'):
        if os.path.exists(tmp + ext):
            os.remove(tmp + ext)

    out = sqlite3.connect(tmp)
    out.execute('PRAGMA synchronous = OFF')
    out.execute('PRAGMA journal_mode = MEMORY')
    out.execute('PRAGMA cache_size = -65536')
    out.execute('''
    CREATE TABLE pali_sentences (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        line_id INTEGER NOT NULL,
        sentence TEXT NOT NULL,
        PRIMARY KEY (book_code, chapter_index, para_index, line_id)
    )
    ''')

    batch = []
    n_sent = 0
    n_paras = 0
    books = set()
    for bcode, cidx, raw_html, html_z in tipi.execute(sel):
        html_str = (
            zlib.decompress(html_z).decode('utf-8')
            if has_html_z and html_z
            else (raw_html or '')
        )
        if not html_str:
            continue
        books.add(bcode)
        for pm in _P_TAG_RE.finditer(html_str):
            attrs, inner = pm.group(1) or '', pm.group(2) or ''
            pidx_m = _PINDEX_RE.search(attrs)
            if not pidx_m:
                continue
            pidx = int(pidx_m.group(1))
            cls_m = _CLS_RE.search(attrs)
            cls = cls_m.group(1) if cls_m else ''
            cleaned = _clean_html_para_with_b(inner)
            if not cleaned:
                continue
            is_prose = bool(re.search(r'\b(bodytext|indent|hangnum|unindented)\b', cls, re.I))
            sents = split_html_sentences(cleaned) if is_prose else [cleaned]
            if not sents:
                continue
            n_paras += 1
            for lid, sent in enumerate(sents, 1):
                batch.append((bcode, cidx, pidx, lid, sent))
                n_sent += 1
                if len(batch) >= 20000:
                    out.executemany('INSERT OR REPLACE INTO pali_sentences VALUES (?,?,?,?,?)', batch)
                    out.commit()
                    batch.clear()
    if batch:
        out.executemany('INSERT OR REPLACE INTO pali_sentences VALUES (?,?,?,?,?)', batch)
        out.commit()
    tipi.close()

    out.execute('CREATE INDEX idx_ps_book_chap ON pali_sentences (book_code, chapter_index)')
    out.execute('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    out.executemany('INSERT OR REPLACE INTO meta VALUES (?, ?)', [
        ('source', 'tipitaka.db chapters.html fallback'),
        ('built_at', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())),
        ('total_sentences', str(n_sent)),
        ('total_paragraphs', str(n_paras)),
        ('total_books', str(len(books))),
    ])
    out.commit()
    out.close()

    for ext in ('', '-wal', '-shm'):
        old = out_path + ext
        if os.path.exists(old):
            os.remove(old)
    os.rename(tmp, out_path)
    return {'sentences': n_sent, 'paragraphs': n_paras, 'books': len(books)}


def verify_sentence_alignment(tipi_path: str, ps_path: str | None = None) -> None:
    tipi = sqlite3.connect(f'file:{tipi_path}?mode=ro', uri=True)
    tables = {r[0] for r in tipi.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    pack_counts = {}
    if 'chapter_text_pack' in tables:
        import json
        id_to_code = dict(tipi.execute('SELECT id, code FROM books').fetchall())
        for bid, ci, dz in tipi.execute('SELECT book_id, chapter_index, data_z FROM chapter_text_pack'):
            bc = id_to_code.get(bid)
            if not bc:
                continue
            for item in json.loads(zlib.decompress(dz).decode('utf-8')):
                if len(item) >= 3 and item[2]:
                    pack_counts[(bc, ci, item[0])] = len(item[2])
    tipi.close()
    print(f'[verify] tipitaka.db chapter_text_pack paragraphs with sentences: {len(pack_counts):,}')

    if ps_path and os.path.exists(ps_path):
        ps = sqlite3.connect(f'file:{ps_path}?mode=ro', uri=True)
        ps_counts = dict(
            ((bc, ci, pi), cnt)
            for bc, ci, pi, cnt in ps.execute(
                'SELECT book_code, chapter_index, para_index, COUNT(*) '
                'FROM pali_sentences GROUP BY book_code, chapter_index, para_index'
            )
        )
        ps.close()
        print(f'[verify] pali_sentences.db paragraphs: {len(ps_counts):,}')
        if pack_counts:
            exact = sum(1 for k, v in ps_counts.items() if pack_counts.get(k) == v)
            print(f'[verify] pack vs pali_sentences.db parity: {exact:,}/{len(ps_counts):,}')

    en_path = os.path.join(os.path.dirname(tipi_path), 'translation_en.db')
    if os.path.exists(en_path) and pack_counts:
        ten = sqlite3.connect(f'file:{en_path}?mode=ro', uri=True)
        en_counts = dict(
            ((bc, ci, pi), cnt)
            for bc, ci, pi, cnt in ten.execute(
                'SELECT book_code, chapter_index, para_index, COUNT(*) '
                'FROM sentence_translations GROUP BY book_code, chapter_index, para_index'
            )
        )
        ten.close()
        matched = sum(1 for k, c in en_counts.items() if pack_counts.get(k) == c)
        pct = 100.0 * matched / max(1, len(en_counts))
        print(f'[verify] translation_en.db sentence alignment: {matched:,}/{len(en_counts):,} ({pct:.2f}%)')


def main():
    parser = argparse.ArgumentParser(description='Build and manage Pāḷi sentence database.')
    parser.add_argument('--epitaka-db', default=None, help='Path to epitaka.db')
    parser.add_argument('--tipitaka-db', default=TIPI_DB, help='Path to tipitaka.db')
    parser.add_argument('--output', default=OUT_DB, help='Output pali_sentences.db path')
    parser.add_argument('--from-html', action='store_true', help='Extract sentences from tipitaka.db chapters HTML instead of epitaka.db')
    parser.add_argument('--embed', action='store_true', help='Also embed sentences into tipitaka.db chapter_text_pack via optimize_tipitaka_db.py')
    parser.add_argument('--verify', action='store_true', help='Verify sentence alignment with tipitaka.db and translation_en.db')
    args = parser.parse_args()

    t0 = time.time()
    if not os.path.exists(args.tipitaka_db):
        sys.exit(f'missing tipitaka.db: {args.tipitaka_db}')

    if not args.verify or args.from_html or args.epitaka_db:
        epi_path = None if args.from_html else resolve_epitaka_db(args.epitaka_db)
        if epi_path:
            stats = build_from_epitaka(epi_path, args.tipitaka_db, args.output)
        elif args.from_html:
            stats = build_from_tipitaka_html(args.tipitaka_db, args.output)
        else:
            sys.exit(
                'epitaka.db not found in any default location; pass --epitaka-db PATH '
                'or --from-html to extract from tipitaka.db chapters.'
            )
        size_mb = os.path.getsize(args.output) / (1024 * 1024)
        print(
            f"[pali_sent] {stats['sentences']:,} sentences / {stats['paragraphs']:,} paras / "
            f"{stats['books']} books -> {args.output} ({size_mb:.1f} MB) in {time.time() - t0:.1f}s"
        )

    if args.embed:
        from optimize_tipitaka_db import optimize_database
        optimize_database(args.tipitaka_db, args.output, args.tipitaka_db, verify=True)

    if args.verify:
        verify_sentence_alignment(args.tipitaka_db, args.output)


if __name__ == '__main__':
    main()
