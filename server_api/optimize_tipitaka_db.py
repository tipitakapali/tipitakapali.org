#!/usr/bin/env python3
"""
optimize_tipitaka_db.py
=======================
Produces a size-optimized, 100%-lossless single `tipitaka.db` that bundles BOTH:
  - Paragraph-level data (`chapters.html_z`, `books.meta_z`, normalized `canon_paragraphs`)
  - Sentence-level Pāḷi segmentations (`pali_sentences.db` -> `chapter_text_pack`)

Optimizations applied:
  1. `books.meta_json` (38 MB) -> `books.meta_z` zlib-9 BLOB (~4.6 MB).
  2. `chapters.html` (201 MB) -> `chapters.html_z` zlib-9 BLOB (~42.4 MB).
  3. Interleaved `pali_text` + `pali_sentences` per chapter inside
     `chapter_text_pack(book_id, chapter_index, data_z) WITHOUT ROWID` (~40.4 MB,
     omitting redundant `pali_text` when equal to `' '.join(sentences)`).
  4. Normalized `canon_paragraphs_raw` using integer dictionary tables
     (`cp_titles`, `cp_small`), `books.id` FKs, `global_id` FKs for `*_guid`,
     dropping duplicate `idx_canon_guid` index, and exposing `canon_paragraphs`
     via an indexed SQLite `VIEW`.
  5. `PRAGMA page_size = 4096` + `ANALYZE` + `VACUUM` (~173 MB total on disk,
     down from ~778 MB combined `tipitaka.db` + `pali_sentences.db`).

Usage:
  python3 optimize_tipitaka_db.py [--input tipitaka.db] [--sentences pali_sentences.db] [--output tipitaka.db]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import time
import zlib

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TIPI = os.path.join(BASE_DIR, 'db', 'tipitaka.db')
DEFAULT_SENT = os.path.join(BASE_DIR, 'db', 'pali_sentences.db')


def decode_pack_rows(data_z: bytes):
    rows = json.loads(zlib.decompress(data_z).decode('utf-8'))
    pali_map = {}
    sent_map = {}
    for item in rows:
        pi = item[0]
        raw_pt = item[1]
        sents = item[2] if len(item) >= 3 else None
        if sents is not None:
            sent_map[pi] = sents
            pali_map[pi] = raw_pt if raw_pt is not None else ' '.join(s[1] for s in sents)
        elif raw_pt is not None:
            pali_map[pi] = raw_pt
    return pali_map, sent_map


def optimize_database(src_path: str, ps_path: str | None, out_path: str, verify: bool = True):
    t0 = time.time()
    if not os.path.exists(src_path):
        sys.exit(f'ERROR: source tipitaka.db not found at {src_path}')

    has_ps = bool(ps_path and os.path.exists(ps_path))
    print(f'[opt] Source tipitaka.db: {src_path} ({os.path.getsize(src_path)/1024/1024:.2f} MB)')
    if has_ps:
        print(f'[opt] Merging pali_sentences.db: {ps_path} ({os.path.getsize(ps_path)/1024/1024:.2f} MB)')
    else:
        print('[opt] No separate pali_sentences.db provided/found; checking embedded sentences.')

    src = sqlite3.connect(f'file:{src_path}?mode=ro', uri=True)
    ps = sqlite3.connect(f'file:{ps_path}?mode=ro', uri=True) if has_ps else None

    tmp_path = out_path + '.opt_tmp'
    for ext in ('', '-wal', '-shm'):
        if os.path.exists(tmp_path + ext):
            os.remove(tmp_path + ext)

    dst = sqlite3.connect(tmp_path)
    dst.execute('PRAGMA page_size = 4096')
    dst.execute('PRAGMA journal_mode = OFF')
    dst.execute('PRAGMA synchronous = OFF')
    dst.execute('PRAGMA temp_store = MEMORY')

    try:
        # 1. site_metadata
        dst.execute('CREATE TABLE site_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        dst.executemany('INSERT INTO site_metadata VALUES (?, ?)', src.execute('SELECT key, value FROM site_metadata'))
        dst.execute("INSERT OR REPLACE INTO site_metadata VALUES ('schema_opt_version', '2')")

        # 2. books (meta_z BLOB, meta_json NULL)
        dst.execute('''
            CREATE TABLE books (
                id INTEGER PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                nikaya TEXT,
                category TEXT,
                xml_filename TEXT,
                chapter_count INTEGER,
                meta_json TEXT,
                meta_z BLOB
            )
        ''')
        src_book_cols = {r[1] for r in src.execute('PRAGMA table_info(books)')}
        has_src_meta_z = 'meta_z' in src_book_cols
        book_sel = (
            'SELECT id, code, title, nikaya, category, xml_filename, chapter_count, meta_json, meta_z FROM books ORDER BY id'
            if has_src_meta_z
            else 'SELECT id, code, title, nikaya, category, xml_filename, chapter_count, meta_json FROM books ORDER BY id'
        )
        book_id_map = {}
        id_to_book = {}
        for r in src.execute(book_sel):
            id_, code = r[0], r[1]
            book_id_map[code] = id_
            id_to_book[id_] = code
            mj = r[7]
            if mj is None and has_src_meta_z and r[8] is not None:
                mz = r[8]
            elif mj:
                mz = zlib.compress(mj.encode('utf-8'), 9)
            else:
                mz = None
            dst.execute('INSERT INTO books VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', (*r[:7], None, mz))
        dst.execute('CREATE INDEX idx_books_code ON books(code)')

        # 3. chapters (html_z BLOB, html NULL)
        dst.execute('''
            CREATE TABLE chapters (
                id INTEGER PRIMARY KEY,
                book_id INTEGER NOT NULL,
                book_code TEXT NOT NULL,
                chapter_index INTEGER NOT NULL,
                title TEXT,
                chunk_name TEXT,
                anchor_id TEXT,
                para_index INTEGER,
                html TEXT,
                html_z BLOB
            )
        ''')
        src_chap_cols = {r[1] for r in src.execute('PRAGMA table_info(chapters)')}
        has_src_html_z = 'html_z' in src_chap_cols
        chap_sel = (
            'SELECT id, book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index, html, html_z FROM chapters ORDER BY id'
            if has_src_html_z
            else 'SELECT id, book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index, html FROM chapters ORDER BY id'
        )
        for r in src.execute(chap_sel):
            h = r[8]
            if h is None and has_src_html_z and r[9] is not None:
                hz = r[9]
            else:
                hz = zlib.compress((h or '').encode('utf-8'), 9)
            dst.execute('INSERT INTO chapters VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', (*r[:8], None, hz))
        dst.execute('CREATE INDEX idx_chapters_book ON chapters(book_code)')
        dst.execute('CREATE INDEX idx_chapters_book_idx ON chapters(book_code, chapter_index)')
        dst.execute('CREATE INDEX idx_chapters_chunk ON chapters(chunk_name)')

        # 4. Copy small structural tables & indexes verbatim
        for tbl in ('tree_nodes', 'book_mat', 'mat_para_map', 'mat_chapter_map', 'book_toc'):
            tbl_row = src.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (tbl,)).fetchone()
            if not tbl_row:
                continue
            dst.execute(tbl_row[0])
            cols = [r[1] for r in src.execute(f'PRAGMA table_info({tbl})')]
            ph = ','.join(['?'] * len(cols))
            rows = src.execute(f'SELECT * FROM {tbl}').fetchall()
            if rows:
                dst.executemany(f'INSERT INTO {tbl} VALUES ({ph})', rows)
        for (idx_sql,) in src.execute(
            "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL "
            "AND tbl_name IN ('tree_nodes','book_mat','mat_para_map','mat_chapter_map','book_toc')"
        ):
            dst.execute(idx_sql)

        # 5. Build chapter_text_pack (pali_text + pali_sentences interleaved per chapter)
        ps_by_bc = {}
        if ps is not None:
            for bc, ci, pi, li, s in ps.execute(
                'SELECT book_code, chapter_index, para_index, line_id, sentence '
                'FROM pali_sentences ORDER BY book_code, chapter_index, para_index, line_id'
            ):
                ps_by_bc.setdefault((bc, ci), {}).setdefault(pi, []).append([li, s])
        else:
            src_tables = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
            if 'chapter_text_pack' in src_tables:
                for bid, ci, dz in src.execute('SELECT book_id, chapter_index, data_z FROM chapter_text_pack'):
                    bc = id_to_book.get(bid)
                    if bc:
                        _, s_map = decode_pack_rows(dz)
                        if s_map:
                            ps_by_bc[(bc, ci)] = s_map
            elif 'pali_sentences' in src_tables:
                for bc, ci, pi, li, s in src.execute(
                    'SELECT book_code, chapter_index, para_index, line_id, sentence '
                    'FROM pali_sentences ORDER BY book_code, chapter_index, para_index, line_id'
                ):
                    ps_by_bc.setdefault((bc, ci), {}).setdefault(pi, []).append([li, s])

        if ps_by_bc:
            dst.execute("INSERT OR REPLACE INTO site_metadata VALUES ('has_pali_sentences', '1')")

        cp_by_bc = {}
        src_tables = {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
        if 'chapter_text_pack' in src_tables:
            for bid, ci, dz in src.execute('SELECT book_id, chapter_index, data_z FROM chapter_text_pack'):
                bc = id_to_book.get(bid)
                if bc:
                    p_map, _ = decode_pack_rows(dz)
                    if p_map:
                        cp_by_bc[(bc, ci)] = p_map
        for bc, ci, pi, pt in src.execute(
            'SELECT book_code, chapter_index, para_index, pali_text FROM canon_paragraphs ORDER BY book_code, chapter_index, para_index'
        ):
            if pt is not None:
                cp_by_bc.setdefault((bc, ci), {})[pi] = pt

        dst.execute('''
            CREATE TABLE chapter_text_pack (
                book_id INTEGER NOT NULL,
                chapter_index INTEGER NOT NULL,
                data_z BLOB NOT NULL,
                PRIMARY KEY (book_id, chapter_index)
            ) WITHOUT ROWID
        ''')

        all_keys = sorted(set(cp_by_bc.keys()) | set(ps_by_bc.keys()))
        pack_batch = []
        for bc, ci in all_keys:
            bid = book_id_map.get(bc)
            if bid is None:
                continue
            p_map = cp_by_bc.get((bc, ci), {})
            s_map = ps_by_bc.get((bc, ci), {})
            rows_out = []
            for pi in sorted(set(p_map.keys()) | set(s_map.keys())):
                pt = p_map.get(pi)
                sl = s_map.get(pi)
                if sl is not None:
                    if pt is not None and ' '.join(x[1] for x in sl) == pt:
                        rows_out.append([pi, None, sl])
                    else:
                        rows_out.append([pi, pt, sl])
                else:
                    rows_out.append([pi, pt])
            dz = zlib.compress(json.dumps(rows_out, ensure_ascii=False, separators=(',', ':')).encode('utf-8'), 9)
            pack_batch.append((bid, ci, dz))
        dst.executemany('INSERT INTO chapter_text_pack VALUES (?, ?, ?)', pack_batch)
        del pack_batch

        # 6. Normalized canon_paragraphs_raw + lookup tables + VIEW canon_paragraphs
        dst.execute('CREATE TABLE cp_titles (id INTEGER PRIMARY KEY, val TEXT UNIQUE NOT NULL)')
        dst.execute('CREATE TABLE cp_small (id INTEGER PRIMARY KEY, val TEXT UNIQUE NOT NULL)')
        title_ids = {}
        small_ids = {}

        def tid(v):
            if v is None:
                return None
            i = title_ids.get(v)
            if i is None:
                i = len(title_ids) + 1
                title_ids[v] = i
            return i

        def sid(v):
            if v is None:
                return None
            i = small_ids.get(v)
            if i is None:
                i = len(small_ids) + 1
                small_ids[v] = i
            return i

        guid_to_gid = {}
        for gid, g in src.execute('SELECT global_id, guid FROM canon_paragraphs'):
            guid_to_gid[g] = gid

        dst.execute('''
            CREATE TABLE canon_paragraphs_raw (
                global_id INTEGER PRIMARY KEY,
                book_id INTEGER NOT NULL,
                sub_book_id INTEGER,
                chapter_index INTEGER NOT NULL,
                chapter_title_id INTEGER,
                sutta_title_id INTEGER,
                para_index INTEGER NOT NULL,
                para_num TEXT,
                para_first INTEGER,
                para_last INTEGER,
                rend_id INTEGER,
                word_count INTEGER,
                mula_gid INTEGER,
                mula_book_id INTEGER,
                mula_chapter INTEGER,
                mula_para TEXT,
                attha_gid INTEGER,
                attha_book_id INTEGER,
                attha_chapter INTEGER,
                attha_para TEXT,
                tika_gid INTEGER,
                tika_book_id INTEGER,
                tika_chapter INTEGER,
                tika_para TEXT,
                match_quality_id INTEGER
            )
        ''')

        cp_batch = []
        for r in src.execute('''
            SELECT global_id, book_code, sub_book, chapter_index, chapter_title, sutta_title,
                   para_index, para_num, para_first, para_last, rend, word_count,
                   mula_guid, mula_book, mula_chapter, mula_para,
                   attha_guid, attha_book, attha_chapter, attha_para,
                   tika_guid, tika_book, tika_chapter, tika_para, match_quality
            FROM canon_paragraphs ORDER BY global_id
        '''):
            cp_batch.append((
                r[0],
                book_id_map[r[1]],
                sid(r[2]),
                r[3],
                tid(r[4]),
                tid(r[5]),
                r[6], r[7], r[8], r[9],
                sid(r[10]),
                r[11],
                guid_to_gid.get(r[12]) if r[12] else None,
                book_id_map.get(r[13]) if r[13] else None,
                r[14], r[15],
                guid_to_gid.get(r[16]) if r[16] else None,
                book_id_map.get(r[17]) if r[17] else None,
                r[18], r[19],
                guid_to_gid.get(r[20]) if r[20] else None,
                book_id_map.get(r[21]) if r[21] else None,
                r[22], r[23],
                sid(r[24]),
            ))
            if len(cp_batch) >= 50000:
                dst.executemany('INSERT INTO canon_paragraphs_raw VALUES (' + ','.join(['?'] * 25) + ')', cp_batch)
                cp_batch.clear()
        if cp_batch:
            dst.executemany('INSERT INTO canon_paragraphs_raw VALUES (' + ','.join(['?'] * 25) + ')', cp_batch)

        dst.executemany('INSERT INTO cp_titles VALUES (?, ?)', ((v, k) for k, v in title_ids.items()))
        dst.executemany('INSERT INTO cp_small VALUES (?, ?)', ((v, k) for k, v in small_ids.items()))

        dst.execute('CREATE INDEX idx_cpr_book_chap ON canon_paragraphs_raw(book_id, chapter_index, para_index)')
        dst.execute('CREATE INDEX idx_cpr_book_para ON canon_paragraphs_raw(book_id, para_num)')
        dst.execute('CREATE INDEX idx_cpr_book_pindex ON canon_paragraphs_raw(book_id, para_index)')
        dst.execute('CREATE INDEX idx_cpr_sub_book ON canon_paragraphs_raw(book_id, sub_book_id) WHERE sub_book_id IS NOT NULL')

        dst.execute('''
            CREATE VIEW canon_paragraphs AS
            SELECT
                cp.global_id,
                (b.code || ':c' || cp.chapter_index || ':n' || COALESCE(cp.para_num, '0') || ':p' || cp.para_index) AS guid,
                b.code AS book_code,
                sb.val AS sub_book,
                cp.chapter_index,
                ct.val AS chapter_title,
                st.val AS sutta_title,
                cp.para_index,
                cp.para_num,
                cp.para_first,
                cp.para_last,
                rn.val AS rend,
                NULL AS pali_text,
                cp.word_count,
                CASE WHEN cp.mula_gid IS NOT NULL THEN (
                    SELECT bm2.code || ':c' || pm.chapter_index || ':n' || COALESCE(pm.para_num, '0') || ':p' || pm.para_index
                    FROM canon_paragraphs_raw pm JOIN books bm2 ON bm2.id = pm.book_id WHERE pm.global_id = cp.mula_gid
                ) ELSE NULL END AS mula_guid,
                bm.code AS mula_book,
                cp.mula_chapter,
                cp.mula_para,
                CASE WHEN cp.attha_gid IS NOT NULL THEN (
                    SELECT ba2.code || ':c' || pa.chapter_index || ':n' || COALESCE(pa.para_num, '0') || ':p' || pa.para_index
                    FROM canon_paragraphs_raw pa JOIN books ba2 ON ba2.id = pa.book_id WHERE pa.global_id = cp.attha_gid
                ) ELSE NULL END AS attha_guid,
                ba.code AS attha_book,
                cp.attha_chapter,
                cp.attha_para,
                CASE WHEN cp.tika_gid IS NOT NULL THEN (
                    SELECT bt2.code || ':c' || pt.chapter_index || ':n' || COALESCE(pt.para_num, '0') || ':p' || pt.para_index
                    FROM canon_paragraphs_raw pt JOIN books bt2 ON bt2.id = pt.book_id WHERE pt.global_id = cp.tika_gid
                ) ELSE NULL END AS tika_guid,
                bt.code AS tika_book,
                cp.tika_chapter,
                cp.tika_para,
                mq.val AS match_quality
            FROM canon_paragraphs_raw cp
            JOIN books b ON b.id = cp.book_id
            LEFT JOIN cp_small sb ON sb.id = cp.sub_book_id
            LEFT JOIN cp_titles ct ON ct.id = cp.chapter_title_id
            LEFT JOIN cp_titles st ON st.id = cp.sutta_title_id
            LEFT JOIN cp_small rn ON rn.id = cp.rend_id
            LEFT JOIN books bm ON bm.id = cp.mula_book_id
            LEFT JOIN books ba ON ba.id = cp.attha_book_id
            LEFT JOIN books bt ON bt.id = cp.tika_book_id
            LEFT JOIN cp_small mq ON mq.id = cp.match_quality_id
        ''')

        dst.execute('ANALYZE')
        dst.commit()
        dst.execute('VACUUM')

        if verify:
            print('[opt] Verifying 100% lossless round-trip integrity...')
            for tbl in ('books', 'chapters', 'canon_paragraphs'):
                sc = src.execute(f'SELECT COUNT(*) FROM {tbl}').fetchone()[0]
                dc = dst.execute(f'SELECT COUNT(*) FROM {tbl}').fetchone()[0]
                assert sc == dc, f'Count mismatch on {tbl}: {sc} vs {dc}'

            # Check every compressed chapter HTML matches bit-for-bit
            if not has_src_html_z:
                for (bc, ci, h_src), (hz_dst,) in zip(
                    src.execute('SELECT book_code, chapter_index, html FROM chapters ORDER BY id'),
                    dst.execute('SELECT html_z FROM chapters ORDER BY id'),
                ):
                    assert (h_src or '') == zlib.decompress(hz_dst).decode('utf-8'), f'HTML mismatch {bc}:{ci}'

            # Check every chapter_text_pack matches source pali_text and pali_sentences bit-for-bit
            pack_count = 0
            sent_count = 0
            for bid, ci, dz in dst.execute('SELECT book_id, chapter_index, data_z FROM chapter_text_pack'):
                bc = id_to_book[bid]
                p_dec, s_dec = decode_pack_rows(dz)
                pack_count += len(p_dec)
                sent_count += sum(len(v) for v in s_dec.values())
                exp_p = cp_by_bc.get((bc, ci), {})
                exp_s = ps_by_bc.get((bc, ci), {})
                assert p_dec == exp_p, f'pali_text mismatch in {bc} ch {ci}'
                assert s_dec == exp_s, f'pali_sentences mismatch in {bc} ch {ci}'
            exp_sent_total = sum(sum(len(v) for v in m.values()) for m in ps_by_bc.values())
            assert sent_count == exp_sent_total, f'Sentence count mismatch: {sent_count} vs {exp_sent_total}'

            # Verify canon_paragraphs view metadata across spread sample rows
            sample_src = src.execute('''
                SELECT global_id, guid, book_code, sub_book, chapter_index, chapter_title, sutta_title,
                       para_index, para_num, rend, mula_guid, attha_guid, tika_guid, match_quality
                FROM canon_paragraphs WHERE global_id IN (1, 1000, 100000, 250000, 500000)
                ORDER BY global_id
            ''').fetchall()
            sample_dst = dst.execute('''
                SELECT global_id, guid, book_code, sub_book, chapter_index, chapter_title, sutta_title,
                       para_index, para_num, rend, mula_guid, attha_guid, tika_guid, match_quality
                FROM canon_paragraphs WHERE global_id IN (1, 1000, 100000, 250000, 500000)
                ORDER BY global_id
            ''').fetchall()
            assert sample_src == sample_dst, f'canon_paragraphs view mismatch:\n{sample_src}\nvs\n{sample_dst}'
            print(f'[opt] Verification passed: 100% lossless ({sent_count:,} sentences, {pack_count:,} paragraph texts)')
    finally:
        dst.close()
        src.close()
        if ps:
            ps.close()

    os.replace(tmp_path, out_path)
    out_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f'[opt] Wrote optimized DB -> {out_path} ({out_mb:.2f} MB) in {time.time() - t0:.1f}s')


def main():
    p = argparse.ArgumentParser(description='Optimize and unify tipitaka.db + pali_sentences.db')
    p.add_argument('--input', default=DEFAULT_TIPI)
    p.add_argument('--sentences', default=DEFAULT_SENT)
    p.add_argument('--output', default=DEFAULT_TIPI)
    p.add_argument('--no-verify', action='store_true')
    args = p.parse_args()
    optimize_database(args.input, args.sentences, args.output, verify=not args.no_verify)


if __name__ == '__main__':
    main()
