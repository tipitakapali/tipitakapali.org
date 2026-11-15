import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqlite3/sqlite3.dart';
import 'package:tipitakapali_app/core/services/tipitaka_repository.dart';

void _seedTipitakaDb(String dbPath) {
  final db = sqlite3.open(dbPath);
  try {
    db.execute('''
      CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        nikaya TEXT,
        category TEXT,
        xml_filename TEXT NOT NULL,
        chapter_count INTEGER DEFAULT 0,
        meta_json TEXT
      );
      CREATE TABLE chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        chunk_name TEXT NOT NULL,
        anchor_id TEXT NOT NULL,
        para_index INTEGER DEFAULT 0,
        html TEXT
      );
      CREATE TABLE tree_nodes (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        parent_id INTEGER,
        node_type TEXT,
        book_code TEXT,
        chapter_index INTEGER,
        href TEXT
      );
      CREATE TABLE book_mat (
        book_code TEXT PRIMARY KEY,
        category TEXT,
        mula_code TEXT,
        mula_title TEXT,
        attha_code TEXT,
        attha_title TEXT,
        tika_code TEXT,
        tika_title TEXT
      );
      CREATE TABLE mat_chapter_map (
        source_book TEXT NOT NULL,
        source_chapter INTEGER NOT NULL,
        mula_book TEXT,
        mula_chapter INTEGER,
        mula_title TEXT,
        attha_book TEXT,
        attha_chapter INTEGER,
        attha_title TEXT,
        tika_book TEXT,
        tika_chapter INTEGER,
        tika_title TEXT,
        PRIMARY KEY (source_book, source_chapter)
      );
      CREATE TABLE book_toc (
        book_id INTEGER,
        book_code TEXT,
        item_index INTEGER,
        level INTEGER,
        type TEXT,
        rend TEXT,
        title TEXT,
        para_index INTEGER,
        para_num TEXT,
        anchor_id TEXT,
        chapter_index INTEGER
      );
      CREATE TABLE canon_paragraphs (
        global_id INTEGER PRIMARY KEY AUTOINCREMENT,
        guid TEXT UNIQUE NOT NULL,
        book_code TEXT NOT NULL,
        sub_book TEXT,
        chapter_index INTEGER NOT NULL,
        chapter_title TEXT,
        sutta_title TEXT,
        para_index INTEGER NOT NULL,
        para_num TEXT,
        para_first INTEGER,
        para_last INTEGER,
        rend TEXT,
        pali_text TEXT,
        word_count INTEGER,
        mula_guid TEXT,
        mula_book TEXT,
        mula_chapter INTEGER,
        mula_para TEXT,
        attha_guid TEXT,
        attha_book TEXT,
        attha_chapter INTEGER,
        attha_para TEXT,
        tika_guid TEXT,
        tika_book TEXT,
        tika_chapter INTEGER,
        tika_para TEXT,
        match_quality TEXT
      );
    ''');

    db.execute(
      "INSERT INTO books (code, title, nikaya, category, xml_filename, chapter_count) "
      "VALUES ('s0101m.mul', 'Sīlakkhandhavaggapāḷi', 'digha', 'mūla', 's0101m.mul.xml', 1);",
    );
    db.execute(
      "INSERT INTO chapters (book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index, html) "
      "VALUES (1, 's0101m.mul', 0, '1. Brahmajālasuttaṃ', 'ch0', 'chap-0', 0, '<p class=\"bodytext\" data-pindex=\"5\">Fallback</p>');",
    );
    db.execute(
      "INSERT INTO tree_nodes (id, text, parent_id, node_type, book_code, chapter_index) VALUES "
      "(1, 'Suttapiṭaka', NULL, 'category', NULL, NULL), "
      "(2, '1. Brahmajālasuttaṃ', 1, 'chapter', 's0101m.mul', 0);",
    );
    db.execute(
      "INSERT INTO book_mat (book_code, category, attha_code, attha_title) "
      "VALUES ('s0101m.mul', 'mūla', 's0101a.att', 'Sumaṅgalavilāsinī');",
    );
    db.execute(
      "INSERT INTO canon_paragraphs (guid, book_code, chapter_index, para_index, para_num, rend, pali_text, attha_book, attha_chapter) "
      "VALUES ('s0101m.mul:c0:n0:p5', 's0101m.mul', 0, 5, '1', 'bodytext', 'Evaṃ me sutaṃ – ekaṃ samayaṃ bhagavā.', 's0101a.att', 1);",
    );
  } finally {
    db.close();
  }
}

void main() {
  test('TipitakaRepository loads tree, chapters, aligned translations, FTS hits, and DPD words', () {
    final tmp = Directory.systemTemp.createTempSync('tp_repo_');
    addTearDown(() => tmp.deleteSync(recursive: true));

    final tipitakaPath = p.join(tmp.path, 'tipitaka.db');
    _seedTipitakaDb(tipitakaPath);

    final transPath = p.join(tmp.path, 'translation_en.db');
    final transDb = sqlite3.open(transPath);
    try {
      transDb.execute('''
        CREATE TABLE paragraph_translations (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          guid TEXT,
          para_num TEXT,
          translation TEXT NOT NULL,
          sentence_count INTEGER NOT NULL DEFAULT 1,
          sentences_json TEXT,
          PRIMARY KEY (book_code, chapter_index, para_index)
        );
      ''');
      transDb.execute('''
        CREATE TABLE sentence_translations (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          line_id INTEGER NOT NULL,
          translation TEXT NOT NULL,
          PRIMARY KEY (book_code, chapter_index, para_index, line_id)
        );
      ''');
      transDb.execute(
        "INSERT INTO paragraph_translations (book_code, chapter_index, para_index, para_num, translation) "
        "VALUES ('s0101m.mul', 0, 5, '1', '<b>Thus</b> have I heard.');",
      );
      transDb.execute(
        "INSERT INTO sentence_translations (book_code, chapter_index, para_index, line_id, translation) "
        "VALUES ('s0101m.mul', 0, 5, 1, 'Thus have I heard.');",
      );
    } finally {
      transDb.close();
    }

    final paliSentPath = p.join(tmp.path, 'pali_sentences.db');
    final paliSentDb = sqlite3.open(paliSentPath);
    try {
      paliSentDb.execute('''
        CREATE TABLE pali_sentences (
          book_code TEXT NOT NULL,
          chapter_index INTEGER NOT NULL,
          para_index INTEGER NOT NULL,
          line_id INTEGER NOT NULL,
          sentence TEXT NOT NULL,
          PRIMARY KEY (book_code, chapter_index, para_index, line_id)
        );
      ''');
      paliSentDb.execute(
        "INSERT INTO pali_sentences VALUES ('s0101m.mul', 0, 5, 1, 'Evaṃ me sutaṃ.');",
      );
    } finally {
      paliSentDb.close();
    }

    final dpdPath = p.join(tmp.path, 'dpd_tipitakapali.db');
    final dpdDb = sqlite3.open(dpdPath);
    try {
      dpdDb.execute(
        'CREATE TABLE evz (id INTEGER PRIMARY KEY, word TEXT NOT NULL, defi TEXT NOT NULL);',
      );
      dpdDb.execute(
        "INSERT INTO evz (word, defi) VALUES ('evaṃ', '<b>ind.</b> thus; so.');",
      );
    } finally {
      dpdDb.close();
    }

    final repo = TipitakaRepository();

    final roots = repo.getTreeChildren(tipitakaPath);
    expect(roots.single.text, 'Suttapiṭaka');
    final children = repo.getTreeChildren(tipitakaPath, parentId: roots.single.id);
    expect(children.single.bookCode, 's0101m.mul');

    final bundle = repo.loadChapter(
      tipitakaPath,
      rawBookCode: 's0101m.mul0',
      translationDbPath: transPath,
      translationLangCode: 'en',
      paliSentencesDbPath: paliSentPath,
    );
    expect(bundle.book.code, 's0101m.mul');
    expect(bundle.currentChapterIndex, 0);
    expect(bundle.mat.attha?.bookCode, 's0101a.att');
    expect(bundle.paragraphs.single.paliText, contains('Evaṃ me sutaṃ'));
    expect(bundle.paragraphs.single.translationText, 'Thus have I heard.');
    expect(bundle.paragraphs.single.sentences.single.paliSentence, 'Evaṃ me sutaṃ.');
    expect(
      bundle.paragraphs.single.sentences.single.translationsByLang['en'],
      'Thus have I heard.',
    );

    final paraHit = repo.findParagraphTarget(
      tipitakaPath,
      bookCode: 's0101m.mul',
      paraNumQuery: '1',
    );
    expect(paraHit?.chapterIndex, 0);
    expect(paraHit?.paraIndex, 5);

    final matRel = repo.resolveMatForParagraph(
      tipitakaPath,
      bookCode: 's0101m.mul',
      chapterIndex: 0,
      paraNum: '1',
      paraIndex: 5,
    );
    expect(matRel.attha?.bookCode, 's0101a.att');

    final defs = repo.lookupWord(rawWord: 'Evaṃ,', dpdDbPath: dpdPath);
    expect(defs.single.headword, 'evaṃ');
    expect(defs.single.bodyText, 'ind. thus; so.');
  });
}
