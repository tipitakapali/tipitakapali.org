# Database Structure Report — `tipitaka.db` & `translation_en.db`

> Generated: 2026-09-09 · SQLite 3.46 · App: `web_app_next/server_api`

This document explains every table in the two primary SQLite databases used by the
Tipiṭaka VRI web app:

| Database | Path | Size | Role |
|---|---|---|---|
| `tipitaka.db` | `server_api/db/tipitaka.db` | ~602 MB | Canonical Pāḷi Tipiṭaka (books, chapters, navigation tree, HTML, MAT cross-references, paragraph registry) |
| `translation_en.db` | `server_api/db/translation_en.db` | ~740 MB | English translations of the canon (paragraph-level + sentence-level) |

Both databases are opened **read-only** by `server.js` / `translationEngine.js` via
`better-sqlite3`, with `PRAGMA query_only = 1`, `synchronous = NORMAL`, `temp_store = MEMORY`.
They are built by the scripts in `dev_build_vri_db_2026/` (`build_pipeline.py`) and
`server_api/convert_translation_db.py` respectively.

A pair of companion **FTS5 search-index** databases (`fts_tipitaka.db`,
`fts_translation_en.db`) is built on top of these two and is described in §5.

---

## 1. `tipitaka.db` — canonical Pāḷi database (9 tables)

| Table | Rows | Purpose |
|---|---|---|
| `site_metadata` | 2 | key/value application metadata |
| `books` | 217 | one row per edition/book (mūla / aṭṭhakathā / ṭīkā / añña) |
| `chapters` | 2,695 | one row per chapter (chunk) incl. pre-rendered chapter HTML |
| `tree_nodes` | 2,860 | flattened navigation tree (categories → books → chapters) |
| `book_mat` | 217 | **book-level** Mūla-Aṭṭhakathā-Ṭīkā (MAT) links |
| `mat_para_map` | 111,024 | **paragraph-level** MAT cross-references |
| `mat_chapter_map` | 2,102 | **chapter-level** MAT cross-references |
| `book_toc` | 37,226 | per-book table-of-contents entries |
| `canon_paragraphs` | 523,277 | master registry of every canon paragraph (the file's "heart") |

---

## 1.1 `site_metadata`

Generic key/value store for database-level metadata.

| Column | Type | Description |
|---|---|---|
| `key` | TEXT | Primary key. Currently: `tree_json`, `version` |
| `value` | TEXT | JSON or plain value |

**Rows observed**

| key | value |
|---|---|
| `tree_json` | Full JSON navigation tree (Vinayapiṭaka / Suttapiṭaka / Abhidhammapiṭaka hierarchy, 2,860 nodes) — used as fallback source for the UI sidebar tree |
| `version` | `1.0` |

**Who reads it:** `server.js` → `stmtGetTreeMeta` (`SELECT value FROM site_metadata WHERE key='tree_json'`); used only if `server_api/tree.json` is missing.

---

## 1.2 `books`

Catalog of all 217 editions/books, one row per `book_code`.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | PK, autoincrement |
| `code` | TEXT | Unique book code, e.g. `s0101m.mul`, `vin01m.mul`, `abh01a.att`. Pattern: `<vol><seq><letter>.<ed>` where suffix is `m.mul` (mūla) / `a.att` (aṭṭhakathā) / `t.tik` (ṭīkā) |
| `title` | TEXT | Book title, e.g. `Dhammasaṅgaṇīpāḷi` |
| `nikaya` | TEXT | Pitaka/nikāya, e.g. `Vinayapiṭake`, `Dīghanikāyo`, `Khuddakanikāye`, `Abhidhammapiṭake`; empty for 72 rows |
| `category` | TEXT | `mūla` (61), `aṭṭhakathā` (49), `ṭīkā` (22), `añña` (85) |
| `xml_filename` | TEXT | Source CST4 XML file, e.g. `s0101m.mul.xml` |
| `chapter_count` | INTEGER | Number of chapters, e.g. 5 |
| `meta_json` | TEXT | JSON navigation/mapping envelope (see below) |

**`meta_json` structure** (per book; built by `build_pipeline.py`):

| Key | Content |
|---|---|
| `para_to_chapter` | 1-based CST para number → chapter_index |
| `chapter_to_paras` | chapter_index → list of 1-based para numbers |
| `para_to_index` | 1-based para number → 0-based `para_index` |
| `page_to_chapter` / `page_to_para` / `page_anchors` | page (edition) → chapter / para / anchor-id maps |
| `para_range` | `{min, max, total}` para numbers |
| `edition_ranges` | per-edition page ranges with labels |
| `book_type` | e.g. `Whole` |
| `mat` | flat MAT triplet for the book (mirrors `book_mat`) |
| `chapter_to_mat` / `para_to_mat` | per-chapter / per-para MAT links (mirror `mat_chapter_map` / `mat_para_map`) |

**Indexes:** `idx_books_code` on `code`.

**Who reads it:** `server.js` → `stmtGetBooks` (book list held in RAM), `stmtGetBook` (`/api/book/:code`).

---

## 1.3 `chapters`

One row per chapter/chunk of every book. This is the storage of the actual Pāḷi text:
each row's `html` holds the fully rendered chapter.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | PK, autoincrement |
| `book_id` | INTEGER | FK → `books.id` |
| `book_code` | TEXT | Denormalized book code (fast lookups without a join) |
| `chapter_index` | INTEGER | 0-based chapter number within the book |
| `title` | TEXT | Chapter title, e.g. `1. brahmajālasuttaṃ` |
| `chunk_name` | TEXT | Source chunk file, e.g. `s0101m.mul0.xml` |
| `anchor_id` | TEXT | Anchor, e.g. `chap-0` |
| `para_index` | INTEGER | 0-based index of the **first paragraph** of the chapter (start offset into the book) |
| `html` | TEXT | Full pre-rendered HTML of the chapter; every `<p>` carries `data-guid="<book_code>:c<ch>:n<node>:p<para>"`, `data-pindex`, and `id="pindex-N"` |

**Indexes:** `idx_chapters_book` (`book_code`), `idx_chapters_book_idx` (`book_code`, `chapter_index`), `idx_chapters_chunk` (`chunk_name`).

**Who reads it:** `server.js` → `stmtGetChapters` (chapter list), `stmtGetChapterHtml`, `stmtGetChaptersRangeHtml` (`/api/book/:code/chapters?start=&end=`), `stmtGetAllChaptersHtml`.

---

## 1.4 `tree_nodes`

The 2,860-node navigation tree, stored as a flat adjacency list (derived from `tree.json`).

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | PK |
| `text` | TEXT | Display label, e.g. `Pārājikapāḷi` |
| `parent_id` | INTEGER | Parent node id (self-referencing; NULL for roots) |
| `node_type` | TEXT | `category` (261), `book` (24), `chapter` (2,575) |
| `book_code` | TEXT | Book code for book/chapter nodes |
| `chapter_index` | INTEGER | Chapter index for chapter leaf nodes |
| `href` | TEXT | CST4 URL, e.g. `cscd/vin01m.mul0.xml` |

**Indexes:** `idx_tree_parent` (`parent_id`).

**Who reads it:** relational alternative to `site_metadata.tree_json`; the running server prefers the in-memory `tree.json` / `site_metadata` copy.
---

## 1.5 `book_mat`

Book-level MAT (Mūla–Aṭṭhakathā–Ṭīkā) mapping. Every book appears exactly once (217 rows);
for a mūla book `mula_code = book_code`; for a commentary the row still points at the root
text it belongs to.

| Column | Type | Description |
|---|---|---|
| `book_code` | TEXT | PK |
| `category` | TEXT | `mūla` / `aṭṭhakathā` / `ṭīkā` / `añña` |
| `mula_code` / `mula_title` | TEXT | Root (mūla) edition code/title |
| `attha_code` / `attha_title` | TEXT | Commentary (aṭṭhakathā) edition code/title |
| `tika_code` / `tika_title` | TEXT | Sub-commentary (ṭīkā) edition code/title |

**Indexes:** `idx_book_mat_code` (`book_code`).

**Who reads it:** `server.js` → `stmtGetMat` (`/api/mat?book=`), `stmtGetAllMat` (`/api/mat`).

---

## 1.6 `mat_para_map`

Paragraph-level MAT cross-references: for each paragraph of a source book, points to the
matching paragraph(s) in the mūla / aṭṭhakathā / ṭīkā editions.

| Column | Type | Description |
|---|---|---|
| `source_book` | TEXT | Book whose paragraph we are mapping from |
| `source_chapter` | INTEGER | Chapter index of the source paragraph |
| `source_para` | TEXT | Source para number (numeric string; part of PK) |
| `sub_book` | TEXT | Sub-section within the book, e.g. `dhatukatha` (only in some Abhidhamma books) |
| `mula_book` / `mula_chapter` / `mula_para` / `mula_title` | TEXT/INT | Match in the mūla edition |
| `attha_book` / `attha_chapter` / `attha_para` / `attha_title` | TEXT/INT | Match in the aṭṭhakathā |
| `tika_book` / `tika_chapter` / `tika_para` / `tika_title` | TEXT/INT | Match in the ṭīkā |

Primary key: `(source_book, source_chapter, source_para)`. `source_para`/`mula_para` etc.
are declared TEXT but hold numeric strings (para numbers).

**Indexes:** `idx_mat_para_lookup` (`source_book`, `source_chapter`, `source_para`), `idx_mat_para_src` (`source_book`, `source_para`).

**Who reads it:** `server.js` → `stmtGetMatParaChap` (para within chapter), `stmtGetMatPara`, `stmtGetMatParaSub` (sub_book lookups), `stmtGetMatParaSibs`; `aiController.js` (MAT sidebar navigation).

---

## 1.7 `mat_chapter_map`

Chapter-level MAT mapping — same idea as `mat_para_map` but one row per (book, chapter).

| Column | Type | Description |
|---|---|---|
| `source_book` | TEXT | PK part |
| `source_chapter` | INTEGER | PK part |
| `mula_book` / `mula_chapter` / `mula_title` | TEXT/INT | Chapter match in mūla |
| `attha_book` / `attha_chapter` / `attha_title` | TEXT/INT | Chapter match in aṭṭhakathā |
| `tika_book` / `tika_chapter` / `tika_title` | TEXT/INT | Chapter match in ṭīkā |

Primary key: `(source_book, source_chapter)` · Index: `idx_mat_chap_src`.

**Who reads it:** `server.js` → `stmtGetMatChapter` (chapter-level MAT tab).

---

## 1.8 `book_toc`

Per-book table of contents, one row per TOC entry (37,226 rows).

| Column | Type | Description |
|---|---|---|
| `book_id` | INTEGER | Denormalized `books.id` |
| `book_code` | TEXT | Denormalized book code |
| `item_index` | INTEGER | Ordering index within the book |
| `level` | INTEGER | Heading depth (0 = top) |
| `type` | TEXT | `nikaya` (184) · `book` (218) · `title` (6,361) · `subhead` (27,728) · `subsubhead` (83) · `chapter` (2,652) |
| `rend` | TEXT | Rendition hint (matches the `rend` class of the paragraph) |
| `title` | TEXT | Heading text |
| `para_index` | INTEGER | 0-based index of the paragraph the heading points at |
| `para_num` | TEXT | CST para number (nullable) |
| `anchor_id` | TEXT | e.g. `para-N` |
| `chapter_index` | INTEGER | Chapter the entry belongs to |

**Indexes:** `idx_book_toc_code` (`book_code`, `item_index`).

**Who reads it:** `server.js` → `stmtGetToc` (`/api/book/:code/toc`).
---

## 1.9 `canon_paragraphs`

**The master paragraph registry of the whole canon — 523,277 paragraphs over 217 books and
17,390 distinct suttā titles.** Every other part of the system keys off this table.

| Column | Type | Description |
|---|---|---|
| `global_id` | INTEGER | PK, autoincrement |
| `guid` | TEXT | Unique global id, format `<book_code>:c<ch>:n<node>:p<para>`, e.g. `s0101m.mul:c0:n0:p0` |
| `book_code` | TEXT | Book code |
| `sub_book` | TEXT | Sub-section within a book, e.g. `dhatukatha` (nullable) |
| `chapter_index` | INTEGER | 0-based chapter |
| `chapter_title` | TEXT | Chapter title |
| `sutta_title` | TEXT | Sutta/section heading (17,390 distinct) |
| `para_index` | INTEGER | 0-based paragraph index within the book (0…15,943) |
| `para_num` | TEXT | CST 1-based para number (nullable — 44,027 NULL rows) |
| `para_first` / `para_last` | INTEGER | Inclusive CST para-number range of this registry row (NULL for 44,031 rows) |
| `rend` | TEXT | Typographic style: `bodytext` (214,381) · `gatha1` (82,172) · `gathalast` (80,689) · `hangnum` (59,237) · `subhead` (27,728) · `centre` (22,276) · `gatha2` (12,046) · `gatha3` (8,318) · `unindented` (4,112) · `indent` (2,820) · `chapter` (2,652) · `book` (218) · `nikaya` (184) · `subsubhead` (83) |
| `pali_text` | TEXT | The paragraph's Pāḷi text |
| `word_count` | INTEGER | Number of words |
| `mula_guid` / `mula_book` / `mula_chapter` / `mula_para` | TEXT/INT | Link to the matching paragraph in the mūla edition |
| `attha_guid` / `attha_book` / `attha_chapter` / `attha_para` | TEXT/INT | Link to the matching paragraph in the aṭṭhakathā |
| `tika_guid` / `tika_book` / `tika_chapter` / `tika_para` | TEXT/INT | Link to the matching paragraph in the ṭīkā |
| `match_quality` | TEXT | Quality of the MAT match: `exact` (223,487) · *(empty)* (155,099) · `section` (82,503) · `span` (31,409) · `chapter_fallback` (30,779) |

**Indexes:** `idx_canon_guid` (unique, on `guid`) · `idx_canon_book_chap` (`book_code`, `chapter_index`) · `idx_canon_book_para` (`book_code`, `para_num`) · `idx_canon_book_pindex` (`book_code`, `para_index`) · `idx_canon_sub_book` (`book_code`, `sub_book`).

**Who reads it:**
- `aiController.js` — canon text by `guid` (`stmtGetCanonByGuid`) and "closest paragraph" lookup (`ORDER BY ABS(para_first - ?)`, `stmtGetClosestCanonPara`);
- `aiQueryUnderstanding.js` — sutta discovery (`GROUP BY sutta_title` within a chapter);
- `convert_translation_db.py` — builds the `(book_code, para_index) → (chapter_index, guid, para_num)` lookup used to populate `translation_*.db`;
- `build_translation_fts.py` / `export_static_cloudflare.py` — static export and FTS indexing.

---

## 2. `translation_en.db` — English translations (3 tables)

| Table | Rows | Purpose |
|---|---|---|
| `paragraph_translations` | 464,546 | one aggregated translation per canon paragraph |
| `sentence_translations` | 1,224,451 | sentence-level translation lines (child of the above) |
| `translation_meta` | 9 | language/database metadata |

The same 3-table schema is reused for every language (`translation_vi.db`,
`translation_my.db`, …) by the converter `server_api/convert_translation_db.py`.

---

## 2.1 `paragraph_translations`

Paragraph-level translations. The primary key `(book_code, chapter_index, para_index)`
mirrors the same three key columns of `canon_paragraphs`, so each row maps 1:1 onto a
canon paragraph (when a translation exists).

| Column | Type | Description |
|---|---|---|
| `book_code` | TEXT | Canon book code |
| `chapter_index` | INTEGER | 0-based chapter |
| `para_index` | INTEGER | 0-based paragraph index |
| `guid` | TEXT | Exact `canon_paragraphs.guid` of the source paragraph (464,539 of 464,546 rows link; 7 don't) |
| `para_num` | TEXT | CST para number (nullable) |
| `translation` | TEXT | Full translated paragraph text |
| `sentence_count` | INTEGER | Number of sentence lines (default 1) |
| `sentences_json` | TEXT | JSON array of `{"line_id": N, "translation": "…"}` — mirrors `sentence_translations` |

Primary key: `(book_code, chapter_index, para_index)`.

**Indexes:** `idx_pt_book_chap` (`book_code`, `chapter_index`) · `idx_pt_guid` (`guid`).

**Who reads it:** `translationEngine.js` → `stmtChapter` (whole chapter), `stmtPara` (one para), `stmtGuid` (by guid) — powers every translation view in the app; `aiController.js` (multi-language translation display).
---

## 2.2 `sentence_translations`

Sentence-level translations — child rows of `paragraph_translations`. A paragraph with
N sentences produces N rows here with `line_id` 1…N. Total: 1,224,451 lines.

| Column | Type | Description |
|---|---|---|
| `book_code` | TEXT | Canon book code |
| `chapter_index` | INTEGER | 0-based chapter |
| `para_index` | INTEGER | 0-based paragraph index |
| `line_id` | INTEGER | 1-based sentence/line number within the paragraph |
| `translation` | TEXT | The translated sentence/line |

Primary key: `(book_code, chapter_index, para_index, line_id)` · Index: `idx_st_book_chap` (`book_code`, `chapter_index`).

**Who reads it:** populating/validation scripts (`convert_translation_db.py`,
`normalize_vi_homage.py`); used for sentence-aligned display.

---

## 2.3 `translation_meta`

Language/database metadata as key/value pairs.

| key | value |
|---|---|
| `lang_code` | `en` |
| `lang_id` | `english` |
| `name` | `English` |
| `native_name` | `English` |
| `flag` | `🇬🇧` |
| `total_sentences` | `1278920` |
| `total_paragraphs` | `464546` |
| `total_books` | `217` |
| `converted_at` | `2026-09-04T17:59:09Z` |

**Who reads it:** `translationEngine.js` loads it into the engine's `meta` object
(knowledge of the translation DB is exposed to the routes that serve language tabs).

---

## 3. Relationships between the two databases

```
canon_paragraphs (tipitaka.db)                      translation_en.db
book_code, chapter_index, para_index ───────────────► paragraph_translations (same 3 cols; PK)
guid ───────────────────────────────────────────────► paragraph_translations.guid   (464,539 linked / 7 not)
paragraph_translations ── 1:N (by PK, line_id) ────► sentence_translations
books.code ── 1:N ──► chapters.book_code / book_toc.book_code / canon_paragraphs.book_code / paragraph_translations.book_code
books.id ──► chapters.book_id
```

- Coverage: `paragraph_translations` covers **88.8 %** of the 523,277 canon paragraphs
  (464,546 / 523,277).
- `guid` is the stable join key across DBs for exact paragraph identity; the
  `(book_code, chapter_index, para_index)` triple is the fast positional key.
- MAT links (`book_mat`, `mat_para_map`, `mat_chapter_map` and the `*_guid`/`*_book`/`*_chapter`/`*_para`
  columns of `canon_paragraphs`) enable the "parallel reading" of mūla / aṭṭhakathā / ṭīkā.

## 4. SQLite housekeeping tables

- `sqlite_sequence` — internal; tracks the last autoincrement value of `books.id`.
- `sqlite_stat1` — internal; query-planner statistics from `ANALYZE` (created at build time).

## 5. Companion FTS search databases (for reference)

Full-text search does **not** live inside `tipitaka.db` / `translation_en.db`. It is kept in
separate, pre-built FTS5 shadow databases in the same folder:

- `fts_tipitaka.db` → virtual table `paragraphs_fts` (+ FTS5 shadow tables `..._data`,
  `..._idx`, `..._content`, `..._docsize`, `..._config`) for Pāḷi search — built by
  `server_api/generate_fts.py` (FTS5 `unicode61 remove_diacritics`).
- `fts_translation_en.db` → virtual table `paragraphs_fts` for English full-text search —
  built by `server_api/build_translation_fts.py`.
- They are opened lazily via `server.js` → `getSearchDatabase()` (`fts_translation_<lang>.db`).

## 6. Quick reference — book codes & categories

- Book code shape: `<vol><seq><letter>.<edition>`, e.g. `s0101m.mul`, `s0102a.att`, `s0103t.tik`.
- Categories (217 books): `mūla` (61), `aṭṭhakathā` (49), `ṭīkā` (22), `añña` (85).
- Nikāya values: `Vinayapiṭake`, `Dīghanikāyo`, `Majjhimanikāyo`, `Saṃyuttanikāye`,
  `Aṅguttaranikāyo`, `Khuddakanikāye`, `Suttantapiṭaka`, `Abhidhammapiṭake`, plus
  sub-commentary groupings and 72 books with empty `nikaya`.