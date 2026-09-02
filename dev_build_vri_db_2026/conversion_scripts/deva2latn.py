#!/usr/bin/env python3
"""
Deva2Latn - Transliterates Unicode Devanagari Tipitaka XML to Unicode Latin script (Roman).
Ported from conversion scripts/Deva2Latn.cs and LatinCapitalizer.cs.
"""

import os
import sys
import glob
import re
import shutil
from typing import List, Optional, Set


class LatinCapitalizer:
    """
    Handles marking and performing capitalization on Devanagari/Latin XML text.
    Replicates the behavior of LatinCapitalizer.cs in CST.Conversion.
    """

    def __init__(
        self,
        paragraph_elements: Optional[List[str]] = None,
        ignore_elements: Optional[List[str]] = None,
        capital_marker: Optional[str] = None,
    ):
        self.paragraph_elements: List[str] = (
            paragraph_elements if paragraph_elements is not None else ["p", "head", "trailer", "tree"]
        )
        self.paragraph_elements_set: Set[str] = set(self.paragraph_elements)
        self.ignore_elements: List[str] = (
            ignore_elements if ignore_elements is not None else ["note"]
        )
        self.ignore_elements_set: Set[str] = set(self.ignore_elements)
        self.capital_marker: str = capital_marker if capital_marker is not None else chr(4676)

    def mark_capitals(self, xml_text: str) -> str:
        """
        Marks Devanagari XML text for later programmatic capitalization.
        Traverses the XML structure, setting capitalization flags at paragraph element boundaries
        and sentence-ending punctuation, while ignoring elements such as <note>.
        """
        body_match = re.search(r'<body[^>]*>', xml_text)
        body_end = xml_text.find("</body>")

        if not body_match or body_end == -1:
            body_tag = ""
            body_content = xml_text
            outer_prefix = ""
            outer_suffix = ""
        else:
            body_tag = body_match.group(0)
            body_start = body_match.start() + len(body_tag)
            body_content = xml_text[body_start:body_end]
            outer_prefix = (
                '<?xml version="1.0" encoding="UTF-16"?>'
                '<?xml-stylesheet type="text/xsl" href="tipitaka-latn.xsl"?>'
                '<TEI.2><teiHeader></teiHeader><text><front></front>'
            )
            outer_suffix = "</body><back></back></text></TEI.2>"

        preserve_space = 'xml:space="preserve"' in body_tag

        tag_re = re.compile(r"(<[^>]+>|[^<]+)")
        tokens = tag_re.findall(body_content)

        next_is_cap = False
        ignore_depth = 0
        output_tokens = []

        for token in tokens:
            if token.startswith("<"):
                if token.startswith("<?") or token.startswith("<!"):
                    output_tokens.append(token)
                    continue
                if token.startswith("</"):
                    m = re.match(r"</([a-zA-Z0-9_\.:]+)", token)
                    tag_name = m.group(1) if m else ""
                    if tag_name in self.ignore_elements_set:
                        ignore_depth -= 1
                    output_tokens.append(token)
                else:
                    m = re.match(r"<([a-zA-Z0-9_\.:]+)", token)
                    tag_name = m.group(1) if m else ""
                    is_self_closing = token.endswith("/>")

                    if ignore_depth == 0 and tag_name in self.paragraph_elements_set:
                        next_is_cap = True

                    if not is_self_closing and tag_name in self.ignore_elements_set:
                        ignore_depth += 1

                    # Normalize empty element space if self-closing: <pb .../> -> <pb ... />
                    if is_self_closing and not token.endswith(" />"):
                        token = token[:-2] + " />"

                    output_tokens.append(token)
            else:
                if not preserve_space and not token.strip():
                    continue
                if ignore_depth == 0:
                    val = []
                    for c in token:
                        ccode = ord(c)
                        # If c is a Devanagari letter/vowel sign in [0x0901..0x094B]
                        if next_is_cap and 0x0901 <= ccode <= 0x094B:
                            val.append(self.capital_marker)
                            next_is_cap = False
                        elif c in ("\u0964", "?", "!"):
                            next_is_cap = True
                        val.append(c)
                    output_tokens.append("".join(val))
                else:
                    output_tokens.append(token)

        processed_body = "".join(output_tokens)

        if outer_prefix:
            outer_xml = f"{outer_prefix}{body_tag}{processed_body}{outer_suffix}"
        else:
            outer_xml = processed_body

        # Apply structural formatting replacements identical to CST.Conversion.LatinCapitalizer
        xml_str = outer_xml
        xml_str = xml_str.replace("<?xml-stylesheet", "\r\n<?xml-stylesheet")
        xml_str = xml_str.replace("<TEI.2>", "\r\n<TEI.2>")
        xml_str = xml_str.replace("</TEI.2>", "\r\n</TEI.2>")
        xml_str = xml_str.replace("<teiHeader>", "\r\n<teiHeader>")
        xml_str = xml_str.replace("<front>", "\r\n<front>")
        xml_str = xml_str.replace("<body>", "\r\n<body>")
        xml_str = xml_str.replace("</body>", "\r\n</body>")
        xml_str = xml_str.replace("<back>", "\r\n<back>")
        xml_str = xml_str.replace("<text>", "\r\n<text>")
        xml_str = xml_str.replace("</text>", "\r\n</text>")

        for paragraph_element in self.paragraph_elements:
            open_tag = "<" + paragraph_element + " "
            xml_str = xml_str.replace(open_tag, "\r\n\r\n" + open_tag)

        return xml_str

    def capitalize(self, latin: str) -> str:
        """
        Replaces capitalMarker + lowercase character with its uppercase equivalent,
        then cleans up any remaining capitalMarkers.
        """
        latin_pali_lowercase = r"[a-zñ\u1E45\u1E6D\u1E0D\u1E47\u1E37\u0101\u012B\u016B\u1E43]"

        def repl(m: re.Match) -> str:
            return m.group(0)[1:].upper()

        latin = re.sub(self.capital_marker + latin_pali_lowercase, repl, latin)
        latin = latin.replace(self.capital_marker, "")
        return latin


class Deva2Latn:
    """
    Transliterates Unicode Devanagari to Unicode Latin (IAST / Roman Pali script).
    Port of CST.Conversion.Deva2Latn.
    """

    def __init__(
        self,
        paragraph_elements: Optional[List[str]] = None,
        ignore_elements: Optional[List[str]] = None,
        capital_marker: Optional[str] = None,
    ):
        self.paragraph_elements = (
            paragraph_elements if paragraph_elements is not None else ["p", "head", "trailer", "tree"]
        )
        self.ignore_elements = ignore_elements if ignore_elements is not None else ["note"]
        self.capital_marker = capital_marker if capital_marker is not None else chr(4676)

        # Devanagari to Latin character mapping table
        self.deva2latn = {
            "\u0902": "\u1E43",  # niggahita (ṃ)
            # Independent vowels
            "\u0905": "a",       # a
            "\u0906": "\u0101",  # aa (ā)
            "\u0907": "i",       # i
            "\u0908": "\u012B",  # ii (ī)
            "\u0909": "u",       # u
            "\u090A": "\u016B",  # uu (ū)
            "\u090F": "e",       # e
            "\u0913": "o",       # o
            # Velar stops
            "\u0915": "k",       # ka
            "\u0916": "kh",      # kha
            "\u0917": "g",       # ga
            "\u0918": "gh",      # gha
            "\u0919": "\u1E45",  # n overdot a (ṅ)
            # Palatal stops
            "\u091A": "c",       # ca
            "\u091B": "ch",      # cha
            "\u091C": "j",       # ja
            "\u091D": "jh",      # jha
            "\u091E": "\u00F1",  # ña (ñ)
            # Retroflex stops
            "\u091F": "\u1E6D",   # t underdot a (ṭ)
            "\u0920": "\u1E6Dh",  # t underdot ha (ṭh)
            "\u0921": "\u1E0D",   # d underdot a (ḍ)
            "\u0922": "\u1E0Dh",  # d underdot ha (ḍh)
            "\u0923": "\u1E47",   # n underdot a (ṇ)
            # Dental stops
            "\u0924": "t",       # ta
            "\u0925": "th",      # tha
            "\u0926": "d",       # da
            "\u0927": "dh",      # dha
            "\u0928": "n",       # na
            # Labial stops
            "\u092A": "p",       # pa
            "\u092B": "ph",      # pha
            "\u092C": "b",       # ba
            "\u092D": "bh",      # bha
            "\u092E": "m",       # ma
            # Liquids, fricatives, etc.
            "\u092F": "y",       # ya
            "\u0930": "r",       # ra
            "\u0932": "l",       # la
            "\u0935": "v",       # va
            "\u0938": "s",       # sa
            "\u0939": "h",       # ha
            "\u0933": "\u1E37",  # l underdot a (ḷ)
            # Dependent vowel signs
            "\u093E": "\u0101",  # aa (ā)
            "\u093F": "i",       # i
            "\u0940": "\u012B",  # ii (ī)
            "\u0941": "u",       # u
            "\u0942": "\u016B",  # uu (ū)
            "\u0947": "e",       # e
            "\u094B": "o",       # o
            "\u094D": "",        # virama
            # Numerals
            "\u0966": "0",
            "\u0967": "1",
            "\u0968": "2",
            "\u0969": "3",
            "\u096A": "4",
            "\u096B": "5",
            "\u096C": "6",
            "\u096D": "7",
            "\u096E": "8",
            "\u096F": "9",
            # Punctuation / zero-width marks
            "\u0970": ".",       # Devanagari abbreviation sign
            "\u200C": "",        # ZWNJ (ignore)
            "\u200D": "",        # ZWJ (ignore)
        }

        self.capitalizer = LatinCapitalizer(
            self.paragraph_elements, self.ignore_elements, self.capital_marker
        )

    def convert_string(self, dev_str: str) -> str:
        """
        Generalized, reusable transliteration method.
        Inserts inherent vowel 'a' after consonants where needed,
        then maps Devanagari characters to Latin characters.
        """
        # Insert 'a' after consonants not followed by virama, dependent vowel, or 'a'
        dev_str = re.sub(r"([\u0915-\u0939])([^\u093E-\u094Da])", r"\1a\2", dev_str)
        dev_str = re.sub(r"([\u0915-\u0939])([^\u093E-\u094Da])", r"\1a\2", dev_str)

        sb = []
        for c in dev_str:
            sb.append(self.deva2latn.get(c, c))
        return "".join(sb)

    def convert_dandas(self, text: str) -> str:
        """
        Converts Devanagari dandas (।) and double dandas (॥) to Latin punctuation.
        In gathas: single danda -> semicolon (;), double danda -> period (.)
        In centre paragraph (namo tassa): double danda removed.
        All other dandas -> period (.)
        """
        def convert_gatha(m: re.Match) -> str:
            s = m.group(0)
            s = s.replace("\u0964", ";")
            s = s.replace("\u0965", ".")
            return s

        def remove_namo_tassa(m: re.Match) -> str:
            s = m.group(0)
            return s.replace("\u0965", "")

        text = re.sub(r'<p rend="gatha[a-z0-9]*">.+?</p>', convert_gatha, text)
        text = re.sub(r'<p rend="centre">.+?</p>', remove_namo_tassa, text)
        text = text.replace("\u0964", ".")
        text = text.replace("\u0965", ".")
        return text

    def cleanup_punctuation(self, text: str) -> str:
        """
        Removes leading spaces before punctuation marks (, ? ! ; .).
        """
        text = text.replace(" ,", ",")
        text = text.replace(" ?", "?")
        text = text.replace(" !", "!")
        text = text.replace(" ;", ";")
        text = text.replace(" .", ".")
        return text

    def convert(self, dev_str: str) -> str:
        """
        Full conversion pipeline for Devanagari XML string to Latin XML string.
        """
        # 1. Update stylesheet reference for Latin
        dev_str = dev_str.replace("tipitaka-deva.xsl", "tipitaka-latn.xsl")

        # 2. Mark capitalization positions in Devanagari XML
        dev_str = self.capitalizer.mark_capitals(dev_str)

        # 3. Remove Devanagari abbreviation sign before ellipsis
        dev_str = dev_str.replace("\u0970\u2026", "\u2026")

        # 4. Transliterate Devanagari script to Latin script
        latin_str = self.convert_string(dev_str)

        # 5. Apply capitalization at marked positions
        latin_str = self.capitalizer.capitalize(latin_str)

        # 6. Convert dandas
        latin_str = self.convert_dandas(latin_str)

        # 7. Clean up punctuation spacing
        latin_str = self.cleanup_punctuation(latin_str)

        return latin_str

    @staticmethod
    def read_xml_file(path: str) -> str:
        """Reads XML file with auto-detection of UTF-16LE, UTF-16BE, or UTF-8."""
        with open(path, "rb") as f:
            raw = f.read()
        if raw.startswith(b"\xfe\xff"):
            return raw[2:].decode("utf-16-be")
        elif raw.startswith(b"\xff\xfe"):
            return raw[2:].decode("utf-16-le")
        elif raw.startswith(b"\xef\xbb\xbf"):
            return raw[3:].decode("utf-8")
        else:
            if len(raw) >= 4 and raw[0] == 0 and raw[2] == 0:
                return raw.decode("utf-16-be")
            elif len(raw) >= 4 and raw[1] == 0 and raw[3] == 0:
                return raw.decode("utf-16-le")
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return raw.decode("latin-1")

    def convert_file(self, input_path: str, output_path: str, use_utf8: bool = True) -> None:
        """
        Reads a Devanagari XML file, converts it,
        and writes the Roman Latin XML file (UTF-8 by default, or UTF-16LE).
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Input file does not exist: {input_path}")

        dev_str = self.read_xml_file(input_path)
        latin_str = self.convert(dev_str)

        output_dir = os.path.dirname(os.path.abspath(output_path))
        if output_dir:
            os.makedirs(output_dir, exist_ok=True)

        if use_utf8:
            latin_str = re.sub(r'encoding=["\']UTF-16["\']', 'encoding="UTF-8"', latin_str, flags=re.IGNORECASE)
            with open(output_path, "w", encoding="utf-8", newline="\n") as f:
                f.write(latin_str)
        else:
            with open(output_path, "w", encoding="utf-16", newline="") as f:
                f.write(latin_str)

    def convert_directory(self, input_dir: str, output_dir: str, pattern: str = "*.xml", use_utf8: bool = True) -> int:
        """
        Converts all matching XML files from input_dir into output_dir.
        Returns the number of converted files.
        """
        if not os.path.isdir(input_dir):
            raise NotADirectoryError(f"Input directory does not exist: {input_dir}")

        os.makedirs(output_dir, exist_ok=True)
        files = sorted(glob.glob(os.path.join(input_dir, pattern)))
        for i, file_path in enumerate(files, start=1):
            file_name = os.path.basename(file_path)
            out_file_path = os.path.join(output_dir, file_name)
            self.convert_file(file_path, out_file_path, use_utf8=use_utf8)

        return len(files)

    def convert_tree(self, input_dir: str, output_dir: str, use_utf8: bool = True) -> int:
        """
        Recursively converts an entire directory tree to output_dir.
        Converts XML files and copies/transforms non-XML files (HTML, CSS, JSON, assets).
        """
        if not os.path.isdir(input_dir):
            raise NotADirectoryError(f"Input directory does not exist: {input_dir}")

        xml_count = 0
        for root, dirs, files in os.walk(input_dir):
            rel_dir = os.path.relpath(root, input_dir)
            target_dir = output_dir if rel_dir == "." else os.path.join(output_dir, rel_dir)
            os.makedirs(target_dir, exist_ok=True)

            for f in files:
                src_path = os.path.join(root, f)
                dst_path = os.path.join(target_dir, f)

                if f.endswith(".xml"):
                    self.convert_file(src_path, dst_path, use_utf8=use_utf8)
                    xml_count += 1
                else:
                    if f.endswith((".html", ".css", ".json")):
                        try:
                            with open(src_path, "r", encoding="utf-8") as fp:
                                content = fp.read()
                            content = content.replace("tipitaka-deva", "tipitaka-latn")
                            content = content.replace("/deva/", "/romn/")
                            with open(dst_path, "w", encoding="utf-8") as fp:
                                fp.write(content)
                        except Exception:
                            shutil.copy2(src_path, dst_path)
                    else:
                        shutil.copy2(src_path, dst_path)

        return xml_count


def print_usage() -> None:
    print("Transliterates Unicode Devanagari to Unicode Latin script")
    print("syntax:")
    print("deva2latn input [output]")


def main() -> None:
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print_usage()
        sys.exit(0)

    input_arg = sys.argv[1]
    output_arg = sys.argv[2] if len(sys.argv) == 3 else None

    if not os.path.exists(input_arg):
        print("Input file does not exist")
        sys.exit(1)

    converter = Deva2Latn()

    if os.path.isdir(input_arg):
        output_dir = output_arg if output_arg else "../latn"
        count = converter.convert_tree(input_arg, output_dir)
        print(f"Converted {count} XML file(s) from '{input_arg}' to '{output_dir}'.")
    else:
        # Input is a single file
        input_filename = os.path.basename(input_arg)
        if output_arg is None:
            output_dir = "../latn"
            os.makedirs(output_dir, exist_ok=True)
            output_path = os.path.join(output_dir, input_filename)
        elif os.path.isdir(output_arg) or not os.path.splitext(output_arg)[1]:
            os.makedirs(output_arg, exist_ok=True)
            output_path = os.path.join(output_arg, input_filename)
        else:
            output_path = output_arg

        converter.convert_file(input_arg, output_path)
        print(f"Converted '{input_arg}' -> '{output_path}'.")


if __name__ == "__main__":
    main()
