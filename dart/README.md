# Deva2Latn (Dart / Flutter)

A high-performance pure Dart & Flutter library and CLI tool for transliterating Devanagari Pali XML and text to Roman Latin script (IAST / Tipitaka Roman). Ported faithfully from `CST.Conversion` `Deva2Latn.cs` and `LatinCapitalizer.cs`.

## Features

- **Pure Dart**: Zero platform-specific dependencies; compatible with Flutter (Android, iOS, macOS, Windows, Linux, Web) and Dart VM / CLI.
- **Accurate Pali Transliteration**: Complete support for Pali consonants, vowels, conjuncts with virama, niggahita, numerals, dandas, and punctuation.
- **Tipitaka XML Structure & Capitalization**: Handles Tipitaka TEI.2 XML DOM structures, preserves special elements (e.g. `<note>`), and applies capitalization rules for sentences and paragraph headings (`p`, `head`, `trailer`, `tree`).
- **UTF-16LE with BOM Support**: Full support for legacy and standard UTF-16LE XML file encodings with byte-for-byte fidelity.

## Installation

Add to your `pubspec.yaml`:

```yaml
dependencies:
  deva2latn:
    path: ./dart # or git repository URL
```

## Usage

### 1. Plain String Transliteration

```dart
import 'package:deva2latn/deva2latn.dart';

void main() {
  final converter = Deva2Latn();

  // Transliterate Devanagari Pali text
  String latin = converter.convertString('नमो तस्स भगवतो अरहतो सम्मासम्बुद्धस्स');
  print(latin); // namo tassa bhagavato arahato sammāsambuddhassa
}
```

### 2. Full XML Conversion with Capitalization & Dandas

```dart
import 'package:deva2latn/deva2latn.dart';

void main() {
  final converter = Deva2Latn();

  String xmlDeva = '''<?xml version="1.0" encoding="UTF-16"?>
<?xml-stylesheet type="text/xsl" href="tipitaka-deva.xsl"?>
<TEI.2>
<teiHeader></teiHeader>
<text>
<front></front>
<body xml:space="preserve">
<p rend="centre">॥ नमो तस्स भगवतो अरहतो सम्मासम्बुद्धस्स॥</p>
<p rend="nikaya">अभिधम्मपिटके</p>
</body>
</text>
</TEI.2>''';

  String xmlLatin = converter.convert(xmlDeva);
  print(xmlLatin);
}
```

### 3. File and Directory Conversion (CLI or Server)

```dart
import 'package:deva2latn/deva2latn.dart';

void main() async {
  final converter = Deva2Latn();

  // Convert a single XML file
  await converter.convertFile('path/to/input.xml', 'path/to/output.xml');

  // Convert an entire directory of XML files
  int count = await converter.convertDirectory('deva', 'p_latin');
  print('Converted $count files.');
}
```

### 4. Running the CLI Tool

```bash
# Convert a single file
dart run bin/deva2latn.dart input.xml output.xml

# Convert a directory
dart run bin/deva2latn.dart deva/ p_latin/
```

## Running Tests

```bash
dart test
```
