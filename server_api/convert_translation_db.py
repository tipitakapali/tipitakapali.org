#!/usr/bin/env python3
"""
convert_translation_db.py
Converts epitaka translation SQLite databases into the schema compatible with
the tipitakapali.org Next.js application and server_api.

Mapping:
  - Epitaka `book_id` -> Tipitaka VRI `book_code` (e.g. 'D-i' -> 's0101m.mul')
  - Epitaka `para_id` (1-based) -> Tipitaka `para_index` (0-based, para_id - 1)
  - Links to `chapter_index`, `guid`, and `para_num` via tipitaka.db's `canon_paragraphs`
  - Aggregates sentence-level translations into paragraph-level translations,
    while preserving individual sentence lines in `sentence_translations` and `sentences_json`.
"""

import os
import sys
import time
import json
import sqlite3
import argparse
from pathlib import Path

# Language metadata mapping
LANG_META = {
    'en': {'id': 'english', 'name': 'English', 'native': 'English', 'flag': '🇬🇧'},
    'vi': {'id': 'vietnamese', 'name': 'Vietnamese', 'native': 'Tiếng Việt', 'flag': '🇻🇳'},
    'my': {'id': 'myanmar', 'name': 'Myanmar', 'native': 'မြန်မာ', 'flag': '🇲🇲'},
    'my_nissaya': {'id': 'my_nissaya', 'name': 'Myanmar Nissaya', 'native': 'မြန်မာနိဿယ', 'flag': '🇲🇲'},
    'si': {'id': 'sinhala', 'name': 'Sinhala', 'native': 'සිංහල', 'flag': '🇱🇰'},
    'th': {'id': 'thai', 'name': 'Thai', 'native': 'ไทย', 'flag': '🇹🇭'},
    'zh': {'id': 'chinese', 'name': 'Chinese', 'native': '中文', 'flag': '🇨🇳'},
    'km': {'id': 'khmer', 'name': 'Khmer', 'native': 'ភាសាខ្មែរ', 'flag': '🇰🇭'},
    'lo': {'id': 'lao', 'name': 'Lao', 'native': 'ລາວ', 'flag': '🇱🇦'},
    'ta': {'id': 'tamil', 'name': 'Tamil', 'native': 'தமிழ்', 'flag': '🇮🇳'},
    'de': {'id': 'german', 'name': 'German', 'native': 'Deutsch', 'flag': '🇩🇪'},
    'ja': {'id': 'japanese', 'name': 'Japanese', 'native': '日本語', 'flag': '🇯🇵'},
    'pt': {'id': 'portuguese', 'name': 'Portuguese', 'native': 'Português', 'flag': '🇵🇹'},
    'ru': {'id': 'russian', 'name': 'Russian', 'native': 'Русский', 'flag': '🇷🇺'},
    'hi': {'id': 'hindi', 'name': 'Hindi', 'native': 'हिन्दी', 'flag': '🇮🇳'},
}


def load_canon_lookup(tipi_db_path):
    """Load (book_code, para_index) -> (chapter_index, guid, para_num) lookup table."""
    conn = sqlite3.connect(tipi_db_path)
    cur = conn.cursor()
    cur.execute('SELECT book_code, para_index, chapter_index, guid, para_num FROM canon_paragraphs')
    canon_lookup = {}
    book_max_chap = {}
    for r in cur.fetchall():
        canon_lookup[(r[0], r[1])] = (r[2], r[3], r[4])
        if r[2] is not None:
            book_max_chap[r[0]] = max(book_max_chap.get(r[0], 0), r[2])
    conn.close()
    return canon_lookup, book_max_chap


def load_epitaka_book_map(epi_db_path):
    """Load epitaka book_id -> vri_id (tipitaka book_code) mapping."""
    conn = sqlite3.connect(epi_db_path)
    cur = conn.cursor()
    cur.execute('SELECT book_id, vri_id FROM books WHERE vri_id IS NOT NULL AND vri_id != ""')
    book_map = dict(cur.fetchall())
    conn.close()
    return book_map


def init_target_database(db_path):
    """Create the target tables and performance pragmas."""
    if os.path.exists(db_path):
        os.remove(db_path)
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA synchronous = OFF')
    conn.execute('PRAGMA journal_mode = MEMORY')
    conn.execute('PRAGMA cache_size = -65536')

    conn.execute('''
    CREATE TABLE paragraph_translations (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        guid TEXT,
        para_num TEXT,
        translation TEXT NOT NULL,
        sentence_count INTEGER NOT NULL DEFAULT 1,
        sentences_json TEXT,
        PRIMARY KEY (book_code, chapter_index, para_index)
    )
    ''')

    conn.execute('''
    CREATE TABLE sentence_translations (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        para_index INTEGER NOT NULL,
        line_id INTEGER NOT NULL,
        translation TEXT NOT NULL,
        PRIMARY KEY (book_code, chapter_index, para_index, line_id)
    )
    ''')

    conn.execute('''
    CREATE TABLE translation_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    ''')

    return conn


def parse_nissaya_content(content):
    """Parse JSON content from epitaka_my_nissaya.db into formatted text and word pairs."""
    content = content.strip()
    if not content:
        return "", []
    try:
        data = json.loads(content)
        if isinstance(data, list):
            pairs = []
            text_parts = []
            for item in data:
                if isinstance(item, dict):
                    pali = (item.get("pali") or "").strip()
                    meaning = (item.get("meaning") or "").strip()
                    note = (item.get("note") or "").strip()
                    pairs.append({"pali": pali, "meaning": meaning, "note": note})
                    if pali and meaning:
                        text_parts.append(f"{pali}: {meaning}")
                    elif meaning:
                        text_parts.append(meaning)
                    elif pali:
                        text_parts.append(pali)
                    if note:
                        text_parts.append(f"[{note}]")
                elif isinstance(item, str) and item.strip():
                    pairs.append({"pali": "", "meaning": item.strip(), "note": ""})
                    text_parts.append(item.strip())
            return " | ".join(text_parts), pairs
        elif isinstance(data, dict):
            pali = (data.get("pali") or "").strip()
            meaning = (data.get("meaning") or "").strip()
            note = (data.get("note") or "").strip()
            pairs = [{"pali": pali, "meaning": meaning, "note": note}]
            res = []
            if pali and meaning:
                res.append(f"{pali}: {meaning}")
            elif meaning:
                res.append(meaning)
            elif pali:
                res.append(pali)
            if note:
                res.append(f"[{note}]")
            return " | ".join(res), pairs
    except Exception:
        pass
    return content, [{"pali": "", "meaning": content, "note": ""}]


def convert_language(lang_code, src_db_path, epi_ref_path, tipi_db_path, out_db_path, canon_lookup=None, book_max_chap=None, book_map=None):
    """Convert a single epitaka_{lang}.db to translation_{lang}.db."""
    t0 = time.time()
    if not os.path.exists(src_db_path):
        print(f"[{lang_code}] Source DB not found: {src_db_path}")
        return False

    if canon_lookup is None or book_max_chap is None:
        canon_lookup, book_max_chap = load_canon_lookup(tipi_db_path)
    if book_map is None:
        book_map = load_epitaka_book_map(epi_ref_path)

    print(f"[{lang_code}] Converting {src_db_path} -> {out_db_path}...")
    out_conn = init_target_database(out_db_path)

    src_conn = sqlite3.connect(src_db_path)
    src_cur = src_conn.cursor()

    is_nissaya = 'nissaya' in lang_code.lower()

    # Determine primary nissaya edition per book to prioritize when multiple nissayas exist
    primary_nissaya = {}
    if is_nissaya:
        for bid, nid, cnt in src_cur.execute(
            "SELECT book_id, nissaya_id, count(*) FROM sentences GROUP BY book_id, nissaya_id ORDER BY book_id, count(*) DESC"
        ):
            if bid not in primary_nissaya:
                primary_nissaya[bid] = nid

        query = '''
        SELECT book_id, para_id, line_id, content, nissaya_id
        FROM sentences
        WHERE content IS NOT NULL AND content != ""
        ORDER BY book_id, para_id, line_id, nissaya_id
        '''
    else:
        query = '''
        SELECT book_id, para_id, line_id, translation, 0 as dummy
        FROM sentences
        WHERE translation IS NOT NULL AND translation != ""
        ORDER BY book_id, para_id, line_id
        '''
    src_cur.execute(query)

    pt_batch = []
    st_batch = []
    current_key = None
    # For nissaya: line_id -> (formatted_text, pairs, is_primary)
    # For standard: line_id -> (text, None, True)
    current_lines = {}
    total_sentences = 0
    total_paras = 0
    distinct_books = set()

    def flush_para():
        nonlocal total_paras, total_sentences
        if not current_key or not current_lines:
            return
        bid, pid = current_key
        bcode = book_map.get(bid)
        if not bcode:
            return
        distinct_books.add(bcode)
        pindex = pid - 1
        info = canon_lookup.get((bcode, pindex))
        if info:
            cidx, guid, pnum = info
        else:
            cidx = book_max_chap.get(bcode, 0)
            guid = f'{bcode}:p{pindex}'
            pnum = None

        sorted_lines = sorted(current_lines.items(), key=lambda x: x[0])
        total_sentences += len(sorted_lines)

        trans_text = ' '.join(t for _, (t, _, _) in sorted_lines)
        if is_nissaya:
            s_json = json.dumps([{'line_id': lid, 'translation': t, 'pairs': p} for lid, (t, p, _) in sorted_lines], ensure_ascii=False)
        else:
            s_json = json.dumps([{'line_id': lid, 'translation': t} for lid, (t, _, _) in sorted_lines], ensure_ascii=False)

        pt_batch.append((bcode, cidx, pindex, guid, pnum, trans_text, len(sorted_lines), s_json))
        for lid, (t, _, _) in sorted_lines:
            st_batch.append((bcode, cidx, pindex, lid, t))
        total_paras += 1

    for row in src_cur:
        bid, pid, lid, raw_text, nid = row
        raw_text = raw_text.strip()
        if not raw_text:
            continue
        key = (bid, pid)
        if key != current_key:
            flush_para()
            current_key = key
            current_lines = {}

        if is_nissaya:
            parsed_text, pairs = parse_nissaya_content(raw_text)
            if not parsed_text:
                continue
            is_pri = (nid == primary_nissaya.get(bid))
            if lid not in current_lines:
                current_lines[lid] = (parsed_text, pairs, is_pri)
            elif is_pri and not current_lines[lid][2]:
                current_lines[lid] = (parsed_text, pairs, True)
        else:
            current_lines[lid] = (raw_text, None, True)

        if len(pt_batch) >= 10000:
            out_conn.executemany('INSERT OR REPLACE INTO paragraph_translations VALUES (?,?,?,?,?,?,?,?)', pt_batch)
            out_conn.executemany('INSERT OR REPLACE INTO sentence_translations VALUES (?,?,?,?,?)', st_batch)
            out_conn.commit()
            pt_batch = []
            st_batch = []

    flush_para()
    if pt_batch:
        out_conn.executemany('INSERT OR REPLACE INTO paragraph_translations VALUES (?,?,?,?,?,?,?,?)', pt_batch)
        out_conn.executemany('INSERT OR REPLACE INTO sentence_translations VALUES (?,?,?,?,?)', st_batch)
        out_conn.commit()

    src_conn.close()

    # Index creation
    out_conn.execute('CREATE INDEX idx_pt_book_chap ON paragraph_translations (book_code, chapter_index)')
    out_conn.execute('CREATE INDEX idx_pt_guid ON paragraph_translations (guid)')
    out_conn.execute('CREATE INDEX idx_st_book_chap ON sentence_translations (book_code, chapter_index)')

    # Metadata
    meta = LANG_META.get(lang_code, {'id': lang_code, 'name': lang_code.upper(), 'native': lang_code.upper(), 'flag': '🌐'})
    meta_entries = [
        ('lang_code', lang_code),
        ('lang_id', meta['id']),
        ('name', meta['name']),
        ('native_name', meta['native']),
        ('flag', meta['flag']),
        ('total_sentences', str(total_sentences)),
        ('total_paragraphs', str(total_paras)),
        ('total_books', str(len(distinct_books))),
        ('converted_at', time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())),
    ]
    out_conn.executemany('INSERT OR REPLACE INTO translation_meta VALUES (?, ?)', meta_entries)
    out_conn.commit()
    out_conn.close()

    size_mb = os.path.getsize(out_db_path) / (1024 * 1024)
    elapsed = time.time() - t0
    print(f"[{lang_code}] Success: {total_sentences:,} sentences across {len(distinct_books)} books into {out_db_path} ({size_mb:.1f} MB) in {elapsed:.1f}s")
    return True


def main():
    parser = argparse.ArgumentParser(description="Convert epitaka translation DBs to tipitakapali.org compatible schema")
    parser.add_argument('--lang', default='en', help="Language code (e.g. en, vi, my, all)")
    parser.add_argument('--data-dir', default='/home/administrator/freebuff_run/data', help="Directory with epitaka_*.db files")
    parser.add_argument('--output-dir', default=os.path.join(os.path.dirname(__file__), 'db'), help="Output directory for translation_*.db files")
    parser.add_argument('--tipi-db', default=os.path.join(os.path.dirname(__file__), 'db', 'tipitaka.db'), help="Path to tipitaka.db")
    parser.add_argument('--epi-db', default='/home/administrator/freebuff_run/data/epitaka.db', help="Path to epitaka.db")
    args = parser.parse_args()

    data_dir = os.path.abspath(args.data_dir)
    output_dir = os.path.abspath(args.output_dir)
    tipi_db = os.path.abspath(args.tipi_db)
    epi_db = os.path.abspath(args.epi_db)

    print(f"Loading canon data from {tipi_db}...")
    canon_lookup, book_max_chap = load_canon_lookup(tipi_db)
    print(f"Loading book mapping from {epi_db}...")
    book_map = load_epitaka_book_map(epi_db)

    if args.lang.lower() == 'all':
        langs = list(LANG_META.keys())
    else:
        langs = [l.strip() for l in args.lang.split(',') if l.strip()]

    for lang in langs:
        src_db = os.path.join(data_dir, f'epitaka_{lang}.db')
        out_db = os.path.join(output_dir, f'translation_{lang}.db')
        if not os.path.exists(src_db):
            print(f"Skipping {lang}: {src_db} does not exist")
            continue
        convert_language(lang, src_db, epi_db, tipi_db, out_db, canon_lookup, book_max_chap, book_map)

    # Clean up test database if exists
    test_db = os.path.join(output_dir, 'test_trans_en.db')
    if os.path.exists(test_db):
        try:
            os.remove(test_db)
        except:
            pass


if __name__ == '__main__':
    main()
