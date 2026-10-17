#!/usr/bin/env python3
"""
build_pts_db.py
Parses the PTS PED HTML dictionary from buddhadust.net (ped.htm),
removes all audio voice links and broken relative image links,
formats entries beautifully for readability and compatibility with the web app,
and builds new_ptsped2015ed_tipitakapali.db.
"""

import os
import sys
import re
import sqlite3
import time
import shutil
from collections import defaultdict

def clean_audio_voice_links(html):
    if not html:
        return ''
    # 1. Remove notice paragraphs about audio
    html = re.sub(r'<p[^>]*>\s*Links are to audio files.*?<\/p>', '', html, flags=re.I|re.S)
    html = re.sub(r'<p[^>]*>\s*<a[^>]*href=[^>]*pali\.audios\.htm[^>]*>.*?<\/a>\s*<\/p>', '', html, flags=re.I|re.S)
    
    # 2. Audio links that contain only images or audio icons: remove entirely
    # e.g. <a ...><img ...audio.../></a>
    html = re.sub(r'<a\s+[^>]*href=[\"\'\s]?[^\"\' >]*(?:\.wav|\.mp3|\.ogg|\.m4a|glossology_audios)[^\"\' >]*[\"\'\s]?[^>]*>\s*<img\s+[^>]*>\s*</a>', '', html, flags=re.I|re.S)
    
    # 3. Audio links where text is inside (like <a href="...p-k.wav">k</a> or <i>saṅgha,</i><img ...>)
    def unwrap_audio_link(m):
        content = m.group(1)
        # strip any audio img inside
        content = re.sub(r'<img\s+[^>]*src=[\"\'\s]?[^\"\' >]*audio[^\"\' >]*[\"\'\s]?[^>]*>', '', content, flags=re.I)
        content = re.sub(r'<img\s+[^>]*alt=[\"\'\s]?[^\"\' >]*audio[^\"\' >]*[\"\'\s]?[^>]*>', '', content, flags=re.I)
        return content.strip()
    
    html = re.sub(r'<a\s+[^>]*href=[\"\'\s]?[^\"\' >]*(?:\.wav|\.mp3|\.ogg|\.m4a|glossology_audios)[^\"\' >]*[\"\'\s]?[^>]*>(.*?)</a>', unwrap_audio_link, html, flags=re.I|re.S)
    
    # 4. Remove any remaining audio images
    html = re.sub(r'<img\s+[^>]*src=[\"\'\s]?[^\"\' >]*audio[^\"\' >]*[\"\'\s]?[^>]*>', '', html, flags=re.I)
    html = re.sub(r'<img\s+[^>]*alt=[\"\'\s]?[^\"\' >]*audio[^\"\' >]*[\"\'\s]?[^>]*>', '', html, flags=re.I)
    return html

def clean_common_markup(html):
    if not html:
        return ''
    # 1. Strip entire floating image blocks (which contain <img> and associated captions/credits)
    html = re.sub(r'<div\s+class=[\"\x27]float[lr][^\"\x27]*[\"\x27][^>]*>[\s\S]*?<img[\s\S]*?<\/div>', '', html, flags=re.I)
    
    # 2. Strip any standalone inline images (e.g. pdf.gif, icons, avatars)
    html = re.sub(r'<img\s+[^>]*>', '', html, flags=re.I)
    
    # 3. Rewrite relative links ../../../../ to https://buddhadust.net/
    html = re.sub(r'href=[\"\']\.\./\.\./\.\./\.\./([^\"\']+)[\"\']', r'href="https://buddhadust.net/\1" target="_blank" rel="noopener noreferrer"', html)

    # 4. Clean up empty paragraphs or wrappers left behind
    html = re.sub(r'<p>\s*(?:&nbsp;|<br\s*/?>|\s)*</p>', '', html, flags=re.I)
    html = re.sub(r'<div[^>]*>\s*</div>', '', html, flags=re.I)
    return html

def clean_entry_block(block):
    # 1. Clean audio voice links and icons
    block = clean_audio_voice_links(block)
    
    # 2. Clean common markup
    block = clean_common_markup(block)
    
    # 3. Clean specific special entries
    if 'id="xMātugāmo"' in block:
        block = re.sub(r'<p[^>]*>\s*<a\s+[^>]*id=[\"\'\s]?xMātugāmo[^>]*>.*?</a>\s*', '<b>Mātugāmo</b> ', block, flags=re.I|re.S)
    elif 'id="xahu-3"' in block:
        block = re.sub(r'<p[^>]*>\s*<a\s+[^>]*id=[\"\'\s]?xahu-3[^>]*>::\s*Ahu<sup>3,4</sup>\s*(\[DOP\][^<]*<i>[^<]*</i>)</a>\s*', r'<b>Ahu<sup>3,4</sup></b> \1', block, flags=re.I|re.S)
    elif 'id="xbahula-1"' in block:
        block = re.sub(r'<p[^>]*>\s*<a\s+[^>]*id=[\"\'\s]?xbahula-1[^>]*>::\s*Bahula<sup>1</sup>\(adjective\)</a>\s*', '<b>Bahula<sup>1</sup></b> (adjective) ', block, flags=re.I|re.S)
    else:
        # Strip leading <p...> tag so definition starts cleanly with <b>...</b>
        lead_p = re.match(r'^\s*<p[^>]*>\s*', block)
        if lead_p:
            block = block[lead_p.end():]
        
        # Replace <a class="palientry">:: Word</a> with <b>Word</b>
        def replace_hw(m):
            raw = m.group(1).strip()
            if raw.startswith('::'):
                raw = raw[2:].strip()
            return f'<b>{raw}</b>'
        
        block = re.sub(r'<a\s+[^>]*class=[\"\'\s]?palientry[^>]*>(.*?)</a>', replace_hw, block, flags=re.I|re.S)
    
    # Clean whitespace directly after </b>
    block = re.sub(r'(</b>)\s{2,}', r'\1 ', block)
    block = block.strip()
    # Normalize ending
    if not (block.endswith('</p>') or block.endswith('</div>')):
        block += '</p>'
    return block

def get_variants(word):
    """
    Given a word with parentheses like 'anu(g)gaṇhāti', return:
    ['anu(g)gaṇhāti', 'anugaṇhāti', 'anuggaṇhāti']
    """
    variants = [word]
    if '(' in word and ')' in word:
        clean_no_paren = re.sub(r'\((.*?)\)', '', word).strip()
        clean_with_paren = re.sub(r'\((.*?)\)', r'\1', word).strip()
        if clean_no_paren and clean_no_paren != word and clean_no_paren not in variants:
            variants.append(clean_no_paren)
        if clean_with_paren and clean_with_paren != word and clean_with_paren not in variants:
            variants.append(clean_with_paren)
    return variants

def extract_headwords(block):
    """
    Extracts all headwords from an entry block, including IDs and normalized lookup keys.
    """
    palientry_matches = list(re.finditer(r'<a\s+[^>]*class=[\"\'\s]?palientry[^>]*>(.*?)</a>', block, re.I|re.S))
    
    results = []
    for pm in palientry_matches:
        full_tag = pm.group(0)
        id_m = re.search(r'id=[\"\'\s]?([^\"\' >]+)', full_tag, re.I)
        tag_id = id_m.group(1) if id_m else ''
        raw_text = pm.group(1).strip()
        
        clean = re.sub(r'<[^>]+>', '', raw_text)
        clean = re.sub(r'::\s*', '', clean).strip()
        if tag_id == 'xMātugāmo':
            clean = 'Mātugāmo'
        elif tag_id == 'xahu-3':
            clean = 'Ahu'
        elif tag_id == 'xbahula-1':
            clean = 'Bahula'
        elif tag_id == 'x-nuu':
            # Ensure all suffix variants are indexed
            for extra in ['-nū', 'nū', '-ñū', 'ñū', '-ññū', 'ññū']:
                if extra not in results:
                    results.append(extra)
        
        # Remove numbers/superscripts e.g. 1, 2, 3, 4
        norm_word = re.sub(r'\d+', '', clean).strip().lower()
        # Allow punctuation like hyphen, degree, apostrophe, asterisk, parens
        norm_word = re.sub(r'[^\w\s\u00C0-\u024F\u1E00-\u1EFF\-°\'\*\(\)]', '', norm_word).strip()
        if not norm_word:
            continue
        
        for v in get_variants(norm_word):
            if v not in results:
                results.append(v)
            if ' ' in v:
                unspaced = v.replace(' ', '')
                if unspaced not in results:
                    results.append(unspaced)
            # Strip punctuation for normalized Tipitaka text lookup (e.g. paṭicca-samuppāda -> paṭiccasamuppāda, abhi- -> abhi, pa° -> pa, 'kara -> kara, *āsita -> āsita)
            clean_punc = re.sub(r'[\-°\'\*\(\)]', '', v).strip()
            if clean_punc and clean_punc not in results:
                results.append(clean_punc)
                if ' ' in clean_punc:
                    unspaced_punc = clean_punc.replace(' ', '')
                    if unspaced_punc not in results:
                        results.append(unspaced_punc)

        # For nominative singular -o forms like mātugāmo, also add stem -a
        for r_item in list(results):
            if r_item.endswith('o') and len(r_item) > 2:
                stem = r_item[:-1] + 'a'
                if stem not in results:
                    results.append(stem)
                if ' ' in stem:
                    unspaced_stem = stem.replace(' ', '')
                    if unspaced_stem not in results:
                        results.append(unspaced_stem)

    # Check for secondary reconstructed headwords like *Āsita, *Āpā
    for star_m in re.finditer(r'<br\s*/?>\s*\*([A-Za-zĀĪŪṚṄÑṬḌṆa-zāīūṛṅñṭḍṇ]+)', block):
        star_w = '*' + star_m.group(1).lower()
        if star_w not in results:
            results.append(star_w)
        star_clean = star_m.group(1).lower()
        if star_clean not in results:
            results.append(star_clean)

    return results

def get_table_name(word):
    """
    Determines SQLite partition table for a given lookup word.
    """
    w = word.strip().lower()
    if len(w) < 2 or not w[0].isalpha() or w.startswith(('-', "'", '*', '[', '#', '°')):
        return 'misc'
    return w[:2] + 'z'

def build_database(html_path, out_db_path):
    print(f'Starting PTS PED build from {html_path} -> {out_db_path}')
    t0 = time.time()
    
    with open(html_path, 'r', encoding='utf-8', errors='replace') as f:
        text = f.read()
    print(f'Loaded HTML ({len(text):,} bytes) in {time.time() - t0:.2f}s')
    
    # 0. Normalize un-tagged headwords in Buddhadust text
    text = re.sub(r'<p>\s*<b><i>::\s*Yena</i></b>\s*see\s+Ya\.\s*</p>', '<p><a id="xyena" href="#xyena" class="palientry">:: Yena</a> see Ya.</p>', text, flags=re.I)
    text = re.sub(r'<p>\s*:\s*Uddhasta\s*(\[past participle of)', r'<p><a id="xuddhasta" href="#xuddhasta" class="palientry">:: Uddhasta</a> \1', text, flags=re.I)
    text = re.sub(r'<p>\s*-nū\s*\((-ññū)\)\s*\(adjective-suffix\)', r'<p><a id="x-nuu" href="#x-nuu" class="palientry">:: -nū</a> (\1) (adjective-suffix)', text, flags=re.I)
    text = re.sub(r'<p>\s*°Pa\s*\(adjective\)\s*\[<i>Cp\.', r'<p><a id="x-pa-drink" href="#x-pa-drink" class="palientry">:: °Pa</a> (adjective) [<i>Cp.', text, flags=re.I)
    
    # 1. Locate entry boundaries
    entry_starts = [m.start() for m in re.finditer(r'<p[^>]*>\s*<a\s+[^>]*class=[\"\'\s]?palientry[^>]*>', text, re.I)]
    dividers = [m.start() for m in re.finditer(r'<p[^>]*>\s*-----\s*<a\s+[^>]*id=[\"\'\s]?e_[^>]*>', text, re.I)]
    afterword_pos = text.find('<h4 class="ctr">Afterword</h4>')
    hr_pos = text.rfind('<hr class="hrctr"', 0, afterword_pos)
    end_of_all = hr_pos if hr_pos != -1 else afterword_pos
    
    print(f'Found {len(entry_starts):,} entry starts, {len(dividers)} section dividers')
    
    # 2. Extract and clean frontmatter
    first_entry_start = entry_starts[0]
    frontmatter_raw = text[:first_entry_start]
    # Clean frontmatter
    frontmatter_clean = clean_audio_voice_links(frontmatter_raw)
    frontmatter_clean = clean_common_markup(frontmatter_clean)
    # Extract inner content of main
    main_m = re.search(r'<div class="main">(.*)', frontmatter_clean, re.S)
    if main_m:
        frontmatter_defi = main_m.group(1).strip()
    else:
        frontmatter_defi = frontmatter_clean.strip()
    
    # 3. Extract and clean afterword
    afterword_end = text.rfind('</div>')
    afterword_raw = text[afterword_pos:afterword_end if afterword_end != -1 else len(text)]
    afterword_clean = clean_audio_voice_links(afterword_raw)
    afterword_clean = clean_common_markup(afterword_clean)
    afterword_defi = afterword_clean.strip()
    
    # 4. Parse all entry blocks
    tables_data = defaultdict(list)
    
    # Add special metadata rows to misc and pez
    tables_data['misc'].append(('##ptsinfo', frontmatter_defi))
    tables_data['misc'].append(('##ptsafterword', afterword_defi))
    tables_data['pez'].append(('pedinfo', frontmatter_defi))
    
    total_blocks = len(entry_starts)
    parsed_entries_count = 0
    total_headwords_count = 0
    
    for i in range(total_blocks):
        start = entry_starts[i]
        if i + 1 < total_blocks:
            next_start = entry_starts[i+1]
            div_between = [d for d in dividers if start < d < next_start]
            end = div_between[0] if div_between else next_start
        else:
            end = end_of_all
        
        raw_block = text[start:end]
        defi = clean_entry_block(raw_block)
        words = extract_headwords(raw_block)
        
        parsed_entries_count += 1
        for w in words:
            tbl = get_table_name(w)
            tables_data[tbl].append((w, defi))
            total_headwords_count += 1
            # If word is a 1-letter word (like 'a', 'ā', 'u', 'i', 'o'), also ensure it is in misc
            if len(w) == 1 and tbl != 'misc':
                tables_data['misc'].append((w, defi))
    
    print(f'Parsed {parsed_entries_count:,} entry blocks into {total_headwords_count:,} total headwords across {len(tables_data)} tables in {time.time() - t0:.2f}s')
    
    # 5. Build SQLite database
    os.makedirs(os.path.dirname(os.path.abspath(out_db_path)), exist_ok=True)
    if os.path.exists(out_db_path):
        os.remove(out_db_path)
    
    conn = sqlite3.connect(out_db_path)
    cur = conn.cursor()
    cur.execute('PRAGMA synchronous = OFF;')
    cur.execute('PRAGMA journal_mode = MEMORY;')
    cur.execute('PRAGMA page_size = 4096;')
    
    # Create synonyms table
    cur.execute('''
        CREATE TABLE synonyms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT NOT NULL,
            synonym TEXT
        );
    ''')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_synonyms_word ON synonyms(word);')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_synonyms_synonym ON synonyms(synonym);')
    
    # Create and populate all tables
    for tbl_name, rows in sorted(tables_data.items()):
        cur.execute(f'''
            CREATE TABLE "{tbl_name}" (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word TEXT NOT NULL,
                defi TEXT NOT NULL
            );
        ''')
        cur.executemany(f'INSERT INTO "{tbl_name}" (word, defi) VALUES (?, ?);', rows)
        cur.execute(f'CREATE INDEX IF NOT EXISTS "idx_{tbl_name}_word" ON "{tbl_name}"(word);')
    
    conn.commit()
    cur.execute('PRAGMA optimize;')
    conn.close()
    
    db_size = os.path.getsize(out_db_path)
    print(f'Database written successfully: {out_db_path} ({db_size:,} bytes) in {time.time() - t0:.2f}s')
    
    # Mirror database between server_api/db and root
    root_db = 'ptsped2015ed_tipitakapali.db'
    server_db = 'server_api/db/ptsped2015ed_tipitakapali.db'
    if os.path.abspath(out_db_path) == os.path.abspath(server_db):
        shutil.copy2(server_db, root_db)
        print(f'Mirrored database to {root_db}')
    elif os.path.abspath(out_db_path) == os.path.abspath(root_db):
        shutil.copy2(root_db, server_db)
        print(f'Mirrored database to {server_db}')

if __name__ == '__main__':
    html_src = 'tmp_ped/ped.htm'
    out_db = 'server_api/db/ptsped2015ed_tipitakapali.db'
    if len(sys.argv) > 1:
        out_db = sys.argv[1]
    build_database(html_src, out_db)
