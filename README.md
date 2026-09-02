# Chaṭṭha Saṅgāyana Tipiṭaka — Next.js Edition

Modern, high-performance, full-featured digital reader for the **Chaṭṭha Saṅgāyana Tipiṭaka (VRI)**, built with **Next.js (App Router)**, **Tailwind CSS**, **Lucide Icons**, and a high-speed **Fastify + SQLite** backend engine.

Designed for instant paragraph-level navigation, comprehensive multi-dictionary lookup, multi-script live transliteration, and robust cross-referencing between **Mūla**, **Aṭṭhakathā**, and **Ṭīkā** (MAT).

---

## 📂 Directory Structure

```text
web_app_next/
├── app/                                 # Next.js App Router (Root layout, page entrypoints, globals.css)
│   ├── layout.jsx                       # Master HTML shell with theme and context providers
│   ├── page.jsx                         # Main reading interface and layout coordinator
│   └── globals.css                      # Global styles, fonts, and Tailwind directives
│
├── components/                          # Modular React UI Component Library
│   ├── NavigationTree/                  # Sidebar tree navigation across the 4 authentic categories (2,860 nodes)
│   │   ├── NavigationTree.jsx           # Hierarchical navigation with expand/collapse and filter
│   │   └── TreeNode.jsx                 # Individual book, pitaka, and section nodes
│   ├── Reader/                          # Virtualized reader view & text rendering
│   │   ├── ReaderView.jsx               # HTML chapter renderer with DOM-scoped paragraph anchor jumping
│   │   └── ReaderSettings.jsx           # Inline reader control buttons (zoom, theme, TOC)
│   ├── Search/                          # Full-Text Search modal
│   │   └── SearchModal.jsx              # Fast FTS5 search with debouncing, proximity, and snippet highlights
│   ├── Settings/                        # Advanced settings UI
│   │   └── SettingsModal.jsx            # Typography (fonts, size, line-height), Themes, Colors, Layout
│   ├── Help/                            # Guide & keyboard shortcuts modal
│   │   └── HelpModal.jsx                # Keybindings reference and reader navigation tips
│   ├── BookTabsBar.jsx                  # Multi-tab reading bar with scroll memory and close shortcuts
│   ├── BookTocModal.jsx                 # Book Table of Contents drawer with direct chapter/para jumping
│   ├── BookmarkModal.jsx                # Bookmark manager persisted to LocalStorage
│   ├── DictionaryModal.jsx              # Instant multi-dictionary popup (DPD, PTS, Abhidhān, Sinhala)
│   ├── HistoryModal.jsx                 # Recently viewed chapters and reading history
│   ├── LanguageMenu.jsx                 # Live script switcher (Devanagari, Sinhala, Myanmar, Thai, etc.)
│   ├── MatJumpModal.jsx                 # MAT modal: Jump between Mūla, Aṭṭhakathā, and Ṭīkā with sub-book awareness
│   ├── Header.jsx                       # Top application bar with search, dictionary, and settings triggers
│   ├── Footer.jsx                       # Sticky reading navigation bar with prev/next chapter controls
│   └── FloatingMenuBtn.jsx              # Floating toggle button for distraction-free Zen mode
│
├── context/                             # Global React State Management (Context API)
│   ├── TabContext.jsx                   # Active book tabs, chapter buffers, scroll offsets & MAT routing
│   ├── DictionaryContext.jsx            # Dictionary query state, selected word lookup, and cache
│   └── ThemeSettingsContext.jsx         # User preferences: fonts, spacing, themes, and layout
│
├── services/                            # Frontend Service & API Integration Layer
│   ├── api.js                           # Unified HTTP client for books, chapters, TOC, MAT, and FTS search
│   ├── transliterate.js                 # High-performance multi-script transliterator
│   ├── scroll.js                        # Smooth paragraph and anchor scrolling engine
│   └── dpdFeedback.js                   # Community dictionary suggestion & feedback handler
│
├── server_api/                          # High-Performance Node.js Fastify Backend (Port 5055 / 5000)
│   ├── server.js                        # REST API endpoints (/api/books, /api/book/:code, /api/search, /api/mat)
│   ├── dictEngine.js                    # Multi-dictionary lookup engine querying SQLite dictionaries
│   ├── book_mat.json                    # Canonical 217 MAT cross-reference catalog with sub-book boundaries
│   ├── chapters_catalog.json            # Fast chapter registry with offsets and anchor points
│   ├── tree.json                        # Canonical 2,860-node navigation tree
│   └── db/                              # Local SQLite storage for runtime reading and search:
│       ├── tipitaka.db                  # Primary database (217 books, 2,695 chapters with precomputed HTML)
│       ├── fts_tipitaka.db              # FTS5 full-text search index (522,711 paragraphs)
│       └── *.db                         # DPD, PTS, Abhidhān, and Sinhala dictionary databases
│
├── dev_build_vri_db_2026/               # Self-Contained Database Build Pipeline (2026)
│   ├── README.md                        # Pipeline documentation, flags, and testing guide
│   ├── run.sh                           # 1-command executable to build and verify everything
│   ├── build_pipeline.py                # Pipeline orchestrator: transliteration, HTML, FTS5, and verification
│   ├── back_up_build_pipeline.py        # Preserved legacy monolithic script for reference
│   ├── conversion_scripts/              # Python Devanagari-to-Roman XML transliteration engine
│   ├── metadata/                        # Canonical catalogs: tree.json, book_mat.json, chapters_catalog.json
│   ├── tipitaka-xml/                    # Upstream authentic VRI XML source files (auto-cloned if missing)
│   └── output/                          # Generated database artifacts (local only, ignored by Git)
│       ├── tipitaka.db                  # Generated primary database with sub-book metadata
│       └── fts_tipitaka.db              # Generated FTS5 search index
│
├── public/                              # Static public web assets
│   ├── fonts/                           # Offline fonts (Gentium Plus, EB Garamond)
│   ├── icons/                           # App icons, SVG assets, and favicon
│   └── manifest.json                    # PWA Web App Manifest
│
├── export_static_cloudflare_pages.py    # Static Edge Distribution Exporter for Cloudflare Pages (tipitakapali.org)
├── generate_seo_ai_metadata.py          # Static OpenGraph, sitemap, and LLM metadata generator
├── next.config.js                       # Next.js bundler and compiler configuration
├── tailwind.config.js                   # Tailwind theme colors, typography, and dark-mode setup
├── package.json                         # Node.js dependencies and run scripts
└── .gitignore                           # Repository ignore rules (excludes databases and heavy build artifacts)
```

---

## ⚡ Quick Start & Development Workflows

### 1. Local Development (Next.js + Fastify API)

#### Terminal A: Start the API Backend
```bash
cd web_app_next/server_api
node server.js
```
*(Runs on port `5055` by default, or port specified by `PORT` env)*

#### Terminal B: Start Next.js Frontend
```bash
cd web_app_next
npm run dev
```
Open **`http://localhost:3000`** in your browser.

---

### 2. Building & Verifying the Tipitaka Databases

To regenerate or verify the primary SQLite databases from authentic VRI XML:

```bash
cd web_app_next/dev_build_vri_db_2026

# Verify existing databases (integrity checks & all 6 multi-volume test suites)
python3 build_pipeline.py --verify-only

# Or rebuild tipitaka.db from scratch (~13 seconds)
python3 build_pipeline.py --db-only

# Or full 1-command build (translit + db + fts + verify)
./run.sh
```

---

### 3. Deploying to Cloudflare Pages (Static Edge Distribution)

To export the entire application as an ultra-fast static distribution for Cloudflare Pages:

```bash
cd web_app_next
python3 export_static_cloudflare_pages.py
```
This pre-exports all 217 books, 2,695+ chapters, TOCs, and MAT matrices to static JSON in `cloudflare_pages_dist/`, builds Next.js in static mode, and configures Cloudflare Edge Functions for dynamic search and dictionary queries.

---

## 🧭 Multi-Volume MAT Navigation System

The application features a **Sub-Book Disambiguation Engine** for collections split into multiple volumes at the Mūla level (e.g., Aṅguttaranikāya 2-3-4, 5-6-7, 8-9-10-11, Pañcapakaraṇa, and Vinaya):
- **Partitioned Paragraph Maps**: Paragraph numbers repeating across nipātas (such as paragraph 2) are mapped per sub-book (`an2`, `an3`, `an4`) rather than collapsed into a single flat dictionary.
- **Bidirectional Offsets**: Jumping from Mūla to commentary uses chapter offsets (`attha_start_chapter`); jumping from commentary to Mūla automatically identifies the active volume and computes relative chapter indexes.
- **DOM Scoping**: Reader queries are scoped by `[data-chapter="..."]`, preventing duplicate DOM ID collisions across chapter buffers.
