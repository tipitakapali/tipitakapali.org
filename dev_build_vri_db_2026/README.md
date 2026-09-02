# VRI Tipitaka Database Pipeline (2026)

Self-contained, reproducible pipeline to generate the modern SQLite databases for **VRI Tipiṭaka Web App (`web_app_next`)**, Electron reader, and mobile/offline clients.

Running **one command** automatically clones upstream sources (if not present), performs Unicode transliteration from Devanagari master to `_latest_romn/`, precomputes chapter HTML & CST metadata, builds the FTS5 full-text search index, and verifies database integrity.

All generated databases remain strictly inside the local `output/` directory and are excluded from Git.

---

## ⚡ Quick Start (1 Command)

To reproduce the identical databases from scratch, run:

```bash
cd web_app_next/dev_build_vri_db_2026
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
web_app_next/dev_build_vri_db_2026/
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

---

## 🧭 Multi-Volume MAT Navigation & Disambiguation

In the canonical Tipiṭaka texts, several major collections are split into multiple physical volumes at the **Mūla** level, but are consolidated into a single volume at the **Aṭṭhakathā** and/or **Ṭīkā** levels.

### The Paragraph Collision Problem
Whenever a work is divided into multiple volumes or nipātas:
1. **Paragraph numbering restarts at `1` in each volume.**
2. A single commentary like `s0402a.att` contains Dukanipāta, Tikanipāta, and Catukkanipāta all in one book.
3. In a naive database mapping, paragraph 2 exists multiple times (Chapter 0, Chapter 19, and Chapter 36). A flat `para_to_chapter["2"]` lookup would permanently resolve to Chapter 0!
4. Consequently, a user reading `s0402m2.mul` (Tikanipāta) at paragraph 2 who clicked MAT ➔ Aṭṭhakathā would mistakenly jump to Dukanipāta (`2. Padhānasuttavaṇṇanā`) instead of Tikanipāta (`2. Lakkhaṇasuttavaṇṇanā`).
5. Conversely, clicking Mūla while in Tikanipāta would mistakenly jump backward to Dukanipāta (`s0402m1.mul`).

### The Solution: Sub-Book Awareness
The 2026 pipeline parses sub-book boundary indicators (`<div id="..." type="book">`) and injects structured sub-book metadata:
- **`sub_books` & `chapter_to_sub_book`**: Stored in `meta_json` for multi-volume commentaries to record exact chapter boundaries.
- **`sub_books_para_to_chapter`**: Partitioned paragraph lookups (`an2`, `an3`, `an4`) so paragraph 2 resolves to the correct chapter depending on the active volume.
- **`data-sub-book` & DOM Scoping**: Paragraph elements carry their sub-book code, and `findElement` in `ReaderView.jsx` scopes to the target chapter (`[data-chapter="..."]`), eliminating duplicate DOM ID collisions.
- **Bidirectional Chapter Offsets**:
  - **Forward (Mūla ➔ Att/Ṭīkā)**: Uses `attha_start_chapter + activeChapterIdx`.
  - **Reverse (Att/Ṭīkā ➔ Mūla)**: Identifies the active sub-book, selects the correct Mūla volume, and computes `activeChapterIdx - subInfo.chapter_range[0]`.

---

## 🧪 Practical Testing Guide (All Multi-Volume Groups)

You can verify all multi-volume links either via the automated test script or manually in the reader interface.

### Automated Test Command
Run the built-in verification suite directly via the pipeline:
```bash
python3 build_pipeline.py --verify-only
```
*(Note: This test suite also runs automatically at the end of every database build.)*

---

### Manual Testing Scenarios

#### 1. Aṅguttaranikāya 2-3-4 (`s0402`)

* **Volume 1: Dukanipātapāḷi** (`s0402m1.mul`, 19 chapters: 0..18)
  * Open `s0402m1.mul`, Chapter 0, Paragraph 2 (`2. Padhānasuttaṃ`).
  * Click **MAT ➔ Aṭṭhakathā**.
  * ✅ **Expected**: Opens `s0402a.att` Chapter 0 (`1. kammakāraṇavaggo`), Paragraph 2: **`2. Padhānasuttavaṇṇanā`**.
* **Volume 2: Tikanipātapāḷi** (`s0402m2.mul`, 18 chapters: 0..17)
  * Open `s0402m2.mul`, Chapter 0, Paragraph 2 (`2. Lakkhaṇasuttaṃ`).
  * Click **MAT ➔ Aṭṭhakathā**.
  * ✅ **Expected**: Opens `s0402a.att` Chapter 19 (`1. bālavaggo`), Paragraph 2: **`2. Lakkhaṇasuttavaṇṇanā`**.
* **Volume 3: Catukkanipātapāḷi** (`s0402m3.mul`, 28 chapters: 0..27)
  * Open `s0402m3.mul`, Chapter 0, Paragraph 2 (`2. Papatitasuttaṃ`).
  * Click **MAT ➔ Aṭṭhakathā**.
  * ✅ **Expected**: Opens `s0402a.att` Chapter 36 (`1. bhaṇḍagāmavaggo`), Paragraph 2: **`2. Papatitasuttavaṇṇanā`**.
* **Reverse Jump Tests (Commentary ➔ Mūla)**:
  * In `s0402a.att`, go to Chapter 19 Paragraph 2 ➔ Click **MAT ➔ Mūla**.
  * ✅ **Expected**: Jumps to `s0402m2.mul` Chapter 0, Paragraph 2 (`2. Lakkhaṇasuttaṃ`).
  * In `s0402a.att`, go to Chapter 36 Paragraph 2 ➔ Click **MAT ➔ Mūla**.
  * ✅ **Expected**: Jumps to `s0402m3.mul` Chapter 0, Paragraph 2 (`2. Papatitasuttaṃ`).

---

#### 2. Aṅguttaranikāya 5-6-7 (`s0403`)

* **Commentary**: `s0403a.att` (47 chapters: 0..46)
* **Sub-commentary**: `s0403t.tik` (47 chapters: 0..46)

| Volume | Mūla Book Code | Chapter Count | Commentary Chapters (`s0403a.att`) | Test Target |
| :--- | :--- | :--- | :--- | :--- |
| **Pañcakanipāta** | `s0403m1.mul` | 29 (0..28) | Chapters `0..25` (`1. Sekhabalavaggo`) | Para 1 ➔ Chap 0 |
| **Chakkanipāta** | `s0403m2.mul` | 13 (0..12) | Chapters `26..38` (`1. Āhuneyyavaggo`) | Para 1 ➔ Chap 26 |
| **Sattakanipāta** | `s0403m3.mul` | 11 (0..10) | Chapters `39..46` (`1. Dhanavaggo`) | Para 1 ➔ Chap 39 |

* **Test Chakkanipāta**: Open `s0403m2.mul` at Chapter 0, Paragraph 1 (`1. Āhuneyyasuttaṃ`). Click **MAT ➔ Aṭṭhakathā**.
  * ✅ **Expected**: Opens `s0403a.att` at Chapter 26 (`1. Āhuneyyavaggo`), Paragraph 1.
* **Test Sattakanipāta**: Open `s0403m3.mul` at Chapter 0, Paragraph 1 (`1. Paṭhamadhanasuttaṃ`). Click **MAT ➔ Aṭṭhakathā**.
  * ✅ **Expected**: Opens `s0403a.att` at Chapter 39 (`1. Dhanavaggo`), Paragraph 1.

---

#### 3. Aṅguttaranikāya 8-9-10-11 (`s0404`)

* **Commentary**: `s0404a.att` (33 chapters: 0..32)
* **Sub-commentary**: `s0404t.tik` (33 chapters: 0..32)

| Volume | Mūla Book Code | Chapter Count | Commentary Chapters (`s0404a.att`) | Test Target |
| :--- | :--- | :--- | :--- | :--- |
| **Aṭṭhakanipāta** | `s0404m1.mul` | 11 (0..10) | Chapters `0..9` (`1. Mettāvaggo`) | Para 1 ➔ Chap 0 |
| **Navakanipāta** | `s0404m2.mul` | 10 (0..9) | Chapters `10..14` (`1. Sambodhivaggo`) | Para 1 ➔ Chap 10 |
| **Dasakanipāta** | `s0404m3.mul` | 23 (0..22) | Chapters `15..30` (`1. Ānisaṃsavaggo`) | Para 1 ➔ Chap 15 |
| **Ekādasakanipāta** | `s0404m4.mul` | 4 (0..3) | Chapters `31..32` (`1. Nissayavaggo`) | Para 1 ➔ Chap 31 |

* **Test Navakanipāta**: Open `s0404m2.mul` Chapter 0 Para 1 ➔ MAT Aṭṭhakathā ➔ Opens `s0404a.att` Chapter 10.
* **Test Dasakanipāta**: Open `s0404m3.mul` Chapter 0 Para 1 ➔ MAT Aṭṭhakathā ➔ Opens `s0404a.att` Chapter 15.
* **Test Ekādasakanipāta**: Open `s0404m4.mul` Chapter 0 Para 1 ➔ MAT Aṭṭhakathā ➔ Opens `s0404a.att` Chapter 31.

---

#### 4. Abhidhammapiṭaka Pañcapakaraṇa (`abh03`)

* **Commentary**: `abh03a.att` (Pañcapakaraṇa-aṭṭhakathā, 66 chapters)
* **Sub-commentary**: `abh03t.tik` (Pañcapakaraṇa-mūlaṭīkā, 5 chapters)

| Treatise | Mūla Book Code(s) | Commentary Chapters (`abh03a.att`) | Ṭīkā Chapter (`abh03t.tik`) |
| :--- | :--- | :--- | :--- |
| **Dhātukathā** | `abh03m1.mul` | Chapters `0..2` | Chapter `0` |
| **Puggalapaññatti** | `abh03m2.mul` | Chapters `3..5` | Chapter `1` |
| **Kathāvatthu** | `abh03m3.mul` | Chapters `6..38` | Chapter `2` |
| **Yamaka (1, 2, 3)** | `abh03m4.mul`, `abh03m5.mul`, `abh03m6.mul` | Chapters `39..49` | Chapter `3` |
| **Paṭṭhāna (1..5)** | `abh03m7.mul` .. `abh03m11.mul` | Chapters `50..65` | Chapter `4` |

---

#### 5. Vinayapiṭaka Sāratthadīpanī (`vin02`)

* **Sub-commentary**: `vin02t.tik` (Sāratthadīpanī-ṭīkā-3, 48 chapters)

| Section | Mūla Book Code | Commentary (`.att`) | Ṭīkā Chapters (`vin02t.tik`) |
| :--- | :--- | :--- | :--- |
| **Pācittiya** | `vin02m1.mul` | `vin02a1.att` | Chapters `0..7` |
| **Mahāvagga** | `vin02m2.mul` | `vin02a2.att` | Chapters `8..18` |
| **Cūḷavagga** | `vin02m3.mul` | `vin02a3.att` | Chapters `19..31` |
| **Parivāra** | `vin02m4.mul` | `vin02a4.att` | Chapters `32..47` |

