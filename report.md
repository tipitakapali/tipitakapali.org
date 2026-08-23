# Comprehensive Research Report: CST4 Book Mapping, MAT Navigation, and Pagination Architecture

**Author:** Antigravity AI Assistant  
**Date:** 2026-08-24  
**Scope:** Analysis of CST4 / CST.Avalonia source code (`/cst/src/CST.Core`, `/cst/src/CST.Avalonia`) and comparison with `web_app_next`.

---

## 1. Executive Summary

A deep architectural investigation into the original CST4 and CST.Avalonia codebases revealed the fundamental reasons why **MAT (Mūla · Aṭṭhakathā · Ṭīkā) Jump** and **Go To Page / Paragraph** were failing or producing inaccurate results in the web application:

1. **MAT Relationships are Relational, Not Suffix Formulas:**  
   The canonical Tipiṭaka and its commentaries do not have a 1-to-1 filename mapping. For example, three separate Mūla volumes (`s0402m1.mul`, `s0402m2.mul`, `s0402m3.mul`) map to a single combined Aṭṭhakathā (`s0402a.att`) and Ṭīkā (`s0402t.tik`). Naïve string prefix slicing generated nonexistent filenames (`s0402m1a.att`), breaking navigation. CST4 solves this by defining an explicit 217-book relational index (`MulaIndex`, `AtthakathaIndex`, `TikaIndex`).

2. **3,618 Ranged Paragraphs Across 87 Books:**  
   In commentary and canonical texts, paragraphs are often grouped as ranges (e.g. `n="16-26"` or abbreviated `n="196-7"`). Previous parsers only indexed the exact string `"16-26"`. Consequently, searching or jumping to paragraph `20` resulted in an "Out of Range" or "Not Found" error. CST4 uses `TryParseParagraphSpan` to expand each range into full inclusive integer spans.

3. **Page Break Encoding & Volume-Qualified Anchors:**  
   TEI XML encodes page breaks as `<pb ed="<EDITION>" n="<VOL>.<PAGE_PADDED_4>"/>` (e.g., `<pb ed="V" n="0.0023"/>`, `<pb ed="P" n="3.0023"/>`). CST4 creates precise anchors (`V0.0023`, `P3.0023`) and infers the volume from the reader's current position when given a bare page number (`23`). The web app lacked exact anchor IDs and relied on CSS substring selectors (`[data-page*="1"]`) which erroneously matched any page containing the digit `1` (e.g., matching `0.0001` or `0.0010` instead of `0.0021`).

---

## 2. CST4 Book Catalog & MAT Relational Mapping

In `src/CST.Core/Books.cs` and `Book.cs`, CST4 defines exactly **217 canonical books** indexed from 0 to 216. Each book has:

- **`FileName`**: e.g., `s0101m.mul.xml`
- **`Matn`**: Commentary level (`Mula`, `Atthakatha`, `Tika`, `Other`)
- **`Pitaka`**: `Vinaya`, `Sutta`, `Abhidhamma`, `Other`
- **`BookType`**: `Whole`, `Multi` (multiple sub-books in one XML), `Split`
- **`MulaIndex`**: Index (0–216) of the corresponding root text (`-1` if none or self)
- **`AtthakathaIndex`**: Index of corresponding commentary (`-1` if none or self)
- **`TikaIndex`**: Index of corresponding sub-commentary (`-1` if none or self)

### Canonical Mapping Complexities

| Group | Mūla XML Files | Aṭṭhakathā XML File | Ṭīkā XML File | Notes |
|---|---|---|---|---|
| **Dīgha Nikāya 1** | `s0101m.mul.xml` | `s0101a.att.xml` | `s0101t.tik.xml` | 1-to-1 Whole book |
| **Aṅguttara Duka-Catukka** | `s0402m1.mul.xml`<br>`s0402m2.mul.xml`<br>`s0402m3.mul.xml` | `s0402a.att.xml` (Multi: `an2`, `an3`, `an4`) | `s0402t.tik.xml` (Multi: `an2`, `an3`, `an4`) | 3 Mūla books share 1 combined Aṭṭhakathā and 1 Ṭīkā |
| **Aṅguttara Pañcaka-Sattaka** | `s0403m1.mul.xml`<br>`s0403m2.mul.xml`<br>`s0403m3.mul.xml` | `s0403a.att.xml` (Multi: `an5`, `an6`, `an7`) | `s0403t.tik.xml` (Multi: `an5`, `an6`, `an7`) | 3 Mūla books share 1 combined Aṭṭhakathā and 1 Ṭīkā |
| **Aṅguttara Aṭṭhaka-Ekādasa** | `s0404m1.mul.xml`<br>`s0404m2.mul.xml`<br>`s0404m3.mul.xml`<br>`s0404m4.mul.xml` | `s0404a.att.xml` (Multi: `an8`–`an11`) | `s0404t.tik.xml` (Multi: `an8`–`an11`) | 4 Mūla books share 1 combined Aṭṭhakathā and 1 Ṭīkā |
| **Vinaya Pārājika** | `vin01m.mul.xml` | `vin01a.att.xml` | `vin01t1.tik.xml`<br>`vin01t2.tik.xml` | 1 Mūla maps to 2 Ṭīkā volumes |
| **Jātaka 1** | `s0513m.mul.xml` | `s0513a1.att.xml` to `s0513a4.att.xml` | *(None)* | 1 Mūla maps to 4 Aṭṭhakathā volumes |
| **Jātaka 2** | `s0514m.mul.xml` | `s0514a1.att.xml` to `s0514a3.att.xml` | *(None)* | 1 Mūla maps to 3 Aṭṭhakathā volumes |
| **Theragāthā** | `s0508m.mul.xml` | `s0508a1.att.xml`<br>`s0508a2.att.xml` | *(None)* | 1 Mūla maps to 2 Aṭṭhakathā volumes |
| **Abhidhamma 3** | `abh03m1.mul.xml` to `abh03m11.mul.xml` | `abh03a.att.xml` | `abh03t.tik.xml` | 11 Mūla books share 1 Aṭṭhakathā and 1 Ṭīkā |

---

## 3. Paragraph Numbering & Span Expansion Architecture

### CST4 Parsing Rule (`TryParseParagraphSpan`)

In `CST.Core/Search/BookMarkers.cs`:
- Paragraph numbers in XML attributes can take single or range forms:
  - Single: `n="21"` $\rightarrow [21, 21]$
  - Range: `n="16-26"` $\rightarrow [16, 26]$
  - Abbreviated tail: `n="196-7"` $\rightarrow [196, 197]$
  - Repeated abbreviation: `n="266-7-8"` $\rightarrow [266, 268]$
  - Complex tail: `n="292-3-6"` $\rightarrow [292, 296]$
  - Trailing typo: `n="179-"` $\rightarrow [179, 179]$
  - Inverted typo protection: `n="706-608"` $\rightarrow [706, 706]$ (drops invalid backwards span)

### Navigation Anchor Resolution

When navigating to paragraph $N$:
1. Check for exact paragraph anchor `paraN`.
2. If $N$ sits within a ranged paragraph $[First, Last]$, resolve to that block.
3. For Multi-book volumes, append the sub-book code (e.g. `para100_an5`).

---

## 4. Page Break Navigation & Volume Derivation

### Page Break Structure in XML

```xml
<pb ed="V" n="0.0023"/>
<pb ed="P" n="3.0045"/>
<pb ed="M" n="1.0112"/>
<pb ed="T" n="2.0005"/>
```

- **Prefixes:**
  - `V` $\rightarrow$ VRI (Vipassana Research Institute)
  - `M` $\rightarrow$ Myanmar (Chaṭṭha Saṅgāyana)
  - `P` $\rightarrow$ PTS (Pali Text Society)
  - `T` $\rightarrow$ Royal Thai Edition
  - `O` $\rightarrow$ Other

### Anchor Construction Rule (`BuildPageAnchor`)

Given user input string:
- If input has a dot (e.g., `"3.45"`): `Volume = 3`, `Page = 45` $\rightarrow$ Anchor `P3.0045`.
- If input is a bare number (e.g., `"45"`): Derive volume $V$ from the reader's current page in that edition (defaults to `0` or book volume) $\rightarrow$ Anchor `P<V>.0045`.
- Target element in DOM: `<span id="P3.0045" class="pb" ...>` or `<a id="P3.0045" ...>`.

---

## 5. Upgrade Implementation Plan for Web App

1. **Precomputed CST Catalog (`cst_books_catalog.json`):**
   - Incorporate the complete 217-book relational database exported directly from `CST.Core/Books.cs`.
   - Provide instant, 100% accurate MAT lookups on both server and client without guesswork.

2. **Backend Span & Page Precomputations (`server.js`):**
   - Implement `tryParseParagraphSpan` to index every integer within ranged paragraphs into `para_to_chapter` and `para_to_index`.
   - Render exact `id` attributes on paragraphs (`id="para16"` ... `id="para26"`) and page breaks (`id="V0.0023"`, `id="P3.0045"`).
   - Precompute exact min/max bounds and availability for all editions (`V`, `M`, `P`, `T`).

3. **Client Navigation & Modal Enhancements:**
   - **`MatJumpModal.jsx`**: Directly use `activeTab.mat` from the catalog. Show only other connected layers.
   - **`GoToModal.jsx`**: Exact paragraph and page validation against precomputed metadata; construct exact anchor targets.
   - **`ReaderView.jsx`**: Fast, exact DOM element lookup using `document.getElementById(anchorId)` with fallback to smooth scrolling and pulse highlighting.
