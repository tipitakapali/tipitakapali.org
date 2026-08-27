#!/usr/bin/env python3
"""
generate_seo_ai_metadata.py
===========================
Generates comprehensive SEO metadata and AI crawler/agent files for the
Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi web application:

Generated Files:
  1. sitemap.xml     - Complete Google & search engine sitemap (Home, all 217 books, 2,695 chapters).
  2. robots.txt      - Search engine and AI crawler rules (GPTBot, ClaudeBot, Perplexity, etc.).
  3. llms.txt        - Structured site summary and index adhering to the /llms.txt standard for AI Agents.
  4. llms-full.txt   - Complete 217-book catalog, navigation paths, and API specifications for LLMs.
  5. site.jsonld     - Schema.org JSON-LD structured data (WebSite, SearchAction, Dataset, Collection).

Usage:
  python3 generate_seo_ai_metadata.py
  python3 generate_seo_ai_metadata.py --site-url https://next.cuong.eu.org
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
    dist_dir = root_dir / 'cloudflare_pages_dist'
    next_git_dir = root_dir / 'next'

    return {
        'root_dir': root_dir,
        'web_app_dir': web_app_dir,
        'db_path': db_path,
        'catalog_path': catalog_path,
        'public_dir': public_dir,
        'dist_dir': dist_dir,
        'next_git_dir': next_git_dir,
    }

def generate_sitemap_xml(books, chapters, site_url):
    """Generate official XML sitemap with home, all 217 books, and all 2,695 chapters."""
    urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # 1. Home page
    url_elem = ET.SubElement(urlset, "url")
    ET.SubElement(url_elem, "loc").text = f"{site_url}/"
    ET.SubElement(url_elem, "lastmod").text = now_iso
    ET.SubElement(url_elem, "changefreq").text = "weekly"
    ET.SubElement(url_elem, "priority").text = "1.0"

    # 2. All 217 Books
    for b in books:
        clean_code = b['code']
        url_elem = ET.SubElement(urlset, "url")
        ET.SubElement(url_elem, "loc").text = f"{site_url}/book/{clean_code}"
        ET.SubElement(url_elem, "lastmod").text = now_iso
        ET.SubElement(url_elem, "changefreq").text = "monthly"
        ET.SubElement(url_elem, "priority").text = "0.9"

    # 3. All individual chapters
    for ch in chapters:
        book_code = ch['book_code']
        ch_idx = ch['chapter_index']
        # User visible 1-indexed chapter URL: /book/{code}/{idx+1} and /chapter/{code}/{idx+1}
        url_elem = ET.SubElement(urlset, "url")
        ET.SubElement(url_elem, "loc").text = f"{site_url}/book/{book_code}/{ch_idx + 1}"
        ET.SubElement(url_elem, "lastmod").text = now_iso
        ET.SubElement(url_elem, "changefreq").text = "monthly"
        ET.SubElement(url_elem, "priority").text = "0.7"

    xml_str = ET.tostring(urlset, encoding="utf-8")
    parsed = minidom.parseString(xml_str)
    return parsed.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")

def generate_robots_txt(site_url):
    """Generate SEO and AI crawler friendly robots.txt."""
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
Allow: /
Allow: /_next/
Allow: /api/
Allow: /book/
Allow: /chapter/
Disallow: /api/search*

# 2. Leading AI Crawlers, Search Agents & LLM Scrapers
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
Allow: /
Allow: /llms.txt
Allow: /llms-full.txt
Allow: /api/
Allow: /book/
Allow: /chapter/

# 3. Default for all other user agents
User-agent: *
Allow: /
Allow: /_next/
Allow: /api/
Disallow: /api/search*

# 4. Sitemaps and AI Entry Points
Sitemap: {site_url}/sitemap.xml
Host: {site_url.replace('https://', '').replace('http://', '')}
"""

def generate_llms_txt(site_url, books_count, chapters_count):
    """Generate /llms.txt adhering to the LLM agent standard (https://llmstxt.org)."""
    return f"""# Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (VRI)
> Complete Chaṭṭha Saṅgāyana Tipiṭaka (Sixth Buddhist Council) Pali Canon texts, commentary, sub-commentary, and dictionaries.

## Overview
- **Corpus**: Chaṭṭha Saṅgāyana Tipiṭaka (Vipassana Research Institute / CSCD edition).
- **Total Canonical Books**: {books_count} books.
- **Total Chapters**: {chapters_count:,} chapters across 520,000+ paragraphs.
- **Languages / Scripts**: Pāḷi in Roman (Latin with full diacritics), Devanagari, Myanmar, Sinhala, Thai, Khmer, Cyrillic, and 10+ other scripts.
- **Canonical Piṭakas**:
  1. **Vinaya Piṭaka** (Monastic Rules): Pārājikapāḷi, Pācittiyapāḷi, Mahāvaggapāḷi, Cūḷavaggapāḷi, Parivārapāḷi, plus commentaries (Aṭṭhakathā) and sub-commentaries (Ṭīkā).
  2. **Sutta Piṭaka** (Discourses): Dīgha Nikāya, Majjhima Nikāya, Saṃyutta Nikāya, Aṅguttara Nikāya, Khuddaka Nikāya (Dhammapada, Sutta Nipāta, Jātaka, etc.), plus Aṭṭhakathā and Ṭīkā.
  3. **Abhidhamma Piṭaka** (Higher Doctrine): Dhammasaṅgaṇī, Vibhaṅga, Dhātukathā, Puggalapaññatti, Kathāvatthu, Yamaka, Paṭṭhāna, plus Aṭṭhakathā and Ṭīkā.
  4. **Añña Texts**: Post-canonical grammars, Visuddhimagga, chronicles (Vaṃsa), and commentaries.

## Key Reading Links
- [Home & Canonical Navigation]({site_url}/)
- [Full Catalog & AI Documentation]({site_url}/llms-full.txt)
- [XML Sitemap]({site_url}/sitemap.xml)

## Reading URLs Syntax
- Book: `{site_url}/book/[book_code]` (e.g. `{site_url}/book/s0101m.mul` for Dīgha Nikāya Sīlakkhandhavagga)
- Chapter: `{site_url}/book/[book_code]/[chapter_number]` (e.g. `{site_url}/book/s0101m.mul/2` for Chapter 2)
- Specific Paragraph: `{site_url}/book/[book_code]#para-[number]` (e.g. `{site_url}/book/s0502m.mul#para-1` for Dhammapada Verse 1)

## Public Static JSON API (Edge CDN 0ms)
- Navigation Tree: `GET {site_url}/api/tree`
- Books List: `GET {site_url}/api/books`
- Book Details & Initial Chapters: `GET {site_url}/api/book/[book_code]`
- Chapter HTML: `GET {site_url}/api/book/[book_code]/chapter/[chapter_index]`
- Book Table of Contents: `GET {site_url}/api/book/[book_code]/toc`
- Mūla-Aṭṭhakathā-Ṭīkā Cross Matrix: `GET {site_url}/api/mat`

## Dynamic Search & Dictionary Endpoints
- Full-Text Search: `GET {site_url}/api/search?q=[query]`
- Dictionary Lookup: `GET {site_url}/api/dict/lookup?w=[word]`
- Inflection Lookup: `GET {site_url}/api/dict/inf?w=[word]`
"""

def generate_llms_full_txt(site_url, books, catalog):
    """Generate complete /llms-full.txt with 217-book catalog, navigation paths, and metadata."""
    lines = [
        "# Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi — Complete Canonical Catalog & Reference",
        f"> Website: {site_url}",
        f"> Total Canonical Books: {len(books)}",
        "",
        "## Canonical Books Directory",
        "| Book Code | Title | Piṭaka | Category | Chapters | URL |",
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
        "### 5. Full-Text Search (FTS5)",
        f"- Endpoint: `GET {site_url}/api/search?q={{query}}&pitaka={{all|vinaya|sutta|abhidhamma}}&mat={{all|mula|attha|tika}}&limit=50`",
        "- Example: `GET /api/search?q=anatta&pitaka=sutta`",
        "- Description: Ultra-fast full-text search across 520,000+ canonical paragraphs.",
        "",
        "### 6. Pāḷi Dictionary Lookup",
        f"- Endpoint: `GET {site_url}/api/dict/lookup?w={{pali_word}}&dict={{all|dpd|pts|abd|psd}}`",
        "- Example: `GET /api/dict/lookup?w=dhamma`",
        "- Description: Comprehensive lexical lookup across Digital Pāḷi Dictionary (DPD), PTS Pali-English Dictionary, Abhidhānappadīpikā, etc.",
    ])

    return "\n".join(lines)

def generate_schema_jsonld(site_url, books):
    """Generate Schema.org JSON-LD structured data for Google Rich Results."""
    schema = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebSite",
                "@id": f"{site_url}/#website",
                "url": f"{site_url}/",
                "name": "Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi",
                "alternateName": ["Tipitaka Pali", "CSCD Pali Canon", "VRI Tipitaka"],
                "description": "Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with multi-script typography, DPD dictionary, and full-text search.",
                "inLanguage": ["pi", "en", "my", "si", "th", "vi"],
                "potentialAction": {
                    "@type": "SearchAction",
                    "target": {
                        "@type": "EntryPoint",
                        "urlTemplate": f"{site_url}/?q={{search_term_string}}"
                    },
                    "query-input": "required name=search_term_string"
                }
            },
            {
                "@type": "DataCatalog",
                "@id": f"{site_url}/#catalog",
                "name": "Chaṭṭha Saṅgāyana Pali Canon Canonical Corpus",
                "description": "217 books of the Theravada Buddhist Pali Canon including Vinaya, Sutta, and Abhidhamma Pitakas with Atthakatha and Tika commentaries.",
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

    # 1. Generate files
    print("[*] Generating sitemap.xml...")
    sitemap_content = generate_sitemap_xml(books, chapters, site_url)

    print("[*] Generating robots.txt...")
    robots_content = generate_robots_txt(site_url)

    print("[*] Generating llms.txt (AI Agent Standard)...")
    llms_content = generate_llms_txt(site_url, len(books), len(chapters))

    print("[*] Generating llms-full.txt (Comprehensive AI Corpus)...")
    llms_full_content = generate_llms_full_txt(site_url, books, catalog)

    print("[*] Generating site.jsonld (Schema.org Structured Data)...")
    jsonld_content = generate_schema_jsonld(site_url, books)

    # 2. Target output directories
    target_dirs = [
        paths['public_dir'],
        paths['dist_dir'],
        paths['next_git_dir'],
    ]

    files_written = 0
    for t_dir in target_dirs:
        if t_dir.exists():
            with open(t_dir / 'sitemap.xml', 'w', encoding='utf-8') as f:
                f.write(sitemap_content)
            with open(t_dir / 'robots.txt', 'w', encoding='utf-8') as f:
                f.write(robots_content)
            with open(t_dir / 'llms.txt', 'w', encoding='utf-8') as f:
                f.write(llms_content)
            with open(t_dir / 'llms-full.txt', 'w', encoding='utf-8') as f:
                f.write(llms_full_content)
            with open(t_dir / 'site.jsonld', 'w', encoding='utf-8') as f:
                f.write(jsonld_content)
            files_written += 5
            print(f"[✓] Saved SEO & AI files into: {t_dir}")

    print("\n" + "=" * 60)
    print(" [✓] SEO & AI METADATA GENERATION COMPLETE!")
    print("=" * 60)
    print(f" Sitemap URLs      : {len(books) + len(chapters) + 1:,} URLs")
    print(f" AI Agent Standards: /llms.txt, /llms-full.txt")
    print(f" Search Engine Rule: /robots.txt (AI-Enabled)")
    print(f" Structured Data   : /site.jsonld (Schema.org)")
    print("=" * 60 + "\n")

if __name__ == '__main__':
    main()
