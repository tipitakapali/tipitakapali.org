# Chaṭṭha Saṅgāyana Tipiṭaka — TipitakaPali.org Apps

<div align="center" id="download-offline-tipitaka-pali-apps">
  <img src="docs/img/Tipitakapali.org-1024x448-compressed.png" alt="Tipitakapali.org" />
<br /> <br />
<a target="_blank" href="https://apps.apple.com/vn/app/tipitakacst/id6743404213"><img height="50" src="docs/img/Apple_logo_dark_grey.svg.png" alt="Download for macOS"></a>
<span>&nbsp;&nbsp;&nbsp;</span>
<a target="_blank" href="https://github.com/tipitakapali/tipitakapali.org/releases"><img height="50" src="docs/img/Tux.svg.png" alt="Download for Linux"></a>
<span>&nbsp;&nbsp;&nbsp;</span>
<a target="_blank" href="https://apps.microsoft.com/store/detail/9NL71SJP2XMH"><img height="50" src="docs/img/Windows_logo_-_2012.svg.png" alt="Download for Windows"></a>
<br /> <br />
<a target="_blank" href="https://apps.apple.com/vn/app/tipitakacst/id6743404213"><img height="40" src="docs/img/download-on-the-app-store.svg" alt="Download on the App Store"></a>
<span>&nbsp;&nbsp;&nbsp;</span>
<a target="_blank" href="https://play.google.com/store/apps/details?id=org.tipitakapali.android"><img height="40" src="docs/img/Google_Play_Store_badge_EN.svg" alt="Get it on Google Play"></a>
<span>&nbsp;&nbsp;&nbsp;</span>
<a target="_blank" href="https://github.com/tipitakapali/tipitakapali.org/releases"><img height="40" src="docs/img/tipitakapali.org.apk.png" alt="Download APK"></a>
<br/> <br/> 
<a target="_blank" href="https://tipitakapali.org">Tipitakapali.org</a> offline software is available for all major platforms: Windows, macOS, Linux, Android, and iOS.

</div>

## 👋 Welcome

### Read & learn Tipiṭaka Pāḷi

[Tipitakapali.org](https://tipitakapali.org) and its [offline apps](#download-offline-tipitaka-pali-apps) aim to offer a simple and pleasant way to read and learn Tipiṭaka Pāḷi. They include helpful Pāḷi and Sanskrit dictionaries, as well as full-text search features.

The Pāḷi Roman text on [Tipitakapali.org](https://tipitakapali.org) follows the latest Chaṭṭha Saṅgāyana Tipiṭaka (CST) - [Official VRI Edition](https://github.com/VipassanaTech/tipitaka-xml). The most recent update by VRI, including typo corrections and other improvements, was in **Aug 2024**. We strive to stay in sync with VRI updates, ensuring you always have access to the latest corrections.

### ✅ Key Features  

✔ Integrated powerful Pāḷi and Sanskrit dictionaries for enhanced learning  

✔ Access to the latest Chaṭṭha Saṅgāyana Tipiṭaka (CST) Pāḷi text  

✔ Powerful full-text search for quick and easy navigation  

✔ Simple, classical reading interface for distraction-free study  

✔ AI Assistant for Pāḷi->English translations & Pāḷi grammar analysis (online web app only: requires internet connection)

### 🌟 Attributions & more info
Check [https://tipitakapali.org/info](https://tipitakapali.org/info)

---

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
├── export_static_cloudflare.py          # Static Edge Distribution Exporter for Cloudflare Pages (tipitakapali.org)
├── generate_seo_ai_metadata.py          # Static OpenGraph, sitemap, and LLM metadata generator
├── next.config.js                       # Next.js bundler and compiler configuration
├── tailwind.config.js                   # Tailwind theme colors, typography, and dark-mode setup
├── package.json                         # Node.js dependencies and run scripts
└── .gitignore                           # Repository ignore rules (excludes databases and heavy build artifacts)
```

---

## 🚀 Publishing & Release Guide (Checklist)

Use this checklist whenever you update code, SEO routes, translations, or databases so nothing is missed before pushing to Git and publishing live.

### Scripts Quick Reference

| Script | When to Run | What It Does |
| :--- | :--- | :--- |
| `python3 generate_seo_ai_metadata.py --public-only` | After changing books, chapters, translations, SEO routes, or AI API docs | Regenerates `public/sitemap.xml` (40 child sitemaps, 112,995 canonical URLs), `public/robots.txt`, `public/llms.txt`, `public/llms-full.txt`, and `public/site.jsonld`. |
| `bash tipitakapali_org_app/scripts/sync_web_bundle.sh` | After changing web UI, CSS, JS, or `server_api/db/dpd_goldendict.js` | Rebuilds static export into `tipitakapali_org_app/assets/web.zip` and extracts all 5 DPD family tables into `tipitakapali_org_app/assets/dpd_family_data.json.gz`. |
| `node --test __tests__/*.test.mjs` | Before every `git push` | Runs all web, Ani AI, SEO, sitemap, routing, and reader unit/regression tests. |
| `(cd tipitakapali_org_app && flutter analyze && flutter test)` | Before every `git push` touching offline app / `web.zip` | Verifies Dart analysis and all Flutter offline server/UI tests. |
| `npm run build` | Before VPS deploy (and after `sync_web_bundle.sh`) | Builds the Next.js SSR standalone production server (`.next/standalone`). |
| `python3 export_static_cloudflare.py` | When deploying static files to Cloudflare Pages (`next_tipitakapali.org`) | Exports static site (`Option 1`), static translation JSONs (`Option 2`), or both (`Option 3`), and syncs `next_tipitakapali.org/`. |
| `python3 scripts/submit_indexnow.py` | **After** the live site is deployed | Notifies Bing, Yandex, Seznam, Naver, and Yep via IndexNow for fast indexing. |
| `bash tipitakapali_org_app/scripts/upload_db_releases.sh` | After rebuilding any `.db` file | Uploads updated SQLite zips to GitHub Releases (`db`) and updates `tipitakapali_org_app/assets/databases_manifest.json`. |
| `dev_build_vri_db_2026/run.sh` | Only when rebuilding `tipitaka.db` / `fts_tipitaka.db` from VRI XML | Runs full VRI XML transliteration, DB build, FTS5 indexing, and verification. |

---

### Step 1: Prepare & Verify Before `git push` (Main Repo)

Run from the repository root (`tipitakapali.org/`):

```bash
# 1. Regenerate sitemaps, robots.txt, llms.txt, llms-full.txt, and site.jsonld
python3 generate_seo_ai_metadata.py --public-only

# 2. Rebuild offline Flutter web bundle (assets/web.zip + assets/dpd_family_data.json.gz)
bash tipitakapali_org_app/scripts/sync_web_bundle.sh

# 3. Run all web & Flutter tests
node --test __tests__/*.test.mjs
(cd tipitakapali_org_app && flutter analyze && flutter test)

# 4. Restore & verify Next.js SSR standalone production build
#    (Important: sync_web_bundle.sh leaves .next in static export mode)
npm run build
```

Before committing, check `git status` to make sure no temporary/uncompressed files (such as an unzipped `tipitakapali_org_app/assets/dpd_family_data.json`) are staged by accident:

```bash
git status
git add -A
git commit -m "Describe your changes"
git push origin main
```

> **CI Note:** Pushing changes under `tipitakapali_org_app/**` (including `assets/web.zip`) to `main` automatically triggers `.github/workflows/build_windows_linux.yml` to build Windows and Linux installers.

---

### Step 2A: Publish Live Website — VPS Next.js SSR (Full Multi-Script & 23-Language SEO)

Full SSR serves live HTML for all 17 Pāḷi scripts (`/book/{book_code}`, `/book/{script}.{book_code}`, plus chapters) and all 23 translations (`/translation/{lang}/{book_code}`, plus chapters) on-demand with edge caching (`Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`) and bounded RAM cache (`isrFlushToDisk: false`, so VPS disk never fills up).

On your VPS:

```bash
cd /path/to/tipitakapali.org
git pull origin main
npm ci             # only needed if package.json / package-lock.json changed
npm run build

# Restart Fastify API backend (port 8400 by default) if server_api/ changed
# Restart Next.js SSR server (port 3000, BACKEND_API_URL=http://127.0.0.1:8400)
# e.g. pm2 restart all   (or systemctl restart tipitaka-api tipitaka-web)
```

**Cloudflare Dashboard Setup for VPS SSR & Markdown for Agents:**
- Route `/book/*`, `/translation/*`, and `/sitemap*.xml` to your VPS Next.js SSR origin, with Cloudflare Cache Rules set to **Respect origin `Cache-Control`**.
- Legacy `/book/{code}?l={lang}` and `/book/{code}{N}` links automatically `301` redirect in `proxy.js` to `/translation/{lang}/{code}` or `/book/{code}/{N+1}`.
- **Markdown for Agents (`Accept: text/markdown`)**:
  - **VPS Next.js SSR**: `proxy.js` and `/api/markdown/[[...path]]` automatically negotiate `Accept: text/markdown`, returning structured Markdown with YAML frontmatter, JSON-LD, `Content-Type: text/markdown; charset=utf-8`, `Vary: Accept`, `x-markdown-tokens`, and `Content-Signal: ai-train=yes, search=yes, ai-input=yes` while keeping HTML as the default for browsers.
  - **Cloudflare Free Plan (Zero Workers Quota)**:
    - **Step A (Origin Rule — so `/book/*`, `/translation/*`, `/info`, `/` with `Accept: text/markdown` render real page/chapter Markdown from your VPS Fastify server)**:
      Go to **Cloudflare Dashboard → zone `tipitakapali.org` → Rules → Overview → Create rule → Origin Rule**:
      - **Rule name**: `Route Markdown for Agents to VPS`
      - **If incoming requests match → Custom filter expression**:
        ```text
        any(http.request.headers["accept"][*] contains "text/markdown") and not ends_with(http.request.uri.path, ".md") and not ends_with(http.request.uri.path, ".txt")
        ```
      - **Then → Host Header → Rewrite to**: `api.tipitakapali.org`
      - **DNS Record → Override to**: `api.tipitakapali.org`
      *(With this Origin Rule enabled, you can **delete or disable** the static `/llms.txt` URL Rewrite Rule 5, because `server_api/server.js` on `api.tipitakapali.org` now serves the exact Markdown of `/`, `/info`, `/book/s0101m.mul/1`, `/book/si.s0102m.mul/9`, `/translation/vi/s0102m.mul/9`, etc. with `Content-Type: text/markdown; charset=utf-8` and `x-markdown-tokens`!)*
    - **Step B (Fallback URL Rewrite Rule — only if you do NOT use the Origin Rule above)**:
      Go to **Rules → Overview → Create rule → URL Rewrite Rule** (Place at: **Last**):
      - **If incoming requests match**:
        ```text
        any(http.request.headers["accept"][*] contains "text/markdown") and not ends_with(http.request.uri.path, ".md") and not ends_with(http.request.uri.path, ".txt") and not starts_with(http.request.uri.path, "/api/")
        ```
      - **Then → Path → Rewrite to → Static**: `/llms.txt` (Query → **Preserve**).
- If migrating from static Cloudflare Pages, **disable** the legacy SPA-shell URL Rewrite Rules (Rules 1–3 below) for `/book/*` and `/chapter/*` so Cloudflare does not overwrite SSR HTML with `/`.

---

### Step 2B: Publish Live Website — Cloudflare Pages Static Export (`next_tipitakapali.org`)

If you also/instead deploy the static edge build to Cloudflare Pages:

```bash
# Interactive menu: 1 = website only, 2 = translation JSONs only, 3 = both
python3 export_static_cloudflare.py

# Push the synced Cloudflare Pages repository
cd next_tipitakapali.org
git status
git add -A
git commit -m "Update static build"
git push origin main
```

> **Note:** dictionary, search, inflection, and the **Ani AI chat** endpoints (`/api/ai/chat`, `/api/ai/paragraph_content`, `/api/ai/tools`, …) are **not** proxied through Cloudflare — the browser calls `https://api.tipitakapali.org` directly (`services/api.js:getApiBase`) and MAT maps load from static JSON first (`fetchMatStaticMap`), so no Worker hop and no quota burn. After any change in `server_api/`, restart the Fastify API server on the VPS.

---

### Step 3: Notify Search Engines After Live Deploy (IndexNow & Sitemaps)

Once the live site is updated and reachable at `https://tipitakapali.org`:

```bash
# 1. Preview book-level URLs across all 17 scripts + 23 translations (8,425 URLs, 1 batch)
python3 scripts/submit_indexnow.py --only-books --dry-run

# 2. Verify live IndexNow key file and submit book-level URLs (fast, recommended for routine updates)
python3 scripts/submit_indexnow.py --only-books --verify-live

# 3. Full submission of all 112,995 canonical URLs (auto-chunked at 10,000/request)
python3 scripts/submit_indexnow.py --verify-live

# 4. Or submit specific updated URLs only
python3 scripts/submit_indexnow.py --urls https://tipitakapali.org/ https://tipitakapali.org/translation/vi/s0102m.mul
```

In **Google Search Console** and **Bing Webmaster Tools**, only submit the single Sitemap Index URL:
- `https://tipitakapali.org/sitemap.xml` (automatically references all 40 child sitemaps: `sitemap-main.xml`, 16 `sitemap-{script}.xml`, and 23 `sitemap-lang-{lang}.xml`).

---

### Step 4: Publish Offline Apps & Database Releases (`tipitakapali_org_app/`)

See [`tipitakapali_org_app/README.md`](tipitakapali_org_app/README.md) for platform build details (Android Play Store, iOS/macOS App Store, Windows, Linux) and database release uploads (`bash tipitakapali_org_app/scripts/upload_db_releases.sh`).

---

## ⚡ Quick Start & Local Development

### 1. Local Development (Next.js + Fastify API)

#### Terminal A: Start the API Backend
```bash
cd server_api
node server.js
```
*(Runs on port `8400` by default, or port specified by `PORT` env)*

#### Terminal B: Start Next.js Frontend
```bash
npm run dev
```
Open **`http://localhost:3000`** in your browser.

---

### 2. Building & Verifying the Tipitaka Databases

To regenerate or verify the primary SQLite databases from authentic VRI XML:

```bash
cd dev_build_vri_db_2026

# Verify existing databases (integrity checks & all 6 multi-volume test suites)
python3 build_pipeline.py --verify-only

# Or rebuild tipitaka.db from scratch (~13 seconds)
python3 build_pipeline.py --db-only

# Or full 1-command build (translit + db + fts + verify)
./run.sh
```

---

### 3. Legacy Static Cloudflare Pages URL Rewrite Rules (Only if NOT using VPS SSR)

If serving solely from static Cloudflare Pages without VPS SSR, deep links such as `/book/s0101m.mul/1` (chapter), `/book/si.s0101m.mul` (script prefix), `/book/si.s0101m.mul/1` (both), and `/translation/vi/s0101m.mul` have **no pre-rendered static file** — only plain `/book/<code>` does (217 SEO pages). These rules serve the SPA shell (`/`) server-side while keeping the browser URL intact, so the client router opens the right book/chapter/script/translation.

Why URL Rewrite rules and not `_redirects` or Functions:
- Cloudflare rejects `/book/* /index.html 200` in `_redirects` as an infinite loop (rules get ignored), and `_redirects` rewrites would shadow the real SEO files anyway.
- Functions are **not** generated by default because every `/book/*`, `/translation/*`, and `/chapter/*` hit costs 1 Workers invocation — search/AI crawlers alone can exhaust the 100k/day Free quota (Error 1027). The exporter keeps them only as a legacy opt-in backup (`--with-spa-fallback`).

**Setup:** Dashboard → zone `tipitakapali.org` → **Rules → Overview → Create rule → URL Rewrite Rule**. For each rule: **If incoming requests match → Custom filter expression** (Expression Editor), Query → **Preserve**. Rules 1–3 use action **Rewrite to → Static `/`**; Rule 4 uses **Rewrite to → Dynamic** (value below):

```text
Rule 1 — "SPA shell: chapter & translation paths"
(starts_with(http.request.uri.path, "/chapter/") or
 starts_with(http.request.uri.path, "/translation/")) and
not any(http.request.headers["accept"][*] contains "text/markdown")

Rule 2 — "SPA shell: book chapter deep-links"
starts_with(http.request.uri.path, "/book/") and
(ends_with(http.request.uri.path, "0") or
 ends_with(http.request.uri.path, "1") or
 ends_with(http.request.uri.path, "2") or
 ends_with(http.request.uri.path, "3") or
 ends_with(http.request.uri.path, "4") or
 ends_with(http.request.uri.path, "5") or
 ends_with(http.request.uri.path, "6") or
 ends_with(http.request.uri.path, "7") or
 ends_with(http.request.uri.path, "8") or
 ends_with(http.request.uri.path, "9")) and
not (http.request.uri.path contains "/__next") and
not any(http.request.headers["accept"][*] contains "text/markdown")

Rule 3 — "SPA shell: script-prefixed books"
(starts_with(http.request.uri.path, "/book/si.") or
 starts_with(http.request.uri.path, "/book/hi.") or
 starts_with(http.request.uri.path, "/book/thai.") or
 starts_with(http.request.uri.path, "/book/laos.") or
 starts_with(http.request.uri.path, "/book/my.") or
 starts_with(http.request.uri.path, "/book/km.") or
 starts_with(http.request.uri.path, "/book/beng.") or
 starts_with(http.request.uri.path, "/book/gurm.") or
 starts_with(http.request.uri.path, "/book/tham.") or
 starts_with(http.request.uri.path, "/book/guja.") or
 starts_with(http.request.uri.path, "/book/telu.") or
 starts_with(http.request.uri.path, "/book/kann.") or
 starts_with(http.request.uri.path, "/book/mala.") or
 starts_with(http.request.uri.path, "/book/brah.") or
  starts_with(http.request.uri.path, "/book/tibt.") or
  starts_with(http.request.uri.path, "/book/cyrl.")) and
not any(http.request.headers["accept"][*] contains "text/markdown")

Rule 4 — "Translation JSON: strip .json suffix"
starts_with(http.request.uri.path, "/api/book/") and
ends_with(http.request.uri.path, ".json") and
http.request.uri.path contains "/translation/"
Rewrite to (Dynamic): substring(http.request.uri.path, 0, -5)

Rule 5 — "Markdown for Agents (Accept: text/markdown)" [Place at: LAST]
any(http.request.headers["accept"][*] contains "text/markdown") and
not ends_with(http.request.uri.path, ".md") and
not ends_with(http.request.uri.path, ".txt") and
not starts_with(http.request.uri.path, "/api/")
Rewrite to (Static): /llms.txt
```

Design notes (do not "simplify" without re-testing):
- Rule 2 matches on *trailing digit* because the Free plan forbids the `matches` (wildcard) operator (Business+ only). Real files never end in a digit (codes end `.mul`/`.att`/`.tik`/`.nrf`, payloads end `.txt`), so there is no shadowing. The `not … "/__next"` guard protects RSC flight payloads.
- Rule 3 checks include the `/book/` prefix so a real code can never false-match.
- Plain `/book/<code>` matches **no** rule → pre-rendered SEO HTML serves directly. Verify via view-source (book title, not the generic shell).
- Legacy `/chapter/{code}{N}` gets the shell + client-side open (no true 301 — Rules expressions can't do the `N+1` arithmetic; the backup Function does the 301 if rules are ever removed).
- Rule 4 exists because the `_redirects` placeholder in `/api/book/:code/translation/:lang` also matches the direct `.json` request (`:lang` binds `en.json` → rewrites to `en.json.json` → 404). Stripping the suffix first lets the existing `_redirects` rule serve the file. Dashboard rewrites run before Pages routing, so this costs zero Workers quota. Same mechanism explains why direct `.json` URLs for the older API files (e.g. `/api/book/<code>.json`) also 404 — clients must use clean URLs or a Rule-4-style pattern.

**Verify after deploying rules** (see Rules → Trace, plus live checks): `/book/s0101m.mul/1`, `/book/si.s0101m.mul`, `/book/si.s0101m.mul/1`, `/book/s0101m.mul` (must stay pre-rendered), and `/api/book/s0101m.mul/translation/en.json` (must return 200 `application/json`).

---

## 🧭 Multi-Volume MAT Navigation System

The application features a **Sub-Book Disambiguation Engine** for collections split into multiple volumes at the Mūla level (e.g., Aṅguttaranikāya 2-3-4, 5-6-7, 8-9-10-11, Pañcapakaraṇa, and Vinaya):
- **Partitioned Paragraph Maps**: Paragraph numbers repeating across nipātas (such as paragraph 2) are mapped per sub-book (`an2`, `an3`, `an4`) rather than collapsed into a single flat dictionary.
- **Bidirectional Offsets**: Jumping from Mūla to commentary uses chapter offsets (`attha_start_chapter`); jumping from commentary to Mūla automatically identifies the active volume and computes relative chapter indexes.
- **DOM Scoping**: Reader queries are scoped by `[data-chapter="..."]`, preventing duplicate DOM ID collisions across chapter buffers.
