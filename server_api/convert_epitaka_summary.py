#!/usr/bin/env python3
"""
convert_epitaka_summary.py
Converts epitaka_summary.db into server_api/db/summaries.db compatible with
the tipitakapali.org Next.js application and Fastify backend server.

Mapping:
  - Epitaka `book_id` -> Tipitaka VRI `book_code` (e.g. 'M-i' -> 's0201m.mul')
  - `para_start` / `para_end` (1-indexed in Epitaka) -> 0-indexed para_index
  - Resolves chapter_index from canon_paragraphs in tipitaka.db
  - Creates FTS5 virtual table for instant sutta/section summary search
"""

import os
import sys
import json
import sqlite3

def convert_summaries(summary_db_path, epitaka_ref_path, tipitaka_db_path, out_db_path):
    print(f"Reading summaries from {summary_db_path}...")
    if not os.path.exists(summary_db_path):
        print(f"Error: {summary_db_path} does not exist.")
        return False

    # Load book map
    epi_conn = sqlite3.connect(epitaka_ref_path)
    cur = epi_conn.cursor()
    cur.execute("SELECT book_id, vri_id, book_name FROM books WHERE vri_id IS NOT NULL AND vri_id != ''")
    book_map = {}
    book_names = {}
    for bid, vid, bname in cur.fetchall():
        book_map[bid] = vid
        book_names[vid] = bname
    epi_conn.close()

    # Load canon lookup
    tipi_conn = sqlite3.connect(tipitaka_db_path)
    cur = tipi_conn.cursor()
    cur.execute("SELECT book_code, para_index, chapter_index, chapter_title, sutta_title FROM canon_paragraphs")
    canon_lookup = {}
    for bcode, pidx, cidx, ctitle, stitle in cur.fetchall():
        canon_lookup[(bcode, pidx)] = (cidx, ctitle, stitle)
    tipi_conn.close()

    # Read summaries
    src_conn = sqlite3.connect(summary_db_path)
    cur = src_conn.cursor()
    cur.execute("""
        SELECT book_id, section_id, para_start, para_end, heading_title, sutta_title, vagga_title, title, content, sources
        FROM summaries
        ORDER BY book_id, section_id
    """)
    rows = cur.fetchall()
    src_conn.close()

    print(f"Found {len(rows)} summaries. Creating target database at {out_db_path}...")
    if os.path.exists(out_db_path):
        os.remove(out_db_path)

    out_conn = sqlite3.connect(out_db_path)
    out_conn.execute("PRAGMA synchronous = NORMAL")
    out_conn.execute("PRAGMA journal_mode = WAL")

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
            sources TEXT,
            UNIQUE(book_code, section_id)
        )
    """)

    out_conn.execute("CREATE INDEX idx_summaries_book ON summaries(book_code)")
    out_conn.execute("CREATE INDEX idx_summaries_chap ON summaries(book_code, chapter_index)")
    out_conn.execute("CREATE INDEX idx_summaries_paras ON summaries(book_code, para_index_start, para_index_end)")

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

    insert_sql = """
        INSERT INTO summaries (
            book_id, book_code, book_title, section_id, chapter_index,
            para_start, para_end, para_index_start, para_index_end,
            heading_title, sutta_title, vagga_title, title, content, sources
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    fts_insert_sql = """
        INSERT INTO summaries_fts (
            rowid, book_code, book_title, title, sutta_title, vagga_title, heading_title, content
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """

    inserted = 0
    for r in rows:
        bid, sec_id, p_start, p_end, h_title, s_title, v_title, title, content, sources = r
        bcode = book_map.get(bid, bid)
        bname = book_names.get(bcode, bid)

        p_idx_start = max(0, p_start - 1)
        p_idx_end = max(0, p_end - 1)

        cinfo = canon_lookup.get((bcode, p_idx_start))
        cidx = cinfo[0] if cinfo else 0

        cur = out_conn.cursor()
        cur.execute(insert_sql, (
            bid, bcode, bname, sec_id, cidx,
            p_start, p_end, p_idx_start, p_idx_end,
            h_title or '', s_title or '', v_title or '', title or '', content or '', sources or '[]'
        ))
        rowid = cur.lastrowid

        out_conn.execute(fts_insert_sql, (
            rowid, bcode, bname, title or '', s_title or '', v_title or '', h_title or '', content or ''
        ))
        inserted += 1

    out_conn.commit()
    out_conn.close()
    print(f"Successfully converted {inserted} summaries into {out_db_path} with FTS5 index.")
    return True

if __name__ == '__main__':
    base_dir = os.path.dirname(os.path.abspath(__file__))
    summary_db = os.path.join(base_dir, '../ref/epitaka_app/assets/db/epitaka_summary.db')
    epitaka_ref = os.path.join(base_dir, '../ref/epitaka_app/assets/db/epitaka.db')
    tipitaka_db = os.path.join(base_dir, 'db/tipitaka.db')
    out_db = os.path.join(base_dir, 'db/summaries.db')

    convert_summaries(summary_db, epitaka_ref, tipitaka_db, out_db)
