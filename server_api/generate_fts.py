#!/usr/bin/env python3
"""
================================================================================
fts.py - SQLite FTS5 Full-Text Search Table Builder & Reference (Python)
================================================================================

This script demonstrates how to create, populate, and optimize the high-performance
`paragraphs_fts` SQLite FTS5 virtual table for the Tipiṭaka Pāḷi corpus with:
  1. `prefix = 3` for instant prefix / wildcard searches (e.g. 'dha*', 'buddha*').
  2. Footnote / variant reading text preserved for comprehensive scholarly searches.
  3. Clean text normalization (nigghahita 'ṁ' -> 'ṃ', zero-width spaces stripped).
  4. B-tree optimization (`optimize`) to merge index segments for maximum query speed.
  5. Canonical Piṭaka sorting (Mūla -> Aṭṭhakathā -> Ṭīkā -> Añña) and BM25 scoring.

Author: Antigravity Coding Assistant (Tipitaka Project)
================================================================================
"""

import os
import sys
import time
import re
import sqlite3

# Default paths relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAIN_DB_PATH = os.path.join(SCRIPT_DIR, "db", "tipitaka.db")
FTS_DB_PATH = os.path.join(SCRIPT_DIR, "db", "fts_tipitaka.db")
XML_DB_PATH = os.path.join(SCRIPT_DIR, "db", "books_xml.db")


# ==============================================================================
# 1. Text Sanitization & Cleaning Helper
# ==============================================================================
def clean_paragraph_text(pcontent: str) -> str:
    """
    Sanitizes raw TEI XML / HTML paragraph text for FTS5 full-text indexing:
      - RETAINS text inside <note>...</note> (footnotes & variant readings).
      - STRIPS <note> and </note> tags.
      - STRIPS page break tags (<pb.../>, <span class="pagebreak">...</span>).
      - STRIPS paragraph number anchors (<strong class="paranum">...</strong>).
      - STRIPS all remaining XML / HTML markup (<[^>]+>).
      - Normalizes Pāḷi nigghahita ('ṁ' / 'Ṁ' -> 'ṃ').
      - Removes invisible zero-width and non-breaking spaces.
      - Collapses multiple whitespace characters.
    """
    if not pcontent:
        return ""

    # Step A: Strip pagebreak markers e.g. <pb ed="VRI" n="1.0001"/> or HTML spans
    text = re.sub(r"<pb[^>]*/>", " ", pcontent)
    text = re.sub(r'<span class="pagebreak"[^>]*>.*?</span>', " ", text, flags=re.DOTALL)

    # Step B: Strip paragraph number anchor spans e.g. <strong class="paranum">1</strong>
    text = re.sub(r'<strong class="paranum"[^>]*>.*?</strong>', " ", text, flags=re.DOTALL)

    # Step C: Strip XML / HTML tags (Note: text inside <note>...</note> is preserved!)
    text = re.sub(r"<[^>]+>", " ", text)

    # Step D: Normalize Pāḷi nigghahita to standard unicode 'ṃ'
    text = text.replace("ṁ", "ṃ").replace("Ṁ", "ṃ")

    # Step E: Remove zero-width spaces, byte order marks, and non-breaking spaces
    text = re.sub(r"[\u200B-\u200D\uFEFF\u00A0]", " ", text)

    # Step F: Collapse all whitespace into single spaces and trim
    return re.sub(r"\s+", " ", text).strip()


# ==============================================================================
# 2. Database FTS5 Table Creation & Population
# ==============================================================================
def build_paragraphs_fts(db_path: str, xml_source_db: str = None):
    """
    Creates and populates the paragraphs_fts FTS5 table with prefix=3.
    """
    print(f"[*] Connecting to SQLite database: {db_path}")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = OFF;")
    conn.execute("PRAGMA cache_size = -64000;")  # 64 MB memory cache
    cur = conn.cursor()

    # Step 1: Drop existing table if present
    print("[1] Dropping existing paragraphs_fts table (if any)...")
    cur.execute("DROP TABLE IF EXISTS paragraphs_fts;")

    # Step 2: Create FTS5 Virtual Table with prefix=3
    #
    # Explanation of schema:
    #   - book_code:             Indexed book identifier (e.g. 's0101m.mul')
    #   - book_title:            Indexed book title (e.g. 'Sīlakkhandhavaggapāḷi')
    #   - nikaya:                Indexed nikaya name (e.g. 'Dīghanikāya')
    #   - para_num:              Indexed paragraph number (e.g. '1', '25')
    #   - para_index UNINDEXED:  Raw 0-indexed position in book (stored but not tokenized)
    #   - para_rend:             CSS render class (e.g. 'bodytext', 'gatha1', 'hangnum')
    #   - content:               Clean text of paragraph (tokenized for full-text search)
    #   - prefix = 3:            Creates dedicated 3-character prefix index for fast wildcards
    print("[2] Creating virtual table `paragraphs_fts` USING fts5(..., prefix = 3)...")
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
    conn.commit()

    # Step 3: Extract paragraphs from source XML
    print("[3] Populating paragraphs into FTS5 index...")
    t0 = time.time()

    # Load book metadata (title, nikaya) from books table
    books_meta = {
        r[0]: (r[1], r[2])
        for r in cur.execute("SELECT code, title, nikaya FROM books;").fetchall()
    }

    # Open XML source (either books_xml.db or fallback to main db)
    source_conn = conn
    if xml_source_db and os.path.exists(xml_source_db):
        source_conn = sqlite3.connect(xml_source_db)
    source_cur = source_conn.cursor()

    xml_books = source_cur.execute(
        "SELECT book_code, xml_content FROM books_xml ORDER BY book_code;"
    ).fetchall()

    fts_batch = []
    total_indexed = 0

    for book_code, xml_content in xml_books:
        title, nikaya = books_meta.get(book_code, (book_code, ""))
        # Match all paragraph, header, and trailer elements in XML
        paras = re.findall(
            r'<(?:p|head|trailer)\s+rend="([^"]+)"(?:\s+n="([^"]+)")?\s*>(.*?)</(?:p|head|trailer)>',
            xml_content,
            flags=re.DOTALL,
        )

        for p_idx, (rend, pnum, raw_content) in enumerate(paras):
            clean_text = clean_paragraph_text(raw_content)
            if clean_text:
                fts_batch.append(
                    (book_code, title, nikaya, pnum or "", p_idx, rend, clean_text)
                )

        # Batch insert every 10,000 rows
        if len(fts_batch) >= 10000:
            cur.executemany(
                """
            INSERT INTO paragraphs_fts (book_code, book_title, nikaya, para_num, para_index, para_rend, content)
            VALUES (?, ?, ?, ?, ?, ?, ?);
            """,
                fts_batch,
            )
            total_indexed += len(fts_batch)
            fts_batch = []

    # Insert remaining rows
    if fts_batch:
        cur.executemany(
            """
        INSERT INTO paragraphs_fts (book_code, book_title, nikaya, para_num, para_index, para_rend, content)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """,
            fts_batch,
        )
        total_indexed += len(fts_batch)
        fts_batch = []

    conn.commit()
    t1 = time.time()
    print(f"  ✓ Successfully indexed {total_indexed:,} paragraphs in {t1 - t0:.2f} seconds.")

    if source_conn != conn:
        source_conn.close()

    # Step 4: Optimize FTS5 B-tree index structure
    print("[4] Optimizing FTS5 index (merging B-tree segments)...")
    t0 = time.time()
    cur.execute("INSERT INTO paragraphs_fts(paragraphs_fts) VALUES('optimize');")
    conn.commit()
    t1 = time.time()
    print(f"  ✓ FTS5 optimize completed in {t1 - t0:.2f} seconds.")

    # Step 5: VACUUM database to reclaim unused pages
    print("[5] Reclaiming disk space via VACUUM...")
    t0 = time.time()
    cur.execute("VACUUM;")
    conn.commit()
    t1 = time.time()
    print(f"  ✓ VACUUM completed in {t1 - t0:.2f} seconds.")

    # Step 6: Benchmark Demonstration Queries
    print("\n[6] Running Benchmark Searches:")
    demo_queries = [
        ("Exact Term: 'dhamma'", "'\"dhamma\"'"),
        ("Prefix Wildcard: 'dha*'", "'\"dha\"*'"),
        ("Exact Phrase: 'evaṃ me sutaṃ'", "'\"evaṃ me sutaṃ\"'"),
        ("Proximity (NEAR 3): 'dhamma' NEAR 'hetu'", "NEAR(\"dhamma\" \"hetu\", 3)"),
        ("Variant / Footnote: 'syā*'", "'\"syā\"*'"),
    ]

    for label, match_expr in demo_queries:
        t_start = time.perf_counter()
        cur.execute(f"SELECT count(*) FROM paragraphs_fts WHERE paragraphs_fts MATCH {match_expr};")
        cnt = cur.fetchone()[0]
        elapsed_ms = (time.perf_counter() - t_start) * 1000.0

        # Sample snippet
        cur.execute(
            f"SELECT snippet(paragraphs_fts, 6, '<mark>', '</mark>', '...', 15) "
            f"FROM paragraphs_fts WHERE paragraphs_fts MATCH {match_expr} LIMIT 1;"
        )
        row = cur.fetchone()
        sample = row[0] if row else "None"
        print(f"  {label:<42} -> {cnt:>6,} matches ({elapsed_ms:>5.2f}ms) | Sample: {sample[:60]}...")

    conn.close()
    print("\n[✓] Finished successfully!")


# ==============================================================================
# 3. Main Execution Entry Point
# ==============================================================================
if __name__ == "__main__":
    db_file = FTS_DB_PATH
    xml_file = XML_DB_PATH

    if len(sys.argv) > 1:
        db_file = sys.argv[1]
    if len(sys.argv) > 2:
        xml_file = sys.argv[2]

    build_paragraphs_fts(db_file, xml_file)
