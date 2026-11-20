import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/services.dart' show AssetBundle, rootBundle;

/// Restores minified DPD GoldenDict HTML payloads (`@<json>@...`) and link
/// placeholders (`L#0@`..`L#4@`) to match `tipitakapali.org/server_api/dictEngine.js`.
class DpdFamilyTemplates {
  static const List<MapEntry<String, String>> _minifiedLinks = [
    MapEntry(
      'L#0@',
      'https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform',
    ),
    MapEntry(
      'L#1@',
      'https://docs.google.com/forms/d/e/1FAIpQLSdAL2PzavyrtXgGmtNrZAMyh3hV6g3fU0chxhWFxunQEZtH0g/viewform',
    ),
    MapEntry(
      'L#2@',
      'https://docs.google.com/forms/d/e/1FAIpQLSf9boBe7k5tCwq7LdWgBHHGIPVc4ROO5yjVDo1X5LDAxkmGWQ/viewform',
    ),
    MapEntry(
      'L#3@',
      'https://docs.google.com/forms/d/e/1FAIpQLSfKUBx-icfRCWmhHqUwzX60BVQE21s_NERNfU2VvbjEfE371A/viewform',
    ),
    MapEntry(
      'L#4@',
      'https://docs.google.com/forms/d/e/1FAIpQLSfResxEUiRCyFITWPkzoQ2HhHEvUS5fyg68Rl28hFH6vhHlaA/viewform',
    ),
  ];

  Map<String, dynamic> _familyCompounds;
  Map<String, dynamic> _familyIdioms;
  Map<String, dynamic> _familyRoot;
  Map<String, dynamic> _familySets;
  Map<String, dynamic> _familyWord;
  bool _loaded;
  Future<void>? _loadingFuture;
  Uint8List? _preloadedCompressedBytes;

  DpdFamilyTemplates({
    Map<String, dynamic>? familyCompounds,
    Map<String, dynamic>? familyIdioms,
    Map<String, dynamic>? familyRoot,
    Map<String, dynamic>? familySets,
    Map<String, dynamic>? familyWord,
    Uint8List? compressedAssetBytes,
  })  : _familyCompounds = familyCompounds ?? const {},
        _familyIdioms = familyIdioms ?? const {},
        _familyRoot = familyRoot ?? const {},
        _familySets = familySets ?? const {},
        _familyWord = familyWord ?? const {},
        _preloadedCompressedBytes = compressedAssetBytes,
        _loaded = familyCompounds != null ||
            familyIdioms != null ||
            familyRoot != null ||
            familySets != null ||
            familyWord != null;

  bool get isLoaded => _loaded;

  void setCompressedAssetBytes(Uint8List? bytes) {
    if (_loaded || bytes == null || bytes.isEmpty) return;
    _preloadedCompressedBytes = bytes;
  }

  void _applyCompressedBytes(Uint8List compressed) {
    final rawBytes = gzip.decode(compressed);
    final decoded = jsonDecode(utf8.decode(rawBytes));
    if (decoded is Map<String, dynamic>) {
      _familyCompounds =
          (decoded['family_compounds'] as Map<String, dynamic>?) ?? const {};
      _familyIdioms =
          (decoded['family_idioms'] as Map<String, dynamic>?) ?? const {};
      _familyRoot =
          (decoded['family_root'] as Map<String, dynamic>?) ?? const {};
      _familySets =
          (decoded['family_sets'] as Map<String, dynamic>?) ?? const {};
      _familyWord =
          (decoded['family_word'] as Map<String, dynamic>?) ?? const {};
    }
    _preloadedCompressedBytes = null;
    _loaded = true;
  }

  Future<void> ensureLoaded({AssetBundle? bundle}) {
    if (_loaded) return Future.value();
    final preloaded = _preloadedCompressedBytes;
    if (preloaded != null) {
      try {
        _applyCompressedBytes(preloaded);
      } catch (_) {
        _preloadedCompressedBytes = null;
        _loaded = true;
      }
      return Future.value();
    }
    return _loadingFuture ??= _loadFromBundle(bundle ?? rootBundle);
  }

  Future<void> _loadFromBundle(AssetBundle bundle) async {
    try {
      final data = await bundle.load('assets/dpd_family_data.json.gz');
      final compressed = data.buffer.asUint8List(
        data.offsetInBytes,
        data.lengthInBytes,
      );
      _applyCompressedBytes(compressed);
    } catch (_) {
      // Allow graceful operation even if compressed family asset isn't bundled in unit tests.
      _loaded = true;
    } finally {
      _loadingFuture = null;
    }
  }

  String restoreMinifiedLinksAndFooter(String html) {
    if (html.isEmpty) return '';
    var out = html;
    for (final entry in _minifiedLinks) {
      if (out.contains(entry.key)) {
        out = out.replaceAll(entry.key, entry.value);
      }
    }
    return out
        .replaceAll('class=footer', 'class="dpd-footer"')
        .replaceAll('class="footer"', 'class="dpd-footer"');
  }

  String restoreDpdDefi(String rawDefi) {
    if (rawDefi.isEmpty) return '';
    if (!rawDefi.startsWith('@')) {
      return restoreMinifiedLinksAndFooter(rawDefi);
    }

    final secondIndex = rawDefi.indexOf('@', 1);
    if (secondIndex <= 0) {
      return restoreMinifiedLinksAndFooter(rawDefi);
    }

    final jsonString = rawDefi.substring(1, secondIndex);
    var defi = rawDefi.substring(secondIndex + 1);

    try {
      final fData = jsonDecode(jsonString);
      if (fData is Map<String, dynamic> && fData.length > 2) {
        final lemma = (fData['lemma'] ?? '').toString();
        if (lemma.isNotEmpty) {
          if (fData['family_compounds'] is List && _familyCompounds.isNotEmpty) {
            defi = defi.replaceAll(
              '${lemma}_fc',
              makeFamilyCompoundHtml(fData),
            );
          }
          if (fData['family_idioms'] is List && _familyIdioms.isNotEmpty) {
            defi = defi.replaceAll(
              '${lemma}_fi',
              makeFamilyIdiomsHtml(fData),
            );
          }
          final frKey = fData['family_root']?.toString();
          if (frKey != null && _familyRoot[frKey] is Map<String, dynamic>) {
            defi = defi.replaceAll(
              '${lemma}_fr',
              makeFamilyRootHtml(
                fData,
                _familyRoot[frKey] as Map<String, dynamic>,
              ),
            );
          }
          if (fData['family_sets'] is List && _familySets.isNotEmpty) {
            defi = defi.replaceAll(
              '${lemma}_fs',
              makeFamilySetsHtml(fData),
            );
          }
          final fwKey = fData['family_word']?.toString();
          if (fwKey != null && _familyWord[fwKey] is Map<String, dynamic>) {
            defi = defi.replaceAll(
              '${lemma}_fw',
              makeFamilyWordHtml(fData),
            );
          }
        }
      }
    } catch (_) {
      // Keep raw definition body if header JSON cannot be decoded.
    }

    return restoreMinifiedLinksAndFooter(defi);
  }

  static String _superScripter(String text) {
    return text.replaceAllMapped(
      RegExp(r'\d'),
      (m) => '&hairsp;<sup>${m.group(0)}</sup>',
    );
  }

  String _appendFamilyTableRows(StringBuffer buf, List<dynamic> rows) {
    buf.write('<table class="family"><tbody>');
    for (final row in rows) {
      if (row is! List || row.length < 4) continue;
      buf.write(
        '<tr><th>${row[0]}</th><td><b>${row[1]}</b></td>'
        '<td>${row[2]}</td><td><span class="gray">${row[3]}</span></td></tr>',
      );
    }
    buf.write('</tbody></table>');
    return '';
  }

  String makeFamilyCompoundHtml(Map<String, dynamic> data) {
    final items = (data['family_compounds'] as List<dynamic>? ?? const [])
        .map((e) => e.toString())
        .toList(growable: false);
    if (items.isEmpty) return '';
    final lemma = (data['lemma'] ?? '').toString();
    final lemmaTag = lemma.replaceAll(' ', '_');
    final lemmaLink = lemma.replaceAll(' ', '%20');
    final id = (data['id'] ?? '').toString();
    final buf = StringBuffer();

    if (items.length > 1) {
      buf.write('<p class="heading" id="${lemmaTag}_cf_top">jump to: ');
      for (final item in items) {
        final itemTag = item.replaceAll(' ', '_');
        buf.write('<a class="jump" href="#${lemmaTag}_cf_$itemTag">$item</a> ');
      }
      buf.write('</p>');
    }

    for (final item in items) {
      final fc = _familyCompounds[item];
      if (fc is! Map<String, dynamic>) continue;
      final itemTag = item.replaceAll(' ', '_');
      if (items.length > 1) {
        buf.write(
          '<p class="heading underlined overlined" id="${lemmaTag}_cf_$itemTag">'
          '<b>${fc['count']}</b> compounds which contain '
          '<b>${_superScripter(item)}</b>'
          '<a class="jump" href="#${lemmaTag}_cf_top"> ⤴</a></p>',
        );
      } else {
        buf.write(
          '<p class="heading underlined" id="${lemmaTag}_cf_top">'
          '<b>${fc['count']}</b> compound which contains '
          '<b>${_superScripter(item)}</b></p>',
        );
      }
      _appendFamilyTableRows(buf, fc['data'] as List<dynamic>? ?? const []);
    }

    buf.write(
      '<p class="dpd-footer">Spot a mistake? '
      '<a class="dpd-link" href="${_minifiedLinks[0].value}?usp=pp_url&amp;entry.438735500=$id%20$lemmaLink&amp;entry.326955045=Compound+Family&amp;entry.1433863141=Tipitakapali.org" target="_blank">Fix it here</a>.'
      '<a class="jump" href="#${lemmaTag}_cf_top"> ⤴</a></p>',
    );
    return buf.toString();
  }

  String makeFamilyIdiomsHtml(Map<String, dynamic> data) {
    final items = (data['family_idioms'] as List<dynamic>? ?? const [])
        .map((e) => e.toString())
        .toList(growable: false);
    if (items.isEmpty) return '';
    final lemma = (data['lemma'] ?? '').toString();
    final lemmaTag = lemma.replaceAll(' ', '_');
    final lemmaLink = lemma.replaceAll(' ', '%20');
    final id = (data['id'] ?? '').toString();
    final buf = StringBuffer();

    if (items.length > 1) {
      buf.write('<p class="heading" id="${lemmaTag}_idiom_top">jump to: ');
      for (final item in items) {
        final itemTag = item.replaceAll(' ', '_');
        buf.write('<a class="jump" href="#${lemmaTag}_idiom_$itemTag">$item</a> ');
      }
      buf.write('</p>');
    }

    for (final item in items) {
      final fi = _familyIdioms[item];
      if (fi is! Map<String, dynamic>) continue;
      final itemTag = item.replaceAll(' ', '_');
      if (items.length > 1) {
        buf.write(
          '<p class="heading underlined overlined" id="${lemmaTag}_idiom_$itemTag">'
          '<b>${fi['count']}</b> idiomatic expressions which contain '
          '<b>${_superScripter(item)}</b>'
          '<a class="jump" href="#${lemmaTag}_idiom_top"> ⤴</a></p>',
        );
      } else {
        buf.write(
          '<p class="heading underlined" id="${lemmaTag}_idiom_top">'
          '<b>${fi['count']}</b> idiomatic expression which contains '
          '<b>${_superScripter(item)}</b></p>',
        );
      }
      _appendFamilyTableRows(buf, fi['data'] as List<dynamic>? ?? const []);
    }

    buf.write(
      '<p class="dpd-footer">Please add more idioms '
      '<a class="dpd-link" href="${_minifiedLinks[0].value}?usp=pp_url&amp;entry.438735500=$id%20$lemmaLink&amp;entry.326955045=Idioms&amp;entry.1433863141=Tipitakapali.org" target="_blank">here</a>.'
      '<a class="jump" href="#${lemmaTag}_idiom_top"> ⤴</a></p>',
    );
    return buf.toString();
  }

  String makeFamilyRootHtml(
    Map<String, dynamic> data,
    Map<String, dynamic> fr,
  ) {
    final lemma = (data['lemma'] ?? '').toString();
    final lemmaLink = lemma.replaceAll(' ', '%20');
    final id = (data['id'] ?? '').toString();
    final count = fr['count'];
    final wordLabel = count == 1 ? 'word belongs' : 'words belong';
    final buf = StringBuffer()
      ..write(
        '<p class="heading underlined"><b>$count</b> $wordLabel to the root family '
        '<b>${fr['root_family']}</b> (${fr['root_meaning']})</p>',
      );
    _appendFamilyTableRows(buf, fr['data'] as List<dynamic>? ?? const []);
    buf.write(
      '<p class="dpd-footer">Something out of place? '
      '<a class="dpd-link" href="${_minifiedLinks[0].value}?usp=pp_url&amp;entry.438735500=$id%20$lemmaLink&amp;entry.326955045=Root+Family&amp;entry.1433863141=Tipitakapali.org" target="_blank">Report it here</a>.</p>',
    );
    return buf.toString();
  }

  String makeFamilySetsHtml(Map<String, dynamic> data) {
    final sets = (data['family_sets'] as List<dynamic>? ?? const [])
        .map((e) => e.toString())
        .toList(growable: false);
    if (sets.isEmpty) return '';
    final lemma = (data['lemma'] ?? '').toString();
    final lemmaTag = lemma.replaceAll(' ', '_');
    final lemmaLink = lemma.replaceAll(' ', '%20');
    final id = (data['id'] ?? '').toString();
    final buf = StringBuffer();

    if (sets.length > 1) {
      buf.write('<p class="heading" id="${lemmaTag}_set_top">jump to: ');
      for (final item in sets) {
        final itemTag = item.replaceAll(' ', '_');
        buf.write('<a class="jump" href="#${lemmaTag}_set_$itemTag">$item</a>. ');
      }
      buf.write('</p>');
    }

    for (final setName in sets) {
      final fs = _familySets[setName];
      if (fs is! Map<String, dynamic>) continue;
      final setTag = setName.replaceAll(' ', '_');
      if (sets.length > 1) {
        buf.write(
          '<p class="heading underlined overlined" id="${lemmaTag}_set_$setTag">'
          '<b>$lemma</b> belongs to the set of <b>$setName</b>'
          '<a class="jump" href="#${lemmaTag}_set_top"> ⤴</a></p>',
        );
      } else {
        buf.write(
          '<p class="heading underlined" id="${lemmaTag}_set_top">'
          '<b>$lemma</b> belongs to the set of <b>$setName</b></p>',
        );
      }
      _appendFamilyTableRows(buf, fs['data'] as List<dynamic>? ?? const []);
    }

    buf.write(
      '<p class="dpd-footer">Spot a mistake? '
      '<a class="dpd-link" href="${_minifiedLinks[0].value}?usp=pp_url&amp;entry.438735500=$id%20$lemmaLink&amp;entry.326955045=Set&amp;entry.1433863141=Tipitakapali.org" target="_blank">Fix it here</a>.'
      '<a class="jump" href="#${lemmaTag}_set_top"> ⤴</a></p>',
    );
    return buf.toString();
  }

  String makeFamilyWordHtml(Map<String, dynamic> data) {
    final familyWordKey = (data['family_word'] ?? '').toString();
    final fw = _familyWord[familyWordKey];
    if (fw is! Map<String, dynamic>) return 'Data not available';
    final lemma = (data['lemma'] ?? '').toString();
    final lemmaLink = lemma.replaceAll(' ', '%20');
    final buf = StringBuffer()
      ..write(
        '<p class="heading underlined"><b>${fw['count']}</b> words belong to the '
        '<b>${_superScripter(familyWordKey)}</b> family</p>',
      );
    _appendFamilyTableRows(buf, fw['data'] as List<dynamic>? ?? const []);
    buf.write(
      '<p class="dpd-footer">Something out of place? '
      '<a class="dpd-link" href="${_minifiedLinks[0].value}?usp=pp_url&amp;entry.438735500=$lemmaLink&amp;entry.326955045=Word+Family&amp;entry.1433863141=Tipitakapali.org" target="_blank">Report it here</a>.</p>',
    );
    return buf.toString();
  }
}
