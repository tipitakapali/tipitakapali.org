#!/usr/bin/env python3
"""Build server_api/db/pali_sentences.db from epitaka's sentence segmentation.

Source: ref/epitaka_app/assets/db/epitaka.db :: sentences(book_id, para_id,
line_id, pali) — the same segmentation pass that produced every
epitaka_{lang}.db translation line, so Pāḷi line numbers align with
translation line_ids by construction (~99.7% per-para count match).

Mapping (mirrors convert_translation_db.py):
  epitaka book_id -> VRI book_code via books.vri_id
  epitaka para_id (1-based) -> para_index (0-based, para_id - 1)
  chapter_index via tipitaka.db canon_paragraphs lookup.

Output table: pali_sentences(book_code, chapter_index, para_index,
line_id, sentence). Serves the VPS /api/book/:code/pali_sentences endpoint
and the pali_sentences.json static export.
"""
import os
import sqlite3
import sys
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_APP_DIR = os.path.dirname(BASE_DIR)
REF_DB = os.path.join(WEB_APP_DIR, 'ref', 'epitaka_app', 'assets', 'db', 'epitaka.db')
TIPI_DB = os.path.join(BASE_DIR, 'db', 'tipitaka.db')
OUT_DB = os.path.join(BASE_DIR, 'db', 'pali_sentences.db')


def main():
    t0 = time.time()
    for label, path in [('epitaka.db', REF_DB), ('tipitaka.db', TIPI_DB)]:
        if not os.path.exists(path):
            sys.exit(f'missing {label}: {path}')

    # Canon lookup: (book_code, para_index) -> chapter_index.
    tipi = sqlite3.connect(f'file:{TIPI_DB}?mode=ro', uri=True)
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

    epi = sqlite3.connect(f'file:{REF_DB}?mode=ro', uri=True)
    book_map = dict(
        epi.execute(
            "SELECT book_id, vri_id FROM books WHERE vri_id IS NOT NULL AND vri_id != ''"
        ).fetchall()
    )
    print(f'[pali_sent] book mappings: {len(book_map)}')

    tmp = OUT_DB + '.tmp'
    if os.path.exists(tmp):
        os.remove(tmp)
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
        text = (pali or '').strip()
        if not text:
            continue
        bcode = book_map.get(bid)
        if not bcode:
            unmapped_books.add(bid)
            continue
        pidx = pid - 1
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

    for ext in ['', '-wal', '-shm']:
        old = OUT_DB + ext
        if os.path.exists(old):
            os.remove(old)
    os.rename(tmp, OUT_DB)
    size_mb = os.path.getsize(OUT_DB) / (1024 * 1024)
    print(f'[pali_sent] {n_sent:,} sentences / {n_paras:,} paras / {len(books)} books -> {OUT_DB} ({size_mb:.1f} MB) in {time.time() - t0:.1f}s')
    if unmapped_books:
        print(f'[pali_sent] unmapped epitaka book_ids skipped: {sorted(unmapped_books)[:10]}')


if __name__ == '__main__':
    main()
