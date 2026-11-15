part of 'tipitaka_web_api.dart';

/// Offline Ani AI & Citation Quickview endpoints backed by the local SQLite
/// databases (`tipitaka.db`, `pali_sentences.db`, `translation_<lang>.db`,
/// `fts_tipitaka.db`, and DPD dictionary databases).
extension TipitakaWebAiApi on TipitakaWebApi {
  static const Map<String, String> _aiBookAliases = {
    'dn1': 's0101m.mul',
    'dn2': 's0102m.mul',
    'dn3': 's0103m.mul',
    'd-i': 's0101m.mul',
    'd-ii': 's0102m.mul',
    'd-iii': 's0103m.mul',
    'mn1': 's0201m.mul',
    'mn2': 's0202m.mul',
    'mn3': 's0203m.mul',
    'm-i': 's0201m.mul',
    'm-ii': 's0202m.mul',
    'm-iii': 's0203m.mul',
    'sn1': 's0301m.mul',
    'sn2': 's0302m.mul',
    'sn3': 's0303m.mul',
    'sn4': 's0304m.mul',
    'sn5': 's0305m.mul',
    's-i': 's0301m.mul',
    's-ii': 's0302m.mul',
    's-iii': 's0303m.mul',
    's-iv': 's0304m.mul',
    's-v': 's0305m.mul',
    'an1': 's0401m1.mul',
    'an2': 's0402m1.mul',
    'an3': 's0402m2.mul',
    'an4': 's0402m3.mul',
    'an5': 's0403m1.mul',
    'an6': 's0403m2.mul',
    'an7': 's0403m3.mul',
    'an8': 's0404m1.mul',
    'an9': 's0404m2.mul',
    'an10': 's0404m3.mul',
    'an11': 's0404m4.mul',
    'a-i': 's0401m1.mul',
    'a-ii': 's0402m1.mul',
    'a-iii': 's0402m2.mul',
    'a-iv': 's0402m3.mul',
    'a-v': 's0403m1.mul',
    'khp': 's0501m.mul',
    'dhp': 's0502m.mul',
    'ud': 's0503m.mul',
    'it': 's0504m.mul',
    'iti': 's0504m.mul',
    'snp': 's0505m.mul',
    'vv': 's0506m.mul',
    'pv': 's0507m.mul',
    'thag': 's0508m.mul',
    'thig': 's0509m.mul',
    'ja': 's0513m.mul',
    'jat': 's0513m.mul',
    'jataka': 's0513m.mul',
    'vin1': 'vin01m.mul',
    'vin2': 'vin02m.mul',
    'vin3': 'vin03m.mul',
    'vin4': 'vin04m.mul',
    'vin5': 'vin05m.mul',
    'patimokkha': 'vin01m.mul',
    'dhammasangani': 'abh01m.mul',
    'vibhanga': 'abh02m.mul',
    'dhatukatha': 'abh03m.mul',
    'puggalapannatti': 'abh04m.mul',
    'kathavatthu': 'abh05m.mul',
    'yamaka': 'abh06m.mul',
    'patthana': 'abh07m.mul',
  };

  static const List<Map<String, Object>> _kAiToolDeclarations = [
    {
      'name': 'search_tipitaka',
      'description':
          'Search the Tipitaka database for passages using full-text search across Pāḷi Canon and translations.',
      'parameters': {
        'type': 'OBJECT',
        'properties': {
          'query': {
            'type': 'STRING',
            'description': 'Search query for the Pāḷi text or translation.',
          },
        },
        'required': ['query'],
      },
    },
    {
      'name': 'search_tipitaka_batch',
      'description': 'Search the Tipitaka using multiple queries in parallel.',
      'parameters': {
        'type': 'OBJECT',
        'properties': {
          'queries': {
            'type': 'ARRAY',
            'items': {'type': 'STRING'},
          },
        },
        'required': ['queries'],
      },
    },
    {
      'name': 'get_paragraph_content',
      'description':
          'Retrieve exact Pāḷi and translated paragraph text for a book citation.',
      'parameters': {
        'type': 'OBJECT',
        'properties': {
          'book_code': {'type': 'STRING'},
          'chapter_index': {'type': 'INTEGER'},
          'para_start': {'type': 'INTEGER'},
          'para_end': {'type': 'INTEGER'},
          'para_num': {'type': 'STRING'},
        },
        'required': ['book_code'],
      },
    },
    {
      'name': 'get_paragraph_content_batch',
      'description': 'Retrieve multiple canonical passage ranges at once.',
      'parameters': {
        'type': 'OBJECT',
        'properties': {
          'ranges': {
            'type': 'ARRAY',
            'items': {'type': 'OBJECT'},
          },
        },
        'required': ['ranges'],
      },
    },
    {
      'name': 'get_sentences',
      'description':
          'Retrieve sentence-aligned Pāḷi lines and translations for a paragraph.',
      'parameters': {
        'type': 'OBJECT',
        'properties': {
          'book_code': {'type': 'STRING'},
          'chapter_index': {'type': 'INTEGER'},
          'para_index': {'type': 'INTEGER'},
          'line_id': {'type': 'INTEGER'},
        },
        'required': ['book_code', 'para_index'],
      },
    },
    {
      'name': 'get_commentaries',
      'description': 'Retrieve linked Aṭṭhakathā and Ṭīkā commentaries.',
      'parameters': {
        'type': 'OBJECT',
        'properties': {
          'book_code': {'type': 'STRING'},
          'chapter_index': {'type': 'INTEGER'},
          'para_num': {'type': 'STRING'},
          'para_index': {'type': 'INTEGER'},
        },
        'required': ['book_code'],
      },
    },
    {
      'name': 'get_dictionary',
      'description': 'Look up a Pāḷi word in DPD dictionary.',
      'parameters': {
        'type': 'OBJECT',
        'properties': {
          'word': {'type': 'STRING'},
        },
        'required': ['word'],
      },
    },
    {
      'name': 'get_dictionary_batch',
      'description': 'Look up multiple Pāḷi words in DPD dictionary.',
      'parameters': {
        'type': 'OBJECT',
        'properties': {
          'words': {
            'type': 'ARRAY',
            'items': {'type': 'STRING'},
          },
        },
        'required': ['words'],
      },
    },
    {
      'name': 'get_books',
      'description': 'List canonical books from local tipitaka.db.',
      'parameters': {'type': 'OBJECT', 'properties': {}},
    },
  ];

  static int? _asAiInt(Object? raw) {
    if (raw == null) return null;
    if (raw is int) return raw;
    if (raw is num) return raw.toInt();
    return int.tryParse(raw.toString().trim());
  }

  static String? _cleanAiParaNum(Object? raw) {
    if (raw == null) return null;
    final cleaned = raw
        .toString()
        .replaceFirst(RegExp(r'^(?:para-?|p)', caseSensitive: false), '')
        .trim();
    return cleaned.isEmpty ? null : cleaned;
  }

  List<String> _parseAiLangs(
    Object? raw, {
    List<String> defaults = const ['en', 'vi'],
  }) {
    final items = <String>[];
    if (raw is List) {
      for (final item in raw) {
        final s = item?.toString().trim() ?? '';
        if (s.isNotEmpty) items.add(s);
      }
    } else if (raw != null) {
      final s = raw.toString().trim();
      if (s.isNotEmpty) {
        for (final part in s.split(',')) {
          final p = part.trim();
          if (p.isNotEmpty) items.add(p);
        }
      }
    }
    return items.isEmpty ? defaults : items;
  }

  /// Resolves canonical book codes and common Nikāya/book short aliases
  /// (e.g. `dn1`, `mn18`, `sn56.11`, `an4.1`, `dhp`, `vin1`) to CST book codes.
  String _resolveCanonicalBookCode(String? raw, Database? dbTipitaka) {
    if (raw == null) return '';
    final clean = TipitakaWebApi._parseBookCode(raw).code.trim();
    if (clean.isEmpty) return '';

    if (dbTipitaka != null) {
      try {
        final rows = dbTipitaka.select(
          'SELECT code FROM books WHERE LOWER(code) = ? LIMIT 1',
          [clean.toLowerCase()],
        );
        if (rows.isNotEmpty) {
          return rows.first['code'].toString();
        }
      } catch (_) {}
    }

    final lowerRaw = clean.toLowerCase();
    final directAlias = _aiBookAliases[lowerRaw];
    if (directAlias != null) return directAlias;

    final compact = lowerRaw.replaceAll(RegExp(r'[\s_-]+'), '');
    final compactAlias = _aiBookAliases[compact];
    if (compactAlias != null) return compactAlias;

    final dnMatch = RegExp(r'^d(?:n)?(\d+)$').firstMatch(compact);
    if (dnMatch != null) {
      final n = int.parse(dnMatch.group(1)!);
      if (n <= 13) return 's0101m.mul';
      if (n <= 23) return 's0102m.mul';
      return 's0103m.mul';
    }

    final mnMatch = RegExp(r'^m(?:n)?(\d+)$').firstMatch(compact);
    if (mnMatch != null) {
      final n = int.parse(mnMatch.group(1)!);
      if (n <= 50) return 's0201m.mul';
      if (n <= 100) return 's0202m.mul';
      return 's0203m.mul';
    }

    final snMatch = RegExp(r'^s(?:n)?(\d+)(?:\.\d+)?$').firstMatch(compact);
    if (snMatch != null) {
      final n = int.parse(snMatch.group(1)!);
      if (n <= 11) return 's0301m.mul';
      if (n <= 21) return 's0302m.mul';
      if (n <= 34) return 's0303m.mul';
      if (n <= 44) return 's0304m.mul';
      return 's0305m.mul';
    }

    final anMatch = RegExp(r'^a(?:n)?(\d+)(?:\.\d+)?$').firstMatch(compact);
    if (anMatch != null) {
      return switch (int.parse(anMatch.group(1)!)) {
        1 => 's0401m1.mul',
        2 => 's0402m1.mul',
        3 => 's0402m2.mul',
        4 => 's0402m3.mul',
        5 => 's0403m1.mul',
        6 => 's0403m2.mul',
        7 => 's0403m3.mul',
        8 => 's0404m1.mul',
        9 => 's0404m2.mul',
        10 => 's0404m3.mul',
        _ => 's0404m4.mul',
      };
    }

    final vinMatch = RegExp(r'^vin(?:aya)?(\d+)?$').firstMatch(compact);
    if (vinMatch != null) {
      final n = int.tryParse(vinMatch.group(1) ?? '1') ?? 1;
      if (n >= 1 && n <= 5) return 'vin0${n}m.mul';
    }

    final abhMatch = RegExp(r'^abh(?:idhamma)?(\d+)?$').firstMatch(compact);
    if (abhMatch != null) {
      final n = int.tryParse(abhMatch.group(1) ?? '1') ?? 1;
      if (n >= 1 && n <= 7) return 'abh0${n}m.mul';
    }

    return clean;
  }

  ({String bookCode, int chapterIndex, int? startPara, int? endPara})?
      _resolveCanonicalCitationRef(String? text, Database dbTipitaka) {
    if (text == null || text.trim().isEmpty) return null;
    if (RegExp(r'\.(?:mul|att|tik|nrf)$', caseSensitive: false)
        .hasMatch(text.trim())) {
      return null;
    }

    // Normalize Burmese digits to ASCII digits before matching citation formats.
    const burmeseDigits = '၀၁၂၃၄၅၆၇၈၉';
    final buf = StringBuffer();
    for (final rune in text.runes) {
      final ch = String.fromCharCode(rune);
      final idx = burmeseDigits.indexOf(ch);
      buf.write(idx >= 0 ? idx.toString() : ch);
    }

    final m = RegExp(
      r'\b(MN|M|DN|D|SN|S|AN|A|Dhp|Khp|Ud|Iti|Snp)\s*[-.:/]?\s*(\d+)(?:[.:/](\d+))?\b',
      caseSensitive: false,
    ).firstMatch(buf.toString());
    if (m == null) return null;

    var book = m.group(1)!.toUpperCase();
    if (book == 'M') book = 'MN';
    if (book == 'D') book = 'DN';
    if (book == 'S') book = 'SN';
    if (book == 'A') book = 'AN';
    final n = int.tryParse(m.group(2) ?? '');
    final sub = m.group(3) != null ? int.tryParse(m.group(3)!) : null;
    if (n == null || n <= 0) return null;

    String? bookCode;
    int chapIdx = 0;
    int? startPara;
    int? endPara;

    if (book == 'MN' && n <= 152) {
      int suttaInVagga;
      if (n <= 50) {
        bookCode = 's0201m.mul';
        chapIdx = (n - 1) ~/ 10;
        suttaInVagga = ((n - 1) % 10) + 1;
      } else if (n <= 100) {
        bookCode = 's0202m.mul';
        chapIdx = (n - 51) ~/ 10;
        suttaInVagga = ((n - 51) % 10) + 1;
      } else {
        bookCode = 's0203m.mul';
        final rem = n - 100;
        if (rem <= 10) {
          chapIdx = 0;
          suttaInVagga = rem;
        } else if (rem <= 20) {
          chapIdx = 1;
          suttaInVagga = rem - 10;
        } else if (rem <= 30) {
          chapIdx = 2;
          suttaInVagga = rem - 20;
        } else if (rem <= 42) {
          chapIdx = 3;
          suttaInVagga = rem - 30;
        } else {
          chapIdx = 4;
          suttaInVagga = rem - 42;
        }
      }
      try {
        final rows = dbTipitaka.select(
          'SELECT MIN(para_index) AS start_para, MAX(para_index) AS end_para '
          'FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? AND sutta_title LIKE ?',
          [bookCode, chapIdx, '$suttaInVagga.%'],
        );
        if (rows.isNotEmpty) {
          startPara = _asAiInt(rows.first['start_para']);
          endPara = _asAiInt(rows.first['end_para']);
        }
      } catch (_) {}
    } else if (book == 'DN' && n <= 34) {
      if (n <= 13) {
        bookCode = 's0101m.mul';
        chapIdx = n - 1;
      } else if (n <= 23) {
        bookCode = 's0102m.mul';
        chapIdx = n - 14;
      } else {
        bookCode = 's0103m.mul';
        chapIdx = n - 24;
      }
      try {
        final rows = dbTipitaka.select(
          'SELECT MIN(para_index) AS start_para, MAX(para_index) AS end_para '
          'FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ?',
          [bookCode, chapIdx],
        );
        if (rows.isNotEmpty) {
          startPara = _asAiInt(rows.first['start_para']);
          endPara = _asAiInt(rows.first['end_para']);
        }
      } catch (_) {}
    } else if (book == 'SN' && n <= 56) {
      if (n <= 11) {
        bookCode = 's0301m.mul';
        chapIdx = n - 1;
      } else if (n <= 21) {
        bookCode = 's0302m.mul';
        chapIdx = n - 12;
      } else if (n <= 34) {
        bookCode = 's0303m.mul';
        chapIdx = n - 22;
      } else if (n <= 44) {
        bookCode = 's0304m.mul';
        chapIdx = n - 35;
      } else {
        bookCode = 's0305m.mul';
        chapIdx = n - 45;
      }
      if (n == 56 && sub == 11) {
        startPara = 2473;
        endPara = 2485;
      } else if (n == 22 && sub == 59) {
        startPara = 322;
        endPara = 333;
      } else if (n == 12 && sub == 2) {
        startPara = 2;
        endPara = 15;
      } else if (n == 35 && sub == 28) {
        startPara = 28;
        endPara = 35;
      } else if (n == 45 && sub == 8) {
        startPara = 8;
        endPara = 20;
      } else if (sub != null) {
        try {
          final rows = dbTipitaka.select(
            'SELECT MIN(para_index) AS start_para, MAX(para_index) AS end_para '
            'FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ? '
            'AND (sutta_title LIKE ? OR para_num = ?)',
            [bookCode, chapIdx, '$sub.%', '$sub'],
          );
          if (rows.isNotEmpty) {
            startPara = _asAiInt(rows.first['start_para']);
            endPara = _asAiInt(rows.first['end_para']);
          }
        } catch (_) {}
      }
    } else if (book == 'AN' && n <= 11) {
      bookCode = _resolveCanonicalBookCode('an$n', dbTipitaka);
    }

    if (bookCode == null || bookCode.isEmpty) return null;
    return (
      bookCode: bookCode,
      chapterIndex: chapIdx,
      startPara: startPara,
      endPara: endPara,
    );
  }

  /// Opens `pali_sentences.db` when present, or falls back to `tipitaka.db`
  /// if it contains a `pali_sentences` table.
  Database? _openPaliSentencesDb(Database? dbTipitaka) {
    final dedicated = _openDb('pali_sentences.db');
    if (dedicated != null) return dedicated;
    if (dbTipitaka != null && _getTableNames('CORE', dbTipitaka).contains('pali_sentences')) {
      return dbTipitaka;
    }
    return null;
  }

  /// `GET /api/ai/paragraph_content` handler used by Ani `CitationQuickviewModal`
  /// and `get_paragraph_content` tool calls.
  ApiResponse getAiParagraphContent(Map<String, dynamic> params) {
    final dbTipitaka = _openDb('tipitaka.db');
    if (dbTipitaka == null) {
      return const ApiResponse({
        'success': false,
        'error': 'tipitaka.db not installed',
      });
    }

    final rawBook = (params['book_code'] ?? params['book'] ?? '').toString();
    var targetCode = _resolveCanonicalBookCode(rawBook, dbTipitaka);
    var chapterIndex = _asAiInt(params['chapter_index'] ?? params['chapter']);
    final pNum = _cleanAiParaNum(params['para_num'] ?? params['para_number']);
    final paraIndexParam = _asAiInt(params['para_index']);
    final paraStartParam =
        _asAiInt(params['para_start'] ?? params['start']);
    var pIdx = paraIndexParam ?? (pNum == null ? paraStartParam : null);
    var pEnd = _asAiInt(params['para_end'] ?? params['end']);
    final suttaName = params['sutta_name']?.toString();
    final langs = _parseAiLangs(params['langs']);

    final resolved = _resolveCanonicalCitationRef(
      (suttaName != null && suttaName.isNotEmpty) ? suttaName : rawBook,
      dbTipitaka,
    );
    if (resolved != null && resolved.startPara != null) {
      if (targetCode.isEmpty || targetCode == rawBook.trim()) {
        targetCode = resolved.bookCode;
      }
      chapterIndex ??= resolved.chapterIndex;
      if (pIdx == null || pIdx <= 1) pIdx = resolved.startPara;
      pEnd ??= resolved.endPara ?? (pIdx! + 4);
    }

    if ((pIdx == null || pIdx <= 1) && pNum == null && suttaName != null && suttaName.trim().isNotEmpty) {
      try {
        final sRows = dbTipitaka.select(
          'SELECT para_index, chapter_index FROM canon_paragraphs '
          'WHERE book_code = ? AND sutta_title LIKE ? LIMIT 1',
          [targetCode, '%${suttaName.trim()}%'],
        );
        if (sRows.isNotEmpty) {
          pIdx = _asAiInt(sRows.first['para_index']);
          chapterIndex ??= _asAiInt(sRows.first['chapter_index']);
        }
      } catch (_) {}
    }

    final endIdx = pEnd ?? (pIdx != null ? pIdx + 4 : null);

    try {
      const selectCols =
          'global_id, guid, book_code, chapter_index, chapter_title, '
          'sutta_title, para_index, para_num, pali_text';
      var pRows = <Map<String, Object?>>[];

      List<Map<String, Object?>> toRows(ResultSet rs) {
        return [
          for (final r in rs)
            {for (final col in rs.columnNames) col: r[col]},
        ];
      }

      // Priority 1: canonical para_num
      if (pNum != null) {
        if (chapterIndex != null) {
          pRows = toRows(
            dbTipitaka.select(
              'SELECT $selectCols FROM canon_paragraphs '
              'WHERE book_code = ? AND chapter_index = ? AND para_num = ? '
              'ORDER BY para_index',
              [targetCode, chapterIndex, pNum],
            ),
          );
        }
        if (pRows.isEmpty) {
          pRows = toRows(
            dbTipitaka.select(
              'SELECT $selectCols FROM canon_paragraphs '
              'WHERE book_code = ? AND para_num = ? ORDER BY para_index',
              [targetCode, pNum],
            ),
          );
        }
      }

      // Priority 2: sequential para_index range
      if (pRows.isEmpty && pIdx != null) {
        final activeEnd = endIdx ?? pIdx;
        if (chapterIndex != null) {
          pRows = toRows(
            dbTipitaka.select(
              'SELECT $selectCols FROM canon_paragraphs '
              'WHERE book_code = ? AND chapter_index = ? AND para_index BETWEEN ? AND ? '
              'ORDER BY para_index',
              [targetCode, chapterIndex, pIdx, activeEnd],
            ),
          );
        }
        if (pRows.isEmpty) {
          pRows = toRows(
            dbTipitaka.select(
              'SELECT $selectCols FROM canon_paragraphs '
              'WHERE book_code = ? AND para_index BETWEEN ? AND ? '
              'ORDER BY para_index',
              [targetCode, pIdx, activeEnd],
            ),
          );
        }
      }

      // Priority 3: fallback when pIdx was intended as printed para_num
      if (pRows.isEmpty && pIdx != null) {
        pRows = toRows(
          dbTipitaka.select(
            'SELECT $selectCols FROM canon_paragraphs '
            'WHERE book_code = ? AND para_num = ? ORDER BY para_index',
            [targetCode, pIdx.toString()],
          ),
        );
      }

      final bookTitle = _bookTitleFor(dbTipitaka, targetCode) ?? targetCode;
      final passages = <Map<String, dynamic>>[];

      for (final pRow in pRows) {
        final rowBook = (pRow['book_code'] ?? targetCode).toString();
        final rowChap = _asAiInt(pRow['chapter_index']) ?? 0;
        final rowParaIdx = _asAiInt(pRow['para_index']) ?? 0;
        final rowGuid = pRow['guid']?.toString() ?? '';

        final translations = <String, dynamic>{};
        for (final lang in langs) {
          final code = _normalizeLangCode(lang);
          final tdb = _openDb('translation_$code.db');
          if (tdb == null) continue;
          try {
            var tRows = tdb.select(
              'SELECT translation FROM paragraph_translations '
              'WHERE book_code = ? AND chapter_index = ? AND para_index = ? LIMIT 1',
              [rowBook, rowChap, rowParaIdx],
            );
            if (tRows.isEmpty && rowGuid.isNotEmpty) {
              tRows = tdb.select(
                'SELECT translation FROM paragraph_translations WHERE guid = ? LIMIT 1',
                [rowGuid],
              );
            }
            if (tRows.isNotEmpty && tRows.first['translation'] != null) {
              translations[lang] = tRows.first['translation'];
            }
          } catch (_) {}
        }

        passages.add({
          'guid': pRow['guid'],
          'book_code': rowBook,
          'book_title': bookTitle,
          'chapter_index': rowChap,
          'chapter_title': (pRow['chapter_title'] ?? '').toString(),
          'sutta_title': (pRow['sutta_title'] ?? '').toString(),
          'para_index': rowParaIdx,
          'para_num': pRow['para_num'],
          'pali': pRow['pali_text'],
          'translations': translations,
          'citation_ref': '[$rowBook:c$rowChap:p$rowParaIdx]',
        });
      }

      return ApiResponse({
        'success': true,
        'count': passages.length,
        'passages': passages,
      });
    } catch (e) {
      return ApiResponse({'success': false, 'error': e.toString()});
    }
  }

  /// `GET /api/ai/sentences` handler used by Ani `CitationQuickviewModal`
  /// when opening sentence-level citations (`-L<line_id>`).
  ApiResponse getAiSentences(Map<String, dynamic> params) {
    final dbTipitaka = _openDb('tipitaka.db');
    if (dbTipitaka == null) {
      return const ApiResponse({
        'success': false,
        'error': 'tipitaka.db not installed',
      });
    }

    final rawBook = (params['book_code'] ?? params['book'] ?? '').toString();
    final targetCode = _resolveCanonicalBookCode(rawBook, dbTipitaka);
    var cIdx = _asAiInt(params['chapter_index'] ?? params['chapter']);
    var pIdx = _asAiInt(params['para_index'] ?? params['para']);
    final pNum = _cleanAiParaNum(params['para_num'] ?? params['pnum']);
    final lid = _asAiInt(params['line_id'] ?? params['line']);
    final tLangs = _parseAiLangs(params['langs'], defaults: const ['en']);

    if (pIdx == null && pNum != null) {
      try {
        final rows = dbTipitaka.select(
          'SELECT chapter_index, para_index FROM canon_paragraphs '
          'WHERE book_code = ? AND para_num = ? LIMIT 1',
          [targetCode, pNum],
        );
        if (rows.isNotEmpty) {
          pIdx = _asAiInt(rows.first['para_index']);
          cIdx = _asAiInt(rows.first['chapter_index']);
        }
      } catch (_) {}
    } else if (pIdx != null) {
      // Para index is unique per book; verify against canon_paragraphs when present.
      try {
        final rows = dbTipitaka.select(
          'SELECT chapter_index FROM canon_paragraphs '
          'WHERE book_code = ? AND para_index = ? LIMIT 1',
          [targetCode, pIdx],
        );
        if (rows.isNotEmpty && rows.first['chapter_index'] != null) {
          cIdx = _asAiInt(rows.first['chapter_index']);
        }
      } catch (_) {}
    }
    final activeChap = cIdx ?? 0;

    var paliSents = <Map<String, dynamic>>[];
    final pdb = _openPaliSentencesDb(dbTipitaka);
    if (pdb != null) {
      try {
        if (pIdx != null && lid != null) {
          final rows = pdb.select(
            'SELECT line_id, sentence FROM pali_sentences '
            'WHERE book_code = ? AND chapter_index = ? AND para_index = ? AND line_id = ? '
            'ORDER BY line_id',
            [targetCode, activeChap, pIdx, lid],
          );
          paliSents = [
            for (final r in rows)
              {'line_id': r['line_id'], 'sentence': r['sentence']},
          ];
        } else if (pIdx != null) {
          final rows = pdb.select(
            'SELECT line_id, sentence FROM pali_sentences '
            'WHERE book_code = ? AND chapter_index = ? AND para_index = ? '
            'ORDER BY line_id',
            [targetCode, activeChap, pIdx],
          );
          paliSents = [
            for (final r in rows)
              {'line_id': r['line_id'], 'sentence': r['sentence']},
          ];
        } else {
          final rows = pdb.select(
            'SELECT line_id, sentence, para_index FROM pali_sentences '
            'WHERE book_code = ? AND chapter_index = ? '
            'ORDER BY para_index, line_id LIMIT 40',
            [targetCode, activeChap],
          );
          paliSents = [
            for (final r in rows)
              {
                'line_id': r['line_id'],
                'sentence': r['sentence'],
                'para_index': r['para_index'],
              },
          ];
        }
      } catch (_) {}
    }

    // Fallback to canon_paragraphs.pali_text when pali_sentences has no rows.
    if (paliSents.isEmpty && pIdx != null) {
      try {
        final rows = dbTipitaka.select(
          'SELECT pali_text FROM canon_paragraphs '
          'WHERE book_code = ? AND chapter_index = ? AND para_index = ? LIMIT 1',
          [targetCode, activeChap, pIdx],
        );
        if (rows.isNotEmpty && rows.first['pali_text'] != null) {
          paliSents = [
            {
              'line_id': lid ?? 1,
              'sentence': rows.first['pali_text'].toString(),
              'para_index': pIdx,
            },
          ];
        }
      } catch (_) {}
    }

    final translations = <String, List<Map<String, dynamic>>>{};
    for (final lang in tLangs) {
      final code = _normalizeLangCode(lang);
      final tdb = _openDb('translation_$code.db');
      if (tdb == null) continue;

      var langRows = <Map<String, dynamic>>[];
      try {
        if (pIdx != null && lid != null) {
          final rows = tdb.select(
            'SELECT translation FROM sentence_translations '
            'WHERE book_code = ? AND chapter_index = ? AND para_index = ? AND line_id = ? LIMIT 1',
            [targetCode, activeChap, pIdx, lid],
          );
          if (rows.isNotEmpty) {
            langRows = [
              {'line_id': lid, 'translation': rows.first['translation']},
            ];
          }
        } else if (pIdx != null) {
          final rows = tdb.select(
            'SELECT line_id, translation FROM sentence_translations '
            'WHERE book_code = ? AND chapter_index = ? AND para_index = ? '
            'ORDER BY line_id',
            [targetCode, activeChap, pIdx],
          );
          langRows = [
            for (final r in rows)
              {'line_id': r['line_id'], 'translation': r['translation']},
          ];
        } else {
          final rows = tdb.select(
            'SELECT para_index, line_id, translation FROM sentence_translations '
            'WHERE book_code = ? AND chapter_index = ? '
            'ORDER BY para_index, line_id LIMIT 80',
            [targetCode, activeChap],
          );
          langRows = [
            for (final r in rows)
              {
                'para_index': r['para_index'],
                'line_id': r['line_id'],
                'translation': r['translation'],
              },
          ];
        }
      } catch (_) {}

      // Fallback to paragraph_translations (`sentences_json` or full paragraph)
      // when sentence_translations has no matching rows.
      if (langRows.isEmpty && pIdx != null) {
        try {
          final rows = tdb.select(
            'SELECT translation, sentences_json FROM paragraph_translations '
            'WHERE book_code = ? AND chapter_index = ? AND para_index = ? LIMIT 1',
            [targetCode, activeChap, pIdx],
          );
          if (rows.isNotEmpty) {
            final parsedSents =
                TipitakaWebApi._tryDecodeJson(rows.first['sentences_json']);
            if (parsedSents is List && parsedSents.isNotEmpty) {
              for (var i = 0; i < parsedSents.length; i++) {
                final item = parsedSents[i];
                final itemLid =
                    item is Map ? (_asAiInt(item['line_id']) ?? (i + 1)) : (i + 1);
                if (lid != null && itemLid != lid) continue;
                final text = item is Map
                    ? (item['translation'] ?? item['text'] ?? '').toString()
                    : (item ?? '').toString();
                if (text.isNotEmpty) {
                  langRows.add({'line_id': itemLid, 'translation': text});
                }
              }
            }
            if (langRows.isEmpty && rows.first['translation'] != null) {
              langRows = [
                {
                  'line_id': lid ?? 1,
                  'translation': rows.first['translation'].toString(),
                },
              ];
            }
          }
        } catch (_) {}
      }

      translations[lang] = langRows;
    }

    return ApiResponse({
      'success': true,
      'book_code': targetCode,
      'chapter_index': activeChap,
      'para_index': pIdx,
      'count': paliSents.length,
      'pali_sentences': paliSents,
      'translations': translations,
    });
  }

  ApiResponse getAiTools() {
    return const ApiResponse({'tools': _kAiToolDeclarations});
  }

  ApiResponse getAiBooks() {
    final db = _openDb('tipitaka.db');
    if (db == null) {
      return const ApiResponse({'success': false, 'books': []});
    }
    try {
      final rows = db.select(
        'SELECT code, title, nikaya, category, chapter_count FROM books ORDER BY id',
      );
      return ApiResponse({
        'success': true,
        'count': rows.length,
        'books': [
          for (final r in rows)
            {for (final col in rows.columnNames) col: r[col]},
        ],
      });
    } catch (e) {
      return ApiResponse({'success': false, 'error': e.toString()});
    }
  }

  ApiResponse _executeAiBatchParagraphs(Map<String, dynamic> args) {
    final ranges = args['ranges'] is List ? args['ranges'] as List : const [];
    final allPassages = <dynamic>[];
    for (final r in ranges.take(6)) {
      if (r is! Map) continue;
      final res = getAiParagraphContent({
        'book_code': r['book_code'] ?? r['book'],
        'chapter_index': r['chapter_index'] ?? r['chapter'],
        'para_start': r['para_start'] ?? r['para_index'],
        'para_end': r['para_end'],
        'para_num': r['para_num'] ?? r['para_number'],
        'para_index': r['para_index'],
        if (r['langs'] != null) 'langs': r['langs'],
      });
      final body = res.body;
      if (body is Map && body['passages'] is List) {
        allPassages.addAll(body['passages'] as List);
      }
    }
    return ApiResponse({
      'success': true,
      'count': allPassages.length,
      'passages': allPassages,
    });
  }

  Future<ApiResponse> executeAiTool(
    String name,
    Map<String, dynamic> args,
  ) async {
    switch (name) {
      case 'get_paragraph_content':
        return getAiParagraphContent({
          ...args,
          'para_start': args['para_start'] ?? args['para_index'],
          'para_num': args['para_num'] ?? args['para_number'],
        });
      case 'get_paragraph_content_batch':
        return _executeAiBatchParagraphs(args);
      case 'get_sentences':
        return getAiSentences({
          'book_code': args['book_code'] ?? args['book'],
          'chapter_index': args['chapter_index'] ?? args['chapter'],
          'para_index':
              args['para_index'] ?? args['para_start'] ?? args['para'],
          'para_num': args['para_num'] ?? args['para_number'],
          'line_id': args['line_id'] ?? args['line'] ?? args['sentence_id'],
          'langs': args['langs'],
        });
      case 'get_books':
        return getAiBooks();
      case 'search_tipitaka':
        final searchRes = search({
          'q': (args['query'] ?? '').toString(),
          'limit': (args['limit'] ?? '15').toString(),
        }).body;
        if (searchRes is Map) {
          return ApiResponse({'success': true, ...searchRes});
        }
        return const ApiResponse({'success': false, 'results': []});
      case 'search_tipitaka_batch':
        final queries = args['queries'] is List
            ? args['queries'] as List
            : [args['query']];
        final combined = <dynamic>[];
        final seen = <String>{};
        for (final q in queries.take(4)) {
          final qStr = (q ?? '').toString().trim();
          if (qStr.isEmpty) continue;
          final body = search({'q': qStr, 'limit': '10'}).body;
          if (body is Map && body['results'] is List) {
            for (final item in body['results'] as List) {
              if (item is Map) {
                final k = '${item['book_code']}:${item['para_index']}';
                if (seen.add(k)) combined.add(item);
              }
            }
          }
        }
        return ApiResponse({
          'success': true,
          'count': combined.length,
          'results': combined.take(25).toList(),
        });
      case 'get_dictionary':
        return _aiLookupDictionary((args['word'] ?? '').toString());
      case 'get_dictionary_batch':
        final words = args['words'] is List
            ? args['words'] as List
            : (args['terms'] is List ? args['terms'] as List : const []);
        final entries = <Map<String, dynamic>>[];
        for (final w in words.take(6)) {
          final body = (await _aiLookupDictionary((w ?? '').toString())).body;
          if (body is Map && body['entries'] is List) {
            for (final e in body['entries'] as List) {
              if (e is Map<String, dynamic>) entries.add(e);
            }
          }
        }
        return ApiResponse({
          'success': true,
          'count': entries.length,
          'entries': entries,
        });
      case 'get_commentaries':
        final rawCode = (args['book_code'] ?? args['book'] ?? '').toString();
        final db = _openDb('tipitaka.db');
        final code = _resolveCanonicalBookCode(rawCode, db);
        final pNum =
            _cleanAiParaNum(args['para_num'] ?? args['para_number']) ??
                _asAiInt(args['para_index'])?.toString();
        final chap = _asAiInt(args['chapter_index'] ?? args['chapter']);
        return getMatJump(code, pNum, chap);
      case 'final_answer':
        return ApiResponse({
          'success': true,
          'summary': (args['summary'] ?? 'Research complete').toString(),
        });
      default:
        return ApiResponse({
          'success': false,
          'error': 'Unknown offline tool: $name',
        });
    }
  }

  Future<ApiResponse> _aiLookupDictionary(String rawWord) async {
    final trimmed = rawWord.trim();
    if (trimmed.isEmpty) {
      return const ApiResponse({'success': false, 'error': 'Empty word'});
    }
    await dpdFamilyTemplates.ensureLoaded();
    final word = PaliScriptConverter.cleanDictionaryQuery(trimmed);
    final dpd = _lookupDpdList(word, _getSynonyms(word));
    final entries = <Map<String, dynamic>>[];
    for (final item in dpd.take(4)) {
      final html = (item['html'] ?? '').toString();
      final text = html
          .replaceAll(RegExp(r'<div class="?button-box"?[\s\S]*?</div>', caseSensitive: false), ' ')
          .replaceAll(RegExp(r'<svg[\s\S]*?</svg>', caseSensitive: false), ' ')
          .replaceAll(RegExp(r'<div class="?content"?[\s\S]*?</div>', caseSensitive: false), ' ')
          .replaceAll(RegExp(r'<[^>]*>'), ' ')
          .replaceAll('&nbsp;', ' ')
          .replaceAll(RegExp(r'\s+'), ' ')
          .trim();
      if (text.isEmpty) continue;
      entries.add({
        'word': item['word'],
        'isExact': item['isExact'] == true,
        'definition': text.length > 450 ? '${text.substring(0, 450)}…' : text,
      });
    }
    return ApiResponse({
      'success': true,
      'word': trimmed,
      'count': entries.length,
      'entries': entries,
    });
  }
}
