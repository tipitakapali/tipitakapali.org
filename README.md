# Chaṭṭha Saṅgāyana Tipiṭaka — Next.js Edition

Modern, high-performance Tipiṭaka Reader built with **Next.js 14 (App Router)**, **Tailwind CSS**, and **Lucide Icons** with a comprehensive **Advanced Settings UI**.

---

## Key Features

- **Advanced Settings UI (`SettingsModal.jsx`)**:
  - **Typography**: Choose between Gentium Plus, EB Garamond, Georgia/System Serif, and Sans-Serif fonts; adjust font sizes (`14px`–`32px`) and line-heights (`1.4`–`2.6`) with live text previews, text alignment (Justified / Left), and Tipitaka paragraph indentation.
  - **Themes & Accent Colors**: Light (Classic), Warm Sepia, Dark Charcoal, and OLED Pure Black themes with selectable accent colors (Burgundy, Saffron Gold, Forest Emerald, Royal Indigo, Slate).
  - **Display Toggles**: Show/hide Page Number Breaks (`[VRI 1.23]`, `[PTS 2.45]`), Paragraph numbers (`1.`, `2.`), Footnotes, and Chapter headings.
  - **Layout & Tree Density**: Adjust reader column width (`760px`, `880px`, `1100px`), navigation tree density (Compact, Normal, Spacious), and animations.
  - **Backup & Migration**: Export settings to JSON, import from JSON, or reset to defaults.

- **Multi-Tab Reading**:
  - Open multiple books simultaneously in tabs with tab scrolling, middle-click to close, and individual scroll memory.

- **Navigation Tree**:
  - Direct top-level access to the 4 authentic categories: **Tipiṭaka (Mūla)**, **Aṭṭhakathā**, **Ṭīkā**, and **Añña**.
  - Hierarchical guide connecting lines, book chapter count badges, single-button `⊞ Expand` / `⊟ Collapse` toggle, and `◖ Hide` button for distraction-free reading.

- **Fast Full-Text Search**:
  - Queries all 520,000+ paragraphs with instant debouncing and keyword snippet highlights.
  - Direct jump to exact paragraphs (`#pindex-N` / `#para-N`) with pulsing border animation.

- **Persistent Footer & Floating Menu Toggle**:
  - Chapter navigation with `◀ Prev` and `Next ▶` buttons.
  - Floating `☰` action button to toggle Header, Footer, and Navigation sidebar in Zen mode.

---

## Quick Start

### 1. Start Python Backend (API & SQLite Database)
```bash
cd ../web_app2
python3 app.py
```
*(Runs on port 5000)*

### 2. Start Next.js Frontend
```bash
cd web_app_next
npm run dev
```
Open **`http://localhost:3000`** in your browser.

### Production Build
```bash
npm run build
npm start
```
