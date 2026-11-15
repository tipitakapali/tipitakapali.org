import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart' show GlobalKey;

import '../../../core/utils/pali_script_converter.dart';

/// Characters that terminate a word across scripts (whitespace + Latin/Indic/
/// Myanmar/Tibetan/Sinhala punctuation). Everything else belongs inside the word.
final RegExp _kWordTerminator = RegExp(
  r'''[\s.,;:!?()\[\]{}“”"«»‘’'…*·।॥<>།༎་෴§\u2013\u2014၊။]''',
);

const String _kClosingQuotes = "\u2019'";
final RegExp _kNonLetters = RegExp(r'[^\p{L}\p{M}\p{Nd}]', unicode: true);
final RegExp _kJoinWhitespace = RegExp(r'\s');

/// Metadata attached to reader segments for word hit-testing.
class ReaderSegmentMeta {
  final int paraIndex;
  final int? lineId;
  final String segment; // 'pali' | 'translation'
  final String? langCode;

  const ReaderSegmentMeta({
    required this.paraIndex,
    this.lineId,
    this.segment = 'pali',
    this.langCode,
  });
}

/// Result of hit-testing a word in a rendered paragraph/sentence.
class ReaderWordHitResult {
  final String word;
  final String rawWord;
  final int? paraIndex;
  final int? lineId;
  final String segment;
  final String? langCode;
  final TextRange range;
  final String? joinedWord;

  const ReaderWordHitResult({
    required this.word,
    required this.rawWord,
    this.paraIndex,
    this.lineId,
    this.segment = 'pali',
    this.langCode,
    required this.range,
    this.joinedWord,
  });
}

/// Expands outward from [tapOffset] in [text] to the nearest word terminators,
/// avoiding `RenderParagraph.getWordBoundary` which splits Indic/Myanmar/Thai clusters.
TextRange wordRangeAt(String text, int tapOffset) {
  if (text.isEmpty) return TextRange.empty;
  final offset = tapOffset.clamp(0, text.length - 1);
  if (_kWordTerminator.hasMatch(text[offset])) return TextRange.empty;

  var start = offset;
  var end = offset;
  while (start > 0 && !_kWordTerminator.hasMatch(text[start - 1])) {
    start--;
  }
  while (end < text.length && !_kWordTerminator.hasMatch(text[end])) {
    end++;
  }
  return TextRange(start: start, end: end);
}

/// Handles CST elided closing-quote joins (`oghamatarin ’’’ ti` -> `oghamatarinti`).
String? quoteJoinCandidate(String fullText, int wordEnd, String wordPrefix) {
  bool isSpace(int i) => _kJoinWhitespace.hasMatch(fullText[i]);
  var i = wordEnd;
  while (i < fullText.length && isSpace(i)) {
    i++;
  }
  var quotes = 0;
  while (i < fullText.length &&
      quotes < 4 &&
      _kClosingQuotes.contains(fullText[i])) {
    i++;
    quotes++;
  }
  if (quotes == 0) return null;
  while (i < fullText.length && isSpace(i)) {
    i++;
  }
  if (i >= fullText.length || isSpace(i)) return null;

  var j = i;
  while (j < fullText.length && !isSpace(j)) {
    j++;
  }
  final rawToken = fullText.substring(i, j).replaceAll(_kNonLetters, '');
  final token = PaliScriptConverter.cleanDictionaryQuery(rawToken);
  if (token.isEmpty) return null;
  return '$wordPrefix$token';
}

/// Hit-tests the render subtree under [contentHitTestKey] at [globalPosition]
/// and extracts the tapped Pāli word (normalizing any script -> Roman).
ReaderWordHitResult? hitTestWordAt(
  GlobalKey contentHitTestKey,
  Offset globalPosition,
) {
  final context = contentHitTestKey.currentContext;
  if (context == null) return null;

  final renderObject = context.findRenderObject();
  if (renderObject is! RenderBox) return null;

  final local = renderObject.globalToLocal(globalPosition);
  final result = BoxHitTestResult();
  renderObject.hitTest(result, position: local);

  RenderParagraph? paragraph;
  ReaderSegmentMeta? meta;

  for (final entry in result.path) {
    final target = entry.target;
    if (target is RenderMetaData && target.metaData is ReaderSegmentMeta) {
      meta ??= target.metaData as ReaderSegmentMeta;
    }
    if (target is RenderParagraph && paragraph == null) {
      paragraph = target;
    }
  }

  if (paragraph == null && result.path.isNotEmpty) {
    var node = result.path.first.target as RenderObject?;
    while (node != null) {
      if (node is RenderMetaData &&
          node.metaData is ReaderSegmentMeta &&
          meta == null) {
        meta = node.metaData as ReaderSegmentMeta;
      }
      if (node is RenderParagraph && paragraph == null) {
        paragraph = node;
      }
      node = node.parent;
    }
  }

  if (paragraph == null) return null;

  // Non-reader interactive labels/chips sit inside `SelectionContainer.disabled`
  // or lack ReaderSegmentMeta; only resolve inside tagged Pāli segments (or selectable text).
  if (meta == null || meta.segment != 'pali') return null;

  final paragraphOrigin = paragraph.localToGlobal(Offset.zero);
  final localInParagraph = globalPosition - paragraphOrigin;
  if (localInParagraph.dx < 0 ||
      localInParagraph.dy < 0 ||
      localInParagraph.dx > paragraph.size.width ||
      localInParagraph.dy > paragraph.size.height) {
    return null;
  }

  final textPos = paragraph.getPositionForOffset(localInParagraph);
  final fullText = paragraph.text.toPlainText();
  final range = wordRangeAt(fullText, textPos.offset);
  if (range.isCollapsed) return null;

  final rawWord = fullText.substring(range.start, range.end);
  final cleaned = PaliScriptConverter.cleanDictionaryQuery(rawWord);
  if (cleaned.isEmpty) return null;

  return ReaderWordHitResult(
    word: cleaned,
    rawWord: rawWord,
    paraIndex: meta.paraIndex,
    lineId: meta.lineId,
    segment: meta.segment,
    langCode: meta.langCode,
    range: range,
    joinedWord: quoteJoinCandidate(fullText, range.end, cleaned),
  );
}
