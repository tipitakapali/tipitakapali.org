#!/usr/bin/env python3
"""
generate_seo_ai_metadata.py
===========================
Generates full VPS SSR multi-script & multi-translation XML Sitemap Index and
high-signal AI crawler/agent files for tipitakapali.org.

Generated Files:
  1. sitemap.xml              - XML Sitemap Index referencing 40 child sitemaps:
                                - sitemap-main.xml (site pages + 217 Roman books + 2,695 chapters)
                                - sitemap-{script}.xml (16 Pāḷi script sitemaps: books + chapters)
                                - sitemap-lang-{lang}.xml (23 translation language sitemaps:
                                  /translation/{lang}/{book_code} + chapters present in translation_{lang}.db)
                                Every child sitemap stays cleanly under 50,000 URLs & 50 MB.
  2. robots.txt               - Search engine & AI crawler rules allowing /book/ and /translation/
                                with canonical Sitemap Index entry.
  3. llms.txt                 - Concise, high-signal AI Agent playbook & API guide
                                (llmstxt.org standard): Canonical Bold Definitions
                                (387,006 entries), Concept-Group Search, DPD, FTS5,
                                Sentence Alignment, clean /translation/{lang}/{book} URLs, and citations.
  4. llms-full.txt            - Complete 217-book catalog (with Mūla/Aṭṭhakathā/Ṭīkā
                                cross-links), 23 translations (/translation/{lang}/...), 17 scripts,
                                and full REST API reference for LLMs & research agents.
  5. site.jsonld              - Schema.org JSON-LD structured data (WebSite, Organization,
                                DataCatalog with all 217 canonical books).

Usage:
  python3 generate_seo_ai_metadata.py
  python3 generate_seo_ai_metadata.py --public-only
  python3 generate_seo_ai_metadata.py --site-url https://tipitakapali.org
"""

import os
import re
import sys
import json
import sqlite3
import argparse
import time
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

DEFAULT_SITE_URL = "https://tipitakapali.org"
INDEXNOW_KEY_RE = re.compile(r"^[0-9a-f]{32}\.txt$")

# 16 non-default Pāḷi scripts available in the application (Roman 'ro' is default -> 17 total)
PALI_SCRIPTS = [
    {"code": "si", "name": "Sinhala", "native": "සිංහල", "desc": "Sinhala script", "lang": "pi-Sinh"},
    {"code": "hi", "name": "Devanagari / Hindi", "native": "देवनागरी", "desc": "Devanagari script", "lang": "pi-Deva"},
    {"code": "thai", "name": "Thai", "native": "ไทย", "desc": "Thai script", "lang": "pi-Thai"},
    {"code": "laos", "name": "Lao", "native": "ລາວ", "desc": "Lao script", "lang": "pi-Laoo"},
    {"code": "my", "name": "Myanmar / Burmese", "native": "မြန်မာ", "desc": "Myanmar script", "lang": "pi-Mymr"},
    {"code": "km", "name": "Khmer", "native": "ខ្មែរ", "desc": "Khmer script", "lang": "pi-Khmr"},
    {"code": "beng", "name": "Bengali", "native": "বাংলা", "desc": "Bengali script", "lang": "pi-Beng"},
    {"code": "gurm", "name": "Gurmukhi", "native": "ਗੁਰਮੁਖੀ", "desc": "Gurmukhi script", "lang": "pi-Guru"},
    {"code": "tham", "name": "Tai Tham / Lanna", "native": "ᨲ᩠ᩅᩫᨾᩮᩥᩬᨦ", "desc": "Tai Tham script", "lang": "pi-Lana"},
    {"code": "guja", "name": "Gujarati", "native": "ગુજરાતી", "desc": "Gujarati script", "lang": "pi-Gujr"},
    {"code": "telu", "name": "Telugu", "native": "తెలుగు", "desc": "Telugu script", "lang": "pi-Telu"},
    {"code": "kann", "name": "Kannada", "native": "ಕನ್ನಡ", "desc": "Kannada script", "lang": "pi-Knda"},
    {"code": "mala", "name": "Malayalam", "native": "മലയാളം", "desc": "Malayalam script", "lang": "pi-Mlym"},
    {"code": "brah", "name": "Brahmi", "native": "𑀩𑁆𑀭𑀸𑀳𑁆𑀫𑀻", "desc": "Ancient Ashokan Brahmi script", "lang": "pi-Brah"},
    {"code": "tibt", "name": "Tibetan", "native": "བོད་སྐད།", "desc": "Tibetan script", "lang": "pi-Tibt"},
    {"code": "cyrl", "name": "Cyrillic", "native": "кириллица", "desc": "Cyrillic script", "lang": "pi-Cyrl"},
]

# 23 supported modern translation languages across the Canon (+ Pāḷi = 24 total reading layers)
TRANSLATION_LANGUAGES = [
    {"code": "en", "name": "English", "native": "English", "flag": "🇬🇧", "lang": "en", "desc": "English translation • 1.28M sentences"},
    {"code": "vi", "name": "Vietnamese", "native": "Tiếng Việt", "flag": "🇻🇳", "lang": "vi", "desc": "Bản dịch Tiếng Việt • 1.28M câu"},
    {"code": "my", "name": "Myanmar / Burmese", "native": "မြန်မာ", "flag": "🇲🇲", "lang": "my", "desc": "မြန်မာဘာသာပြန် • 1.28M စာကြောင်း"},
    {"code": "my_nissaya", "name": "Myanmar Nissaya", "native": "မြန်မာ နိဿယ", "flag": "🇲🇲", "lang": "my-MM", "desc": "Myanmar Nissaya word-by-word • 570K စာကြောင်း"},
    {"code": "si", "name": "Sinhala", "native": "සිංහල", "flag": "🇱🇰", "lang": "si", "desc": "සිංහල පරිවර්තනය • 1.21M වාක්‍ය"},
    {"code": "zh", "name": "Chinese", "native": "中文", "flag": "🇨🇳", "lang": "zh", "desc": "中文翻译 • 1.27M 句"},
    {"code": "km", "name": "Khmer", "native": "ភាសាខ្មែរ", "flag": "🇰🇭", "lang": "km", "desc": "ការបកប្រែជាភាសាខ្មែរ • 1.18M ប្រយោគ"},
    {"code": "th", "name": "Thai", "native": "ไทย", "flag": "🇹🇭", "lang": "th", "desc": "ฉบับแปลภาษาไทย • 1.27M ประโยค"},
    {"code": "lo", "name": "Lao", "native": "ລາວ", "flag": "🇱🇦", "lang": "lo", "desc": "ການແປພາສາລາວ • 328K ປະໂຫຍກ"},
    {"code": "ta", "name": "Tamil", "native": "தமிழ்", "flag": "🇮🇳", "lang": "ta", "desc": "தமிழ் மொழிபெயர்ப்பு • 1.22M வாக்கியங்கள்"},
    {"code": "hi", "name": "Hindi", "native": "हिन्दी", "flag": "🇮🇳", "lang": "hi", "desc": "हिन्दी अनुवाद • 1.22M वाक्य"},
    {"code": "mr", "name": "Marathi", "native": "मराठी", "flag": "🇮🇳", "lang": "mr", "desc": "मराठी अनुवाद • 1.20M वाक्य"},
    {"code": "id", "name": "Indonesian", "native": "Bahasa Indonesia", "flag": "🇮🇩", "lang": "id", "desc": "Terjemahan Bahasa Indonesia • 1.22M kalimat"},
    {"code": "cs", "name": "Czech", "native": "Čeština", "flag": "🇨🇿", "lang": "cs", "desc": "Český překlad • 1.20M vět"},
    {"code": "de", "name": "German", "native": "Deutsch", "flag": "🇩🇪", "lang": "de", "desc": "Deutsche Übersetzung • 1.28M Sätze"},
    {"code": "es", "name": "Spanish", "native": "Español", "flag": "🇪🇸", "lang": "es", "desc": "Traducción en Español • 1.27M oraciones"},
    {"code": "fr", "name": "French", "native": "Français", "flag": "🇫🇷", "lang": "fr", "desc": "Traduction en Français • 1.27M phrases"},
    {"code": "ja", "name": "Japanese", "native": "日本語", "flag": "🇯🇵", "lang": "ja", "desc": "日本語訳 • 1.25M 文"},
    {"code": "pt", "name": "Portuguese", "native": "Português", "flag": "🇵🇹", "lang": "pt", "desc": "Tradução em Português • 1.22M frases"},
    {"code": "ru", "name": "Russian", "native": "Русский", "flag": "🇷🇺", "lang": "ru", "desc": "Русский перевод • 1.22M предложений"},
    {"code": "ko", "name": "Korean", "native": "한국어", "flag": "🇰🇷", "lang": "ko", "desc": "한국어 번역 • 1.22M 문장"},
    {"code": "ne", "name": "Nepali", "native": "नेपाली", "flag": "🇳🇵", "lang": "ne", "desc": "नेपाली अनुवाद • 1.22M वाक्य"},
    {"code": "be", "name": "Bengali", "native": "বাংলা", "flag": "🇧🇩", "lang": "bn", "desc": "বাংলা অনুবাদ • 1.27M বাক্য"},
]

QUICK_CITATION_MAP = """| Collection | Mūla `book_code` | Aṭṭhakathā | Ṭīkā | Scope |
| :--- | :--- | :--- | :--- | :--- |
| **Dīgha Nikāya (DN 1–13)** | `s0101m.mul` | `s0101a.att` | `s0101t.tik` | Sīlakkhandhavagga |
| **Dīgha Nikāya (DN 14–23)** | `s0102m.mul` | `s0102a.att` | `s0102t.tik` | Mahāvagga (incl. DN 22 Mahāsatipaṭṭhāna) |
| **Dīgha Nikāya (DN 24–34)** | `s0103m.mul` | `s0103a.att` | `s0103t.tik` | Pāthikavagga |
| **Majjhima Nikāya (MN 1–50)** | `s0201m.mul` | `s0201a.att` | `s0201t.tik` | Mūlapaṇṇāsa (incl. MN 10, MN 18) |
| **Majjhima Nikāya (MN 51–100)** | `s0202m.mul` | `s0202a.att` | `s0202t.tik` | Majjhimapaṇṇāsa |
| **Majjhima Nikāya (MN 101–152)** | `s0203m.mul` | `s0203a.att` | `s0203t.tik` | Uparipaṇṇāsa (incl. MN 118 Ānāpānasati) |
| **Saṃyutta Nikāya (SN 1–11)** | `s0301m.mul` | `s0301a.att` | `s0301t.tik` | Sagāthāvagga |
| **Saṃyutta Nikāya (SN 12–21)** | `s0302m.mul` | `s0302a.att` | `s0302t.tik` | Nidānavagga (Paṭiccasamuppāda) |
| **Saṃyutta Nikāya (SN 22–34)** | `s0303m.mul` | `s0303a.att` | `s0303t.tik` | Khandhavagga |
| **Saṃyutta Nikāya (SN 35–44)** | `s0304m.mul` | `s0304a.att` | `s0304t.tik` | Saḷāyatanavagga |
| **Saṃyutta Nikāya (SN 45–56)** | `s0305m.mul` | `s0305a.att` | `s0305t.tik` | Mahāvagga (incl. SN 56.11 Dhammacakka) |
| **Aṅguttara Nikāya (AN 1–11)** | `s0401m.mul`, `s0402m1..3.mul`, `s0403m1..3.mul`, `s0404m1..4.mul` | `s0401a..04a.att` | `s0401t..04t.tik` | Ekaka through Ekādasaka Nipāta |
| **Khuddaka Nikāya (Key Texts)** | `s0501m.mul` (Kp), `s0502m.mul` (Dhp), `s0503m.mul` (Ud), `s0504m.mul` (Iti), `s0505m.mul` (Snp), `s0508m.mul` (Thag), `s0509m.mul` (Thig) | `s0501a..09a.att` | — | Short discourses & verse collections |
| **Vinaya Piṭaka** | `vin01m.mul` (Pārājika), `vin02m1.mul` (Pācittiya), `vin02m2.mul` (Mahāvagga), `vin02m3.mul` (Cūḷavagga), `vin02m4.mul` (Parivāra) | `vin01a..02a4.att` | `vin01t1..t2.tik`, `vin02t.tik` | Monastic discipline & rules |
| **Abhidhamma Piṭaka** | `abh01m.mul` (Dhs), `abh02m.mul` (Vibh), `abh03m1.mul` (Dhk), `abh03m2.mul` (Pp), `abh03m3.mul` (Kv), `abh03m4..6.mul` (Yam), `abh03m7..11.mul` (Paṭṭh) | `abh01a..03a.att` | `abh01t..03t.tik` | Higher doctrine & conditional relations |
| **Visuddhimagga & Manuals** | `e0101n.mul`, `e0102n.mul` (Vism), `abh07t.nrf` (Abhidhammatthasaṅgaha), `s0518m.nrf` (Milindapañha) | `e0103n.att`, `e0104n.att` (Vism-mhṭ) | — | Classical Theravāda treatises |"""


def find_paths():
    script_dir = Path(__file__).resolve().parent
    root_dir = script_dir.parent if (script_dir / 'server_api').exists() else script_dir
    web_app_dir = script_dir if (script_dir / 'package.json').exists() else root_dir / 'web_app_next'

    db_candidates = [
        web_app_dir / 'server_api' / 'db' / 'tipitaka.db',
        web_app_dir / 'server_api' / 'tipitaka.db',
        root_dir / 'tipitaka.db',
        root_dir / 'tipitaka_latin2.db',
    ]

    db_path = None
    for cand in db_candidates:
        if cand.exists():
            db_path = cand
            break

    bold_db_path = web_app_dir / 'server_api' / 'db' / 'bold_definitions.db'
    catalog_path = web_app_dir / 'server_api' / 'cst_books_catalog.json'
    public_dir = web_app_dir / 'public'
    dist_dir = web_app_dir / 'cloudflare_pages_dist'
    next_git_dir = web_app_dir / 'next_tipitakapali.org'

    return {
        'root_dir': root_dir,
        'web_app_dir': web_app_dir,
        'db_path': db_path,
        'db_dir': db_path.parent if db_path else (web_app_dir / 'server_api' / 'db'),
        'bold_db_path': bold_db_path if bold_db_path.exists() else None,
        'catalog_path': catalog_path,
        'public_dir': public_dir,
        'dist_dir': dist_dir,
        'next_git_dir': next_git_dir,
    }


def get_bold_definitions_count(bold_db_path):
    """Read live row count from bold_definitions.db if available."""
    if not bold_db_path or not Path(bold_db_path).exists():
        return 387006
    try:
        conn = sqlite3.connect(str(bold_db_path))
        row = conn.execute("SELECT COUNT(*) FROM bold_definitions").fetchone()
        conn.close()
        return int(row[0]) if row and row[0] else 387006
    except Exception:
        return 387006


def _book_priority(book_dict):
    clean_code = book_dict['code']
    cat = str(book_dict.get('category') or '').lower()
    if clean_code.endswith('.mul') or 'mūla' in cat or 'mula' in cat:
        return "0.9"
    if clean_code.endswith('.att') or 'aṭṭha' in cat or 'attha' in cat:
        return "0.8"
    return "0.75"


def _chapter_priority(book_dict):
    clean_code = book_dict['code']
    if clean_code.endswith('.mul'):
        return "0.7"
    if clean_code.endswith('.att'):
        return "0.65"
    return "0.6"


def _render_urlset_xml(entries, now_iso):
    """Render a standards-compliant UTF-8 XML <urlset> cleanly and quickly."""
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for loc, changefreq, priority in entries:
        lines.append("  <url>")
        lines.append(f"    <loc>{xml_escape(loc)}</loc>")
        lines.append(f"    <lastmod>{now_iso}</lastmod>")
        lines.append(f"    <changefreq>{changefreq}</changefreq>")
        lines.append(f"    <priority>{priority}</priority>")
        lines.append("  </url>")
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def _render_sitemapindex_xml(child_filenames, site_url, now_iso):
    """Render a standards-compliant UTF-8 XML <sitemapindex>."""
    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for fname in child_filenames:
        loc = f"{site_url}/{fname}"
        lines.append("  <sitemap>")
        lines.append(f"    <loc>{xml_escape(loc)}</loc>")
        lines.append(f"    <lastmod>{now_iso}</lastmod>")
        lines.append("  </sitemap>")
    lines.append("</sitemapindex>")
    return "\n".join(lines) + "\n"


def _load_translation_coverage(db_dir: Path, lang_code: str):
    """
    Query translation_{lang}.db for distinct (book_code, chapter_index) pairs
    that actually contain translated paragraphs. Returns {book_code: set(chapter_index)}
    or None if the translation DB is not present on disk.
    """
    if not db_dir:
        return None
    db_file = Path(db_dir) / f"translation_{lang_code}.db"
    if not db_file.exists():
        return None
    coverage = {}
    conn = sqlite3.connect(str(db_file))
    try:
        for bcode, ch_idx in conn.execute(
            "SELECT DISTINCT book_code, chapter_index FROM paragraph_translations "
            "ORDER BY book_code, chapter_index"
        ):
            coverage.setdefault(bcode, set()).add(int(ch_idx))
    finally:
        conn.close()
    return coverage


def generate_all_sitemaps(books, chapters, site_url, db_dir=None):
    """
    Generate the complete VPS SSR XML Sitemap Index and all 40 child sitemaps:
      - sitemap.xml               : XML Sitemap Index referencing all 40 child sitemaps
      - sitemap-main.xml          : 5 static pages + 217 Roman books + 2,695 Roman chapters
      - sitemap-{script}.xml      : 16 Pāḷi script sitemaps (/book/{script}.{code} + chapters)
      - sitemap-lang-{lang}.xml   : 23 translation sitemaps (/translation/{lang}/{code} + present chapters)
    Each child sitemap contains <= 2,917 URLs (strictly within the 50,000-URL / 50 MB spec).
    """
    site_url = site_url.rstrip('/')
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    chapters_by_book = {}
    for ch in chapters:
        chapters_by_book.setdefault(ch['book_code'], []).append(int(ch['chapter_index']))
    for bcode in chapters_by_book:
        chapters_by_book[bcode] = sorted(set(chapters_by_book[bcode]))

    sitemaps = {}
    child_order = []

    # 1. sitemap-main.xml (5 site pages + 217 Roman books + 2,695 Roman chapters)
    main_entries = [
        (f"{site_url}/", "weekly", "1.0"),
        (f"{site_url}/info", "monthly", "0.85"),
        (f"{site_url}/pali-script-converter", "monthly", "0.85"),
        (f"{site_url}/privacy_policy.html", "yearly", "0.3"),
        (f"{site_url}/terms_of_service.html", "yearly", "0.3"),
    ]
    for b in books:
        code = b['code']
        main_entries.append((f"{site_url}/book/{code}", "monthly", _book_priority(b)))
        ch_prio = _chapter_priority(b)
        for ch_idx in chapters_by_book.get(code, []):
            main_entries.append((f"{site_url}/book/{code}/{ch_idx + 1}", "monthly", ch_prio))

    sitemaps['sitemap-main.xml'] = _render_urlset_xml(main_entries, now_iso)
    child_order.append('sitemap-main.xml')

    # 2. sitemap-{script}.xml (16 non-Roman Pāḷi scripts: books + chapters)
    for sc in PALI_SCRIPTS:
        sc_code = sc['code']
        sc_entries = []
        for b in books:
            code = b['code']
            sc_entries.append((f"{site_url}/book/{sc_code}.{code}", "monthly", _book_priority(b)))
            ch_prio = _chapter_priority(b)
            for ch_idx in chapters_by_book.get(code, []):
                sc_entries.append((f"{site_url}/book/{sc_code}.{code}/{ch_idx + 1}", "monthly", ch_prio))
        fname = f"sitemap-{sc_code}.xml"
        sitemaps[fname] = _render_urlset_xml(sc_entries, now_iso)
        child_order.append(fname)

    # 3. sitemap-lang-{lang}.xml (23 modern translations: /translation/{lang}/{code} + chapters present in DB)
    for t in TRANSLATION_LANGUAGES:
        lang_code = t['code']
        coverage = _load_translation_coverage(db_dir, lang_code)
        lang_entries = []
        for b in books:
            code = b['code']
            valid_chaps = chapters_by_book.get(code, [])
            if coverage is not None:
                if code not in coverage:
                    continue
                present_chaps = [ci for ci in valid_chaps if ci in coverage[code]]
            else:
                present_chaps = valid_chaps

            lang_entries.append((f"{site_url}/translation/{lang_code}/{code}", "monthly", _book_priority(b)))
            ch_prio = _chapter_priority(b)
            for ch_idx in present_chaps:
                lang_entries.append((f"{site_url}/translation/{lang_code}/{code}/{ch_idx + 1}", "monthly", ch_prio))

        fname = f"sitemap-lang-{lang_code}.xml"
        sitemaps[fname] = _render_urlset_xml(lang_entries, now_iso)
        child_order.append(fname)

    # 4. Root XML Sitemap Index (sitemap.xml)
    sitemaps['sitemap.xml'] = _render_sitemapindex_xml(child_order, site_url, now_iso)
    return sitemaps


def generate_sitemap_xml(books, chapters, site_url, db_dir=None):
    """Backward-compatibility alias returning the root sitemap.xml index."""
    return generate_all_sitemaps(books, chapters, site_url, db_dir=db_dir)['sitemap.xml']


def cleanup_obsolete_sitemaps(target_dir: Path, keep_files=None):
    """Remove stale sitemap-*.xml files (e.g. legacy sitemap-translations.xml) not in keep_files."""
    if not target_dir or not target_dir.exists():
        return 0
    keep = set(keep_files) if keep_files is not None else {
        "sitemap.xml",
        "sitemap-main.xml",
        *(f"sitemap-{sc['code']}.xml" for sc in PALI_SCRIPTS),
        *(f"sitemap-lang-{t['code']}.xml" for t in TRANSLATION_LANGUAGES),
    }
    removed = 0
    for fpath in target_dir.glob("sitemap-*.xml"):
        if fpath.name not in keep:
            try:
                fpath.unlink()
                removed += 1
            except OSError:
                pass
    return removed


def sync_indexnow_key(public_dir: Path, target_dir: Path):
    """Copy the 32-hex IndexNow verification key file from public/ to target_dir."""
    if not public_dir or not target_dir or public_dir == target_dir or not public_dir.exists() or not target_dir.exists():
        return None
    for p in sorted(public_dir.iterdir()):
        if p.is_file() and INDEXNOW_KEY_RE.match(p.name):
            dst = target_dir / p.name
            dst.write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
            return p.name
    return None


def generate_robots_txt(site_url):
    """Generate SEO and AI-crawler-friendly robots.txt with single canonical sitemap."""
    api_url = "https://api.tipitakapali.org"

    return f"""# robots.txt for Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (VRI)
# =========================================================

# 1. General Search Engine Crawlers (Google, Bing, Yandex, Baidu, DuckDuckGo)
User-agent: Googlebot
User-agent: Bingbot
User-agent: Slurp
User-agent: DuckDuckBot
User-agent: Baiduspider
User-agent: YandexBot
User-agent: Sogou
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /
Allow: /_next/
Allow: /api/
Allow: /book/
Allow: /translation/
Disallow: /api/search*

# 2. Leading AI Crawlers, Search Agents & LLM Scrapers — explicitly allow AI & Dict tools
User-agent: GPTBot
User-agent: ChatGPT-User
User-agent: OAI-SearchBot
User-agent: ClaudeBot
User-agent: Claude-Web
User-agent: PerplexityBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: Amazonbot
User-agent: Bytespider
User-agent: CCBot
User-agent: Diffbot
User-agent: FacebookBot
User-agent: cohere-ai
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /api/
Allow: /api/ai/
Allow: /api/dict/
Allow: /api/links/
Allow: /book/
Allow: /translation/

# 3. Default for all other user agents
User-agent: *
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /
Allow: /_next/
Allow: /api/
Allow: /api/ai/
Allow: /api/dict/
Allow: /api/links/
Allow: /book/
Allow: /translation/
Disallow: /api/search*

# 4. Canonical Sitemap & AI Discovery Entry Points
Sitemap: {site_url}/sitemap.xml
Agentmap: {site_url}/.well-known/ai-catalog.json
Host: {site_url.replace('https://', '').replace('http://', '')}

# AI Tool Quick Reference (Direct VPS, CORS *, no auth)
# Bold Definitions (387K+ canonical/commentary glosses): {api_url}/api/ai/bold_definitions?w=mett%C4%81&langs=en
# Concept-Group Search (multi-concept boolean FTS5):     POST {api_url}/api/ai/search_concepts
# Digital Pāḷi Dictionary (DPD primary):                 {api_url}/api/dict/lookup?w=mett%C4%81&dict=dpd
# Sentence-Aligned Pāḷi + Translations:                  {api_url}/api/ai/sentences?book=s0101m.mul&chapter=0&para_index=5&langs=en
# OpenAPI Specification:                                 {site_url}/openapi.json
# AI Agent Instructions:                                 {site_url}/llms.txt
"""


def generate_llms_txt(site_url, books_count, chapters_count, bold_def_count=387006):
    """Generate /llms.txt adhering to the llmstxt.org standard with high-signal AI research workflows."""
    api_url = "https://api.tipitakapali.org"

    script_rows = []
    for sc in PALI_SCRIPTS:
        script_rows.append(f"- `{sc['code']}`: **{sc['name']}** ({sc['native']}) → `{site_url}/book/{sc['code']}.s0101m.mul`")
    scripts_list_str = "\n".join(script_rows)

    trans_rows = []
    for t in TRANSLATION_LANGUAGES:
        trans_rows.append(f"- `{t['code']}`: **{t['name']}** ({t['native']}) {t['flag']} → `{site_url}/translation/{t['code']}/s0101m.mul` ({t['desc']})")
    translations_list_str = "\n".join(trans_rows)

    return f"""# Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (TipitakaPali.org)
> Complete Sixth Buddhist Council (VRI / CSCD) Theravāda Pāḷi Canon — {books_count} books (Mūla, Aṭṭhakathā, Ṭīkā, Añña), {chapters_count:,} chapters, 520,000+ paragraphs, 1.2M aligned Pāḷi sentences, {bold_def_count:,} pre-indexed canonical bold definitions, Digital Pāḷi Dictionary (DPD), 17 scripts, and {len(TRANSLATION_LANGUAGES)} modern translations (24 layers including Pāḷi). Zero-auth open REST & static JSON APIs (`CORS *`).

## Fastest AI Research & Citation Playbook (Start Here)
> Direct VPS API base (fastest, no proxy hop, no auth, `CORS *`): `{api_url}`

### 1. Defining Any Pāḷi / Buddhist Term → Use Canonical Bold Definitions + DPD First
In the Chaṭṭha Saṅgāyana Tipiṭaka (Aṭṭhakathā, Ṭīkā, Visuddhimagga, Abhidhammatthasaṅgaha, and Mūla), classical commentators mark every defined headword in **bold** (`<span class="bld">term</span>`, followed by *ti attho*, *nāma*, *vuccati*, *lakkhaṇaṃ*). TipitakaPali.org pre-indexes **{bold_def_count:,} bold definitions** with aligned translations and exact sentence citations:
- **Canonical Bold Definitions (Ranked AI Endpoint — Recommended):**
  - `GET {api_url}/api/ai/bold_definitions?w=mett%C4%81&langs=en&limit=8` (also accepts `word=`, `term=`, `q=`; `langs` accepts comma-separated codes e.g. `en,vi`)
  - Returns `{{word, count, definitions: [{{word, book_code, book_title, category, chapter_index, para_index, para_num, line_id, citation_ref, citation_url, pali_definition, translations}}]}}` — pre-scored so authoritative definitional glosses (*ti attho*, *nāma*, *vuccati*, Aṭṭhakathā/Visuddhimagga) appear first with Markdown `**bold**` highlights and ready-to-cite `[book:cX:pY-LZ]` + clickable URLs.
- **Batch Bold Definitions (Multiple Terms in 1 Call):**
  - `POST {api_url}/api/ai/bold_definitions_batch` → JSON body `{{"words": ["sati", "samādhi", "paññā"], "langs": ["en"], "limit": 4}}` (also accepts `"terms"`).
- **Dictionary-Format Bold Definitions:**
  - `GET {api_url}/api/dict/lookup?w=mett%C4%81&dict=bold_def&langs=en`
- **Digital Pāḷi Dictionary (DPD 90,000+ entries — Grammar, Roots, Inflections, Compound Splitter):**
  - Primary DPD: `GET {api_url}/api/dict/lookup?w=mett%C4%81&dict=dpd` (add `&d=yes` for sandhi/compound splitter)
  - Secondary Dictionaries (PTS PED 2015, Pāḷi–Myanmar Abhidhān, Pāḷi–Sinhala, Sanskrit, Splitter): `GET {api_url}/api/dict/lookup?w=mett%C4%81&dict=others`
  - Inflection Table: `GET {api_url}/api/dict/inf?w=declension_mett%C4%81_1`
  - Input note: `w` accepts Roman IAST, Velthuis (`aa ii uu .m .t ~n`), or Myanmar/Sinhala/Devanagari/Thai scripts; `ṁ→ṃ` normalized automatically.

### 2. Multi-Concept Research Questions → Concept-Group Search (Boolean Intersection)
For questions combining 2+ concepts (e.g., *"mindfulness of breathing leading to liberation"*), decompose the question into **2–4 independent Concept Groups**, each with Pāḷi terms/stems AND English synonyms, and call:
- **Concept-Group Search (Tiered AND-across-groups / OR-within-synonyms FTS5):**
  - `POST {api_url}/api/ai/search_concepts`
  - JSON body:
    `{{"concept_groups": [{{"concept": "Mindfulness", "pali_terms": ["sati", "satipaṭṭhāna"], "pali_stems": ["sati"], "english_keywords": ["mindfulness", "awareness"]}}, {{"concept": "Breathing", "pali_terms": ["ānāpāna", "assāsa", "passāsa"], "english_keywords": ["breath", "breathing"]}}], "langs": ["en"], "limit": 12}}`
  - Searches Pāḷi + English/user-language FTS5 indexes with automatic Tier 1 (all groups) → Tier 2 (pairwise) → Tier 3 (single-group) fallback, ranked by concept coverage and Mūla priority.
- **Query Understanding & Canonical Sutta Grounding (Local, Zero-Auth):**
  - `POST {api_url}/api/ai/understand` → `{{"query": "What does DN 22 teach about vedanā?"}}` → returns detected language, concept groups, canonical Pāḷi terms, and resolved `book_code`s.
- **Sutta / Section Title Search:**
  - `GET {api_url}/api/ai/sections?q=satipatthana&limit=10`
- **Full-Text Search (FTS5 across 520,000+ Pāḷi paragraphs & translation indexes):**
  - `GET {api_url}/api/search?q=anatta&l=pali&pitaka=sutta&mat=mula&distance=5&sort=canonical&limit=20`
  - Params: `l` (`pali` or any of the {len(TRANSLATION_LANGUAGES)} translation codes e.g. `en`, `vi`, `my`), `pitaka` (`all|vinaya|sutta|abhidhamma|anna`), `mat` (`all|mula|attha|tika`), `distance` (`1`=exact phrase, `2..10`=NEAR, `0`=anywhere in paragraph), `sort` (`canonical|relevance|bm25`).

### 3. Verifying Exact Passages, Sentence Translations & Commentaries (Zero-Hallucination Grounding)
- **Exact Paragraph Range + Aligned Translations:**
  - `GET {api_url}/api/ai/paragraph_content?book=s0102m.mul&chapter=8&start=1341&end=1345&langs=en` (or by printed VRI paragraph number: `&para_num=373`)
  - Batch: `POST {api_url}/api/ai/paragraph_content_batch` → `{{"ranges": [{{"book_code": "s0102m.mul", "chapter_index": 8, "para_start": 1341, "para_end": 1345}}], "langs": ["en"]}}`
- **Sentence-Level Pāḷi ↔ Translation Alignment (1.2M sentences, shared `line_id`, 99.7% 1:1 match):**
  - `GET {api_url}/api/ai/sentences?book=s0101m.mul&chapter=0&para_index=5&langs=en,vi`
  - Returns exact 1-based `line_id` pairs for sentence-level citations `[book:cX:pY-LZ]`.
- **Parallel Aṭṭhakathā & Ṭīkā Commentaries for Any Mūla Paragraph:**
  - `GET {api_url}/api/ai/commentaries?book=s0101m.mul&chapter=0&para=1`
- **Linked Definition / Cross-Reference Preview (Mūla ↔ Aṭṭhakathā ↔ Ṭīkā):**
  - `GET {api_url}/api/links/preview?book=s0101m.mul&para=1&langs=en`
- **Unified AI Tool Dispatcher (Supports All Tools via Single Endpoint):**
  - `POST {api_url}/api/ai/tool-call` → `{{"tool": "get_bold_definitions", "args": {{"word": "sati", "langs": ["en"], "limit": 6}}}}`
  - Full tool list: `GET {api_url}/api/ai/tools`

## Verifiable Citation Format & Deep-Link URLs
Always ground every claim with exact canonical coordinates so users can click straight to the source paragraph or sentence:
- **Bracket Citation Syntax:**
  - Paragraph: `[book_code:c{{0_based_chapter}}:p{{para_index}}]` (e.g. `[s0102m.mul:c8:p1343]`)
  - Sentence (Preferred for precision): `[book_code:c{{0_based_chapter}}:p{{para_index}}-L{{1_based_line_id}}]` (e.g. `[s0101m.mul:c0:p5-L1]`)
- **Clickable Canonical Web URLs:**
  - Book (Roman Pāḷi canonical): `{site_url}/book/{{book_code}}`
  - Chapter + Exact Paragraph Index: `{site_url}/book/{{book_code}}/{{1_based_chapter}}#pindex-{{para_index}}`
  - Chapter + Printed Para Number: `{site_url}/book/{{book_code}}/{{1_based_chapter}}#para-{{para_num}}`
  - Modern Translation Book (canonical SSR): `{site_url}/translation/{{lang_code}}/{{book_code}}` (e.g. `{site_url}/translation/en/s0102m.mul`, `{site_url}/translation/vi/s0102m.mul`)
  - Modern Translation Chapter (canonical SSR): `{site_url}/translation/{{lang_code}}/{{book_code}}/{{1_based_chapter}}` (legacy `?l={{lang_code}}` also supported & canonicalized)
  - Alternative Pāḷi Script (16 non-Roman scripts, canonical SSR): `{site_url}/book/{{script_code}}.{{book_code}}` and `{site_url}/book/{{script_code}}.{{book_code}}/{{1_based_chapter}}`

### Quick Nikāya / Piṭaka → `book_code` Citation Map
{QUICK_CITATION_MAP}

## Public Static Edge JSON APIs (0ms Cloudflare CDN)
- Navigation Tree: `GET {site_url}/api/tree`
- 217-Book Catalog: `GET {site_url}/api/books`
- Book Details, TOC & Initial Chapters: `GET {site_url}/api/book/{{book_code}}`
- Chapter HTML: `GET {site_url}/api/book/{{book_code}}/chapter/{{0_based_chapter_index}}`
- Book Table of Contents: `GET {site_url}/api/book/{{book_code}}/toc`
- Mūla–Aṭṭhakathā–Ṭīkā Matrix: `GET {site_url}/api/mat` and `GET {site_url}/api/mat/chapter_map`
- Pāḷi Sentences (shared `line_id`): `GET {site_url}/api/book/{{book_code}}/pali_sentences`
- Translation Sentences (static): `GET {site_url}/api/book/{{book_code}}/translation/{{lang}}.sentences.json`

## Key Links & Machine Discovery
- [Home & Tipiṭaka Reader]({site_url}/)
- [About, Features & User Guide]({site_url}/info)
- [Pāḷi Script Converter (17 scripts, Velthuis)]({site_url}/pali-script-converter)
- [Full 217-Book Catalog & Complete API Docs]({site_url}/llms-full.txt)
- [Canonical XML Sitemap]({site_url}/sitemap.xml)
- [OpenAPI 3.1 Specification]({site_url}/openapi.json)
- [MCP Server Card]({site_url}/.well-known/mcp.json)
- [AI Plugin Manifest]({site_url}/.well-known/ai-plugin.json)
- [A2A Agent Card]({site_url}/.well-known/agent-card.json)

### Supported {len(TRANSLATION_LANGUAGES)} Modern Translations (+ Pāḷi = 24 Layers)
{translations_list_str}

### Supported 16 Alternative Pāḷi Scripts (+ Roman Default = 17 Scripts)
{scripts_list_str}
"""


def generate_llms_full_txt(site_url, books, catalog, bold_def_count=387006):
    """Generate comprehensive /llms-full.txt with AI playbook, full 217-book catalog + MAT cross-links, and complete REST API docs."""
    api_url = "https://api.tipitakapali.org"

    script_table_rows = [
        "| Script Code | Script Name | Native | Sample Book URL | Sample Chapter 1 URL |",
        "| :--- | :--- | :--- | :--- | :--- |",
        f"| *(default)* | Roman / Latin (IAST) | Roman | `{site_url}/book/s0101m.mul` | `{site_url}/book/s0101m.mul/1` |",
    ]
    for sc in PALI_SCRIPTS:
        script_table_rows.append(
            f"| `{sc['code']}` | {sc['name']} | {sc['native']} | `{site_url}/book/{sc['code']}.s0101m.mul` | `{site_url}/book/{sc['code']}.s0101m.mul/1` |"
        )

    trans_table_rows = [
        "| Language Code | Language Name | Native | Flag | Coverage / Sentences | Canonical Translation Book URL | Sample Chapter URL |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for t in TRANSLATION_LANGUAGES:
        trans_table_rows.append(
            f"| `{t['code']}` | {t['name']} | {t['native']} | {t['flag']} | {t['desc']} | `{site_url}/translation/{t['code']}/s0101m.mul` | `{site_url}/translation/{t['code']}/s0101m.mul/1` |"
        )

    lines = [
        "# Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi — Complete AI Research Reference, 217-Book Catalog & API Docs",
        f"> Website: {site_url}",
        f"> Direct AI & Search API (CORS *, no auth): {api_url}",
        f"> Corpus: {len(books)} canonical books (Mūla, Aṭṭhakathā, Ṭīkā, Añña) • 520,000+ paragraphs • 1.2M aligned Pāḷi sentences • {bold_def_count:,} pre-indexed canonical bold definitions • {len(TRANSLATION_LANGUAGES)} modern translations • 17 Pāḷi scripts.",
        "",
        "## Recommended AI Agent Workflow for Maximum Accuracy & Citation Grounding",
        "1. **For term / doctrinal / Vinaya / Abhidhamma definitions:** Call `GET https://api.tipitakapali.org/api/ai/bold_definitions?w={term}&langs=en&limit=8` (queries " + f"{bold_def_count:,}" + " pre-indexed commentarial & canonical bold glosses with `*ti attho*`, `*nāma*`, `*vuccati*` ranking and exact `[book:cX:pY-LZ]` citations) in parallel with `GET https://api.tipitakapali.org/api/dict/lookup?w={term}&dict=dpd` (DPD grammar, roots & compound splitter).",
        "2. **For multi-concept research questions:** Break the question into 2–4 Concept Groups (each with Pāḷi terms/stems AND English synonyms) and POST to `https://api.tipitakapali.org/api/ai/search_concepts` for tiered boolean-intersection search across Pāḷi and translation FTS5 indexes.",
        "3. **For exact textual grounding & verification:** Fetch complete paragraphs (`GET /api/ai/paragraph_content`), sentence-aligned Pāḷi + translations (`GET /api/ai/sentences`, 99.7% 1:1 `line_id` match), and parallel Aṭṭhakathā/Ṭīkā commentaries (`GET /api/ai/commentaries`).",
        "4. **For clickable citations:** Emit `[book_code:c{0_based_chapter}:p{para_index}-L{line_id}]` and/or link to " + f"`{site_url}/book/{{book_code}}/{{1_based_chapter}}#pindex-{{para_index}}` (or `{site_url}/translation/{{lang_code}}/{{book_code}}/{{1_based_chapter}}#pindex-{{para_index}}` for canonical modern translations; legacy `?l={{lang_code}}` also works).",
        "",
        "## Quick Nikāya / Piṭaka → `book_code` Citation Map",
        QUICK_CITATION_MAP,
        "",
        "## Complete REST & AI Tool API Reference",
        "",
        f"### 1. Canonical Bold Definitions ({bold_def_count:,} Pre-Indexed Glosses) — Primary Term Definition API",
        f"- Single term (ranked): `GET {api_url}/api/ai/bold_definitions?w={{pali_term}}&langs=en&limit=8`",
        f"  - Also accepts query params `word=`, `term=`, `q=`; `langs` accepts comma-separated language codes (e.g. `en,vi`).",
        f"  - Example: `GET {api_url}/api/ai/bold_definitions?w=satipa%E1%B9%AD%E1%B9%ADh%C4%81na&langs=en&limit=6`",
        f"  - Returns: `{{success, word, search_prefix, count, definitions: [{{word, book_code, book_title, category, chapter_index, para_index, para_num, line_id, citation_ref, citation_url, pali_definition, context_before, context_after, translations}}]}}`",
        f"- Batch terms: `POST {api_url}/api/ai/bold_definitions_batch`",
        "  - Body: `{\"words\": [\"sati\", \"samādhi\", \"paññā\"], \"langs\": [\"en\"], \"limit\": 4}` (also accepts `\"terms\"`).",
        f"- Dictionary-compatible endpoint: `GET {api_url}/api/dict/lookup?w={{pali_term}}&dict=bold_def&langs=en`",
        "- Why Bold Definitions matter: Classical Theravāda commentaries (Buddhaghosa, Dhammapāla, etc.) wrap every exact lemma under explanation in **bold**. Pre-indexing all 387,006 bold occurrences gives AI agents direct, verifiable primary-source definitions instead of relying on parametric memory.",
        "",
        "### 2. Multi-Concept Boolean Search (`search_concepts`) & Query Understanding",
        f"- Concept-Group Search: `POST {api_url}/api/ai/search_concepts`",
        "  - Body: `{\"concept_groups\": [{\"concept\": \"Mindfulness\", \"pali_terms\": [\"sati\", \"satipaṭṭhāna\"], \"pali_stems\": [\"sati\"], \"english_keywords\": [\"mindfulness\", \"awareness\"]}, {\"concept\": \"Breathing\", \"pali_terms\": [\"ānāpāna\", \"assāsa\", \"passāsa\"], \"english_keywords\": [\"breath\", \"breathing\"]}], \"categories\": [], \"nikayas\": [], \"langs\": [\"en\"], \"limit\": 12}`",
        "  - Executes Tier 1 (all concept groups intersected), Tier 2 (pairwise intersections), and Tier 3 (single-group fallback) across Pāḷi and translation FTS5 indexes, ranked by concept coverage and Mūla priority.",
        f"- Local Query Understanding: `POST {api_url}/api/ai/understand` with `{{\"query\": \"...\"}}` → detects language, extracts concept groups, Pāḷi terms/stems, English keywords, and canonical book references.",
        "",
        "### 3. Sutta/Section Discovery, Paragraph Retrieval & Commentaries",
        f"- Search Suttas & Headings: `GET {api_url}/api/ai/sections?q={{query}}&limit=10`",
        f"- Get Section Outline & Summary: `GET {api_url}/api/ai/section?book={{book_code}}&chapter={{0_based_ch}}`",
        f"- Get Exact Paragraph Range + Translations: `GET {api_url}/api/ai/paragraph_content?book={{book_code}}&chapter={{0_based_ch}}&start={{para_index}}&end={{para_index}}&langs=en,vi` (also supports `&para_num={{printed_para}}`)",
        f"- Batch Paragraph Retrieval: `POST {api_url}/api/ai/paragraph_content_batch` with `{{\"ranges\": [{{\"book_code\": \"s0102m.mul\", \"chapter_index\": 8, \"para_start\": 1341, \"para_end\": 1345}}], \"langs\": [\"en\"]}}`",
        f"- Parallel Aṭṭhakathā & Ṭīkā Commentaries: `GET {api_url}/api/ai/commentaries?book={{book_code}}&chapter={{0_based_ch}}&para={{para_num}}`",
        f"- Linked Mūla/Aṭṭhakathā/Ṭīkā Preview: `GET {api_url}/api/links/preview?book={{book_code}}&para={{para_num}}&langs=en`",
        f"- Unified Tool Endpoint & Schema Discovery: `GET {api_url}/api/ai/tools` and `POST {api_url}/api/ai/tool-call` (`{{\"tool\": \"...\", \"args\": {{...}}}}`).",
        "",
        "### 4. Sentence-Level Pāḷi & Translation APIs (Shared `line_id`, 99.7% 1:1 Match)",
        f"- AI Sentence Endpoint: `GET {api_url}/api/ai/sentences?book={{book_code}}&chapter={{0_based_ch}}&para_index={{para_index}}&langs=en,vi`",
        "  - Returns: `{pali_sentences: [{line_id, sentence}], translations: {en: [{line_id, translation}]}}`",
        f"- Book-Level Static Pāḷi Sentences: `GET {site_url}/api/book/{{book_code}}/pali_sentences`",
        f"- Static Translation Sentences: `GET {site_url}/api/book/{{book_code}}/translation/{{lang}}.sentences.json`",
        f"- Live Chapter Translation Sentences: `GET {api_url}/api/book/{{book_code}}/chapter/{{0_based_ch}}/translation?lang={{lang}}&sentences=1`",
        "",
        "### 5. Full-Text Search (FTS5 across Pāḷi & 23 Translations)",
        f"- Endpoint: `GET {api_url}/api/search?q={{query}}&l={{pali|en|vi|...}}&pitaka={{all|vinaya|sutta|abhidhamma|anna}}&mat={{all|mula|attha|tika}}&distance={{1|5|0}}&sort={{canonical|relevance|bm25}}&limit=50`",
        f"- Example: `GET {api_url}/api/search?q=anatta&pitaka=sutta&mat=mula&limit=20`",
        "- Description: Ultra-fast FTS5 across 520,000+ paragraphs plus per-language translation FTS5 indexes. CORS `*`, `Cache-Control: public, max-age=86400`.",
        "",
        "### 6. Pāḷi Dictionary & Inflection Lookup (DPD + 5 Classical Lexicons)",
        f"- Endpoint: `GET {api_url}/api/dict/lookup?w={{pali_word}}&dict={{dpd|others|bold_def|all|pts|abd|psd|sans|splitter}}&d={{yes|no}}`",
        f"- Example DPD (primary): `GET {api_url}/api/dict/lookup?w=mett%C4%81&dict=dpd` → `{{word, counts:{{dpd:2}}, dpd:[{{word,html}}]}}`",
        f"- Example Others (secondary): `GET {api_url}/api/dict/lookup?w=mett%C4%81&dict=others` → `{{counts:{{pts,abd,psd,sans,splitter}}, pts:[], ...}}`",
        f"- Inflection Tables: `GET {api_url}/api/dict/inf?w=declension_{{lemma}}_1` (e.g. `declension_mett%C4%81_1` → `{{word, html}}`)",
        "- Description: DPD (90k+ entries), PTS PED 2015, Tipiṭaka Pāḷi–Myanmar Abhidhān, Pāḷi–Sinhala, Sanskrit (MW/Apte/Edgerton), Compound Splitter, and Bold Definitions. `w` accepts IAST, Velthuis, or Asian scripts (`ṁ→ṃ` normalized). No auth, `GET` preferred, `POST {w,dict}` also supported.",
        "",
        "### 7. Edge Static JSON APIs (0ms CDN)",
        f"- Navigation Tree: `GET {site_url}/api/tree`",
        f"- 217-Book Catalog: `GET {site_url}/api/books`",
        f"- Book Metadata, TOC & Initial Chapters: `GET {site_url}/api/book/{{book_code}}`",
        f"- Chapter HTML: `GET {site_url}/api/book/{{book_code}}/chapter/{{chapter_index}}`",
        f"- MAT Cross-Reference Matrix: `GET {site_url}/api/mat` and `GET {site_url}/api/mat/chapter_map`",
        "",
        "### 8. OpenAPI, MCP & Machine Discovery",
        f"- OpenAPI 3.1: `GET {site_url}/openapi.json`",
        f"- MCP Server Card: `GET {site_url}/.well-known/mcp.json`",
        f"- AI Plugin Manifest: `GET {site_url}/.well-known/ai-plugin.json`",
        f"- A2A Agent Card: `GET {site_url}/.well-known/agent-card.json`",
        f"- Canonical XML Sitemap: `GET {site_url}/sitemap.xml`",
        f"- Human Guide & Help: `{site_url}/info`",
        f"- Offline-Capable Pāḷi Script Converter (17 scripts): `{site_url}/pali-script-converter`",
        "",
        f"## Multilingual Translation Deep-Linking Guide ({len(TRANSLATION_LANGUAGES)} Languages)",
        "Every canonical book and chapter has a dedicated, self-canonical SSR translation URL at `/translation/{lang_code}/{book_code}` and `/translation/{lang_code}/{book_code}/{1_based_chapter}` (legacy `?l={lang_code}` query links remain supported and canonicalize cleanly to `/translation/{lang_code}/...`):",
        "",
        "\n".join(trans_table_rows),
        "",
        "## Multi-Script Deep-Linking Guide (17 Pāḷi Scripts)",
        "Users can open any canonical text directly in their preferred script by prefixing the book code:",
        "",
        "\n".join(script_table_rows),
        "",
        f"## Complete Canonical Books Directory ({len(books)} Books with MAT Cross-Links)",
        "| Book Code | Title | Collection / Path | Category | Chapters | MAT Siblings (M / A / T) | Canonical URL |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ]

    for b in books:
        code = b['code']
        cat_entry = catalog.get(code, {}) if isinstance(catalog, dict) else {}
        nav_parts = [p.strip() for p in str(cat_entry.get('longNavPath') or '').split('/') if p.strip()]
        own_title = nav_parts[-1] if nav_parts else (b['title'] or code)
        parent_path = nav_parts[-2] if len(nav_parts) >= 2 else (b['nikaya'] or '')
        category = b['category'] or cat_entry.get('matn') or ''
        ch_count = b['chapter_count'] or 1
        mat = cat_entry.get('mat') or {}
        sibs = []
        if mat.get('mula_code') and mat['mula_code'] != code:
            sibs.append(f"M:`{mat['mula_code']}`")
        if mat.get('attha_code') and mat['attha_code'] != code:
            sibs.append(f"A:`{mat['attha_code']}`")
        if mat.get('tika_code') and mat['tika_code'] != code:
            sibs.append(f"T:`{mat['tika_code']}`")
        sib_str = ", ".join(sibs) if sibs else "—"
        url = f"{site_url}/book/{code}"
        lines.append(f"| `{code}` | {own_title} | {parent_path} | {category} | {ch_count} | {sib_str} | [{own_title}]({url}) |")

    return "\n".join(lines) + "\n"


def generate_schema_jsonld(site_url, books, catalog=None, bold_def_count=387006):
    """Generate Schema.org JSON-LD structured data for Search Engines and Knowledge Graphs."""
    api_url = "https://api.tipitakapali.org"
    lang_list = sorted(set(
        ["pi", "pi-Latn", "en"]
        + [t["lang"] for t in TRANSLATION_LANGUAGES]
        + [sc["lang"] for sc in PALI_SCRIPTS]
    ))

    datasets = []
    for b in books:
        code = b['code']
        cat_entry = (catalog or {}).get(code, {}) if isinstance(catalog, dict) else {}
        nav_parts = [p.strip() for p in str(cat_entry.get('longNavPath') or '').split('/') if p.strip()]
        own_title = nav_parts[-1] if nav_parts else b['title']
        parent = nav_parts[-2] if len(nav_parts) >= 2 else (b['nikaya'] or 'Buddhism')
        datasets.append({
            "@type": "Dataset",
            "name": f"{own_title} ({parent})" if parent and parent.lower() != own_title.lower() else own_title,
            "identifier": code,
            "inLanguage": "pi",
            "genre": parent,
            "isAccessibleForFree": True,
            "license": "https://creativecommons.org/licenses/by-nc-sa/3.0/",
            "url": f"{site_url}/book/{code}",
        })

    schema = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": f"{site_url}/#organization",
                "name": "TipitakaPali.org",
                "url": f"{site_url}/",
                "logo": f"{site_url}/android-chrome-512x512.png",
                "sameAs": [
                    "https://github.com/tipitakapali/tipitakapali.org",
                    "https://apps.apple.com/vn/app/tipitaka-pali-cst/id6743404213",
                    "https://play.google.com/store/apps/details?id=org.tipitakapali.android",
                ],
            },
            {
                "@type": "WebSite",
                "@id": f"{site_url}/#website",
                "url": f"{site_url}/",
                "name": "Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi",
                "alternateName": ["Tipitaka Pali", "TipitakaPali.org", "CSCD Pali Canon", "VRI Tipitaka"],
                "description": f"Complete {len(books)}-book Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon in 17 scripts with {len(TRANSLATION_LANGUAGES)} modern translations, Digital Pāḷi Dictionary (DPD), {bold_def_count:,} bold definitions, and high-speed full-text search.",
                "inLanguage": lang_list,
                "publisher": {"@id": f"{site_url}/#organization"},
                "potentialAction": [
                    {
                        "@type": "SearchAction",
                        "target": {
                            "@type": "EntryPoint",
                            "urlTemplate": f"{site_url}/?q={{search_term_string}}"
                        },
                        "query-input": "required name=search_term_string"
                    },
                    {
                        "@type": "SearchAction",
                        "target": {
                            "@type": "EntryPoint",
                            "urlTemplate": f"{api_url}/api/dict/lookup?w={{search_term_string}}&dict=dpd"
                        },
                        "query-input": "required name=search_term_string"
                    }
                ]
            },
            {
                "@type": "DataCatalog",
                "@id": f"{site_url}/#catalog",
                "name": "Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canonical Corpus",
                "description": f"{len(books)} canonical books (Mūla, Aṭṭhakathā, Ṭīkā, Añña) of the Theravāda Pāḷi Canon with {len(TRANSLATION_LANGUAGES)} modern translations, 17 scripts, and {bold_def_count:,} bold definitions.",
                "url": f"{site_url}/",
                "isAccessibleForFree": True,
                "license": "https://creativecommons.org/licenses/by-nc-sa/3.0/",
                "publisher": {"@id": f"{site_url}/#organization"},
                "dataset": datasets,
            }
        ]
    }
    return json.dumps(schema, indent=2, ensure_ascii=False)


def main():
    parser = argparse.ArgumentParser(description="Generate SEO and AI metadata files for Tipitaka web app")
    parser.add_argument(
        "--site-url",
        default=os.environ.get("SITE_URL", DEFAULT_SITE_URL),
        help=f"Canonical website URL (default: {DEFAULT_SITE_URL})"
    )
    parser.add_argument(
        "--public-only",
        action="store_true",
        help="Write only to public/ (skip cloudflare_pages_dist and next_tipitakapali.org)"
    )
    args = parser.parse_args()

    paths = find_paths()
    db_path = paths['db_path']
    if not db_path or not db_path.exists():
        print(f"[!] Error: SQLite database not found at {db_path}")
        sys.exit(1)

    site_url = args.site_url.rstrip('/')
    print(f"[*] Generating SEO & AI metadata for: {site_url}")
    print(f"[*] Connecting to database: {db_path}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id")
    books = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT book_code, chapter_index, title FROM chapters ORDER BY book_code, chapter_index")
    chapters = [dict(r) for r in cur.fetchall()]
    conn.close()

    bold_def_count = get_bold_definitions_count(paths.get('bold_db_path'))

    catalog = {}
    if paths['catalog_path'].exists():
        try:
            with open(paths['catalog_path'], 'r', encoding='utf-8') as f:
                catalog = json.load(f)
        except Exception:
            pass

    print(f"[*] Loaded {len(books)} books, {len(chapters)} chapters, and {bold_def_count:,} bold definitions.")

    # 1. Generate full multi-script & multi-translation XML Sitemap Index (40 child sitemaps)
    print("[*] Generating XML Sitemap Index + 40 child sitemaps (17 Pāḷi scripts + 23 translations)...")
    sitemaps = generate_all_sitemaps(books, chapters, site_url, db_dir=paths.get('db_dir'))

    # 2. Generate robots.txt, llms.txt, llms-full.txt, site.jsonld
    print("[*] Generating robots.txt...")
    robots_content = generate_robots_txt(site_url)

    print("[*] Generating llms.txt (AI Agent Playbook & Bold Definitions)...")
    llms_content = generate_llms_txt(site_url, len(books), len(chapters), bold_def_count)

    print("[*] Generating llms-full.txt (Comprehensive AI Corpus & 217-Book Catalog)...")
    llms_full_content = generate_llms_full_txt(site_url, books, catalog, bold_def_count)

    print("[*] Generating site.jsonld (Schema.org Structured Data)...")
    jsonld_content = generate_schema_jsonld(site_url, books, catalog, bold_def_count)

    # 3. Target output directories
    target_dirs = [paths['public_dir']] if args.public_only else [
        paths['public_dir'],
        paths['dist_dir'],
        paths['next_git_dir'],
    ]

    openapi_src = paths['public_dir'] / 'openapi.json'
    ai_plugin_src = paths['public_dir'] / '.well-known' / 'ai-plugin.json'

    for t_dir in target_dirs:
        if t_dir.exists():
            # Prune any stale/obsolete child sitemaps not in the current sitemap index
            removed_old = cleanup_obsolete_sitemaps(t_dir, keep_files=set(sitemaps.keys()))
            if removed_old:
                print(f"[*] Removed {removed_old} obsolete sitemap-*.xml files from {t_dir}")

            # Write sitemap index + all child sitemaps
            for filename, content in sitemaps.items():
                with open(t_dir / filename, 'w', encoding='utf-8') as f:
                    f.write(content)

            # Write metadata & AI files
            with open(t_dir / 'robots.txt', 'w', encoding='utf-8') as f:
                f.write(robots_content)
            with open(t_dir / 'llms.txt', 'w', encoding='utf-8') as f:
                f.write(llms_content)
            with open(t_dir / 'llms-full.txt', 'w', encoding='utf-8') as f:
                f.write(llms_full_content)
            with open(t_dir / 'site.jsonld', 'w', encoding='utf-8') as f:
                f.write(jsonld_content)

            # Sync AI tool files & IndexNow key to dist/next_git if applicable
            if t_dir != paths['public_dir']:
                if openapi_src.exists():
                    (t_dir / 'openapi.json').write_text(openapi_src.read_text(encoding='utf-8'), encoding='utf-8')
                if ai_plugin_src.exists():
                    (t_dir / '.well-known').mkdir(parents=True, exist_ok=True)
                    (t_dir / '.well-known' / 'ai-plugin.json').write_text(ai_plugin_src.read_text(encoding='utf-8'), encoding='utf-8')
                sync_indexnow_key(paths['public_dir'], t_dir)
            print(f"[✓] Saved {len(sitemaps) + 4} SEO & AI files into: {t_dir}")

    total_urls = sum(
        content.count("<loc>")
        for fname, content in sitemaps.items()
        if fname != "sitemap.xml"
    )
    print("\n" + "=" * 60)
    print(" [✓] MULTI-SCRIPT & MULTI-TRANSLATION SEO METADATA COMPLETE!")
    print("=" * 60)
    print(f" XML Sitemap Index : sitemap.xml -> {len(sitemaps) - 1} child sitemaps ({total_urls:,} canonical URLs)")
    print(f" AI Agent Standards: /llms.txt, /llms-full.txt ({bold_def_count:,} bold definitions + {len(TRANSLATION_LANGUAGES)} translations + 17 scripts)")
    print(f" Search Engine Rule: /robots.txt (Allow /book/ & /translation/ + Sitemap Index + AI tool allowances)")
    print(f" Structured Data   : /site.jsonld (WebSite, Organization, DataCatalog with {len(books)} books)")
    print("=" * 60 + "\n")


if __name__ == '__main__':
    main()
