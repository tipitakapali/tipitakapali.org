#!/usr/bin/env python3
"""
compare_pts_db.py
Comprehensive comparison between old ptsped2015ed_tipitakapali.db
and new_ptsped2015ed_tipitakapali.db.
"""

import sqlite3
import os
import re

old_db_path = 'server_api/db/legacy_ptsped2015ed_tipitakapali.db'
new_db_path = 'server_api/db/ptsped2015ed_tipitakapali.db'

def analyze_db(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    prefix_tables = [t for t in tables if t not in ('sqlite_sequence', 'synonyms', 'misc') and not t.startswith('sqlite_')]
    indexes = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
    
    total_rows = 0
    words = []
    audio_links = 0
    spaced_words = []
    ng_words = 0
    b_start = 0
    broken_parens = 0
    relative_imgs = 0
    canonical_imgs = 0
    
    for t in tables:
        if t in ('sqlite_sequence', 'synonyms') or t.startswith('sqlite_'):
            continue
        rows = cur.execute(f'SELECT word, defi FROM "{t}"').fetchall()
        total_rows += len(rows)
        for w, d in rows:
            words.append(w)
            if ' ' in w and w not in ('##ptsinfo', '##ptsafterword'):
                spaced_words.append((t, w))
            if 'ṅ' in w:
                ng_words += 1
            if d.startswith('<b>'):
                b_start += 1
            if any(ext in d.lower() for ext in ('.wav', '.mp3', '.ogg', '.m4a', 'glossology_audios', 'audio-verysmall')):
                audio_links += 1
            if '(' in w and ')' in w:
                broken_parens += 1
            for m in re.finditer(r'<img\s+[^>]*>', d, re.I):
                tag = m.group(0)
                if 'src="http' in tag or "src='http" in tag:
                    canonical_imgs += 1
                else:
                    relative_imgs += 1
                
    file_size = os.path.getsize(db_path)
    conn.close()
    
    return {
        'path': db_path,
        'size': file_size,
        'tables_count': len(tables),
        'prefix_tables_count': len(prefix_tables),
        'indexes_count': len(indexes),
        'total_rows': total_rows,
        'unique_words': len(set(words)),
        'audio_links': audio_links,
        'spaced_words_count': len(spaced_words),
        'spaced_words_sample': spaced_words[:10],
        'ng_words': ng_words,
        'b_start': b_start,
        'broken_parens': broken_parens,
        'relative_imgs': relative_imgs,
        'canonical_imgs': canonical_imgs
    }

old_stats = analyze_db(old_db_path)
new_stats = analyze_db(new_db_path)

print('================ OLD DB STATS ================')
for k, v in old_stats.items():
    if k != 'spaced_words_sample':
        print(f'{k}: {v}')
print('Sample spaced words:', old_stats['spaced_words_sample'])

print('\n================ NEW DB STATS ================')
for k, v in new_stats.items():
    if k != 'spaced_words_sample':
        print(f'{k}: {v}')
print('Sample spaced words:', new_stats['spaced_words_sample'])

# Compare headword lookups
test_words = [
    'a', 'ā',
    'paṭiccasamuppāda', 'paṭicca-samuppāda',
    'yena', 'uddhasta',
    '-nū', 'nū', '-ñū', 'ñū',
    'ahosikamma', 'ahosi-kamma',
    'abhi', 'abhi-',
    'pari', 'pari°',
    'pa', 'pa°',
    '*āsita', 'āsita',
    'aṅga', 'saṅgha', 'abhisaṅkhāra',
    'bhadda', 'bhadara', 'bhadra',
    'mātugāmo', 'mātugāma', 'amha', 'amhan',
    'abbhāgamana', 'abbhuggamana',
    'ahu', 'bahula', 'anuggaṇhāti', 'anugaṇhāti', 'anu(g)gaṇhāti',
    'jhāna', 'nibbāna'
]

print('\n================ LOOKUP COMPARISON ================')
conn_old = sqlite3.connect(old_db_path)
cur_old = conn_old.cursor()
conn_new = sqlite3.connect(new_db_path)
cur_new = conn_new.cursor()

def old_lookup(w):
    w_clean = w.strip().lower()
    t = 'misc' if len(w_clean) < 2 or not w_clean[0].isalpha() or w_clean.startswith(('-', "'", '*', '[', '#', '°')) else w_clean[:2] + 'z'
    try:
        return cur_old.execute(f'SELECT word, defi FROM "{t}" WHERE word = ?', (w,)).fetchall()
    except:
        return []

def new_lookup(w):
    w_clean = w.strip().lower()
    t = 'misc' if len(w_clean) < 2 or not w_clean[0].isalpha() or w_clean.startswith(('-', "'", '*', '[', '#', '°')) else w_clean[:2] + 'z'
    try:
        return cur_new.execute(f'SELECT word, defi FROM "{t}" WHERE word = ?', (w,)).fetchall()
    except:
        return []

for w in test_words:
    r_old = old_lookup(w)
    r_new = new_lookup(w)
    print(f"Word '{w}': Old DB = {len(r_old)} match(es), New DB = {len(r_new)} match(es)")

conn_old.close()
conn_new.close()
