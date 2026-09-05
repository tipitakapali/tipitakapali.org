#!/usr/bin/env python3
"""
convert_epitaka_dbs.py
Converts and indexes:
  1. 121,555 chapter and sutta study summaries from `epitaka_en.db` and `epitaka_summary.db`
     mapped to CST VRI book codes with FTS5 full-text indexing.
  2. All 37,226 section headings from `tipitaka.db` (book_toc and canon_paragraphs)
     into `all_sections_fts` with FTS5 unicode61 remove_diacritics for diacritic-agnostic search.
"""

import os
import sys
import time
import sqlite3

def build_summaries_and_sections_db(base_dir):
    start_time = time.time()
    epi_ref_path = os.path.join(base_dir, "../ref/epitaka_app/assets/db/epitaka.db")
    epi_en_path = os.path.join(base_dir, "../ref/epitaka_app/assets/db/epitaka_en.db")
    epi_sum_path = os.path.join(base_dir, "../ref/epitaka_app/assets/db/epitaka_summary.db")
    tipi_path = os.path.join(base_dir, "db/tipitaka.db")
    out_path = os.path.join(base_dir, "db/summaries.db")

    print(f"[Conversion] Target database: {out_path}")

    # 1. Load book mapping from epitaka.db
    book_map = {}
    book_names = {}
    if os.path.exists(epi_ref_path):
        epi_conn = sqlite3.connect(epi_ref_path)
        cur = epi_conn.cursor()
        cur.execute("SELECT book_id, vri_id, book_name FROM books WHERE vri_id IS NOT NULL AND vri_id != ''")
        for bid, vid, bname in cur.fetchall():
            book_map[bid] = vid
            book_names[vid] = bname
            book_map[bid.lower()] = vid
        epi_conn.close()
        print(f"[Conversion] Loaded {len(book_map)} book mappings from {epi_ref_path}")

    # Also load books from tipitaka.db for any missing
    tipi_conn = sqlite3.connect(tipi_path)
    cur = tipi_conn.cursor()
    cur.execute("SELECT code, title FROM books")
    for code, title in cur.fetchall():
        if code not in book_names:
            book_names[code] = title
        book_map[code] = code
    tipi_conn.close()

    # 2. Connect to output summaries.db
    temp_out = out_path + ".tmp"
    if os.path.exists(temp_out):
        os.remove(temp_out)

    out_conn = sqlite3.connect(temp_out)
    out_conn.execute("PRAGMA synchronous = NORMAL")
    out_conn.execute("PRAGMA journal_mode = WAL")
    out_conn.execute("PRAGMA cache_size = 50000")

    out_conn.execute("""
        CREATE TABLE summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id TEXT NOT NULL,
            book_code TEXT NOT NULL,
            book_title TEXT,
            section_id INTEGER NOT NULL,
            chapter_index INTEGER DEFAULT 0,
            para_start INTEGER NOT NULL,
            para_end INTEGER NOT NULL,
            para_index_start INTEGER NOT NULL,
            para_index_end INTEGER NOT NULL,
            heading_title TEXT,
            sutta_title TEXT,
            vagga_title TEXT,
            title TEXT,
            content TEXT,
            sources TEXT
        )
    """)

    # 3. Read summaries from epitaka_en.db or epitaka_summary.db
    src_db = epi_en_path if os.path.exists(epi_en_path) else epi_sum_path
    print(f"[Conversion] Reading summaries from {src_db}...")
    src_conn = sqlite3.connect(src_db)
    cur = src_conn.cursor()
    cur.execute("""
        SELECT book_id, section_id, para_start, para_end, heading_title, sutta_title, vagga_title, title, content, sources
        FROM summaries
    """)

    insert_sql = """
        INSERT INTO summaries (
            book_id, book_code, book_title, section_id, chapter_index,
            para_start, para_end, para_index_start, para_index_end,
            heading_title, sutta_title, vagga_title, title, content, sources
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    count = 0
    batch = []
    for row in cur:
        bid, sec_id, p_start, p_end, h_title, s_title, v_title, title, content, sources = row
        bcode = book_map.get(bid, book_map.get(bid.lower(), bid))
        btitle = book_names.get(bcode, bid)

        p_idx_start = max(0, (p_start or 1) - 1)
        p_idx_end = max(0, (p_end or p_start or 1) - 1)

        batch.append((
            bid, bcode, btitle, sec_id, 0,
            p_start or 0, p_end or 0, p_idx_start, p_idx_end,
            h_title or '', s_title or '', v_title or '', title or '', content or '', sources or '[]'
        ))

        count += 1
        if len(batch) >= 10000:
            out_conn.executemany(insert_sql, batch)
            out_conn.commit()
            batch.clear()
            print(f"  Inserted {count} summaries...")

    if batch:
        out_conn.executemany(insert_sql, batch)
        out_conn.commit()
        batch.clear()

    src_conn.close()
    print(f"[Conversion] Successfully inserted {count} summaries. Creating indexes...")

    out_conn.execute("CREATE INDEX idx_summaries_bcode ON summaries(book_code)")
    out_conn.execute("CREATE INDEX idx_summaries_bcode_sec ON summaries(book_code, section_id)")
    out_conn.execute("CREATE INDEX idx_summaries_paras ON summaries(book_code, para_index_start, para_index_end)")

    # 4. Create FTS5 virtual table for summaries
    print("[Conversion] Building summaries_fts FTS5 table...")
    out_conn.execute("""
        CREATE VIRTUAL TABLE summaries_fts USING fts5(
            book_code,
            book_title,
            title,
            sutta_title,
            vagga_title,
            heading_title,
            content,
            tokenize = 'unicode61 remove_diacritics 1'
        )
    """)

    out_conn.execute("""
        INSERT INTO summaries_fts (rowid, book_code, book_title, title, sutta_title, vagga_title, heading_title, content)
        SELECT id, book_code, book_title, title, sutta_title, vagga_title, heading_title, content
        FROM summaries
    """)
    out_conn.commit()

    # 5. Create all_sections_fts indexing all 37,226 canonical TOC entries + 17k sutta titles
    print(f"[Conversion] Indexing canonical TOC sections from {tipi_path}...")
    out_conn.execute("""
        CREATE VIRTUAL TABLE all_sections_fts USING fts5(
            book_code,
            book_title,
            title,
            chapter_index UNINDEXED,
            para_index UNINDEXED,
            para_num UNINDEXED,
            level UNINDEXED,
            tokenize = 'unicode61 remove_diacritics 1'
        )
    """)

    tipi_conn = sqlite3.connect(tipi_path)
    cur_tipi = tipi_conn.cursor()
    cur_tipi.execute("""
        SELECT t.book_code, COALESCE(b.title, t.book_code), t.title, t.chapter_index, t.para_index, t.para_num, t.level
        FROM book_toc t
        LEFT JOIN books b ON b.code = t.book_code
    """)
    toc_rows = cur_tipi.fetchall()
    out_conn.executemany("""
        INSERT INTO all_sections_fts (book_code, book_title, title, chapter_index, para_index, para_num, level)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, toc_rows)

    # Also index unique sutta titles from canon_paragraphs for completeness
    cur_tipi.execute("""
        SELECT p.book_code, COALESCE(b.title, p.book_code), p.sutta_title, p.chapter_index, p.para_index, p.para_num, 4
        FROM (
            SELECT book_code, chapter_index, min(para_index) as para_index, para_num, sutta_title
            FROM canon_paragraphs
            WHERE sutta_title IS NOT NULL AND sutta_title != ''
            GROUP BY book_code, sutta_title
        ) p
        LEFT JOIN books b ON b.code = p.book_code
    """)
    sutta_rows = cur_tipi.fetchall()
    out_conn.executemany("""
        INSERT INTO all_sections_fts (book_code, book_title, title, chapter_index, para_index, para_num, level)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, sutta_rows)
    tipi_conn.close()

    out_conn.commit()

    # Optimize FTS
    out_conn.commit()
    out_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    out_conn.execute("PRAGMA journal_mode = DELETE")
    out_conn.close()

    for ext in ["", "-wal", "-shm"]:
        old_f = out_path + ext
        if os.path.exists(old_f):
            os.remove(old_f)
    os.rename(temp_out, out_path)
    for ext in ["-wal", "-shm"]:
        tmp_f = temp_out + ext
        if os.path.exists(tmp_f):
            os.remove(tmp_f)
    print(f"[Conversion] Done in {time.time() - start_time:.2f}s! Saved to {out_path}")
    return True

if __name__ == '__main__':
    base_dir = os.path.dirname(os.path.abspath(__file__))
    build_summaries_and_sections_db(base_dir)
