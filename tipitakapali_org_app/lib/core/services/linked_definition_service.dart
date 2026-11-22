import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';

import 'bold_definition_index_service.dart';
import 'tipitaka_core_reader.dart';

class BookLinkItem {
  final String word;
  final String targetBook;
  final String targetBookTitle;
  final String targetCategory;
  final int targetChapter;
  final int targetParaIndex;
  final String? targetParaNum;
  final int? targetLineId;
  final bool isSource;

  const BookLinkItem({
    required this.word,
    required this.targetBook,
    required this.targetBookTitle,
    required this.targetCategory,
    required this.targetChapter,
    required this.targetParaIndex,
    this.targetParaNum,
    this.targetLineId,
    required this.isSource,
  });

  Map<String, dynamic> toJson() => {
    'word': word,
    'target_book': targetBook,
    'target_book_title': targetBookTitle,
    'target_category': targetCategory,
    'target_chapter': targetChapter,
    'target_para_index': targetParaIndex,
    'target_para_num': targetParaNum,
    if (targetLineId != null) 'target_line_id': targetLineId,
    'is_source': isSource,
  };
}

class LinkedPreviewLine {
  final int paraIndex;
  final String? paraNum;
  final int? lineId;
  final String paliHtml;
  final Map<String, String> translations;
  final bool isTarget;

  const LinkedPreviewLine({
    required this.paraIndex,
    this.paraNum,
    this.lineId,
    required this.paliHtml,
    this.translations = const {},
    this.isTarget = false,
  });

  Map<String, dynamic> toJson() => {
    'para_index': paraIndex,
    if (paraNum != null) 'para_num': paraNum,
    if (lineId != null) 'line_id': lineId,
    'pali_html': paliHtml,
    'translations': translations,
    'is_target': isTarget,
  };
}

class LinkedPreviewContent {
  final String bookCode;
  final String bookTitle;
  final String category;
  final int chapterIndex;
  final int targetParaIndex;
  final String? targetParaNum;
  final int? targetLineId;
  final String? headingTitle;
  final List<String> translationLangs;
  final List<LinkedPreviewLine> lines;

  const LinkedPreviewContent({
    required this.bookCode,
    required this.bookTitle,
    required this.category,
    required this.chapterIndex,
    required this.targetParaIndex,
    this.targetParaNum,
    this.targetLineId,
    this.headingTitle,
    this.translationLangs = const [],
    this.lines = const [],
  });

  Map<String, dynamic> toJson() => {
    'book_code': bookCode,
    'book_title': bookTitle,
    'category': category,
    'chapter_index': chapterIndex,
    'target_para_index': targetParaIndex,
    if (targetParaNum != null) 'target_para_num': targetParaNum,
    if (targetLineId != null) 'target_line_id': targetLineId,
    if (headingTitle != null) 'heading_title': headingTitle,
    'translation_langs': translationLangs,
    'lines': lines.map((l) => l.toJson()).toList(growable: false),
  };
}

/// Resolves word-level commentary/root links (`BookLinkItem`) per chapter and
/// loads rich contextual previews (`LinkedPreviewContent`), inspired by
/// epitaka_app's `BookLinkService` and enhanced to work directly on
/// `tipitaka.db` + `bold_definitions.db` (plus `pali_sentences.db` &
/// `translation_<lang>.db` when installed).
class LinkedDefinitionService {
  static final RegExp _tokenSplitRe = RegExp(
    r'''[\s.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§`‘’“”"'«»‹›„]+''',
  );
  static final RegExp _pTagRe = RegExp(
    r'<p\b([^>]*)>([\s\S]*?)</p>',
    caseSensitive: false,
  );
  static final RegExp _pindexAttrRe = RegExp(
    r'\bdata-pindex="(\d+)"',
    caseSensitive: false,
  );
  static final RegExp _pbSpanRe = RegExp(
    r'<span\b[^>]*\bclass=["\x27]?pb["\x27]?[^>]*>[\s\S]*?</span>',
    caseSensitive: false,
  );
  static final RegExp _paranumRe = RegExp(
    r'<strong\b[^>]*\bclass=["\x27]?paranum["\x27]?[^>]*>[\s\S]*?</strong>(?:\s*<span\b[^>]*\bclass=["\x27]?dot["\x27]?[^>]*>[\s\S]*?</span>)?\s*\.?\s*',
    caseSensitive: false,
  );
  static final RegExp _bldTagRe = RegExp(
    r'<strong\b[^>]*\bclass=["\x27]?bld["\x27]?[^>]*>([\s\S]*?)</strong>',
    caseSensitive: false,
  );
  static final RegExp _anyTagExceptBRe = RegExp(
    r'<(?!/?b\b)[^>]+>',
    caseSensitive: false,
  );

  final BoldDefinitionIndexService _boldService;

  LinkedDefinitionService({BoldDefinitionIndexService? boldService})
      : _boldService = boldService ?? BoldDefinitionIndexService();

  static final RegExp _phrasePunctRe = RegExp(
    r'''[‘’“”"'«»‹›„.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§`]+''',
  );

  static String _normPali(String s) => s
      .toLowerCase()
      .replaceAll('ṁ', 'ṃ')
      .replaceAll(
        RegExp(r'</?(?:b|i|em|strong)\b[^>]*>', caseSensitive: false),
        '',
      )
      .replaceAll(RegExp(r'\[[^\]]*\]'), ' ')
      .replaceAll(RegExp(r'''[’”"']+\s*(?=n?t[iī])''', caseSensitive: false), '')
      .replaceAll(RegExp(r'\s+-(?=\p{L})', unicode: true), '')
      .replaceAll(RegExp(r'<[^>]+>'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();

  static ({
    int lineId,
    String normLine,
    String normPhrase,
    String normPhraseSpaced,
    String normPhraseTi,
    String normPhraseSpacedTi,
    Set<String> tokens,
  }) _buildLineNorm(String rawText, int lineId) {
    final base = rawText
        .toLowerCase()
        .replaceAll('ṁ', 'ṃ')
        .replaceAll(
          RegExp(r'</?(?:b|i|em|strong)\b[^>]*>', caseSensitive: false),
          '',
        )
        .replaceAll(RegExp(r'\[[^\]]*\]'), ' ')
        .replaceAll(RegExp(r'''[’”"']+\s*(?=n?t[iī])''', caseSensitive: false), '')
        .replaceAll(RegExp(r'<[^>]+>'), ' ');
    final normLine = base
        .replaceAll(RegExp(r'\s+-(?=\p{L})', unicode: true), '')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    final normPhrase = normLine
        .replaceAll(_phrasePunctRe, ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    final normPhraseSpaced = base
        .replaceAll(_phrasePunctRe, ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    final tiSpaceRe = RegExp(r'\s+(?=n?t[iī](?:\s|$))');
    return (
      lineId: lineId,
      normLine: normLine,
      normPhrase: normPhrase,
      normPhraseSpaced: normPhraseSpaced,
      normPhraseTi: normPhrase.replaceAll(tiSpaceRe, ''),
      normPhraseSpacedTi: normPhraseSpaced.replaceAll(tiSpaceRe, ''),
      tokens: normLine.isEmpty
          ? const <String>{}
          : normLine.split(_tokenSplitRe).where((t) => t.isNotEmpty).toSet(),
    );
  }

  static final RegExp _validInflectionSuffixRe = RegExp(
    r'^(?:[aāiīuūeoṃ]|[aāiīuū]ṃ|n?t[iī](?:ādi.*)?|a?(?:ssa|smiṃ|mhi|smā|mhā|naṃ)|ena|āya|āni|esu|īsu|ūsu|ehi|ebhi|pi|ca|va|no|to)$',
  );
  static final RegExp _inflectionStemEndRe = RegExp(r'[aāiīuūeo]$');

  static String? _inflectionStem(String word) {
    if (word.isEmpty || word.contains(' ') || word.length < 3) return null;
    var base = word.endsWith('ṃ') ? word.substring(0, word.length - 1) : word;
    if (_inflectionStemEndRe.hasMatch(base) && base.length >= 3) {
      base = base.substring(0, base.length - 1);
    }
    return base.length >= 2 ? base : null;
  }

  static String? _highlightByNormWord(String sentence, String? normWord) {
    if (normWord == null || normWord.length < 2) return null;
    final candidates = <String>{normWord, ..._vowelVariants(normWord)};
    if (normWord.endsWith('ṃ') && normWord.length >= 3) {
      candidates.add(normWord.substring(0, normWord.length - 1));
    }
    for (final c in candidates) {
      final re = RegExp(
        '(?<![\\p{L}])${RegExp.escape(c)}(?=n?t[iī]|[\\s.,;:!?…—–\\-\'’"”)]|\$)',
        caseSensitive: false,
        unicode: true,
      );
      if (re.hasMatch(sentence)) {
        return sentence.replaceFirstMapped(re, (m) => '<b>${m.group(0)}</b>');
      }
    }
    final stem = _inflectionStem(normWord);
    if (stem != null) {
      final reStem = RegExp(
        '(?<![\\p{L}])${RegExp.escape(stem)}(?:a|ā|i|ī|u|ū|e|o|ṃ|aṃ|āya|assa|ānaṃ|asmā|amhā|asmiṃ|amhi|esu|ehi|ebhi|ena|āni|āyo|ayo|ino|inā|inaṃ|isu|īsu|uhi|ūhi|ussa|ūnaṃ|nti)?(?=[\\s.,;:!?…—–\\-\'’"”)]|\$)',
        caseSensitive: false,
        unicode: true,
      );
      if (reStem.hasMatch(sentence)) {
        return sentence.replaceFirstMapped(reStem, (m) => '<b>${m.group(0)}</b>');
      }
    }
    return null;
  }

  static String _highlightSentenceWithBold(
    String sentence,
    String? normWord,
    String? paraHtmlWithB, {
    bool isTarget = false,
  }) {
    if (sentence.isEmpty) return sentence;
    if (sentence.contains('<b>')) {
      if (isTarget && normWord != null && normWord.length >= 2) {
        final boldInner = RegExp(r'<b>([^<]+)</b>', caseSensitive: false)
            .allMatches(sentence)
            .map((m) => _normPali(m.group(1) ?? ''))
            .join(' ');
        if (!_normMatchesTarget(boldInner, normWord)) {
          final plain = sentence.replaceAll(RegExp(r'</?b>', caseSensitive: false), '');
          final highlighted = _highlightByNormWord(plain, normWord);
          if (highlighted != null) return highlighted;
        }
      }
      return sentence;
    }

    if (isTarget) {
      final byWord = _highlightByNormWord(sentence, normWord);
      if (byWord != null) return byWord;
    }

    // 1. Transfer any <b>...</b> terms from the paragraph's CST HTML onto this sentence (word-boundary safe).
    if (paraHtmlWithB != null && paraHtmlWithB.contains('<b>')) {
      for (final bm in RegExp(r'<b>([^<]+)</b>').allMatches(paraHtmlWithB)) {
        final boldTerm = bm.group(1)?.trim() ?? '';
        if (boldTerm.length < 2) continue;
        final re = RegExp(
          '(?<![\\p{L}])${RegExp.escape(boldTerm)}(?![\\p{L}])',
          caseSensitive: false,
          unicode: true,
        );
        if (re.hasMatch(sentence)) {
          return sentence.replaceFirstMapped(re, (m) => '<b>${m.group(0)}</b>');
        }
      }
    }

    if (!isTarget) {
      final byWord = _highlightByNormWord(sentence, normWord);
      if (byWord != null) return byWord;
    }

    return sentence;
  }

  static bool _normMatchesTarget(String rawOrNormSent, String normWord) {
    if (rawOrNormSent.isEmpty || normWord.isEmpty) return false;
    final line = _buildLineNorm(rawOrNormSent, 1);
    return _matchesLineObj(line, normWord);
  }

  static String _categoryLabel(String bookCode) {
    final lower = bookCode.toLowerCase();
    if (lower.endsWith('.mul')) return 'mūla';
    if (lower.endsWith('.att')) return 'aṭṭhakathā';
    if (lower.endsWith('.tik')) return 'ṭīkā';
    return 'anya';
  }

  /// Generates equivalent short/long trailing vowel variants and sandhi forms
  /// for a Pāli word (e.g. `hotī` <-> `hoti`, `paṭī` <-> `paṭi`).
  static List<String> _vowelVariants(String word) {
    if (word.isEmpty) return const [];
    final variants = <String>{word};
    final last = word[word.length - 1];
    const swap = {
      'ā': 'a',
      'a': 'ā',
      'ī': 'i',
      'i': 'ī',
      'ū': 'u',
      'u': 'ū',
    };
    final alt = swap[last];
    if (alt != null) {
      variants.add('${word.substring(0, word.length - 1)}$alt');
    }
    return variants.toList(growable: false);
  }

  /// Generates sandhi token variants (e.g. `evaṃ` -> `evanti`, `hoti` -> `hotīti`)
  /// so bold definitions with restored anusvāra match un-split tokens in lines.
  static List<String> _sandhiTokenVariants(String word) {
    final out = <String>{..._vowelVariants(word)};
    if (word.endsWith('ṃ') && word.length >= 3) {
      final stem = word.substring(0, word.length - 1);
      out.add('${stem}nti');
      out.add('${stem}ntī');
      out.add('${stem}ntīti');
    } else if (word.length >= 2) {
      for (final v in _vowelVariants(word)) {
        out.add('${v}ti');
        out.add('${v}tī');
      }
    }
    return out.toList(growable: false);
  }

  static bool _isBoundaryOrSpace(String s, int idx) {
    if (idx < 0 || idx >= s.length) return true;
    final code = s.codeUnitAt(idx);
    return code == 0x20 || code == 0x09 || code == 0x0A || code == 0x0D;
  }

  static bool _hasTiSuffixAt(String s, int pos) {
    if (pos >= s.length) return true;
    final code = s.codeUnitAt(pos);
    if (code == 0x20 || code == 0x09 || code == 0x0A || code == 0x0D) {
      return true;
    }
    if (s.startsWith('ti', pos) || s.startsWith('tī', pos)) return true;
    if (s.startsWith('nti', pos) || s.startsWith('ntī', pos)) return true;
    return false;
  }

  static bool _hasNtTiAt(String s, int pos) {
    return s.startsWith('nti', pos) || s.startsWith('ntī', pos);
  }

  static bool _containsPhraseFast(
    String haystack,
    String needle, {
    required bool allowPrefixLetters,
    required bool matchNtTiEnd,
  }) {
    var start = 0;
    while (true) {
      final idx = haystack.indexOf(needle, start);
      if (idx == -1) return false;
      final startOk = allowPrefixLetters || _isBoundaryOrSpace(haystack, idx - 1);
      if (startOk) {
        final after = idx + needle.length;
        if (matchNtTiEnd) {
          if (_hasNtTiAt(haystack, after)) return true;
        } else if (_hasTiSuffixAt(haystack, after)) {
          return true;
        }
      }
      start = idx + 1;
    }
  }

  static final RegExp _multiWsRe = RegExp(r'\s+');
  static final RegExp _peSplitRe = RegExp(r'\s+pe\s+');

  static bool _matchesLineObj(
    ({
      int lineId,
      String normLine,
      String normPhrase,
      String normPhraseSpaced,
      String normPhraseTi,
      String normPhraseSpacedTi,
      Set<String> tokens,
    }) line,
    String candidate,
  ) {
    if (line.normLine.isEmpty || candidate.isEmpty) return false;
    final variants = _vowelVariants(candidate);

    if (candidate.contains(' ')) {
      final firstWordLen = candidate.indexOf(' ');
      final allowPrefix = firstWordLen >= 5;
      final haystacks = [
        line.normPhrase,
        line.normPhraseSpaced,
        line.normPhraseTi,
        line.normPhraseSpacedTi,
      ];
      final ntStem = (candidate.endsWith('ṃ') && candidate.length >= 4)
          ? candidate.substring(0, candidate.length - 1)
          : null;
      for (final hay in haystacks) {
        if (hay.isEmpty) continue;
        for (final v in variants) {
          if (_containsPhraseFast(
            hay,
            v,
            allowPrefixLetters: allowPrefix,
            matchNtTiEnd: false,
          )) {
            return true;
          }
        }
        if (ntStem != null &&
            _containsPhraseFast(
              hay,
              ntStem,
              allowPrefixLetters: allowPrefix,
              matchNtTiEnd: true,
            )) {
          return true;
        }
      }
      if (candidate.contains(' pe ')) {
        final peParts = candidate
            .split(_peSplitRe)
            .map((p) => p.trim())
            .where((p) => p.isNotEmpty)
            .toList(growable: false);
        if (peParts.length == 2 &&
            peParts[0].length >= 4 &&
            peParts[1].length >= 4) {
          final p1 = peParts[0];
          final p2 = peParts[1];
          for (final hay in [line.normPhrase, line.normPhraseSpaced]) {
            if (hay.isEmpty) continue;
            var s = 0;
            while (true) {
              final i1 = hay.indexOf(p1, s);
              if (i1 == -1) break;
              if (_isBoundaryOrSpace(hay, i1 - 1) &&
                  _isBoundaryOrSpace(hay, i1 + p1.length)) {
                final searchFrom = i1 + p1.length + 1;
                final maxEnd = (searchFrom + 160 + p2.length <= hay.length)
                    ? searchFrom + 160 + p2.length
                    : hay.length;
                if (searchFrom < maxEnd) {
                  final i2 = hay.indexOf(p2, searchFrom);
                  if (i2 != -1 &&
                      i2 <= searchFrom + 160 &&
                      _isBoundaryOrSpace(hay, i2 - 1) &&
                      _hasTiSuffixAt(hay, i2 + p2.length)) {
                    return true;
                  }
                }
              }
              s = i1 + 1;
            }
          }
        }
      }
      final collapsed = candidate.replaceAll(_multiWsRe, '');
      if (collapsed.length >= 5 && _matchesLineObj(line, collapsed)) {
        return true;
      }
      return false;
    }

    return _matchesInLine(line.normLine, line.tokens, candidate);
  }

  /// Tokenizes [normalizedText] into word tokens and tests whether [candidate]
  /// occurs as a word/phrase or (for candidates >= 5 chars) at compound boundaries.
  static bool _matchesInLine(
    String normalizedText,
    Set<String> lineTokens,
    String candidate,
  ) {
    if (normalizedText.isEmpty || candidate.isEmpty) return false;
    if (candidate.contains(' ')) {
      return _matchesLineObj(_buildLineNorm(normalizedText, 1), candidate);
    }
    final variants = _vowelVariants(candidate);

    final tokenVariants = _sandhiTokenVariants(candidate);
    for (final v in tokenVariants) {
      if (lineTokens.contains(v)) return true;
    }

    if (candidate.length >= 2) {
      for (final v in variants) {
        final tiPrefix = '${v}ti';
        final tiiPrefix = '${v}tī';
        for (final tok in lineTokens) {
          if (tok.startsWith(tiPrefix) || tok.startsWith(tiiPrefix)) {
            return true;
          }
        }
      }
    }

    // Inflectional stem match (e.g. `samayo` <-> `samayaṃ`, `eka` <-> `ekaṃ`)
    final stem = _inflectionStem(candidate);
    if (stem != null) {
      for (final tok in lineTokens) {
        if (tok.startsWith(stem) &&
            _validInflectionSuffixRe.hasMatch(tok.substring(stem.length))) {
          return true;
        }
      }
    }

    // Compound boundary fallback ONLY for longer words (>= 5 chars) at
    // compound start or end (e.g. `addhānamaggappaṭipanno` matches `paṭipanno`),
    // avoiding noisy substring matches like `ayaṃ` inside `samayaṃ`.
    if (candidate.length >= 5) {
      for (final v in variants) {
        for (final tok in lineTokens) {
          if (tok.length > v.length &&
              (tok.startsWith(v) || tok.endsWith(v))) {
            return true;
          }
        }
      }
      if (candidate.endsWith('ṃ')) {
        final stemNt = '${candidate.substring(0, candidate.length - 1)}nt';
        for (final tok in lineTokens) {
          if (tok.startsWith(stemNt) || tok.endsWith(stemNt)) return true;
        }
      }
    }
    return false;
  }

  /// Fast-path lookup returning the raw prebuilt `chapter_links.paragraphs_json`
  /// string directly from SQLite without decoding/re-encoding multi-MB JSON.
  /// Returns `null` when the `chapter_links` table is absent so callers can
  /// fall back to runtime link computation.
  Future<String?> getLinksForChapterRawJson({
    required String dbDirPath,
    required String bookCode,
    required int chapterIndex,
    Database? boldDbOverride,
  }) async {
    Database? ownedBoldDb;
    Database? boldDb = boldDbOverride;
    if (boldDb == null) {
      final boldPath = p.join(dbDirPath, BoldDefinitionIndexService.dbFilename);
      if (!BoldDefinitionIndexService.isUpToDate(dbDirPath)) {
        await _boldService.ensureBuilt(dbDirPath: dbDirPath);
      }
      if (File(boldPath).existsSync()) {
        ownedBoldDb = sqlite3.open(boldPath, mode: OpenMode.readOnly);
        boldDb = ownedBoldDb;
      }
    }
    if (boldDb == null) return null;

    try {
      if (!TipitakaCoreReader.tableAndViewNames(boldDb).contains('chapter_links')) {
        return null;
      }
      final raw = TipitakaCoreReader.readChapterLinksJson(
        boldDb,
        bookCode,
        chapterIndex,
      )?.trim();
      if (raw == null || raw.isEmpty) return '{}';
      if (raw.startsWith('{') && raw.endsWith('}')) {
        return raw;
      }
      return '{}';
    } catch (_) {
      return null;
    } finally {
      ownedBoldDb?.close();
    }
  }

  /// Computes word-level commentary/root links for all paragraphs in
  /// ([bookCode], [chapterIndex]).
  Future<Map<String, dynamic>> getLinksForChapter({
    required String dbDirPath,
    required String bookCode,
    required int chapterIndex,
    Database? tipitakaDbOverride,
    Database? boldDbOverride,
    Database? paliSentencesDbOverride,
  }) async {
    Database? ownedTipiDb;
    Database? tipiDb = tipitakaDbOverride;
    if (tipiDb == null) {
      final path = p.join(dbDirPath, 'tipitaka.db');
      if (!File(path).existsSync()) {
        return {
          'book_code': bookCode,
          'chapter_index': chapterIndex,
          'paragraphs': const <String, dynamic>{},
        };
      }
      ownedTipiDb = sqlite3.open(path, mode: OpenMode.readOnly);
      tipiDb = ownedTipiDb;
    }

    Database? ownedBoldDb;
    Database? boldDb = boldDbOverride;
    if (boldDb == null) {
      final boldPath = p.join(dbDirPath, BoldDefinitionIndexService.dbFilename);
      if (!BoldDefinitionIndexService.isUpToDate(dbDirPath)) {
        await _boldService.ensureBuilt(dbDirPath: dbDirPath);
      }
      if (File(boldPath).existsSync()) {
        ownedBoldDb = sqlite3.open(boldPath, mode: OpenMode.readOnly);
        boldDb = ownedBoldDb;
      }
    }

    if (boldDb == null) {
      ownedTipiDb?.close();
      return {
        'book_code': bookCode,
        'chapter_index': chapterIndex,
        'paragraphs': const <String, dynamic>{},
      };
    }

    try {
      if (TipitakaCoreReader.tableAndViewNames(boldDb).contains('chapter_links')) {
        final raw = TipitakaCoreReader.readChapterLinksJson(
          boldDb,
          bookCode,
          chapterIndex,
        )?.trim();
        if (raw == null || raw.isEmpty) {
          return {
            'book_code': bookCode,
            'chapter_index': chapterIndex,
            'paragraphs': const <String, dynamic>{},
          };
        }
        final decoded = jsonDecode(raw);
        return {
          'book_code': bookCode,
          'chapter_index': chapterIndex,
          'paragraphs': decoded is Map<String, dynamic>
              ? decoded
              : Map<String, dynamic>.from(decoded as Map),
        };
      }
    } catch (_) {}

    Database? ownedSentDb;
    Database? sentDb = paliSentencesDbOverride;
    if (sentDb == null) {
      final sentPath = p.join(dbDirPath, 'pali_sentences.db');
      if (File(sentPath).existsSync()) {
        ownedSentDb = sqlite3.open(sentPath, mode: OpenMode.readOnly);
        sentDb = ownedSentDb;
      }
    }

    try {
      return _computeLinksForChapterSync(
        tipiDb: tipiDb,
        boldDb: boldDb,
        sentDb: sentDb,
        bookCode: bookCode,
        chapterIndex: chapterIndex,
      );
    } finally {
      ownedSentDb?.close();
      ownedBoldDb?.close();
      ownedTipiDb?.close();
    }
  }

  /// Precomputes and stores `chapter_links` for all chapters in [tipiDb]
  /// inside [boldDb] so runtime `getLinksForChapter` is a single SQL lookup.
  static int prebuildChapterLinksSync({
    required Database tipiDb,
    required Database boldDb,
    String? paliSentDbPath,
  }) {
    boldDb.execute('''
      CREATE TABLE IF NOT EXISTS chapter_links (
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        paragraphs_json TEXT NOT NULL,
        PRIMARY KEY (book_code, chapter_index)
      );
    ''');

    final chapCols = TipitakaCoreReader.tableColumns(tipiDb, 'chapters');
    final chapRows = chapCols.contains('book_code')
        ? tipiDb.select(
            'SELECT book_code, chapter_index FROM chapters ORDER BY book_code, chapter_index',
          )
        : tipiDb.select(
            'SELECT b.code AS book_code, c.chapter_index '
            'FROM chapters c JOIN books b ON b.id = c.book_id '
            'ORDER BY b.code, c.chapter_index',
          );
    if (chapRows.isEmpty) return 0;

    Database? sentDb;
    if (paliSentDbPath != null && File(paliSentDbPath).existsSync()) {
      try {
        sentDb = sqlite3.open(paliSentDbPath, mode: OpenMode.readOnly);
      } catch (_) {}
    }

    final bookTitleCache = <String, String>{};
    final reverseParaIndexCache =
        <String, List<({int paraIndex, int chapterIndex})>>{};
    final targetChapSentCache = <
      String,
      Map<
        int,
        List<({
          int lineId,
          String normLine,
          String normPhrase,
          String normPhraseSpaced,
          String normPhraseTi,
          String normPhraseSpacedTi,
          Set<String> tokens,
        })>
      >
    >{};
    final targetParaTextCache = <
      String,
      List<({
        int lineId,
        String normLine,
        String normPhrase,
        String normPhraseSpaced,
        String normPhraseTi,
        String normPhraseSpacedTi,
        Set<String> tokens,
      })>
    >{};

    var inserted = 0;
    final insertStmt = boldDb.prepare(
      'INSERT OR REPLACE INTO chapter_links (book_code, chapter_index, paragraphs_json) VALUES (?, ?, ?);',
    );
    try {
      boldDb.execute('BEGIN TRANSACTION;');
      try {
        for (final cr in chapRows) {
          final bc = (cr['book_code'] ?? '').toString();
          final ci = (cr['chapter_index'] as num).toInt();
          if (bc.isEmpty) continue;
          final payload = _computeLinksForChapterSync(
            tipiDb: tipiDb,
            boldDb: boldDb,
            sentDb: sentDb,
            bookCode: bc,
            chapterIndex: ci,
            bookTitleCache: bookTitleCache,
            reverseParaIndexCache: reverseParaIndexCache,
            targetChapSentCache: targetChapSentCache,
            targetParaTextCache: targetParaTextCache,
          );
          final paras = payload['paragraphs'] as Map<String, dynamic>;
          if (paras.isNotEmpty) {
            insertStmt.execute([bc, ci, jsonEncode(paras)]);
            inserted++;
          }
          if (targetChapSentCache.length > 48) {
            targetChapSentCache.clear();
            targetParaTextCache.clear();
          }
          if (reverseParaIndexCache.length > 4000) {
            reverseParaIndexCache.clear();
          }
        }
        boldDb.execute('COMMIT;');
      } catch (e) {
        try {
          boldDb.execute('ROLLBACK;');
        } catch (_) {}
        rethrow;
      }
    } finally {
      insertStmt.close();
      sentDb?.close();
    }
    return inserted;
  }

  static Map<String, dynamic> _computeLinksForChapterSync({
    required Database tipiDb,
    required Database boldDb,
    required Database? sentDb,
    required String bookCode,
    required int chapterIndex,
    Map<String, String>? bookTitleCache,
    Map<String, List<({int paraIndex, int chapterIndex})>>? reverseParaIndexCache,
    Map<
      String,
      Map<
        int,
        List<({
          int lineId,
          String normLine,
          String normPhrase,
          String normPhraseSpaced,
          String normPhraseTi,
          String normPhraseSpacedTi,
          Set<String> tokens,
        })>
      >
    >? targetChapSentCache,
    Map<
      String,
      List<({
        int lineId,
        String normLine,
        String normPhrase,
        String normPhraseSpaced,
        String normPhraseTi,
        String normPhraseSpacedTi,
        Set<String> tokens,
      })>
    >? targetParaTextCache,
  }) {
    final paraRows = tipiDb.select(
        'SELECT para_index, para_num, pali_text, '
        'mula_book, mula_chapter, mula_para, '
        'attha_book, attha_chapter, attha_para, '
        'tika_book, tika_chapter, tika_para '
        'FROM canon_paragraphs '
        'WHERE book_code = ? AND chapter_index = ? '
        'ORDER BY para_index ASC',
        [bookCode, chapterIndex],
      );

      if (paraRows.isEmpty) {
        return {
          'book_code': bookCode,
          'chapter_index': chapterIndex,
          'paragraphs': const <String, dynamic>{},
        };
      }

      // Load sentence lines from pali_sentences.db or embedded tipitaka.db pack.
      final sentencesByPara = TipitakaCoreReader.readChapterSentences(
        sentDb,
        tipiDb,
        bookCode,
        chapterIndex,
      );
      Map<int, String>? lazyChapTexts;

      // Collect forward targets keyed by (target_book, target_chapter) -> para_nums
      // so books whose para_num resets across chapters (e.g. abh01a.att) never
      // collide across chapters.
      final isMula = bookCode.toLowerCase().endsWith('.mul');
      final isAtt = bookCode.toLowerCase().endsWith('.att');
      final isTik = bookCode.toLowerCase().endsWith('.tik');

      final forwardTargetsByBookChap = <({String book, int? chap}), Set<String>>{};
      for (final r in paraRows) {
        if (isMula || !isTik) {
          final ab = r['attha_book']?.toString();
          final ac = (r['attha_chapter'] as num?)?.toInt();
          final ap = r['attha_para']?.toString().trim();
          if (ab != null && ab.isNotEmpty && ab != bookCode && ap != null && ap.isNotEmpty) {
            forwardTargetsByBookChap.putIfAbsent((book: ab, chap: ac), () => {}).add(ap);
          }
        }
        if (isMula || isAtt) {
          final tb = r['tika_book']?.toString();
          final tc = (r['tika_chapter'] as num?)?.toInt();
          final tp = r['tika_para']?.toString().trim();
          if (tb != null && tb.isNotEmpty && tb != bookCode && tp != null && tp.isNotEmpty) {
            forwardTargetsByBookChap.putIfAbsent((book: tb, chap: tc), () => {}).add(tp);
          }
        }
      }

      // Batch-fetch bold definitions from all forward target (book, chapter, para_num).
      // Key: "$targetBook|${targetChapter ?? ''}|$targetParaNum" -> list of bold def entries
      final forwardBoldDefs =
          <
            String,
            List<
              ({
                String word,
                String bookCode,
                String bookTitle,
                String category,
                int chapterIndex,
                int paraIndex,
                int lineId,
                String? paraNum,
              })
            >
          >{};

      for (final entry in forwardTargetsByBookChap.entries) {
        final targetBook = entry.key.book;
        final targetChap = entry.key.chap;
        final paraNums = entry.value.toList();
        if (paraNums.isEmpty) continue;
        // SQLite supports up to 999 bind params per query; chunk safely at 400.
        for (var i = 0; i < paraNums.length; i += 400) {
          final chunk = paraNums.sublist(
            i,
            i + 400 > paraNums.length ? paraNums.length : i + 400,
          );
          final placeholders = chunk.map((_) => '?').join(',');
          final bRows = targetChap != null
              ? boldDb.select(
                  'SELECT book_code, book_title, category, chapter_index, para_index, line_id, para_num, word '
                  'FROM bold_definitions '
                  'WHERE book_code = ? AND chapter_index = ? AND para_num IN ($placeholders) '
                  'ORDER BY chapter_index, para_index, line_id, id',
                  [targetBook, targetChap, ...chunk],
                )
              : boldDb.select(
                  'SELECT book_code, book_title, category, chapter_index, para_index, line_id, para_num, word '
                  'FROM bold_definitions '
                  'WHERE book_code = ? AND para_num IN ($placeholders) '
                  'ORDER BY chapter_index, para_index, line_id, id',
                  [targetBook, ...chunk],
                );
          for (final br in bRows) {
            final pnum = br['para_num']?.toString().trim() ?? '';
            if (pnum.isEmpty) continue;
            final key = '$targetBook|${targetChap ?? ''}|$pnum';
            forwardBoldDefs.putIfAbsent(key, () => []).add((
              word: br['word'].toString(),
              bookCode: br['book_code'].toString(),
              bookTitle: br['book_title'].toString(),
              category: br['category'].toString(),
              chapterIndex: (br['chapter_index'] as num).toInt(),
              paraIndex: (br['para_index'] as num).toInt(),
              lineId: (br['line_id'] as num?)?.toInt() ?? 1,
              paraNum: pnum,
            ));
          }
        }
      }

      // Also load bold definitions IN THIS chapter for reverse links (att->mul, tik->att/mul).
      final selfBoldDefsByPara = <int, List<({int lineId, String word})>>{};
      if (isAtt || isTik) {
        final selfRows = boldDb.select(
          'SELECT para_index, line_id, word FROM bold_definitions '
          'WHERE book_code = ? AND chapter_index = ? '
          'ORDER BY para_index, line_id, id',
          [bookCode, chapterIndex],
        );
        for (final sr in selfRows) {
          final pidx = (sr['para_index'] as num).toInt();
          final lid = (sr['line_id'] as num?)?.toInt() ?? 1;
          final w = sr['word'].toString();
          selfBoldDefsByPara.putIfAbsent(pidx, () => []).add((lineId: lid, word: w));
        }
      }

      // Cache resolved reverse target para_index + book_title in tipitaka.db
      final localBookTitleCache = bookTitleCache ?? <String, String>{};
      String getBookTitle(String code) {
        return localBookTitleCache.putIfAbsent(code, () {
          final rows = tipiDb.select(
            'SELECT title FROM books WHERE code = ? LIMIT 1',
            [code],
          );
          return rows.isNotEmpty ? (rows.first['title'] ?? code).toString() : code;
        });
      }

      final localReverseParaIndexCache =
          reverseParaIndexCache ?? <String, List<({int paraIndex, int chapterIndex})>>{};
      List<({int paraIndex, int chapterIndex})> resolveTargetParas(
        String targetBook,
        int? targetChapter,
        String targetParaNum,
      ) {
        final key = '$targetBook|${targetChapter ?? -1}|$targetParaNum';
        if (localReverseParaIndexCache.containsKey(key)) {
          return localReverseParaIndexCache[key]!;
        }
        ResultSet rows = targetChapter != null
            ? tipiDb.select(
                'SELECT para_index, chapter_index FROM canon_paragraphs '
                'WHERE book_code = ? AND chapter_index = ? AND para_num = ? '
                'ORDER BY para_index ASC',
                [targetBook, targetChapter, targetParaNum],
              )
            : tipiDb.select(
                'SELECT para_index, chapter_index FROM canon_paragraphs '
                'WHERE book_code = ? AND para_num = ? '
                'ORDER BY para_index ASC',
                [targetBook, targetParaNum],
              );
        if (rows.isEmpty && targetChapter != null) {
          rows = tipiDb.select(
            'SELECT para_index, chapter_index FROM canon_paragraphs '
            'WHERE book_code = ? AND para_num = ? '
            'ORDER BY para_index ASC',
            [targetBook, targetParaNum],
          );
        }
        final parsedNum = int.tryParse(targetParaNum.split('-').first);
        if (rows.isEmpty && parsedNum != null && targetChapter != null) {
          rows = tipiDb.select(
            'SELECT para_index, chapter_index FROM canon_paragraphs '
            'WHERE book_code = ? AND chapter_index = ? AND para_first <= ? AND para_last >= ? '
            'ORDER BY para_index ASC',
            [targetBook, targetChapter, parsedNum, parsedNum],
          );
        }
        if (rows.isEmpty && parsedNum != null) {
          rows = tipiDb.select(
            'SELECT para_index, chapter_index FROM canon_paragraphs '
            'WHERE book_code = ? AND para_first <= ? AND para_last >= ? '
            'ORDER BY para_index ASC',
            [targetBook, parsedNum, parsedNum],
          );
        }
        final res = [
          for (final row in rows)
            (
              paraIndex: (row['para_index'] as num).toInt(),
              chapterIndex: (row['chapter_index'] as num).toInt(),
            ),
        ];
        localReverseParaIndexCache[key] = res;
        return res;
      }

      final localTargetChapSentCache = targetChapSentCache ?? <
        String,
        Map<
          int,
          List<({
            int lineId,
            String normLine,
            String normPhrase,
            String normPhraseSpaced,
            String normPhraseTi,
            String normPhraseSpacedTi,
            Set<String> tokens,
          })>
        >
      >{};
      final localTargetParaTextCache = targetParaTextCache ?? <
        String,
        List<({
          int lineId,
          String normLine,
          String normPhrase,
          String normPhraseSpaced,
          String normPhraseTi,
          String normPhraseSpacedTi,
          Set<String> tokens,
        })>
      >{};

      List<({
        int lineId,
        String normLine,
        String normPhrase,
        String normPhraseSpaced,
        String normPhraseTi,
        String normPhraseSpacedTi,
        Set<String> tokens,
      })> getTargetParaLines(
        String targetBook,
        int targetChap,
        int targetParaIdx,
      ) {
        final ck = '$targetBook|$targetChap';
        final chapMap = localTargetChapSentCache.putIfAbsent(ck, () {
          final rawMap = TipitakaCoreReader.readChapterSentences(
            sentDb,
            tipiDb,
            targetBook,
            targetChap,
          );
          return {
            for (final entry in rawMap.entries)
              entry.key: [
                for (final s in entry.value) _buildLineNorm(s.text, s.lineId),
              ],
          };
        });

        final cached = chapMap[targetParaIdx];
        if (cached != null && cached.isNotEmpty) return cached;

        final pk = '$targetBook|$targetChap|$targetParaIdx';
        return localTargetParaTextCache.putIfAbsent(pk, () {
          var txt = '';
          try {
            final pRows = tipiDb.select(
              'SELECT pali_text FROM canon_paragraphs '
              'WHERE book_code = ? AND chapter_index = ? AND para_index = ? LIMIT 1',
              [targetBook, targetChap, targetParaIdx],
            );
            if (pRows.isNotEmpty && pRows.first['pali_text'] != null) {
              txt = pRows.first['pali_text'].toString();
            }
          } catch (_) {}
          if (txt.isEmpty) {
            txt = TipitakaCoreReader.readChapterPaliTexts(
                  tipiDb,
                  targetBook,
                  targetChap,
                )[targetParaIdx] ??
                '';
          }
          final ln = _buildLineNorm(txt, 1);
          return ln.normLine.isEmpty ? const [] : [ln];
        });
      }

      final paragraphsJson = <String, dynamic>{};

      for (final r in paraRows) {
        final paraIndex = (r['para_index'] as num).toInt();
        var rawText = (r['pali_text'] ?? '').toString();
        if (rawText.isEmpty && sentencesByPara[paraIndex] == null) {
          lazyChapTexts ??= TipitakaCoreReader.readChapterPaliTexts(
            tipiDb,
            bookCode,
            chapterIndex,
          );
          rawText = lazyChapTexts[paraIndex] ?? '';
        }
        final lines = sentencesByPara[paraIndex] ??
            (rawText.trim().isNotEmpty
                ? [(lineId: 1, text: rawText)]
                : const <({int lineId, String text})>[]);

        if (lines.isEmpty) continue;

        final lineNormCache = [
          for (final l in lines) _buildLineNorm(l.text, l.lineId),
        ];

        final byLineMap = <String, List<Map<String, dynamic>>>{};
        final allItems = <Map<String, dynamic>>[];
        final seenAll = <String>{};

        // 1. Forward links (this paragraph's words defined in attha/tika)
        final candidates = <({
          String word,
          String bookCode,
          String bookTitle,
          String category,
          int chapterIndex,
          int paraIndex,
          int lineId,
          String? paraNum,
        })>[];

        if (isMula || !isTik) {
          final ab = r['attha_book']?.toString();
          final ac = (r['attha_chapter'] as num?)?.toInt();
          final ap = r['attha_para']?.toString().trim();
          if (ab != null && ab.isNotEmpty && ab != bookCode && ap != null && ap.isNotEmpty) {
            final list = forwardBoldDefs['$ab|${ac ?? ''}|$ap'];
            if (list != null) candidates.addAll(list);
          }
        }
        if (isMula || isAtt) {
          final tb = r['tika_book']?.toString();
          final tc = (r['tika_chapter'] as num?)?.toInt();
          final tp = r['tika_para']?.toString().trim();
          if (tb != null && tb.isNotEmpty && tb != bookCode && tp != null && tp.isNotEmpty) {
            final list = forwardBoldDefs['$tb|${tc ?? ''}|$tp'];
            if (list != null) candidates.addAll(list);
          }
        }

        if (candidates.isNotEmpty) {
          for (final line in lineNormCache) {
            if (line.normLine.isEmpty) continue;
            final seenInLine = <String>{};
            final lineList = byLineMap.putIfAbsent('${line.lineId}', () => []);

            for (final c in candidates) {
              final lineKey = '${c.word}|${c.bookCode}';
              if (seenInLine.contains(lineKey)) continue;
              if (_matchesLineObj(line, c.word)) {
                seenInLine.add(lineKey);
                final item = BookLinkItem(
                  word: c.word,
                  targetBook: c.bookCode,
                  targetBookTitle: c.bookTitle,
                  targetCategory: c.category,
                  targetChapter: c.chapterIndex,
                  targetParaIndex: c.paraIndex,
                  targetLineId: c.lineId,
                  targetParaNum: c.paraNum,
                  isSource: false,
                ).toJson();
                lineList.add(item);
                if (seenAll.add(lineKey)) {
                  allItems.add(item);
                }
              }
            }
            if (lineList.isEmpty) {
              byLineMap.remove('${line.lineId}');
            }
          }
        }

        // 2. Reverse links (this attha/tika paragraph's bold terms -> attha/mula)
        final selfBolds = selfBoldDefsByPara[paraIndex];
        if (selfBolds != null && selfBolds.isNotEmpty) {
          final rawRevLayers = <({String book, int? chap, String para})>[];
          if (isTik) {
            final ab = r['attha_book']?.toString();
            final ac = (r['attha_chapter'] as num?)?.toInt();
            final ap = r['attha_para']?.toString().trim();
            if (ab != null && ab.isNotEmpty && ab != bookCode && ap != null && ap.isNotEmpty) {
              rawRevLayers.add((book: ab, chap: ac, para: ap));
            }
          }
          final mb = r['mula_book']?.toString();
          final mc = (r['mula_chapter'] as num?)?.toInt();
          final mp = r['mula_para']?.toString().trim();
          if (mb != null &&
              mb.isNotEmpty &&
              mb != bookCode &&
              mp != null &&
              mp.isNotEmpty &&
              !rawRevLayers.any((x) => x.book == mb)) {
            rawRevLayers.add((book: mb, chap: mc, para: mp));
          }

          final resolvedLayers = <({
            String book,
            String title,
            String category,
            String paraNum,
            List<({
              int chapterIndex,
              int paraIndex,
              List<({
                int lineId,
                String normLine,
                String normPhrase,
                String normPhraseSpaced,
                String normPhraseTi,
                String normPhraseSpacedTi,
                Set<String> tokens,
              })> targetLines,
            })> targets,
          })>[];

          for (final layer in rawRevLayers) {
            final targets = resolveTargetParas(layer.book, layer.chap, layer.para);
            if (targets.isEmpty) continue;
            resolvedLayers.add((
              book: layer.book,
              title: getBookTitle(layer.book),
              category: _categoryLabel(layer.book),
              paraNum: layer.para,
              targets: [
                for (final t in targets)
                  (
                    chapterIndex: t.chapterIndex,
                    paraIndex: t.paraIndex,
                    targetLines: getTargetParaLines(
                      layer.book,
                      t.chapterIndex,
                      t.paraIndex,
                    ),
                  ),
              ],
            ));
          }

          if (resolvedLayers.isNotEmpty) {
            void emitReverseItem(
              String lidKey,
              String boldWord,
              ({
                String book,
                String title,
                String category,
                String paraNum,
                List<({
                  int chapterIndex,
                  int paraIndex,
                  List<({
                    int lineId,
                    String normLine,
                    String normPhrase,
                    String normPhraseSpaced,
                    String normPhraseTi,
                    String normPhraseSpacedTi,
                    Set<String> tokens,
                  })> targetLines,
                })> targets,
              }) layer,
              int targetChapter,
              int targetParaIndex,
              int targetLineId,
            ) {
              final revKey = 'rev|$boldWord|${layer.book}';
              final lineList = byLineMap.putIfAbsent(lidKey, () => []);
              if (!lineList.any((e) => e['word'] == boldWord && e['target_book'] == layer.book)) {
                final item = BookLinkItem(
                  word: boldWord,
                  targetBook: layer.book,
                  targetBookTitle: layer.title,
                  targetCategory: layer.category,
                  targetChapter: targetChapter,
                  targetParaIndex: targetParaIndex,
                  targetLineId: targetLineId,
                  targetParaNum: layer.paraNum,
                  isSource: true,
                ).toJson();
                lineList.add(item);
                if (seenAll.add(revKey)) {
                  allItems.add(item);
                }
              }
            }

            for (final sb in selfBolds) {
              final boldWord = sb.word;
              int? matchedLineId;
              final byDefIdx = lineNormCache.indexWhere((l) => l.lineId == sb.lineId);
              if (byDefIdx >= 0 && _matchesLineObj(lineNormCache[byDefIdx], boldWord)) {
                matchedLineId = lineNormCache[byDefIdx].lineId;
              } else {
                for (final line in lineNormCache) {
                  if (_matchesLineObj(line, boldWord)) {
                    matchedLineId = line.lineId;
                    break;
                  }
                }
              }
              final lidKey =
                  '${matchedLineId ?? (byDefIdx >= 0 ? lineNormCache[byDefIdx].lineId : lineNormCache.first.lineId)}';

              for (final layer in resolvedLayers) {
                ({int chapterIndex, int paraIndex, int lineId})? foundHit;
                for (final t in layer.targets) {
                  for (final tl in t.targetLines) {
                    if (_matchesLineObj(tl, boldWord)) {
                      foundHit = (
                        chapterIndex: t.chapterIndex,
                        paraIndex: t.paraIndex,
                        lineId: tl.lineId,
                      );
                      break;
                    }
                  }
                  if (foundHit != null) break;
                }
                if (foundHit != null) {
                  emitReverseItem(
                    lidKey,
                    boldWord,
                    layer,
                    foundHit.chapterIndex,
                    foundHit.paraIndex,
                    foundHit.lineId,
                  );
                }
              }
            }
          }
        }

        if (allItems.isNotEmpty) {
          paragraphsJson['$paraIndex'] = {
            'by_line': byLineMap,
            'all': allItems,
          };
        }
      }

    return {
      'book_code': bookCode,
      'chapter_index': chapterIndex,
      'paragraphs': paragraphsJson,
    };
  }

  /// Loads a contextual preview around ([bookCode], [chapterIndex], [paraIndex])
  /// for the Linked Definition preview sheet/modal.
  Future<LinkedPreviewContent?> getLinkedPreview({
    required String dbDirPath,
    required String bookCode,
    int? chapterIndex,
    int? paraIndex,
    String? paraNum,
    int? lineId,
    String? word,
    List<String> enabledLangs = const [],
    Database? tipitakaDbOverride,
    Database? boldDbOverride,
    Database? paliSentencesDbOverride,
    Database? Function(String langCode)? openTranslationDb,
  }) async {
    Database? ownedTipiDb;
    Database? tipiDb = tipitakaDbOverride;
    if (tipiDb == null) {
      final path = p.join(dbDirPath, 'tipitaka.db');
      if (!File(path).existsSync()) return null;
      ownedTipiDb = sqlite3.open(path, mode: OpenMode.readOnly);
      tipiDb = ownedTipiDb;
    }

    Database? ownedSentDb;
    Database? sentDb = paliSentencesDbOverride;
    if (sentDb == null) {
      final sentPath = p.join(dbDirPath, 'pali_sentences.db');
      if (File(sentPath).existsSync()) {
        ownedSentDb = sqlite3.open(sentPath, mode: OpenMode.readOnly);
        sentDb = ownedSentDb;
      }
    }

    try {
      final bookRows = tipiDb.select(
        'SELECT title FROM books WHERE code = ? LIMIT 1',
        [bookCode],
      );
      if (bookRows.isEmpty) return null;
      final bookTitle = (bookRows.first['title'] ?? bookCode).toString();
      final category = _categoryLabel(bookCode);

      // Resolve target paraIndex & chapterIndex if needed.
      var targetParaIdx = paraIndex;
      var targetChapIdx = chapterIndex;
      var targetParaNum = paraNum;
      final normWord = word != null ? _normPali(word) : null;

      if (targetParaIdx == null && targetParaNum != null && targetParaNum.isNotEmpty) {
        ResultSet rows = targetChapIdx != null
            ? tipiDb.select(
                'SELECT chapter_index, para_index, para_num FROM canon_paragraphs '
                'WHERE book_code = ? AND chapter_index = ? AND para_num = ? '
                'ORDER BY para_index ASC',
                [bookCode, targetChapIdx, targetParaNum],
              )
            : tipiDb.select(
                'SELECT chapter_index, para_index, para_num FROM canon_paragraphs '
                'WHERE book_code = ? AND para_num = ? '
                'ORDER BY para_index ASC',
                [bookCode, targetParaNum],
              );
        if (rows.isEmpty && targetChapIdx != null) {
          rows = tipiDb.select(
            'SELECT chapter_index, para_index, para_num FROM canon_paragraphs '
            'WHERE book_code = ? AND para_num = ? '
            'ORDER BY para_index ASC',
            [bookCode, targetParaNum],
          );
        }
        final parsedNum = int.tryParse(targetParaNum.split('-').first);
        if (rows.isEmpty && parsedNum != null && targetChapIdx != null) {
          rows = tipiDb.select(
            'SELECT chapter_index, para_index, para_num FROM canon_paragraphs '
            'WHERE book_code = ? AND chapter_index = ? AND para_first <= ? AND para_last >= ? '
            'ORDER BY para_index ASC',
            [bookCode, targetChapIdx, parsedNum, parsedNum],
          );
        }
        if (rows.isEmpty && parsedNum != null) {
          rows = tipiDb.select(
            'SELECT chapter_index, para_index, para_num FROM canon_paragraphs '
            'WHERE book_code = ? AND para_first <= ? AND para_last >= ? '
            'ORDER BY para_index ASC',
            [bookCode, parsedNum, parsedNum],
          );
        }
        if (rows.isNotEmpty) {
          var picked = rows.first;
          if (rows.length > 1 && normWord != null && normWord.isNotEmpty) {
            final candCache = <int, Map<int, List<({int lineId, String text})>>>{};
            for (final candRow in rows) {
              final cIdx = (candRow['chapter_index'] as num).toInt();
              final pIdx = (candRow['para_index'] as num).toInt();
              final chapSents = candCache.putIfAbsent(
                cIdx,
                () => TipitakaCoreReader.readChapterSentences(
                  sentDb,
                  tipiDb,
                  bookCode,
                  cIdx,
                ),
              );
              final sents = chapSents[pIdx] ?? const [];
              if (sents.any((s) => _normMatchesTarget(s.text, normWord))) {
                picked = candRow;
                break;
              }
            }
          }
          targetChapIdx = (picked['chapter_index'] as num).toInt();
          targetParaIdx = (picked['para_index'] as num).toInt();
          targetParaNum = picked['para_num']?.toString();
        }
      } else if (targetParaIdx != null) {
        final rows = tipiDb.select(
          'SELECT chapter_index, para_num FROM canon_paragraphs '
          'WHERE book_code = ? AND para_index = ? LIMIT 1',
          [bookCode, targetParaIdx],
        );
        if (rows.isNotEmpty) {
          targetChapIdx ??= (rows.first['chapter_index'] as num).toInt();
          targetParaNum ??= rows.first['para_num']?.toString();
        }
      }

      if (targetParaIdx == null) return null;
      targetChapIdx ??= 0;

      // Nearest section heading from book_toc
      String? headingTitle;
      try {
        final tocRows = tipiDb.select(
          'SELECT title FROM book_toc '
          'WHERE book_code = ? AND para_index <= ? '
          'ORDER BY para_index DESC LIMIT 1',
          [bookCode, targetParaIdx],
        );
        if (tocRows.isNotEmpty) {
          headingTitle = tocRows.first['title']?.toString();
        }
      } catch (_) {}

      // Load a clean paragraph window around targetParaIdx inside the chapter
      // (up to 6 paragraphs before and 10 paragraphs after).
      final beforeParas = tipiDb.select(
        'SELECT para_index, para_num, pali_text FROM canon_paragraphs '
        'WHERE book_code = ? AND chapter_index = ? AND para_index <= ? '
        'ORDER BY para_index DESC LIMIT 7',
        [bookCode, targetChapIdx, targetParaIdx],
      );
      final afterParas = tipiDb.select(
        'SELECT para_index, para_num, pali_text FROM canon_paragraphs '
        'WHERE book_code = ? AND chapter_index = ? AND para_index > ? '
        'ORDER BY para_index ASC LIMIT 10',
        [bookCode, targetChapIdx, targetParaIdx],
      );

      final chapTextsFallback =
          beforeParas.any((r) => r['pali_text'] == null) ||
                  afterParas.any((r) => r['pali_text'] == null)
              ? TipitakaCoreReader.readChapterPaliTexts(
                  tipiDb,
                  bookCode,
                  targetChapIdx,
                )
              : const <int, String>{};

      final windowParas = <({int paraIndex, String? paraNum, String paliText})>[
        for (final r in beforeParas.reversed)
          (
            paraIndex: (r['para_index'] as num).toInt(),
            paraNum: r['para_num']?.toString(),
            paliText: (r['pali_text'] ??
                    chapTextsFallback[(r['para_index'] as num).toInt()] ??
                    '')
                .toString(),
          ),
        for (final r in afterParas)
          (
            paraIndex: (r['para_index'] as num).toInt(),
            paraNum: r['para_num']?.toString(),
            paliText: (r['pali_text'] ??
                    chapTextsFallback[(r['para_index'] as num).toInt()] ??
                    '')
                .toString(),
          ),
      ];

      if (windowParas.isEmpty) return null;

      final minParaIdx = windowParas.first.paraIndex;
      final maxParaIdx = windowParas.last.paraIndex;

      // Load sentence splits from pali_sentences.db via indexed range scan first
      // so we avoid loading all chapter sentences or inflating full chapter HTML.
      final sentByPara = <int, List<({int lineId, String sentence})>>{};
      if (sentDb != null) {
        try {
          final rows = sentDb.select(
            'SELECT para_index, line_id, sentence FROM pali_sentences '
            'WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ? '
            'ORDER BY para_index, line_id',
            [bookCode, targetChapIdx, minParaIdx, maxParaIdx],
          );
          for (final r in rows) {
            final pidx = (r['para_index'] as num).toInt();
            sentByPara.putIfAbsent(pidx, () => []).add((
              lineId: (r['line_id'] as num).toInt(),
              sentence: (r['sentence'] ?? '').toString(),
            ));
          }
        } catch (_) {}
      }
      if (sentByPara.isEmpty) {
        final chapSent = TipitakaCoreReader.readChapterSentences(
          sentDb,
          tipiDb,
          bookCode,
          targetChapIdx,
        );
        for (final e in chapSent.entries) {
          if (e.key >= minParaIdx && e.key <= maxParaIdx) {
            sentByPara[e.key] = [
              for (final s in e.value) (lineId: s.lineId, sentence: s.text),
            ];
          }
        }
      }

      // Indexed bold highlight hints from bold_definitions (avoids inflating full chapter HTML)
      final boldLineHtmlByKey = <String, String>{};
      if (boldDbOverride != null) {
        try {
          final bRows = boldDbOverride.select(
            'SELECT para_index, line_id, sentence_html FROM bold_definitions '
            'WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ?',
            [bookCode, targetChapIdx, minParaIdx, maxParaIdx],
          );
          for (final br in bRows) {
            final sh = br['sentence_html']?.toString() ?? '';
            if (sh.contains('<b>')) {
              boldLineHtmlByKey['${br['para_index']}:${br['line_id']}'] = sh;
            }
          }
        } catch (_) {}
      }

      final needsHtmlFallback = windowParas.any(
        (wp) => (sentByPara[wp.paraIndex]?.isEmpty ?? true),
      );
      final htmlByPara = <int, String>{};
      if (needsHtmlFallback) {
        try {
          final chHtml = TipitakaCoreReader.readChapterHtml(
            tipiDb,
            bookCode,
            targetChapIdx,
          );
          if (chHtml != null && chHtml.isNotEmpty) {
            for (final pm in _pTagRe.allMatches(chHtml)) {
              final attrs = pm.group(1) ?? '';
              final pidxStr = _pindexAttrRe.firstMatch(attrs)?.group(1);
              if (pidxStr == null) continue;
              final pidx = int.tryParse(pidxStr);
              if (pidx == null || pidx < minParaIdx || pidx > maxParaIdx) continue;
              var cleaned = (pm.group(2) ?? '')
                  .replaceAll(_pbSpanRe, ' ')
                  .replaceAll(_paranumRe, ' ')
                  .replaceAllMapped(_bldTagRe, (m) {
                    final inner = (m.group(1) ?? '').replaceAll(RegExp(r'<[^>]+>'), '');
                    return '<b>$inner</b>';
                  })
                  .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), ' ')
                  .replaceAll(_anyTagExceptBRe, '')
                  .replaceAll(RegExp(r'\s+'), ' ')
                  .trim();
              if (cleaned.isNotEmpty) {
                htmlByPara[pidx] = cleaned;
              }
            }
          }
        } catch (_) {}
      }

      // Load translations for every requested enabled language.
      final loadedLangs = <String>[];
      final paraTransByLang = <String, Map<int, String>>{};
      final sentTransByLang = <String, Map<int, Map<int, String>>>{};

      if (enabledLangs.isNotEmpty) {
        for (final lang in enabledLangs) {
          Database? ownedTdb;
          Database? tdb = openTranslationDb?.call(lang);
          if (tdb == null) {
            final tPath = p.join(dbDirPath, 'translation_$lang.db');
            if (File(tPath).existsSync()) {
              ownedTdb = sqlite3.open(tPath, mode: OpenMode.readOnly);
              tdb = ownedTdb;
            }
          }
          if (tdb == null) continue;
          try {
            final pMap = <int, String>{};
            final sMap = <int, Map<int, String>>{};
            final v2Pack = TipitakaCoreReader.readChapterTranslationPack(
              tdb,
              bookCode,
              targetChapIdx,
            );
            if (v2Pack != null) {
              for (final entry in v2Pack) {
                if (entry.paraIndex < minParaIdx || entry.paraIndex > maxParaIdx) {
                  continue;
                }
                final txt = (entry.translation ?? '').trim();
                if (txt.isNotEmpty) pMap[entry.paraIndex] = txt;
                for (final s in entry.sentences) {
                  final st = s.text.trim();
                  if (st.isNotEmpty) {
                    sMap.putIfAbsent(entry.paraIndex, () => {})[s.lineId] = st;
                  }
                }
              }
            } else {
              final pRows = tdb.select(
                'SELECT para_index, translation, sentences_json '
                'FROM paragraph_translations '
                'WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ? '
                'ORDER BY para_index',
                [bookCode, targetChapIdx, minParaIdx, maxParaIdx],
              );
              for (final pr in pRows) {
                final pidx = (pr['para_index'] as num).toInt();
                final txt = (pr['translation'] ?? '').toString().trim();
                if (txt.isNotEmpty) pMap[pidx] = txt;
                final rawJson = pr['sentences_json']?.toString();
                if (rawJson != null && rawJson.isNotEmpty) {
                  try {
                    final decoded = jsonDecode(rawJson);
                    if (decoded is List) {
                      for (var idx = 0; idx < decoded.length; idx++) {
                        final item = decoded[idx];
                        if (item is String) {
                          final t = item.trim();
                          if (t.isNotEmpty) {
                            sMap.putIfAbsent(pidx, () => {})[idx + 1] = t;
                          }
                        } else if (item is Map) {
                          final lid = (item['line_id'] as num?)?.toInt();
                          final t = item['translation']?.toString().trim() ?? '';
                          if (lid != null && t.isNotEmpty) {
                            sMap.putIfAbsent(pidx, () => {})[lid] = t;
                          }
                        }
                      }
                    }
                  } catch (_) {}
                }
              }
              if (sMap.isEmpty) {
                try {
                  final stRows = tdb.select(
                    'SELECT para_index, line_id, translation FROM sentence_translations '
                    'WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ? '
                    'ORDER BY para_index, line_id',
                    [bookCode, targetChapIdx, minParaIdx, maxParaIdx],
                  );
                  for (final sr in stRows) {
                    final pidx = (sr['para_index'] as num).toInt();
                    final lid = (sr['line_id'] as num).toInt();
                    final t = (sr['translation'] ?? '').toString().trim();
                    if (t.isNotEmpty) {
                      sMap.putIfAbsent(pidx, () => {})[lid] = t;
                    }
                  }
                } catch (_) {}
              }
            }
            if (pMap.isNotEmpty || sMap.isNotEmpty) {
              loadedLangs.add(lang);
              paraTransByLang[lang] = pMap;
              sentTransByLang[lang] = sMap;
            }
          } catch (_) {} finally {
            ownedTdb?.close();
          }
        }
      }

      // Build preview lines. Prefer sentence lines when pali_sentences.db has
      // splits for a paragraph; otherwise emit the paragraph row.
      final previewLines = <LinkedPreviewLine>[];
      int? resolvedTargetLineId = lineId;

      for (final wp in windowParas) {
        final sents = sentByPara[wp.paraIndex];
        if (sents != null && sents.isNotEmpty) {
          for (final s in sents) {
            final trans = <String, String>{};
            for (final lang in loadedLangs) {
              final st = sentTransByLang[lang]?[wp.paraIndex]?[s.lineId];
              if (st != null && st.isNotEmpty) {
                trans[lang] = st;
              } else if (sents.length == 1) {
                final pt = paraTransByLang[lang]?[wp.paraIndex];
                if (pt != null && pt.isNotEmpty) trans[lang] = pt;
              }
            }
            var isTarget = false;
            if (wp.paraIndex == targetParaIdx) {
              if (lineId != null) {
                isTarget = s.lineId == lineId;
              } else if (normWord != null && normWord.isNotEmpty) {
                if (_normMatchesTarget(s.sentence, normWord)) {
                  isTarget = true;
                  resolvedTargetLineId ??= s.lineId;
                }
              }
            }
            previewLines.add(
              LinkedPreviewLine(
                paraIndex: wp.paraIndex,
                paraNum: wp.paraNum,
                lineId: s.lineId,
                paliHtml: _highlightSentenceWithBold(
                  s.sentence,
                  normWord,
                  boldLineHtmlByKey['${wp.paraIndex}:${s.lineId}'] ??
                      htmlByPara[wp.paraIndex],
                  isTarget: isTarget,
                ),
                translations: trans,
                isTarget: isTarget,
              ),
            );
          }
        } else {
          final trans = <String, String>{};
          for (final lang in loadedLangs) {
            final pt = paraTransByLang[lang]?[wp.paraIndex];
            if (pt != null && pt.isNotEmpty) trans[lang] = pt;
          }
          previewLines.add(
            LinkedPreviewLine(
              paraIndex: wp.paraIndex,
              paraNum: wp.paraNum,
              paliHtml: htmlByPara[wp.paraIndex] ?? wp.paliText,
              translations: trans,
              isTarget: wp.paraIndex == targetParaIdx,
            ),
          );
        }
      }

      // Ensure at least one line in targetParaIdx is marked as target if none matched.
      if (!previewLines.any((l) => l.isTarget)) {
        for (var i = 0; i < previewLines.length; i++) {
          if (previewLines[i].paraIndex == targetParaIdx) {
            previewLines[i] = LinkedPreviewLine(
              paraIndex: previewLines[i].paraIndex,
              paraNum: previewLines[i].paraNum,
              lineId: previewLines[i].lineId,
              paliHtml: previewLines[i].paliHtml,
              translations: previewLines[i].translations,
              isTarget: true,
            );
            resolvedTargetLineId ??= previewLines[i].lineId;
            break;
          }
        }
      }

      return LinkedPreviewContent(
        bookCode: bookCode,
        bookTitle: bookTitle,
        category: category,
        chapterIndex: targetChapIdx,
        targetParaIndex: targetParaIdx,
        targetParaNum: targetParaNum,
        targetLineId: resolvedTargetLineId,
        headingTitle: headingTitle,
        translationLangs: loadedLangs,
        lines: previewLines,
      );
    } finally {
      ownedTipiDb?.close();
      ownedSentDb?.close();
    }
  }
}
