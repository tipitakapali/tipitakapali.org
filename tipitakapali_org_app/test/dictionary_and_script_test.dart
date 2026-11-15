import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';
import 'package:tipitakapali_app/core/providers/reader_settings_provider.dart';
import 'package:tipitakapali_app/core/services/tipitaka_repository.dart';
import 'package:tipitakapali_app/core/utils/pali_script_converter.dart';
import 'package:tipitakapali_app/features/reader/utils/reader_word_hit_test.dart';
import 'package:tipitakapali_app/features/reader/utils/reader_word_lookup_controller.dart';

void main() {
  test('PaliScriptConverter converts Velthuis and scripts accurately', () {
    expect(PaliScriptConverter.typeVelthuis('eva.m bhagavaa'), 'evaṃ bhagavā');

    final sinh = PaliScriptConverter.convertFromRoman(
      'evaṃ me sutaṃ',
      PaliScript.sinhala,
    );
    expect(sinh, contains('එවං'));
    expect(PaliScriptConverter.convertToRoman(sinh).trim(), 'evaṃ me sutaṃ');

    final myanmar = PaliScriptConverter.convertFromRoman(
      'dhamma',
      PaliScript.myanmar,
    );
    expect(myanmar, contains('ဓမ္မ'));
    expect(PaliScriptConverter.convertToRoman(myanmar).trim(), 'dhamma');

    expect(
      PaliScriptConverter.cleanDictionaryQuery('“dhammaṃ”’’ti.'),
      'dhammaṃ ti',
    );
  });

  test('wordRangeAt and quoteJoinCandidate handle Indic & quote-elided words', () {
    const roman = 'oghamatarin ’’’ ti evaṃ';
    final r1 = wordRangeAt(roman, 2);
    expect(roman.substring(r1.start, r1.end), 'oghamatarin');
    expect(quoteJoinCandidate(roman, r1.end, 'oghamatarin'), 'oghamatarinti');

    const myanmar = 'ဘဂဝတော အရဟတော';
    final r2 = wordRangeAt(myanmar, 3);
    expect(myanmar.substring(r2.start, r2.end), 'ဘဂဝတော');
  });

  test('ReaderWordLookupController respects single vs double tap and movement slop', () {
    var calls = 0;
    final ctrl = ReaderWordLookupController(
      hitFinder: (_, _) {
        calls++;
        return const ReaderWordHitResult(
          word: 'dhammaṃ',
          rawWord: 'dhammaṃ',
          range: TextRange(start: 0, end: 7),
        );
      },
    );
    final key = GlobalKey();

    // Single tap without move triggers lookup on pointerUp
    ctrl.trigger = DictLookupTrigger.single;
    final down = ctrl.handlePointerDown(
      pointer: 1,
      localPosition: const Offset(10, 10),
      globalPosition: const Offset(10, 10),
      timestampMs: 100,
      contentHitTestKey: key,
    );
    expect(down.shouldLookup, isFalse);
    final up = ctrl.handlePointerUp(
      pointer: 1,
      globalPosition: const Offset(10, 10),
      timestampMs: 180,
      contentHitTestKey: key,
      hasSelection: false,
    );
    expect(up.shouldLookup, isTrue);
    expect(up.word, 'dhammaṃ');
    expect(calls, 1);

    // Drag cancels single tap
    ctrl.handlePointerDown(
      pointer: 2,
      localPosition: const Offset(10, 10),
      globalPosition: const Offset(10, 10),
      timestampMs: 300,
      contentHitTestKey: key,
    );
    ctrl.handlePointerMove(2, const Offset(35, 10));
    final dragUp = ctrl.handlePointerUp(
      pointer: 2,
      globalPosition: const Offset(35, 10),
      timestampMs: 350,
      contentHitTestKey: key,
      hasSelection: false,
    );
    expect(dragUp.shouldLookup, isFalse);
    expect(calls, 1);
  });

  test('DictionaryRepository resolves DPD synonyms, Splitter breakups, and Inflections', () {
    final tmp = Directory.systemTemp.createTempSync('tp_dict_repo_');
    addTearDown(() => tmp.deleteSync(recursive: true));

    final dpdPath = p.join(tmp.path, 'dpd_tipitakapali.db');
    final synPath = p.join(tmp.path, 'dpd_synonyms_tipitakapali.db');
    final spliPath = p.join(tmp.path, 'dpd_splitter_tipitakapali.db');
    final infPath = p.join(tmp.path, 'dpd_inflection_tipitakapali.db');

    final dpd = sqlite3.open(dpdPath);
    dpd.execute(
      'CREATE TABLE bhz (id INTEGER PRIMARY KEY, word TEXT, defi TEXT);',
    );
    dpd.execute(
      'INSERT INTO bhz (word, defi) VALUES (?, ?)',
      [
        'bhagavant',
        '@{"id":10,"lemma":"bhagavant_1","family_root":"√bhaj"}@<section class=dp9><span class=p1w>bhagavant 1</span><div class=dpd><p>masc. <b>Blessed One</b></p></div><div class=button-box><a class="dpd-button" onclick="openInflection(\'declension_bhagavant_1\')">inflections</a></div></section>',
      ],
    );
    dpd.close();

    final syn = sqlite3.open(synPath);
    syn.execute('CREATE TABLE bhz (id INTEGER PRIMARY KEY, word TEXT, synonym TEXT);');
    syn.execute('INSERT INTO bhz (word, synonym) VALUES (?, ?)', ['bhagavant', 'bhagavato']);
    syn.close();

    final spli = sqlite3.open(spliPath);
    spli.execute('CREATE TABLE evz (id INTEGER PRIMARY KEY, word TEXT, defi TEXT);');
    spli.execute('INSERT INTO evz (word, defi) VALUES (?, ?)', ['evañca', 'evaṃ+ca@evam+ca']);
    spli.close();

    final inf = sqlite3.open(infPath);
    inf.execute('CREATE TABLE bhz (id INTEGER PRIMARY KEY, word TEXT, defi TEXT);');
    inf.execute(
      'INSERT INTO bhz (word, defi) VALUES (?, ?)',
      [
        'bhagavant_1',
        "<p class='heading'><b>bhagavant</b> declension</p><table class='inflection'><tr><th>case</th><th>sg</th></tr><tr><th>gen</th><td>bhagavato<br>bhagavantassa</td></tr></table>",
      ],
    );
    inf.close();

    final repo = DictionaryRepository();
    final paths = DictionaryDbPaths(
      dpdDbPath: dpdPath,
      synonymsDbPath: synPath,
      splitterDbPath: spliPath,
      inflectionDbPath: infPath,
    );

    final inflectedHit = repo.lookup('bhagavato', paths);
    expect(inflectedHit.synonyms, contains('bhagavant'));
    expect(inflectedHit.entries.first.headword, 'bhagavant 1');
    expect(inflectedHit.entries.first.coreMeaning, 'Blessed One');
    expect(inflectedHit.entries.first.tags, contains('√bhaj'));
    expect(inflectedHit.entries.first.inflectionKey, 'declension_bhagavant_1');

    final table = repo.lookupInflection(infPath, 'declension_bhagavant_1');
    expect(table, isNotNull);
    expect(table!.rows.length, 2);
    expect(table.rows[1][1].forms, contains('bhagavato'));

    final splitHit = repo.lookup('evañca', paths);
    expect(splitHit.entries.any((e) => e.source == DictSource.splitter), isTrue);
    expect(splitHit.entries.first.breakups, ['evaṃ + ca', 'evam + ca']);
  });
}
