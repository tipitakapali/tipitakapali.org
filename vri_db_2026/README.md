# VRI Tipitaka Database Pipeline (2026)

Self-contained, reproducible pipeline to generate the modern SQLite databases for **VRI Tipiṭaka Web App (`web_app_next`)**, Electron reader, and mobile/offline clients.

Running **one command** automatically clones upstream sources (if not present), performs Unicode transliteration from Devanagari master to `_latest_romn/`, precomputes chapter HTML & CST metadata, builds the FTS5 full-text search index, and verifies database integrity.

All generated databases remain strictly inside the local `output/` directory and are excluded from Git.

---

## ⚡ Quick Start (1 Command)

To reproduce the identical databases from scratch, run:

```bash
cd web_app_next/vri_db_2026
./run.sh
```

*(Alternatively: `python3 build_pipeline.py`)*

### Total Execution Time
~**40 seconds** on standard modern hardware (13s for `tipitaka.db`, 26s for `fts_tipitaka.db`).

---

## 📦 What Is Produced in `output/`

| Database File | Size | Description |
| :--- | :--- | :--- |
| **`output/tipitaka.db`** | ~207 MB | Primary database with 217 books, 2,695 chapters with **precomputed HTML**, CST4 `meta_json` (paragraph spans, page anchors for V/P/T/M/O, edition ranges, and MAT cross-references), **37,226 TOC items**, and 2,860 tree nodes. Built from `_latest_romn/`. |
| **`output/fts_tipitaka.db`** | ~280 MB | Dedicated Full-Text Search database powered by SQLite **FTS5** with `prefix = 3` indexing across **522,711 paragraphs**. Optimized and vacuumed. |
| **`output/books_xml.db`** | ~141 MB | *(Optional)* Complete XML archive storing raw UTF-8 XML content for all 217 books (build with `--xml-only`). |

---

## 📂 Directory Structure

```text
web_app_next/vri_db_2026/
├── README.md                      # Documentation & instructions
├── run.sh                         # Convenient 1-command executable wrapper
├── build_pipeline.py              # Canonical orchestrator script (zero external Python deps)
├── back_up_build_pipeline.py      # Preserved legacy monolithic script for comparison
├── .gitignore                     # Ignores output/, tipitaka-xml/, and *.db
├── metadata/
│   ├── tree.json                  # Canonical navigation tree (2,860 nodes)
│   ├── cst_books_catalog.json     # CST4 catalog with book categories
│   ├── chapters_catalog.json      # Complete 2,695 chapter definitions and offsets
│   └── book_mat.json              # Canonical 217 Mūla-Aṭṭhakathā-Ṭīkā cross-references
├── conversion_scripts/
│   └── deva2latn.py               # Built-in Python Devanagari-to-Roman transliteration engine
├── tipitaka-xml/                  # Upstream VRI XML repository (ignored by Git, auto-cloned if missing)
│   ├── deva/                      # 217 authentic Devanagari master XML books
│   ├── _latest_romn/              # Freshly converted Roman Latin XML books (pure UTF-8)
│   ├── romn/                      # Old repo Roman Latin books (comparison baseline)
│   └── deva master/               # CSCD TOC XML files
└── output/                        # Generated output databases (local only, ignored by Git)
    ├── tipitaka.db                # Generated primary database
    └── fts_tipitaka.db            # Generated FTS5 search database
```

---

## 💻 Command-Line Flags

```bash
# Run all steps (default: check clone, convert _latest_romn, build dbs, verify)
python3 build_pipeline.py

# Force fresh re-transliteration from deva/ to _latest_romn/
python3 build_pipeline.py --force-translit

# Compare _latest_romn/ with the repository's old romn/ directory
python3 build_pipeline.py --compare-romn

# Build only the primary tipitaka.db (~13 seconds)
python3 build_pipeline.py --db-only

# Build only the FTS5 search index database (~28 seconds)
python3 build_pipeline.py --fts-only

# Build the raw XML archive database
python3 build_pipeline.py --xml-only

# Verify existing databases without rebuilding
python3 build_pipeline.py --verify-only
```
