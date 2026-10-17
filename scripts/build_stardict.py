#!/usr/bin/env python3
"""Build an enriched StarDict dictionary from the PTS Pali-English Dictionary.

Sources
-------
``ptsped2015ed_tipitakapali.db``
    The PTS Pali-English Dictionary (PED), sharded into one SQLite table per
    leading letter pair (``akz``, ``baz``, ... ``ā°z``) with ``word``/``defi``
    columns.  ``defi`` is an HTML fragment.
``dpd_synonyms_tipitakapali.db``
    Digital Pali Dictionary lemma (``word``) to inflected/variant form
    (``synonym``) pairs.  Every form whose lemma is a PED headword becomes a
    StarDict synonym, so inflected words found in the canon (``dhammassa``,
    ``gacchanti``, ...) resolve to the PED article for their lemma.

The glossary is written with pyglossary (https://github.com/ilius/pyglossary),
which produces the StarDict 3.0.0 files:

    <base>.ifo    metadata, including synwordcount
    <base>.idx    term NUL offset:uint32be size:uint32be
    <base>.dict   article data
    <base>.syn    synonym NUL entry-index:uint32be
    ptsped.css    article styles (also written to res/ for GoldenDict)

Headwords with several meanings get a "N senses" index at the top of the
article, with links to the anchored section for each meaning.

Usage
-----
    pip install -r requirements.txt
    python3 build_stardict.py                 # HTML articles (default)
    python3 build_stardict.py --format text   # plain-text articles
    python3 build_stardict.py --no-synonyms   # PED only, no DPD forms
"""

from __future__ import annotations

import argparse
import hashlib
import html as htmllib
import re
import sqlite3
import struct
import sys
import unicodedata
import zipfile
from pathlib import Path

BASE = "ptsped2015ed_tipitakapali"
CSS_NAME = "ptsped.css"
CSS_PATH = Path(__file__).with_name(CSS_NAME)
BOOKNAME = "PTS Pali-English Dictionary (2015 ed.)"
DESCRIPTION = (
    "Pali-English dictionary of the Pali Text Society by T. W. Rhys Davids "
    "and William Stede, 2015 electronic edition, enriched with Digital Pali "
    "Dictionary inflected forms so that declined and conjugated words can be "
    "looked up."
)
DATE = "2026-10-17"

SKIP_TABLES = {"synonyms", "sqlite_stat1"}

# Front/back matter lives in the ``misc`` shard under site-internal anchors.
# Give those two articles readable headwords (the originals stay in ``.syn``).
FRONT_MATTER = {
    "##ptsinfo": "About this dictionary",
    "##ptsafterword": "Afterword",
}

# --------------------------------------------------------------------------
# HTML cleaning
# --------------------------------------------------------------------------

# Inline tags kept in the article; em/strong are normalised for consistency.
_INLINE = {"b": "b", "i": "i", "sup": "sup", "sub": "sub", "em": "i", "strong": "b"}
# Tags that mark a block or line boundary.
_BREAK = {
    "p", "div", "br", "hr", "tr", "td", "th", "table", "tbody", "thead",
    "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre",
}
# Wrapper tags that are dropped while their text content is kept.
_UNWRAP = {
    "a", "span", "font", "small", "u", "img", "colgroup", "col", "caption",
    "section",
}

# Only these tags are treated as markup; anything else ("a < b") stays text.
_KNOWN_TAGS = sorted(set(_INLINE) | _BREAK | _UNWRAP)
_TAG_RE = re.compile(r"<(/?)(%s)\b([^>]*)>" % "|".join(_KNOWN_TAGS), re.I)
_CLASS_ATTR_RE = re.compile(r"""class\s*=\s*["']([^"']*)["']""", re.I)
_BLOCK_TAG_RE = re.compile(
    r"<br\s*/?>|</?(?:%s)\b[^>]*>" % "|".join(sorted(_BREAK)), re.I
)
_ANY_TAG_RE = re.compile(r"</?(?:%s)\b[^>]*>" % "|".join(_KNOWN_TAGS), re.I)
_BARE_AMP_RE = re.compile(r"&(?![a-zA-Z][a-zA-Z0-9]*;|#\d+;|#x[0-9a-fA-F]+;)")
_BR_RUN_RE = re.compile(r"(?:<br\s*/>\s*){3,}")
_INLINE_TAG_RE = re.compile(r"</?(b|i|sup|sub)>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")


def _escape_text(text: str) -> str:
    """Escape bare ``&`` and ``<`` so the article stays valid HTML."""
    return _BARE_AMP_RE.sub("&amp;", text).replace("<", "&lt;")


def _article_classes(class_attr: str) -> str:
    """Map source layout classes onto the few the stylesheet styles."""
    names = class_attr.split()
    if any(name.startswith("floatr") for name in names):
        return "floatrpp"
    kept: list[str] = []
    for name in names:
        if name in ("in1", "in2"):
            kept.append(name)
        elif name in ("f2", "f3", "f4"):  # f3/f4 are the same muted note style
            if "f2" not in kept:
                kept.append("f2")
        elif name in ("g", "ctr"):
            kept.append(name)
    return " ".join(dict.fromkeys(kept))


def _balance(article: str) -> str:
    """Close unclosed inline tags and drop stray closing tags."""
    out: list[str] = []
    stack: list[str] = []
    pos = 0
    for match in _INLINE_TAG_RE.finditer(article):
        out.append(article[pos:match.start()])
        pos = match.end()
        tag = match.group(1)
        if match.group(0).startswith("</"):
            if tag in stack:
                while stack:
                    top = stack.pop()
                    out.append(f"</{top}>")
                    if top == tag:
                        break
        else:
            stack.append(tag)
            out.append(f"<{tag}>")
    out.append(article[pos:])
    out.extend(f"</{tag}>" for tag in reversed(stack))
    return "".join(out)


def clean_article(fragment: str) -> str:
    """Turn one database HTML fragment into a self-contained HTML article."""
    fragment = unicodedata.normalize("NFC", fragment)
    out: list[str] = []
    pos = 0
    stack: list[tuple[str, str]] = []  # (source tag, marker to emit on close)
    for match in _TAG_RE.finditer(fragment):
        out.append(_escape_text(fragment[pos:match.start()]))
        pos = match.end()
        closing = match.group(1) == "/"
        name = match.group(2).lower()
        attrs = match.group(3)

        if name in _INLINE:
            tag = _INLINE[name]
            out.append(f"</{tag}>" if closing else f"<{tag}>")
            continue

        if closing:
            for index in range(len(stack) - 1, -1, -1):
                if stack[index][0] == name:
                    marker = stack.pop(index)[1]
                    if marker:
                        out.append(marker)
                    break
            else:
                if name in _BREAK:
                    out.append("<br/>")
            continue

        if name in ("br", "hr"):
            out.append("<br/>")
            continue

        if name in _BREAK or name in _UNWRAP:
            found = _CLASS_ATTR_RE.search(attrs)
            classes = _article_classes(found.group(1)) if found else ""
            if classes:
                out.append(f'<span class="{classes}">')
                stack.append((name, "</span>"))
            else:
                if name in _BREAK:
                    out.append("<br/>")
                stack.append((name, ""))
        # Any other tag is dropped.

    out.append(_escape_text(fragment[pos:]))
    article = "".join(out)
    article = _BR_RUN_RE.sub("<br/><br/>", article)
    article = _balance(article)
    article = re.sub(r"^(?:\s*<br\s*/>)+", "", article)
    article = re.sub(r"(?:<br\s*/>\s*)+$", "", article)
    return article.strip()


def _flat_text(fragment: str) -> str:
    """Approximate the visible text of an HTML fragment.

    Deliberately independent of :func:`clean_article` so that comparing the two
    exposes any text dropped while normalising the markup.
    """
    text = _BLOCK_TAG_RE.sub(" ", fragment)
    text = re.sub(r"</?(?:span|section)\b[^>]*>", " ", text, flags=re.I)
    text = _ANY_TAG_RE.sub("", text)
    # Unescape last: a "<" that came from "&lt;" is the text itself, not markup.
    text = htmllib.unescape(text).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _plain(fragment: str) -> str:
    """Visible text of an article fragment, with entities resolved."""
    return htmllib.unescape(re.sub(r"<[^>]+>", "", fragment))


def _cut_point(text: str, min_position: int = 8) -> int:
    """Where a sense preview should stop: the first citation or line break.

    ``<b><i>x</i></b>`` is emphasis rather than a citation, so it is kept, and
    a very early citation ("a lake <b>Jāt</b> …") is ignored so the gloss keeps
    at least a few words.
    """
    best = len(text)
    for pattern in ("<br", "<b>", "<b "):
        position = 0
        while True:
            found = text.find(pattern, position)
            if found == -1:
                break
            if found >= min_position and not text.startswith("<b><i", found):
                best = min(best, found)
                break
            position = found + 1
    return best


def _sense_summary(fragment: str) -> tuple[str, str, str]:
    """Split a sense into (headword html, grammatical descriptor, gloss)."""
    match = re.match(r"\s*<b>(.*?)</b>", fragment, re.S)
    if match:
        heading = match.group(1)
        rest = fragment[match.end():]
    else:
        heading, rest = "", fragment

    descriptor = ""
    match = re.match(r"\s*\(([^()]{0,90})\)", rest)
    if match:
        descriptor = _plain(match.group(1)).strip()
        rest = rest[match.end():]

    # Drop the leading etymology: [Vedic ...] or [Sanskrit ...]
    while re.match(r"\s*\[", rest):
        end = rest.find("]")
        if end == -1:
            break
        rest = rest[end + 1:]

    rest = re.sub(r"^(?:\s*<br\s*/>)+", "", rest)
    gloss = re.sub(r"\s+", " ", _plain(rest[:_cut_point(rest)])).strip(" ,;.:—–-")
    gloss = re.sub(r"\s*\([^)]*$", "", gloss)  # drop an unclosed parenthesis
    if len(gloss) > 115:
        gloss = gloss[:115].rsplit(" ", 1)[0].rstrip(" ,;.:—–-") + "…"
    return heading, descriptor, gloss


def _mark_headword(fragment: str) -> str:
    """Tag the leading bold headword so it can be styled apart from citations."""
    match = re.match(r"\s*<b>(.*?)</b>", fragment, re.S)
    if not match:
        return fragment
    return (
        f'{fragment[: match.start()]}<b class="hw">{match.group(1)}</b>'
        f"{fragment[match.end():]}"
    )


def _document(body: str) -> str:
    """Wrap an entry so readers load the stylesheet from the res directory."""
    return (
        '<!DOCTYPE html><html lang="pi"><head><meta charset="utf-8">'
        f'<link rel="stylesheet" href="{CSS_NAME}">'
        f"</head><body>{body}</body></html>"
    )


def render_article(headword: str, fragments: list[str], fmt: str) -> str:
    """Render one headword, with a sense index when it has several meanings."""
    if fmt == "text":
        return to_plain_text("\n\n".join(fragments))

    if len(fragments) == 1:
        return _document(
            f'<div class="pts15">{_mark_headword(fragments[0])}</div>'
        )

    entry_id = "ped-" + hashlib.md5(headword.encode("utf-8")).hexdigest()[:8]
    items: list[str] = []
    sections: list[str] = []
    for number, fragment in enumerate(fragments, start=1):
        heading, descriptor, gloss = _sense_summary(fragment)
        parts = [f'<span class="ped-hw">{heading}</span>'] if heading else []
        if descriptor:
            parts.append(f'<span class="ped-desc">{htmllib.escape(descriptor)}</span>')
        if gloss:
            parts.append(f'<span class="ped-gloss">{htmllib.escape(gloss)}</span>')
        items.append(f'<li><a href="#{entry_id}-{number}">{"".join(parts)}</a></li>')
        sections.append(
            f'<section class="ped-sense" id="{entry_id}-{number}">'
            f'<span class="ped-sense-num">{number}</span>'
            f"{_mark_headword(fragment)}</section>"
        )

    toc = (
        '<div class="ped-toc">'
        f'<div class="ped-toc-title">{len(fragments)} senses</div>'
        f'<ol>{"".join(items)}</ol>'
        "</div>"
    )
    return _document(
        f'<div class="pts15 pts15--multi">{toc}{"".join(sections)}</div>'
    )


def to_plain_text(article: str) -> str:
    """Flatten a cleaned HTML article for ``defiFormat="m"``."""
    text = re.sub(r"<br\s*/?>", "\n", article)
    text = re.sub(r"<[^>]+>", "", text)
    text = htmllib.unescape(text).replace("\xa0", " ")
    text = _WS_RE.sub(" ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --------------------------------------------------------------------------
# Source reading
# --------------------------------------------------------------------------


def _clean_word(word: str) -> str:
    return _WS_RE.sub("", unicodedata.normalize("NFC", word).strip())


def _stardict_key(word: str) -> tuple[bytes, bytes]:
    """StarDict orders its index with stardict_strcmp: ASCII-case-insensitive,
    then bytewise.  pyglossary sorts by exactly this key."""
    encoded = word.encode("utf-8")
    return (encoded.lower(), encoded)


def normalize_headword(word: str) -> str:
    """Normalise a headword for lookup.

    A few headwords in this edition carry a spurious space where the source
    marked a compound boundary ("adhibha vati" for *adhibhavati*, "pa hoti"
    for *pahoti*).  Joining them keeps the word findable; the original spelling
    is kept as a StarDict synonym.
    """
    return FRONT_MATTER.get(_clean_word(word), _clean_word(word))


def read_pts(db_path: Path) -> tuple[list[str], list[tuple[str, str]]]:
    """Return the PED shard names and all (word, defi) rows in shard order."""
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        tables = [
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        tables = [name for name in tables if name not in SKIP_TABLES]
        rows: list[tuple[str, str]] = []
        for table in tables:
            rows.extend(con.execute(f'SELECT word, defi FROM "{table}" ORDER BY id'))
    finally:
        con.close()
    return tables, rows


def build_articles(
    rows: list[tuple[str, str]], fmt: str
) -> tuple[list[tuple[str, str, list[str]]], dict[str, str]]:
    """Merge duplicate headwords into sorted (word, article, aliases) entries."""
    plain = {_clean_word(word) for word, _ in rows}
    for headword in FRONT_MATTER.values():
        if headword in plain:
            raise ValueError(f"front-matter headword {headword!r} collides with an entry")

    parts: dict[str, list[str]] = {}
    aliases: dict[str, str] = {}
    for word, defi in rows:
        headword = normalize_headword(word)
        article = clean_article(defi or "")
        if not article:
            continue
        if headword != word.strip():
            aliases[word.strip()] = headword
        bucket = parts.setdefault(headword, [])
        if article not in bucket:  # a few shards repeat the same article verbatim
            bucket.append(article)

    entries: list[tuple[str, str, list[str]]] = []
    for headword, fragments in parts.items():
        article = render_article(headword, fragments, fmt)
        entries.append((headword, article, []))

    entries.sort(key=lambda item: _stardict_key(item[0]))
    return entries, aliases


_ALIAS_OK_RE = re.compile(r"[A-Za-zāīūñṅṇṭḍḷṃĀĪŪÑṄṆṬḌḶṂ]")


def _usable_alias(alias: str, headwords: set[str]) -> bool:
    if not alias or len(alias) > 64:
        return False
    if re.search(r"\s", alias) or any(ch in alias for ch in "<>&"):
        return False
    if alias in headwords:
        return False
    return bool(_ALIAS_OK_RE.search(alias))


def attach_manual_aliases(
    entries: list[tuple[str, str, list[str]]], aliases: dict[str, str]
) -> None:
    """Attach the source spellings that differ from the normalised headword."""
    headwords = {word for word, _, _ in entries}
    by_headword: dict[str, list[str]] = {word: list(aliases_for) for word, _, aliases_for in entries}
    for alias, headword in aliases.items():
        alias = alias.strip()
        if not alias or alias in headwords or any(ch in alias for ch in "<>&"):
            continue
        if alias not in by_headword[headword]:
            by_headword[headword].append(alias)
    for index, (word, article, _) in enumerate(entries):
        entries[index] = (word, article, by_headword[word])


def attach_dpd_synonyms(
    dpd_path: Path,
    entries: list[tuple[str, str, list[str]]],
) -> dict[str, int]:
    """Attach DPD inflected forms to the entries of their PED lemma."""
    headwords = {word for word, _, _ in entries}
    by_headword: dict[str, list[str]] = {
        word: list(aliases_for) for word, _, aliases_for in entries
    }

    con = sqlite3.connect(f"file:{dpd_path}?mode=ro", uri=True)
    try:
        tables = [
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
            if row[0] not in SKIP_TABLES
        ]
        scanned = matched = 0
        for table in tables:
            for lemma, synonym in con.execute(
                f'SELECT word, synonym FROM "{table}"'
            ):
                scanned += 1
                if not synonym:
                    continue
                headword = normalize_headword(lemma)
                if headword not in headwords:
                    continue
                matched += 1
                alias = unicodedata.normalize("NFC", synonym.strip())
                if not _usable_alias(alias, headwords):
                    continue
                bucket = by_headword[headword]
                if alias not in bucket:
                    bucket.append(alias)
    finally:
        con.close()

    total = 0
    for index, (word, article, _) in enumerate(entries):
        aliases_for_word = by_headword[word]
        total += len(aliases_for_word)
        entries[index] = (word, article, aliases_for_word)
    return {"scanned": scanned, "matched": matched, "aliases": total}


# --------------------------------------------------------------------------
# Writing with pyglossary
# --------------------------------------------------------------------------


def write_stardict(
    entries: list[tuple[str, str, list[str]]], outdir: Path, fmt: str
) -> Path:
    try:
        from pyglossary.glossary_v2 import Glossary
    except ImportError:  # pragma: no cover - dependency guard
        raise SystemExit(
            "pyglossary is required to write the dictionary: "
            "pip install -r requirements.txt"
        ) from None

    defi_format = "h" if fmt == "html" else "m"
    outdir.mkdir(parents=True, exist_ok=True)
    Glossary.init()
    gloss = Glossary()
    gloss.setInfo("bookname", BOOKNAME)
    gloss.setInfo("description", DESCRIPTION)
    gloss.setInfo("date", DATE)
    for word, article, aliases in entries:
        gloss.addEntry(gloss.newEntry([word, *aliases], article, defiFormat=defi_format))

    # The stylesheet travels with the dictionary: pyglossary stores data entries
    # in <dict>/res/, and a copy next to the .ifo covers readers that resolve
    # relative links from the dictionary folder instead.
    css = CSS_PATH.read_bytes()
    gloss.addEntry(gloss.newDataEntry(CSS_NAME, css))

    out_base = outdir / BASE
    gloss.write(str(out_base), formatName="Stardict", sametypesequence=defi_format)
    (outdir / CSS_NAME).write_bytes(css)
    return out_base


def make_bundle(outdir: Path) -> Path:
    bundle = outdir.parent / f"{BASE}_stardict.zip"
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(outdir.rglob("*")):
            if path.is_file():
                archive.write(
                    path, arcname=f"{BASE}/{path.relative_to(outdir).as_posix()}"
                )
    return bundle


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------


def parse_ifo(path: Path) -> dict[str, str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "StarDict's dict ifo file":
        raise AssertionError("bad .ifo magic")
    meta: dict[str, str] = {}
    for line in lines[1:]:
        if "=" in line:
            key, value = line.split("=", 1)
            meta[key] = value
    return meta


def read_index(path: Path) -> list[tuple[str, int, int]]:
    raw = path.read_bytes()
    records: list[tuple[str, int, int]] = []
    pos = 0
    while pos < len(raw):
        end = raw.index(b"\x00", pos)
        word = raw[pos:end].decode("utf-8")
        offset, size = struct.unpack(">II", raw[end + 1 : end + 9])
        records.append((word, offset, size))
        pos = end + 9
    return records


def read_synonyms(path: Path) -> list[tuple[str, int]]:
    raw = path.read_bytes()
    records: list[tuple[str, int]] = []
    pos = 0
    while pos < len(raw):
        end = raw.index(b"\x00", pos)
        word = raw[pos:end].decode("utf-8")
        (target,) = struct.unpack(">I", raw[end + 1 : end + 5])
        records.append((word, target))
        pos = end + 5
    return records


def verify(
    out_base: Path, entries: list[tuple[str, str, list[str]]], fmt: str
) -> dict[str, int]:
    meta = parse_ifo(out_base.with_suffix(".ifo"))
    for key in ("version", "wordcount", "idxfilesize", "bookname", "sametypesequence"):
        if key not in meta:
            raise AssertionError(f"missing ifo key {key}")
    if meta["sametypesequence"] != ("h" if fmt == "html" else "m"):
        raise AssertionError("sametypesequence mismatch")

    idx_path = out_base.with_suffix(".idx")
    data = out_base.with_suffix(".dict").read_bytes()
    if idx_path.stat().st_size != int(meta["idxfilesize"]):
        raise AssertionError("idxfilesize does not match .idx")

    records = read_index(idx_path)
    if len(records) != len(entries) or len(records) != int(meta["wordcount"]):
        raise AssertionError(f"word count mismatch: {len(records)} vs {len(entries)}")

    expected_offset = 0
    previous: tuple[bytes, bytes] | None = None
    for (word, offset, size), (expected_word, expected_article, _) in zip(records, entries):
        key = _stardict_key(word)
        if previous is not None and key <= previous:
            raise AssertionError(f"index not strictly sorted at {word!r}")
        previous = key
        if word != expected_word:
            raise AssertionError(f"word mismatch: {word!r} != {expected_word!r}")
        if offset != expected_offset:
            raise AssertionError(f"gap in article offsets at {word!r}")
        article = data[offset : offset + size].decode("utf-8")
        if article != expected_article:
            raise AssertionError(f"article mismatch at {word!r}")
        expected_offset += size
        if fmt == "html":
            if len(re.findall(r"<b\b", article)) != article.count("</b>"):
                raise AssertionError(f"unbalanced <b> at {word!r}")
            if article.count("<i>") != article.count("</i>"):
                raise AssertionError(f"unbalanced <i> at {word!r}")
            if f'href="{CSS_NAME}"' not in article:
                raise AssertionError(f"stylesheet not linked at {word!r}")
            if article.count("<section") != article.count("</section>"):
                raise AssertionError(f"unbalanced <section> at {word!r}")
            # A sense index implies one anchored section per meaning.
            anchors = re.findall(r'id="(ped-[0-9a-f]{8}-\d+)"', article)
            if anchors:
                if "ped-toc" not in article:
                    raise AssertionError(f"senses without an index at {word!r}")
                if len(anchors) != article.count('class="ped-sense"'):
                    raise AssertionError(f"sense anchors mismatch at {word!r}")
                links = re.findall(r'href="#(ped-[0-9a-f]{8}-\d+)"', article)
                if links != anchors:
                    raise AssertionError(f"sense index does not match sections at {word!r}")
                prefix = anchors[0].rsplit("-", 1)[0]
                expected_ids = [f"{prefix}-{n}" for n in range(1, len(anchors) + 1)]
                if anchors != expected_ids:
                    raise AssertionError(f"sense anchors out of order at {word!r}")
    if expected_offset != len(data):
        raise AssertionError("article sizes do not cover .dict")

    if fmt == "html":
        css = CSS_PATH.read_bytes()
        for candidate in (out_base.parent / CSS_NAME, out_base.parent / "res" / CSS_NAME):
            if not candidate.is_file():
                raise AssertionError(f"stylesheet missing: {candidate}")
            if candidate.read_bytes() != css:
                raise AssertionError(f"stylesheet differs from source: {candidate}")

    expected_syn = {
        (alias, headword)
        for headword, _, aliases in entries
        for alias in aliases
    }
    syn_path = out_base.with_suffix(".syn")
    syn_records = read_synonyms(syn_path) if syn_path.exists() else []
    if len(syn_records) != len(expected_syn):
        raise AssertionError(f"synonym count mismatch: {len(syn_records)} vs {len(expected_syn)}")
    if "synwordcount" in meta and int(meta["synwordcount"]) != len(syn_records):
        raise AssertionError("ifo synwordcount does not match .syn")
    previous = None
    for alias, target in syn_records:
        encoded = alias.encode("utf-8")
        if previous is not None and encoded < previous:
            raise AssertionError(f"synonyms not sorted at {alias!r}")
        previous = encoded
        if target >= len(records):
            raise AssertionError(f"synonym {alias!r} has out-of-range target")
        if (alias, records[target][0]) not in expected_syn:
            raise AssertionError(f"synonym {alias!r} points at wrong entry")
    if expected_syn and not syn_records:
        raise AssertionError("expected synonyms but .syn is missing")

    return {"words": len(records), "synonyms": len(syn_records)}


def verify_source_text(
    rows: list[tuple[str, str]], entries: list[tuple[str, str, list[str]]], fmt: str
) -> int:
    """Check that every source fragment's text survives into its article."""
    articles = {word: article for word, article, _ in entries}
    lost: list[str] = []
    for word, defi in rows:
        expected = _flat_text(unicodedata.normalize("NFC", defi or ""))
        if not expected:
            continue
        article = articles[normalize_headword(word)]
        got = _flat_text(article) if fmt == "html" else re.sub(r"\s+", " ", article)
        if expected not in got:
            lost.append(word)
    if lost:
        raise AssertionError(
            f"source text missing from {len(lost)} article(s): {lost[:5]}"
        )
    return len(rows)


# Words a reader may type in a canonical text, and the PED article they should
# reach.  All of these are inflected/variant forms, not PED headwords.
SYNONYM_PROBES = {
    "dhammassa": "dhamma",
    "dhammānaṃ": "dhamma",
    "buddhassa": "buddha",
    "gacchanti": "gacchati",
    "bhikkhūnaṃ": "bhikkhu",
    "nibbānassa": "nibbāna",
    "jhānaṃ": "jhāna",
    "kāye": "kāya",
}

HEADWORD_PROBES = ["dhaja", "ñāṇa", "akālika", "sattha", "gala", "kuvalaya"]


def spot_check(
    out_base: Path, entries: list[tuple[str, str, list[str]]], expect_synonyms: bool = True
) -> list[str]:
    """Look words up the way a reader does: index first, then synonyms."""
    articles = {word: article for word, article, _ in entries}
    records = read_index(out_base.with_suffix(".idx"))
    index = {word: n for n, (word, _, _) in enumerate(records)}
    syn_path = out_base.with_suffix(".syn")
    synonyms: dict[str, list[int]] = {}
    if syn_path.exists():
        for alias, target in read_synonyms(syn_path):
            synonyms.setdefault(alias, []).append(target)

    report = []
    for probe in HEADWORD_PROBES:
        if probe not in index:
            raise AssertionError(f"probe {probe!r} missing from index")
        report.append(f"{probe}: {len(articles[probe])} bytes")

    if not expect_synonyms:
        return report

    for probe, expected in SYNONYM_PROBES.items():
        if probe in index:
            raise AssertionError(f"synonym probe {probe!r} shadows a headword")
        targets = synonyms.get(probe, [])
        if not targets:
            raise AssertionError(f"synonym probe {probe!r} missing from .syn")
        reached = [records[target][0] for target in targets]
        if expected not in reached:
            raise AssertionError(f"synonym probe {probe!r} reaches {reached}, not {expected!r}")
        report.append(f"{probe} -> {expected}")
    return report


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=Path(f"{BASE}.db"),
                        help="PED SQLite file")
    parser.add_argument(
        "--dpd", type=Path, default=Path("dpd_synonyms_tipitakapali.db"),
        help="DPD synonyms SQLite file",
    )
    parser.add_argument("--no-synonyms", action="store_true",
                        help="skip DPD inflected forms")
    parser.add_argument("--outdir", type=Path, default=Path("stardict") / BASE,
                        help="output folder")
    parser.add_argument("--format", choices=("html", "text"), default="html",
                        help="article format: HTML or plain text")
    args = parser.parse_args()

    if not args.db.is_file():
        print(f"error: database not found: {args.db}", file=sys.stderr)
        return 2
    if not args.no_synonyms and not args.dpd.is_file():
        print(f"error: DPD synonym database not found: {args.dpd}", file=sys.stderr)
        return 2

    tables, rows = read_pts(args.db)
    entries, aliases = build_articles(rows, args.format)

    attach_manual_aliases(entries, aliases)
    stats = {"scanned": 0, "matched": 0, "aliases": 0}
    if not args.no_synonyms:
        stats = attach_dpd_synonyms(args.dpd, entries)

    out_base = write_stardict(entries, args.outdir, args.format)
    counts = verify(out_base, entries, args.format)
    preserved = verify_source_text(rows, entries, args.format)
    probes = spot_check(out_base, entries, expect_synonyms=not args.no_synonyms)
    bundle = make_bundle(args.outdir)

    multi = sum(1 for _, article, _ in entries if "pts15--multi" in article)
    print(f"PED      : {args.db} ({len(tables)} shards, {len(rows)} rows)")
    print(f"entries  : {counts['words']} merged headwords, {multi} with a sense index")
    if not args.no_synonyms:
        print(f"DPD      : {stats['scanned']} pairs scanned, "
              f"{stats['matched']} on PED lemmas")
    print(f"synonyms : {counts['synonyms']} lookup keys in .syn")
    print(f"format   : {args.format}")
    print(f"output   : {out_base.parent}")
    for line in probes:
        print(f"  probe  : {line}")
    print(f"bundle   : {bundle}")
    print(f"verified : ifo/idx/dict/syn parse, sorted, contiguous, articles match, "
          f"text of all {preserved} source rows preserved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
