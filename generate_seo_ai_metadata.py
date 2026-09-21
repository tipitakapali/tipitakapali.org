#!/usr/bin/env python3
"""
generate_seo_ai_metadata.py
===========================
Generates comprehensive SEO metadata, XML sitemaps (including 16-script sitemaps),
and AI crawler/agent files for the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi web application.

Generated Files:
  1. sitemap.xml          - Root XML Sitemap Index referencing all child sitemaps.
  2. sitemap-main.xml     - Roman / Latin default sitemap (Home, /info, /pali-script-converter, 217 books, 2,695 chapters).
  3. sitemap-{script}.xml - 16 child sitemaps for all supported Pali scripts (si, hi, thai, etc.).
  4. robots.txt           - Search engine and AI crawler rules with all sitemap endpoints.
  5. llms.txt             - Structured site summary and index adhering to /llms.txt standard for AI agents.
  6. llms-full.txt        - Complete 217-book catalog, multi-script URL patterns, and API reference for LLMs.
  7. site.jsonld          - Schema.org JSON-LD structured data (WebSite, SearchAction, Dataset, Collection).

Usage:
  python3 generate_seo_ai_metadata.py
  python3 generate_seo_ai_metadata.py --site-url https://tipitakapali.org
"""

import os
import sys
import json
import sqlite3
import argparse
import time
from pathlib import Path
import xml.etree.ElementTree as ET
from xml.dom import minidom

DEFAULT_SITE_URL = "https://tipitakapali.org"

# 16 non-default Pali scripts available in the application (Roman 'ro' is default)
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

# 15 supported modern translation languages across the Canon
TRANSLATION_LANGUAGES = [
    {"code": "en", "name": "English", "native": "English", "flag": "🇬🇧", "lang": "en", "desc": "English translation • 1.28M sentences"},
    {"code": "vi", "name": "Vietnamese", "native": "Tiếng Việt", "flag": "🇻🇳", "lang": "vi", "desc": "Bản dịch Tiếng Việt • 1.28M câu"},
    {"code": "my", "name": "Myanmar / Burmese", "native": "မြန်မာ", "flag": "🇲🇲", "lang": "my", "desc": "မြန်မာဘာသာပြန် • 1.28M စာကြောင်း"},
    {"code": "my_nissaya", "name": "Myanmar Nissaya", "native": "မြန်မာ နိဿယ", "flag": "🇲🇲", "lang": "my", "desc": "Myanmar Nissaya word-by-word • 570K စာကြောင်း"},
    {"code": "si", "name": "Sinhala", "native": "සිංහල", "flag": "🇱🇰", "lang": "si", "desc": "සිංහල පරිවර්තනය • 1.21M වාක්‍ය"},
    {"code": "zh", "name": "Chinese", "native": "中文", "flag": "🇨🇳", "lang": "zh", "desc": "中文翻译 • 1.27M 句"},
    {"code": "th", "name": "Thai", "native": "ไทย", "flag": "🇹🇭", "lang": "th", "desc": "ฉบับแปลภาษาไทย • 1.27M ประโยค"},
    {"code": "de", "name": "German", "native": "Deutsch", "flag": "🇩🇪", "lang": "de", "desc": "Deutsche Übersetzung • 1.28M Sätze"},
    {"code": "ja", "name": "Japanese", "native": "日本語", "flag": "🇯🇵", "lang": "ja", "desc": "日本語訳 • 1.25M 文"},
    {"code": "pt", "name": "Portuguese", "native": "Português", "flag": "🇵🇹", "lang": "pt", "desc": "Tradução em Português • 1.22M frases"},
    {"code": "hi", "name": "Hindi", "native": "हिन्दी", "flag": "🇮🇳", "lang": "hi", "desc": "हिन्दी अनुवाद • 410K वाक्य"},
    {"code": "km", "name": "Khmer", "native": "ភាសាខ្មែរ", "flag": "🇰🇭", "lang": "km", "desc": "ការបកប្រែជាភាសាខ្មែរ • 912K ប្រយោគ"},
    {"code": "lo", "name": "Lao", "native": "ລາວ", "flag": "🇱🇦", "lang": "lo", "desc": "ການແປພາສາລາວ • 420K ປະໂຫຍກ"},
    {"code": "ta", "name": "Tamil", "native": "தமிழ்", "flag": "🇮🇳", "lang": "ta", "desc": "தமிழ் மொழிபெயர்ப்பு • 1.22M வாக்கியங்கள்"},
    {"code": "ru", "name": "Russian", "native": "Русский", "flag": "🇷🇺", "lang": "ru", "desc": "Русский перевод • 248K предложений"},
    {"code": "ko", "name": "Korean", "native": "한국어", "flag": "🇰🇷", "lang": "ko", "desc": "한국어 번역 • 337K 문장"},
    {"code": "id", "name": "Indonesian", "native": "Bahasa Indonesia", "flag": "🇮🇩", "lang": "id", "desc": "Terjemahan Bahasa Indonesia • 1.27M kalimat"},
    {"code": "ne", "name": "Nepali", "native": "नेपाली", "flag": "🇳🇵", "lang": "ne", "desc": "नेपाली अनुवाद • 35K वाक्य"},
]

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

    catalog_path = web_app_dir / 'server_api' / 'cst_books_catalog.json'
    public_dir = web_app_dir / 'public'
    dist_dir = web_app_dir / 'cloudflare_pages_dist'
    next_git_dir = web_app_dir / 'next_tipitakapali.org'

    return {
        'root_dir': root_dir,
        'web_app_dir': web_app_dir,
        'db_path': db_path,
        'catalog_path': catalog_path,
        'public_dir': public_dir,
        'dist_dir': dist_dir,
        'next_git_dir': next_git_dir,
    }

def generate_sitemap_index_xml(site_url):
    """Generate official XML Sitemap Index referencing main, translations, and all 16 script sitemaps."""
    sitemapindex = ET.Element("sitemapindex", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # 1. Main Roman/Latin Canon Sitemap
    sitemap_elem = ET.SubElement(sitemapindex, "sitemap")
    ET.SubElement(sitemap_elem, "loc").text = f"{site_url}/sitemap-main.xml"
    ET.SubElement(sitemap_elem, "lastmod").text = now_iso

    # 2. Translations Sitemap (15 modern languages across all 217 books)
    sitemap_elem = ET.SubElement(sitemapindex, "sitemap")
    ET.SubElement(sitemap_elem, "loc").text = f"{site_url}/sitemap-translations.xml"
    ET.SubElement(sitemap_elem, "lastmod").text = now_iso

    # 3. 16 Script Child Sitemaps
    for sc in PALI_SCRIPTS:
        sitemap_elem = ET.SubElement(sitemapindex, "sitemap")
        ET.SubElement(sitemap_elem, "loc").text = f"{site_url}/sitemap-{sc['code']}.xml"
        ET.SubElement(sitemap_elem, "lastmod").text = now_iso

    xml_str = ET.tostring(sitemapindex, encoding="utf-8")
    parsed = minidom.parseString(xml_str)
    return parsed.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")

def generate_single_sitemap_xml(books, chapters, site_url, script_code=None):
    """Generate a single XML sitemap for either default Roman or a specific script."""
    urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    prefix = f"{script_code}." if script_code else ""
    is_main = script_code is None

    # Home page + static info/guide page only in main sitemap
    if is_main:
        url_elem = ET.SubElement(urlset, "url")
        ET.SubElement(url_elem, "loc").text = f"{site_url}/"
        ET.SubElement(url_elem, "lastmod").text = now_iso
        ET.SubElement(url_elem, "changefreq").text = "weekly"
        ET.SubElement(url_elem, "priority").text = "1.0"

        url_elem = ET.SubElement(urlset, "url")
        ET.SubElement(url_elem, "loc").text = f"{site_url}/info"
        ET.SubElement(url_elem, "lastmod").text = now_iso
        ET.SubElement(url_elem, "changefreq").text = "monthly"
        ET.SubElement(url_elem, "priority").text = "0.8"

        url_elem = ET.SubElement(urlset, "url")
        ET.SubElement(url_elem, "loc").text = f"{site_url}/pali-script-converter"
        ET.SubElement(url_elem, "lastmod").text = now_iso
        ET.SubElement(url_elem, "changefreq").text = "monthly"
        ET.SubElement(url_elem, "priority").text = "0.8"

    # All 217 Books
    book_priority = "0.9" if is_main else "0.85"
    for b in books:
        clean_code = b['code']
        url_elem = ET.SubElement(urlset, "url")
        ET.SubElement(url_elem, "loc").text = f"{site_url}/book/{prefix}{clean_code}"
        ET.SubElement(url_elem, "lastmod").text = now_iso
        ET.SubElement(url_elem, "changefreq").text = "monthly"
        ET.SubElement(url_elem, "priority").text = book_priority

    # All individual chapters
    chap_priority = "0.7" if is_main else "0.65"
    for ch in chapters:
        book_code = ch['book_code']
        ch_idx = ch['chapter_index']
        url_elem = ET.SubElement(urlset, "url")
        ET.SubElement(url_elem, "loc").text = f"{site_url}/book/{prefix}{book_code}/{ch_idx + 1}"
        ET.SubElement(url_elem, "lastmod").text = now_iso
        ET.SubElement(url_elem, "changefreq").text = "monthly"
        ET.SubElement(url_elem, "priority").text = chap_priority

    xml_str = ET.tostring(urlset, encoding="utf-8")
    parsed = minidom.parseString(xml_str)
    return parsed.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")

def generate_translations_sitemap_xml(books, site_url):
    """Generate XML sitemap containing all 217 books across the 15 translation languages (3,255 URLs)."""
    urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for b in books:
        clean_code = b['code']
        for t in TRANSLATION_LANGUAGES:
            url_elem = ET.SubElement(urlset, "url")
            ET.SubElement(url_elem, "loc").text = f"{site_url}/book/{clean_code}?l={t['code']}"
            ET.SubElement(url_elem, "lastmod").text = now_iso
            ET.SubElement(url_elem, "changefreq").text = "monthly"
            ET.SubElement(url_elem, "priority").text = "0.8"

    xml_str = ET.tostring(urlset, encoding="utf-8")
    parsed = minidom.parseString(xml_str)
    return parsed.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")

def generate_all_sitemaps(books, chapters, site_url):
    """Generate all sitemap files: root index + main + translations + 16 script sitemaps."""
    sitemaps = {}
    # 1. Root index
    sitemaps['sitemap.xml'] = generate_sitemap_index_xml(site_url)
    # 2. Main Roman sitemap
    sitemaps['sitemap-main.xml'] = generate_single_sitemap_xml(books, chapters, site_url, script_code=None)
    # 3. Translations sitemap (15 languages across all 217 books)
    sitemaps['sitemap-translations.xml'] = generate_translations_sitemap_xml(books, site_url)
    # 4. 16 Script sitemaps
    for sc in PALI_SCRIPTS:
        filename = f"sitemap-{sc['code']}.xml"
        sitemaps[filename] = generate_single_sitemap_xml(books, chapters, site_url, script_code=sc['code'])
    return sitemaps

# Backward-compatibility alias
def generate_sitemap_xml(books, chapters, site_url):
    return generate_sitemap_index_xml(site_url)

def generate_robots_txt(site_url):
    """Generate SEO and AI crawler friendly robots.txt with all sitemaps declared."""
    api_url = "https://api.tipitakapali.org"
    sitemap_lines = [
        f"Sitemap: {site_url}/sitemap.xml",
        f"Sitemap: {site_url}/sitemap-main.xml",
        f"Sitemap: {site_url}/sitemap-translations.xml",
    ]
    for sc in PALI_SCRIPTS:
        sitemap_lines.append(f"Sitemap: {site_url}/sitemap-{sc['code']}.xml")
    sitemaps_block = "\n".join(sitemap_lines)

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
Allow: /chapter/
Disallow: /api/search*

# 2. Leading AI Crawlers, Search Agents & LLM Scrapers — explicitly allow dict tool use
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
Allow: /api/dict/lookup
Allow: /api/dict/inf
Allow: /book/
Allow: /chapter/

# 2b. Canonical AI Tool API (direct VPS) — always allow
# AI tools should call {api_url}/api/dict/lookup?w={{word}}&dict=dpd|others
# and {api_url}/api/dict/lookup?w=mett%C4%81&dict=dpd as live example
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: PerplexityBot
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /api/dict/

# 3. Default for all other user agents
User-agent: *
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /
Allow: /_next/
Allow: /api/
Allow: /api/dict/lookup
Allow: /api/dict/inf
Disallow: /api/search*

# 4. Sitemaps and AI Entry Points (Root Index, Main, and 16 Scripts)
{sitemaps_block}
Agentmap: {site_url}/.well-known/ai-catalog.json
Host: {site_url.replace('https://', '').replace('http://', '')}
# AI Tool Docs
# Canonical Dict API: {api_url}/api/dict/lookup?w=mett%C4%81&dict=dpd
# Canonical Dict Others: {api_url}/api/dict/lookup?w=mett%C4%81&dict=others
# OpenAPI: {site_url}/openapi.json
# AI Plugin: {site_url}/.well-known/ai-plugin.json
"""

def generate_llms_txt(site_url, books_count, chapters_count):
    """Generate /llms.txt adhering to the LLM agent standard (https://llmstxt.org)."""
    api_url = "https://api.tipitakapali.org"

    script_rows = []
    for sc in PALI_SCRIPTS:
        script_rows.append(f"- `{sc['code']}`: **{sc['name']}** ({sc['native']}) → `{site_url}/book/{sc['code']}.s0101m.mul`")
    scripts_list_str = "\n".join(script_rows)

    trans_rows = []
    for t in TRANSLATION_LANGUAGES:
        trans_rows.append(f"- `{t['code']}`: **{t['name']}** ({t['native']}) {t['flag']} → `{site_url}/book/s0101m.mul?l={t['code']}` ({t['desc']})")
    translations_list_str = "\n".join(trans_rows)

    return f"""# Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (VRI)
> Complete Chaṭṭha Saṅgāyana Tipiṭaka (Sixth Buddhist Council) Pali Canon texts, commentary, sub-commentary, and dictionaries with 15 modern translations.

## Overview
- **Corpus**: Chaṭṭha Saṅgāyana Tipiṭaka (Vipassana Research Institute / CSCD edition).
- **Total Canonical Books**: {books_count} books.
- **Total Chapters**: {chapters_count:,} chapters across 520,000+ paragraphs.
- **Languages / Scripts**: Pāḷi in Roman (Latin with full IAST diacritics) + 16 Asian & historic scripts.
- **Translations Available**: 15 languages (English, Vietnamese, Burmese, Sinhala, Chinese, Thai, German, Japanese, Portuguese, Hindi, Khmer, Lao, Tamil, Russian, Myanmar Nissaya) with 14M+ sentence-aligned translations.
- **Canonical Piṭakas**:
  1. **Vinaya Piṭaka** (Monastic Rules): Pārājikapāḷi, Pācittiyapāḷi, Mahāvaggapāḷi, Cūḷavaggapāḷi, Parivārapāḷi, plus commentaries (Aṭṭhakathā) and sub-commentaries (Ṭīkā).
  2. **Sutta Piṭaka** (Discourses): Dīgha Nikāya, Majjhima Nikāya, Saṃyutta Nikāya, Aṅguttara Nikāya, Khuddaka Nikāya (Dhammapada, Sutta Nipāta, Jātaka, etc.), plus Aṭṭhakathā and Ṭīkā.
  3. **Abhidhamma Piṭaka** (Higher Doctrine): Dhammasaṅgaṇī, Vibhaṅga, Dhātukathā, Puggalapaññatti, Kathāvatthu, Yamaka, Paṭṭhāna, plus Aṭṭhakathā and Ṭīkā.
  4. **Añña Texts**: Post-canonical grammars, Visuddhimagga, chronicles (Vaṃsa), and commentaries.

## Key Reading Links
- [Home & Canonical Navigation]({site_url}/)
- [About, User Guide & Help]({site_url}/info)
- [Pāḷi Script Converter (17 scripts, Velthuis input)]({site_url}/pali-script-converter)
- [Full Catalog & AI Documentation]({site_url}/llms-full.txt)
- [XML Sitemap Index]({site_url}/sitemap.xml)
- [OpenAPI for AI Tools]({site_url}/openapi.json)
- [AI Plugin Manifest]({site_url}/.well-known/ai-plugin.json)

## Reading URLs, Translations & Multi-Script Syntax
- **Default Roman Book**: `{site_url}/book/[book_code]` (e.g. `{site_url}/book/s0101m.mul` for Dīgha Nikāya Sīlakkhandhavagga)
- **Book with Translation**: `{site_url}/book/[book_code]?l=[lang_code]` (e.g. `{site_url}/book/s0101m.mul?l=en` for English, `{site_url}/book/s0101m.mul?l=vi` for Vietnamese, `{site_url}/book/s0101m.mul?l=my` for Burmese)
- **Multi-Script Book**: `{site_url}/book/[script_code].[book_code]` (e.g. `{site_url}/book/hi.s0101m.mul` for Devanagari, `{site_url}/book/si.s0101m.mul` for Sinhala, `{site_url}/book/my.s0101m.mul` for Myanmar, `{site_url}/book/thai.s0101m.mul` for Thai)
- **Default Roman Chapter**: `{site_url}/book/[book_code]/[chapter_number]` (e.g. `{site_url}/book/s0101m.mul/2` for Chapter 2)
- **Chapter with Translation**: `{site_url}/book/[book_code]/[chapter_number]?l=[lang_code]` (e.g. `{site_url}/book/s0101m.mul/2?l=en`)
- **Specific Paragraph**: `{site_url}/book/[book_code]#para-[number]` (e.g. `{site_url}/book/s0502m.mul#para-1` for Dhammapada Verse 1)

### Supported 15 Modern Translation Languages (14M+ Aligned Sentences):
{translations_list_str}

### Supported 16 Pāḷi Script Codes:
{scripts_list_str}
*(Note: Roman/Latin is the default and uses the standard URL without a prefix)*

## Public Static JSON API (Edge CDN 0ms)
- Navigation Tree: `GET {site_url}/api/tree`
- Books List: `GET {site_url}/api/books`
- Book Details & Initial Chapters: `GET {site_url}/api/book/[book_code]`
- Chapter HTML: `GET {site_url}/api/book/[book_code]/chapter/[chapter_index]`
- Book Table of Contents: `GET {site_url}/api/book/[book_code]/toc`
- Mūla-Aṭṭhakathā-Ṭīkā Cross Matrix: `GET {site_url}/api/mat`
- Pāḷi Sentences (epitaka segmentation, shared line_id): `GET {site_url}/api/book/[book_code]/pali_sentences` → `{{chapters: {{chapter: {{para_index: [{{line,text}}]}}}}}}`
- Translation Sentences: `GET {site_url}/api/book/[book_code]/translation/[lang].sentences.json` (static) or `GET {api_url}/api/book/[book_code]/chapter/[chapter_index]/translation?lang=[lang]&sentences=1` (VPS)

## AI Tool-Use: Canonical Dictionary, Search & Sentences (Direct VPS — no Worker hop)
> Canonical base for AI agents: `{api_url}` (CORS `*`, `Cache-Control: public, max-age=86400`)
> Sentence-level note: Pāḷi sentences (`pali_sentences.db`, 1.2M sentences, 217 books) and translation sentences share `line_id` per paragraph by construction — **99.7% per-para line-count match**. Use `get_sentences` tool for precise sentence citations: `[book:c{{chapter}}:p{{para}}-L{{line}}]`.

- **DPD Primary Lookup (recommended first):** `GET {api_url}/api/dict/lookup?w=mett%C4%81&dict=dpd`
  - Example live: `curl "{api_url}/api/dict/lookup?w=mett%C4%81&dict=dpd"` → `{{word, counts:{{dpd:2}}, dpd:[{{word,html}}]}}`
- **Secondary Dictionaries (PTS, ABD, PSD, Sanskrit, Splitter):** `GET {api_url}/api/dict/lookup?w=mett%C4%81&dict=others`
  - Returns `{{counts:{{pts,abd,psd,sans,splitter}}, pts:[], abd:[], psd:[], sans:[], splitter:[]}}`
- **All at once:** `GET {api_url}/api/dict/lookup?w=mett%C4%81&dict=all` or `GET {site_url}/api/dict/lookup?w=mett%C4%81&dict=all`
- **Inflection:** `GET {api_url}/api/dict/inf?w=declension_mett%C4%81_1` → `{{word, html}}`
- **Full-Text Search:** `GET {api_url}/api/search?q=anatta&pitaka=sutta&mat=mula&limit=50`
- Params: `w` (Pāḷi word, Velthuis or Unicode, `ṁ→ṃ` normalized), `dict` (`dpd`|`others`|`all`|`pts`|`abd`|`psd`|`sans`|`splitter`), `d=yes` for splitter.
- No auth, `CORS *`, `GET` preferred (POST also via `{{w,dict}}` JSON).

## Legacy Edge Proxies (also work, but direct VPS is faster)
- `GET {site_url}/api/dict/lookup?w=[word]&dict=dpd` → proxied to VPS
- `GET {site_url}/api/search?q=[query]` → proxied to VPS
"""

def generate_llms_full_txt(site_url, books, catalog):
    """Generate complete /llms-full.txt with 217-book catalog, translations reference, multi-script patterns, and metadata."""
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
        "| Language Code | Language Name | Native | Flag | Coverage / Sentences | Sample Book URL with Translation |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ]
    for t in TRANSLATION_LANGUAGES:
        trans_table_rows.append(
            f"| `{t['code']}` | {t['name']} | {t['native']} | {t['flag']} | {t['desc']} | `{site_url}/book/s0101m.mul?l={t['code']}` |"
        )

    lines = [
        "# Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi — Complete Canonical Catalog, Translations & Multi-Script Reference",
        f"> Website: {site_url}",
        f"> Total Canonical Books: {len(books)}",
        "",
        "## Multilingual Translation Deep-Linking Guide for AI Agents",
        "Users can open any canonical text with side-by-side / sentence-level translations by appending `?l=[lang_code]`:",
        "",
        "\n".join(trans_table_rows),
        "",
        "## Multi-Script Deep-Linking Guide for AI Agents",
        "Users can open any canonical text directly in their preferred script by prefixing the book code:",
        "",
        "\n".join(script_table_rows),
        "",
        "## Canonical Books Directory (217 Books)",
        "| Book Code | Title | Piṭaka | Category | Chapters | Default Roman URL |",
        "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ]

    for b in books:
        code = b['code']
        title = b['title']
        nikaya = b['nikaya'] or ''
        category = b['category'] or ''
        ch_count = b['chapter_count'] or 1
        url = f"{site_url}/book/{code}"
        lines.append(f"| `{code}` | {title} | {nikaya} | {category} | {ch_count} | [{title}]({url}) |")

    lines.extend([
        "",
        "## Complete REST & JSON API Reference",
        "",
        "### 1. Navigation Tree Hierarchy",
        f"- Endpoint: `GET {site_url}/api/tree`",
        "- Description: Full hierarchical navigation JSON containing Nikayas, Vaggas, and book nodes.",
        "",
        "### 2. Books Catalog",
        f"- Endpoint: `GET {site_url}/api/books`",
        "- Description: Returns summary metadata, chapter counts, and Piṭaka classification for all 217 books.",
        "",
        "### 3. Book Metadata & Content",
        f"- Endpoint: `GET {site_url}/api/book/{{book_code}}`",
        "- Example: `GET /api/book/s0101m.mul`",
        "- Description: Returns table of contents, paragraph mapping, and initial chapter content.",
        "",
        "### 4. Chapter Content",
        f"- Endpoint: `GET {site_url}/api/book/{{book_code}}/chapter/{{chapter_index}}`",
        "- Example: `GET /api/book/s0101m.mul/chapter/1`",
        "- Description: Returns pure HTML content of the requested chapter.",
        "",
        "### 5. Full-Text Search (FTS5) — Direct VPS",
        f"- Endpoint: `GET https://api.tipitakapali.org/api/search?q={{query}}&pitaka={{all|vinaya|sutta|abhidhamma}}&mat={{all|mula|attha|tika}}&limit=50`",
        "- Example: `GET https://api.tipitakapali.org/api/search?q=anatta&pitaka=sutta` (also `GET {site_url}/api/search?q=anatta`)",
        "- Description: Ultra-fast FTS5 across 520,000+ paragraphs. CORS `*`, `Cache-Control: public, max-age=86400`.",
        "",
        "### 6. Pāḷi Dictionary Lookup — AI Tool-Use (Direct VPS)",
        f"- Endpoint: `GET https://api.tipitakapali.org/api/dict/lookup?w={{pali_word}}&dict={{dpd|others|all|pts|abd|psd|sans|splitter}}`",
        "- Example DPD (primary): `GET https://api.tipitakapali.org/api/dict/lookup?w=mett%C4%81&dict=dpd` → `{word,counts:{dpd:2}, dpd:[{word,html}]}`",
        "- Example Others (secondary): `GET https://api.tipitakapali.org/api/dict/lookup?w=mett%C4%81&dict=others` → `{counts:{pts,abd,psd,sans,splitter}, pts:[], ...}`",
        "- All-in-one: `GET https://api.tipitakapali.org/api/dict/lookup?w=dhamma&dict=all`",
        "- Also via edge: `GET {site_url}/api/dict/lookup?w=dhamma&dict=dpd` (proxied, slower)",
        "- Description: DPD (90k+ entries), PTS PED 2015, Abhidhānappadīpikā, Pāḷi-Sinhala, Sanskrit. `w` accepts Velthuis/`ṁ→ṃ`. No auth, `GET` preferred, `POST {w,dict}` also.",
        "",
        "### 7. Sentence-Level Pāḷi & Translation APIs (epitaka shared line_id, 99.7% match)",
        f"- Pāḷi Sentences (book-level): `GET {site_url}/api/book/{{book_code}}/pali_sentences` or `GET https://api.tipitakapali.org/api/book/{{book_code}}/pali_sentences`",
        "- Example: `GET /api/book/s0101m.mul/pali_sentences` → `{book_code, chapters: {chapter: {para_index: [{line,text}]}}}`",
        f"- Translation Sentences (chapter): `GET https://api.tipitakapali.org/api/book/{{book_code}}/chapter/{{chapter_index}}/translation?lang={{lang}}&sentences=1`",
        "- Example: `GET /api/book/s0101m.mul/chapter/0/translation?lang=en&sentences=1` → `{sentences: {en: {para_index: [{line_id, translation}]}}}`",
        f"- AI Agent: `GET https://api.tipitakapali.org/api/ai/sentences?book={{book_code}}&chapter={{chapter_index}}&para_index={{para_index}}&langs=en,vi` → sentence-aligned Pāḷi + translations",
        "- Note: Pāḷi sentences built from `ref/epitaka_app/assets/db/epitaka.db` (`pali_sentences.db`, 1.2M sentences) — same segmentation that produced `translation_*.db`, hence shared `line_id`.",
        "",
        "### 8. Inflection Lookup",
        f"- Endpoint: `GET https://api.tipitakapali.org/api/dict/inf?w=declension_{{lemma}}_1`",
        "- Example: `GET https://api.tipitakapali.org/api/dict/inf?w=declension_mett%C4%81_1`",
        "- Description: Declension/conjugation tables. Returns `{word, html}`.",
        "",
        "### 9. OpenAPI & AI Plugin",
        f"- OpenAPI: `GET {site_url}/openapi.json` (for ChatGPT/MCP tool import)",
        f"- AI Plugin: `GET {site_url}/.well-known/ai-plugin.json`",
        f"- Human Guide (features, shortcuts, dictionaries, scripts): `{site_url}/info`",
        f"- Human Script Converter (17 scripts, Velthuis input, offline .zip): `{site_url}/pali-script-converter`",
    ])

    return "\n".join(lines)

def generate_schema_jsonld(site_url, books):
    """Generate Schema.org JSON-LD structured data for Google Rich Results."""
    api_url = "https://api.tipitakapali.org"
    lang_list = ["pi", "pi-Latn", "en"] + [t["code"] for t in TRANSLATION_LANGUAGES] + [sc["lang"] for sc in PALI_SCRIPTS]
    schema = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebSite",
                "@id": f"{site_url}/#website",
                "url": f"{site_url}/",
                "name": "Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi",
                "alternateName": ["Tipitaka Pali", "CSCD Pali Canon", "VRI Tipitaka"],
                "description": "Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with 15 modern translations, 16 multi-script typography options, DPD dictionary, and full-text search.",
                "inLanguage": lang_list,
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
                "name": "Chaṭṭha Saṅgāyana Pali Canon Canonical Corpus",
                "description": "217 books of the Theravada Buddhist Pali Canon with 15 modern translations across 16 scripts.",
                "url": f"{site_url}/",
                "dataset": [
                    {
                        "@type": "Dataset",
                        "name": b['title'],
                        "identifier": b['code'],
                        "inLanguage": "pi",
                        "genre": b['nikaya'] or "Buddhism",
                        "url": f"{site_url}/book/{b['code']}"
                    }
                    for b in books[:30] # Top 30 canonical entry dataset sample
                ]
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

    catalog = {}
    if paths['catalog_path'].exists():
        try:
            with open(paths['catalog_path'], 'r', encoding='utf-8') as f:
                catalog = json.load(f)
        except Exception:
            pass

    print(f"[*] Loaded {len(books)} books and {len(chapters)} chapters.")

    # 1. Generate all sitemaps (index + main + translations + 16 scripts)
    print(f"[*] Generating XML Sitemaps (Root Index + Main + Translations + 16 Scripts)...")
    sitemaps = generate_all_sitemaps(books, chapters, site_url)

    # 2. Generate robots.txt, llms.txt, llms-full.txt, site.jsonld
    print("[*] Generating robots.txt...")
    robots_content = generate_robots_txt(site_url)

    print("[*] Generating llms.txt (AI Agent Standard)...")
    llms_content = generate_llms_txt(site_url, len(books), len(chapters))

    print("[*] Generating llms-full.txt (Comprehensive AI Corpus)...")
    llms_full_content = generate_llms_full_txt(site_url, books, catalog)

    print("[*] Generating site.jsonld (Schema.org Structured Data)...")
    jsonld_content = generate_schema_jsonld(site_url, books)

    # 3. Target output directories
    target_dirs = [
        paths['public_dir'],
        paths['dist_dir'],
        paths['next_git_dir'],
    ]

    openapi_src = paths['public_dir'] / 'openapi.json'
    ai_plugin_src = paths['public_dir'] / '.well-known' / 'ai-plugin.json'

    for t_dir in target_dirs:
        if t_dir.exists():
            # Write all sitemaps
            for filename, content in sitemaps.items():
                with open(t_dir / filename, 'w', encoding='utf-8') as f:
                    f.write(content)

            # Write other metadata files
            with open(t_dir / 'robots.txt', 'w', encoding='utf-8') as f:
                f.write(robots_content)
            with open(t_dir / 'llms.txt', 'w', encoding='utf-8') as f:
                f.write(llms_content)
            with open(t_dir / 'llms-full.txt', 'w', encoding='utf-8') as f:
                f.write(llms_full_content)
            with open(t_dir / 'site.jsonld', 'w', encoding='utf-8') as f:
                f.write(jsonld_content)

            # Sync AI tool files to dist/next_git if they exist
            if t_dir != paths['public_dir']:
                if openapi_src.exists():
                    (t_dir / 'openapi.json').write_text(openapi_src.read_text(encoding='utf-8'), encoding='utf-8')
                if ai_plugin_src.exists():
                    (t_dir / '.well-known').mkdir(parents=True, exist_ok=True)
                    (t_dir / '.well-known' / 'ai-plugin.json').write_text(ai_plugin_src.read_text(encoding='utf-8'), encoding='utf-8')
            print(f"[✓] Saved {len(sitemaps) + 4} SEO & AI files into: {t_dir}")

    total_indexed_urls = (
        1
        + len(books)
        + len(chapters)
        + len(TRANSLATION_LANGUAGES) * len(books)
        + len(PALI_SCRIPTS) * (len(books) + len(chapters))
    )
    print("\n" + "=" * 60)
    print(" [✓] MULTI-SCRIPT & TRANSLATION SEO & AI METADATA COMPLETE!")
    print("=" * 60)
    print(f" Total Sitemaps    : {len(sitemaps)} (sitemap.xml index + main + translations + 16 child sitemaps)")
    print(f" Total Indexed URLs: {total_indexed_urls:,} URLs across 17 scripts and 15 translation languages")
    print(f" AI Agent Standards: /llms.txt, /llms-full.txt (15 translations and 16 Pali scripts documented)")
    print(f" Search Engine Rule: /robots.txt (AI-Enabled with {len(sitemaps)} sitemap declarations)")
    print(f" Structured Data   : /site.jsonld (Schema.org with 15 translation languages)")
    print("=" * 60 + "\n")

if __name__ == '__main__':
    main()
