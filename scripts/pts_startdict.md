# PTS Pali-English Dictionary — StarDict

StarDict 3.0.0 build of the Pali Text Society's *Pali-English Dictionary*
(2015 electronic edition), enriched with the Digital Pali Dictionary's
inflected forms, with a sense index for homographs and a stylesheet for
GoldenDict (and any reader that renders article CSS).

## Files

```
stardict/
  ptsped2015ed_tipitakapali/
    ptsped2015ed_tipitakapali.ifo    metadata (sametypesequence=h)
    ptsped2015ed_tipitakapali.idx    headword index
    ptsped2015ed_tipitakapali.dict   HTML articles
    ptsped2015ed_tipitakapali.syn    inflected/variant forms -> article
    ptsped.css                       article styles (copy next to the .ifo)
    res/ptsped.css                   the same stylesheet as a StarDict resource
  ptsped2015ed_tipitakapali_stardict.zip   all of the above, ready to install
```

Install by unpacking the zip into a dictionary folder of your reader
(GoldenDict, KOReader, StarDict, …) or point the reader at the `.ifo`.
GoldenDict resolves the `ptsped.css` link from the dictionary's `res/`
directory; the copy beside the `.ifo` covers readers that resolve relative
links from the dictionary folder instead.

## What was done

* **Source**: `ptsped2015ed_tipitakapali.db`, which shards the dictionary into
  287 letter-pair tables (`akz`, `baz`, … `ā°z`) with HTML `defi` fragments.
* **Articles**: HTML fragments are normalised only where necessary — stray
  block tags become `<br/>`, `<a>`/`<span>` wrappers are unwrapped, unknown
  tags are escaped so no text can disappear. Every one of the 16,728 source
  rows is checked to survive into its article.
* **Headwords**: 16,728 rows merge to 15,979 articles — homographs such as
  `sattha` (6 senses) are combined. 25 headwords carry a spurious space from
  the source (`adhibha vati`, `pa hoti`); the space is removed for lookup and
  the original spelling is kept as a synonym. The two front-matter entries
  stored as site anchors get readable headwords (`About this dictionary`,
  `Afterword`).
* **Sense index**: the 605 headwords with more than one meaning open with a
  “N senses” box listing every meaning (headword, part of speech, first gloss)
  with links to `#ped-<hash>-N` anchors on the sections below. Identical
  duplicates from different shards are collapsed. `dhamma`, for example, lists
  its three meanings (Dhamma¹ noun, Dhamma² adjective, Dhamma³ adjective).
* **Synonyms**: `dpd_synonyms_tipitakapali.db` maps a DPD lemma to its
  inflected and variant forms. Every form whose lemma is a PED headword is
  attached to that article as a StarDict synonym — 488,981 synonym records
  (475,987 distinct forms such as `dhammassa`, `bhikkhūnaṃ`, `gacchanti`), so a
  text form reaches the PED article for its lemma.
* **Stylesheet**: `ptsped.css` applies the PTS reader's own article styles
  (`.pts15`: inherit font and colour at 15px/1.7, blue Pali italics, green
  grammar tags, `in1`/`in2` indents, `ctr` headings, floated `floatrpp` notes)
  and adds the sense index and numbered badges. Everything is scoped to
  `.pts15`, so it cannot disturb other dictionaries on GoldenDict's "Found in"
  pages, and it uses no CSS custom properties — GoldenDict on macOS renders
  articles with Qt WebKit, which drops any declaration built on variables.
  Dark styling follows the PTS app's `[data-theme="dark"]` attribute only;
  there is no `prefers-color-scheme` rule, which would turn the text light in
  a reader that keeps a white article pane.
* **Writing**: [pyglossary](https://github.com/ilius/pyglossary) writes the
  StarDict files, the synonym index, and stores `ptsped.css` under `res/`.

## Rebuild

```bash
pip install -r requirements.txt
python3 build_stardict.py                 # HTML articles (default)
python3 build_stardict.py --format text   # plain-text articles, no CSS/senses
python3 build_stardict.py --no-synonyms   # PED only, no DPD forms
```

The build verifies its own output before finishing: `.ifo`/`.idx`/`.dict`/`.syn`
parse, the index is sorted with StarDict's `stardict_strcmp` order, article
offsets are contiguous and cover the `.dict`, articles match what was built,
sense anchors and index entries correspond, the stylesheet is present in both
locations and linked from every article, synonyms point at the right entries,
and the text of all 16,728 source rows is preserved.

## Coverage notes

* The dictionary is case-sensitive; headwords are lower case as in the source.
* Lookups that still miss (e.g. `anicca`, `sotāpanna`) are words this edition
  of the PED does not contain, not a broken index — `anicca` appears only as
  part of `nicca`'s article.
* Cross-references inside articles ("See kālika") are plain text; the anchor
  targets are not part of the StarDict format.
