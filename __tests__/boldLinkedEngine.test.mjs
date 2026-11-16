import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('../server_api/node_modules/better-sqlite3');
const { BoldLinkedEngine } = require('../server_api/boldLinkedEngine');

function createFixtureDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bold_linked_js_'));
  const tipiPath = path.join(dir, 'tipitaka.db');
  const db = new Database(tipiPath);

  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      nikaya TEXT,
      category TEXT,
      chapter_count INTEGER,
      meta_json TEXT,
      meta_z BLOB
    );
    CREATE TABLE chapters (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL,
      book_code TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      title TEXT,
      html TEXT,
      html_z BLOB
    );
    CREATE TABLE book_toc (
      book_code TEXT,
      para_index INTEGER,
      title TEXT
    );
    CREATE TABLE chapter_text_pack (
      book_id INTEGER NOT NULL,
      chapter_index INTEGER NOT NULL,
      data_z BLOB NOT NULL,
      PRIMARY KEY (book_id, chapter_index)
    ) WITHOUT ROWID;
    CREATE TABLE canon_paragraphs (
      global_id INTEGER PRIMARY KEY,
      book_code TEXT,
      chapter_index INTEGER,
      para_index INTEGER,
      para_num TEXT,
      para_first INTEGER,
      para_last INTEGER,
      pali_text TEXT,
      mula_book TEXT,
      mula_chapter INTEGER,
      mula_para TEXT,
      attha_book TEXT,
      attha_chapter INTEGER,
      attha_para TEXT,
      tika_book TEXT,
      tika_chapter INTEGER,
      tika_para TEXT
    );
  `);

  db.prepare(
    'INSERT INTO books (id, code, title, nikaya, category, chapter_count, meta_json, meta_z) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)'
  ).run(1, 'abh01m.mul', 'Dhammasaṅgaṇī', 'abhidhamma', 'mūla', 2, zlib.deflateSync(Buffer.from('{}')));
  db.prepare(
    'INSERT INTO books (id, code, title, nikaya, category, chapter_count, meta_json, meta_z) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)'
  ).run(2, 'abh01a.att', 'Atthasālinī', 'abhidhamma', 'aṭṭhakathā', 2, zlib.deflateSync(Buffer.from('{}')));

  const insChap = db.prepare('INSERT INTO chapters (id, book_id, book_code, chapter_index, title, html, html_z) VALUES (?, ?, ?, ?, ?, NULL, ?)');
  insChap.run(1, 1, 'abh01m.mul', 0, 'Ch0', zlib.deflateSync(Buffer.from('<p class="bodytext" data-pindex="1">Kusalā dhammā.</p>')));
  insChap.run(2, 1, 'abh01m.mul', 1, 'Ch1', zlib.deflateSync(Buffer.from('<p class="bodytext" data-pindex="10">Nāmaṃ me vuttaṃ.</p>')));
  insChap.run(3, 2, 'abh01a.att', 0, 'AttCh0', zlib.deflateSync(Buffer.from('<p class="bodytext" data-pindex="1" data-para="1"><strong class="bld">Kusalā</strong>ti anavajjā.</p>')));
  insChap.run(
    4,
    2,
    'abh01a.att',
    1,
    'AttCh1',
    zlib.deflateSync(
      Buffer.from(
        '<p class="bodytext" data-pindex="20" data-para="1">' +
          'Tathā <strong class="bld">nāma</strong>nti niddeso. ' +
          '<strong class="bld">Me</strong>tiādīni padāni. ' +
          '<strong class="bld">‘‘Vutta</strong>’’nti bhāsitaṃ.' +
          '</p>' +
          '<p class="bodytext" data-pindex="21" data-para="32-33"><strong class="bld">Suta</strong>nti gahitaṃ.</p>'
      )
    )
  );

  const packMula1 = zlib.deflateSync(Buffer.from(JSON.stringify([[10, 'Nāmaṃ me vuttaṃ.', [[1, 'Nāmaṃ me vuttaṃ.']]]])));
  const packAtt1 = zlib.deflateSync(
    Buffer.from(
      JSON.stringify([
        [20, null, [[1, 'Tathā <b>nāman</b>ti niddeso.'], [2, '<b>Me</b>tiādīni padāni.'], [3, '‘‘<b>Vutta</b>’’nti bhāsitaṃ.']]],
        [21, 'Sutanti gahitaṃ.', [[1, '<b>Sutan</b>ti gahitaṃ.']]],
      ])
    )
  );
  db.prepare('INSERT INTO chapter_text_pack VALUES (?, ?, ?)').run(1, 1, packMula1);
  db.prepare('INSERT INTO chapter_text_pack VALUES (?, ?, ?)').run(2, 1, packAtt1);

  const insPara = db.prepare(
    'INSERT INTO canon_paragraphs (global_id, book_code, chapter_index, para_index, para_num, para_first, para_last, pali_text, mula_book, mula_chapter, mula_para, attha_book, attha_chapter, attha_para, tika_book, tika_chapter, tika_para) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  insPara.run(1, 'abh01m.mul', 0, 1, '1', 1, 1, null, 'abh01m.mul', 0, '1', 'abh01a.att', 0, '1', null, null, null);
  insPara.run(2, 'abh01m.mul', 1, 10, '1', 1, 1, null, 'abh01m.mul', 1, '1', 'abh01a.att', 1, '1', null, null, null);
  insPara.run(3, 'abh01a.att', 0, 1, '1', 1, 1, null, 'abh01m.mul', 0, '1', 'abh01a.att', 0, '1', null, null, null);
  insPara.run(4, 'abh01a.att', 1, 20, '1', 1, 1, null, 'abh01m.mul', 1, '1', 'abh01a.att', 1, '1', null, null, null);
  insPara.run(5, 'abh01a.att', 1, 21, '32-33', 32, 33, null, 'abh01m.mul', 1, '1', 'abh01a.att', 1, '32-33', null, null, null);

  const transPath = path.join(dir, 'translation_en.db');
  const tdb = new Database(transPath);
  tdb.exec(`
    CREATE TABLE paragraph_translations (
      book_code TEXT, chapter_index INTEGER, para_index INTEGER, translation TEXT, sentences_json TEXT
    );
    CREATE TABLE sentence_translations (
      book_code TEXT, chapter_index INTEGER, para_index INTEGER, line_id INTEGER, translation TEXT
    );
  `);
  tdb.prepare('INSERT INTO paragraph_translations VALUES (?, ?, ?, ?, ?)').run(
    'abh01a.att',
    1,
    20,
    'Thus name is indicated.',
    null
  );
  tdb.prepare('INSERT INTO sentence_translations VALUES (?, ?, ?, ?, ?)').run(
    'abh01a.att',
    1,
    20,
    1,
    'Thus name is indicated (line 1).'
  );
  tdb.prepare('INSERT INTO sentence_translations VALUES (?, ?, ?, ?, ?)').run(
    'abh01a.att',
    1,
    20,
    3,
    'Said means spoken (line 3).'
  );

  const translationEngine = {
    ensureLanguage: (code) => (code === 'en' ? 'en' : null),
    databases: new Map([['en', { db: tdb }]]),
  };

  const engine = new BoldLinkedEngine({
    dbTipitaka: db,
    tipiDbPath: tipiPath,
    dbDir: dir,
    getPaliSentDb: () => null,
    translationEngine,
  });

  return { dir, db, tdb, engine };
}

test('BoldLinkedEngine builds schema_version=4, extracts quotes before nti, resolves sentence-level translations, and isolates cross-chapter para_num', () => {
  const { dir, db, tdb, engine } = createFixtureDir();
  try {
    const bdb = engine.ensureBoldDb();
    assert.ok(bdb);
    const ver = bdb.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value;
    assert.equal(ver, '4');

    // 1. Quotes before nti (`‘‘Vutta’’nti` -> word='vuttaṃ', ending='ti'), sentence line_id=3 & sentence-level translation
    const vutta = engine.lookupBoldDef('vuttaṃ', ['en']);
    assert.equal(vutta.hasResults, true);
    assert.ok(vutta.results.some((r) => r.word === 'vuttaṃ' && r.ending === 'ti'));
    assert.equal(vutta.results[0].line_id, 3);
    assert.equal(vutta.results[0].translations.en, 'Said means spoken (line 3).');
    assert.equal(vutta.results[0].mat?.mula?.title, 'Dhammasaṅgaṇī');

    // 2. Stemmer keeps `nāmaṃ` -> prefix `nāma` (does not over-trim to `nām`), plus line_id=1 translation when sentence_translations absent
    const namam = engine.lookupBoldDef('nāmaṃ', ['en']);
    assert.equal(namam.search_prefix, 'nāma');
    assert.ok(namam.results.some((r) => r.word === 'nāmaṃ' && r.line_id === 1));

    // 3. Cross-chapter para_num='1' isolation: abh01m.mul ch=1 links to abh01a.att ch=1 (NOT ch=0) with target_line_id
    const ch1Links = engine.getLinksForChapter('abh01m.mul', 1);
    const p10 = ch1Links.paragraphs['10'];
    assert.ok(p10);
    const namaLink = p10.all.find((l) => l.word === 'nāmaṃ');
    assert.ok(namaLink);
    assert.equal(namaLink.target_chapter, 1);
    assert.equal(namaLink.target_para_index, 20);
    assert.equal(namaLink.target_line_id, 1);

    const vuttaLink = p10.all.find((l) => l.word === 'vuttaṃ');
    assert.ok(vuttaLink);
    assert.equal(vuttaLink.target_line_id, 3);

    // 4. Inline <b>...</b> sandhi & 2-letter `Me`tiādīni attach to their exact sentence lines
    const attLinks = engine.getLinksForChapter('abh01a.att', 1);
    const attByLine = attLinks.paragraphs['20'].by_line;
    assert.ok(attByLine['1'].some((l) => l.word === 'nāmaṃ' && l.is_source === true && l.target_line_id === 1));
    assert.ok(attByLine['2'].some((l) => l.word === 'me' && l.is_source === true));
    assert.ok(attByLine['3'].some((l) => l.word === 'vuttaṃ' && l.is_source === true && l.target_line_id === 1));

    // 5. Range para_num ('32-33') + sentence_translations fallback in getLinkedPreview
    const rangePrev = engine.getLinkedPreview({
      book: 'abh01a.att',
      chapter: 1,
      paraNum: '32',
      word: 'sutaṃ',
      langs: ['en'],
    });
    assert.ok(rangePrev);
    assert.equal(rangePrev.target_para_index, 21);

    const prevWithSentTrans = engine.getLinkedPreview({
      book: 'abh01a.att',
      chapter: 1,
      paraNum: '1',
      word: 'vuttaṃ',
      langs: ['en'],
    });
    assert.ok(prevWithSentTrans);
    const targetLine = prevWithSentTrans.lines.find((l) => l.is_target);
    assert.ok(targetLine);
    assert.equal(targetLine.line_id, 3);
    assert.equal(targetLine.translations.en, 'Said means spoken (line 3).');
  } finally {
    try { engine.boldDb?.close(); } catch (_) {}
    try { tdb.close(); } catch (_) {}
    try { db.close(); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BoldLinkedEngine strips editorial notes, matches inflections without substring false positives, and supports dual Tika reverse links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bold_linked_v3_'));
  const tipiPath = path.join(dir, 'tipitaka.db');
  const db = new Database(tipiPath);
  try {
    db.exec(`
      CREATE TABLE books (id INTEGER PRIMARY KEY, code TEXT UNIQUE, title TEXT, nikaya TEXT, category TEXT);
      CREATE TABLE chapters (id INTEGER PRIMARY KEY, book_id INTEGER, book_code TEXT, chapter_index INTEGER, title TEXT, html TEXT);
      CREATE TABLE chapter_text_pack (book_id INTEGER NOT NULL, chapter_index INTEGER NOT NULL, data_z BLOB NOT NULL, PRIMARY KEY (book_id, chapter_index));
      CREATE TABLE canon_paragraphs (
        global_id INTEGER PRIMARY KEY, book_code TEXT, chapter_index INTEGER, para_index INTEGER,
        para_num TEXT, para_first INTEGER, para_last INTEGER, pali_text TEXT,
        mula_book TEXT, mula_chapter INTEGER, mula_para TEXT,
        attha_book TEXT, attha_chapter INTEGER, attha_para TEXT,
        tika_book TEXT, tika_chapter INTEGER, tika_para TEXT
      );
      INSERT INTO books VALUES
        (1, 's0101m.mul', 'Brahmajāla', 'digha', 'mūla'),
        (2, 's0101a.att', 'Brahmajāla-aṭṭhakathā', 'digha', 'aṭṭhakathā'),
        (3, 's0101t.tik', 'Brahmajāla-ṭīkā', 'digha', 'ṭīkā');
      INSERT INTO chapters VALUES
        (1, 1, 's0101m.mul', 0, 'M', ''),
        (2, 2, 's0101a.att', 0, 'A', ''),
        (3, 3, 's0101t.tik', 0, 'T', '');
    `);

    const packM = zlib.deflateSync(Buffer.from(JSON.stringify([
      [5, null, [
        [1, 'Ekaṃ samayaṃ bhagavā viharati.'],
        [2, 'Bhagavantaṃ piṭṭhito piṭṭhito anubandhā [anubaddhā (ka. sī. pī.)] honti.'],
      ]],
    ])));
    const packA = zlib.deflateSync(Buffer.from(JSON.stringify([
      [10, null, [
        [1, '<b>Samayo</b>ti kālo.'],
        [2, '<b>Bhagavantaṃ piṭṭhito piṭṭhito anubandhā hontī</b>ti pacchato gacchanti.'],
        [3, '<b>Ayaṃ</b>ti idha niddeso.'],
        [4, '<b>Evaṃ</b>ti niddisati.'],
      ]],
    ])));
    const packT = zlib.deflateSync(Buffer.from(JSON.stringify([
      [20, null, [
        [1, '<b>Viharatī</b>ti iriyāpathavasena.'],
        [2, '<b>Kālo</b>ti samayaviseso.'],
      ]],
    ])));
    const insPack = db.prepare('INSERT INTO chapter_text_pack VALUES (?, ?, ?)');
    insPack.run(1, 0, packM);
    insPack.run(2, 0, packA);
    insPack.run(3, 0, packT);

    const insPara = db.prepare('INSERT INTO canon_paragraphs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    insPara.run(1, 's0101m.mul', 0, 5, '5', 5, 5, null, 's0101m.mul', 0, '5', 's0101a.att', 0, '5', 's0101t.tik', 0, '5');
    insPara.run(2, 's0101a.att', 0, 10, '5', 5, 5, null, 's0101m.mul', 0, '5', 's0101a.att', 0, '5', 's0101t.tik', 0, '5');
    insPara.run(3, 's0101t.tik', 0, 20, '5', 5, 5, null, 's0101m.mul', 0, '5', 's0101a.att', 0, '5', 's0101t.tik', 0, '5');

    const engine = new BoldLinkedEngine({
      dbTipitaka: db,
      tipiDbPath: tipiPath,
      dbDir: dir,
      getPaliSentDb: () => null,
      translationEngine: null,
    });

    // Forward links from Mula ch0 p5
    const mLinks = engine.getLinksForChapter('s0101m.mul', 0);
    const p5ByLine = mLinks.paragraphs['5'].by_line;
    // Inflection: `samayo` matches `samayaṃ` on line 1; `ayaṃ` does NOT false-match inside `samayaṃ`
    assert.ok(p5ByLine['1'].some((l) => l.word === 'samayo' && l.target_book === 's0101a.att' && l.target_line_id === 1));
    assert.equal(p5ByLine['1'].some((l) => l.word === 'ayaṃ'), false);
    // Tika `viharatī` matches `viharati` on line 1 via vowelVariants with target_line_id=1
    assert.ok(p5ByLine['1'].some((l) => l.word === 'viharatī' && l.target_book === 's0101t.tik' && l.target_line_id === 1));
    // Multi-word phrase with `[anubaddhā (ka. sī. pī.)]` editorial note stripped matches line 2
    assert.ok(p5ByLine['2'].some((l) => l.word === 'bhagavantaṃ piṭṭhito piṭṭhito anubandhā hontī' && l.target_line_id === 2));

    // Dual Tika reverse links: `viharatī` links to Mula p5 line 1; `kālo` links to Attha p10 line 1
    const tLinks = engine.getLinksForChapter('s0101t.tik', 0);
    const p20ByLine = tLinks.paragraphs['20'].by_line;
    assert.ok(p20ByLine['1'].some((l) => l.word === 'viharatī' && l.target_book === 's0101m.mul' && l.target_line_id === 1 && l.is_source === true));
    assert.ok(p20ByLine['2'].some((l) => l.word === 'kālo' && l.target_book === 's0101a.att' && l.target_line_id === 1 && l.is_source === true));

    engine.boldDb?.close();
  } finally {
    try { db.close(); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('multi-paragraph para_num resolution, CST phrase/hyphen/ti/pe normalization, no bogus line-1 fallback, and boundary-safe preview highlighting', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bold-linked-multipara-'));
  const dbPath = path.join(dir, 'tipitaka.db');
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE books (id INTEGER PRIMARY KEY, code TEXT UNIQUE, title TEXT, nikaya TEXT, category TEXT);
      CREATE TABLE chapters (id INTEGER PRIMARY KEY, book_id INTEGER, book_code TEXT, chapter_index INTEGER, title TEXT, html TEXT);
      CREATE TABLE chapter_text_pack (book_id INTEGER NOT NULL, chapter_index INTEGER NOT NULL, data_z BLOB NOT NULL, PRIMARY KEY (book_id, chapter_index));
      CREATE TABLE canon_paragraphs (
        global_id INTEGER PRIMARY KEY, book_code TEXT, chapter_index INTEGER, para_index INTEGER,
        para_num TEXT, para_first INTEGER, para_last INTEGER, pali_text TEXT,
        mula_book TEXT, mula_chapter INTEGER, mula_para TEXT,
        attha_book TEXT, attha_chapter INTEGER, attha_para TEXT,
        tika_book TEXT, tika_chapter INTEGER, tika_para TEXT
      );
      INSERT INTO books VALUES
        (1, 's0101m.mul', 'Mula', 'digha', 'mūla'),
        (2, 's0101a.att', 'Attha', 'digha', 'aṭṭhakathā'),
        (3, 's0101t.tik', 'Tika', 'digha', 'ṭīkā');
      INSERT INTO chapters VALUES
        (1, 1, 's0101m.mul', 0, 'M0', ''),
        (2, 2, 's0101a.att', 0, 'A0', ''),
        (3, 3, 's0101t.tik', 0, 'T0', '');
    `);

    const insPack = db.prepare('INSERT INTO chapter_text_pack VALUES (?, ?, ?)');
    insPack.run(1, 0, zlib.deflateSync(Buffer.from(JSON.stringify([
      [5, null, [[1, 'Addhānamaggappaṭipanno hoti.']]],
    ]))));
    insPack.run(2, 0, zlib.deflateSync(Buffer.from(JSON.stringify([
      [20, null, [[1, 'Samena vuttanti.']]],
      [21, null, [[1, '‘ mayā ’ ti atthe sati.']]],
      [22, null, [
        [1, 'Intro line.'],
        [2, '<b>Me</b> -saddo tiādīsu.'],
        [3, 'Evametaṃ bhagavā, evametaṃ sugatā.'],
        [4, 'Evaṃ te bhikkhave upadese.'],
      ]],
    ]))));
    insPack.run(3, 0, zlib.deflateSync(Buffer.from(JSON.stringify([
      [30, null, [
        [1, '<b>Me saddo</b> tīsu atthesu dissatīti.'],
        [2, '<b>Evametaṃ bhagavā evametaṃ sugatā</b>ti vacanaṃ.'],
        [3, '<b>Mayāti atthe satī</b>ti āha.'],
        [4, '<b>Paṭipanno hotī</b>ti gacchati.'],
        [5, '<b>Evaṃ te pe upadese</b>ti saṃkhepo.'],
        [6, '<b>Sambandho</b>ti anukkamena.'],
      ]],
    ]))));

    const insCp = db.prepare('INSERT INTO canon_paragraphs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    insCp.run(1, 's0101m.mul', 0, 5, '1', 1, 1, null, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1');
    // Attha p20, p21, p22 all share para_num='1' (like multi-paragraph Mula/Attha sections)
    insCp.run(2, 's0101a.att', 0, 20, '1', 1, 1, null, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1');
    insCp.run(3, 's0101a.att', 0, 21, '1', 1, 1, null, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1');
    insCp.run(4, 's0101a.att', 0, 22, '1', 1, 1, null, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1');
    insCp.run(5, 's0101t.tik', 0, 30, '1', 1, 1, null, 's0101m.mul', 0, '1', 's0101a.att', 0, '1', 's0101t.tik', 0, '1');

    const engine = new BoldLinkedEngine({
      dbTipitaka: db,
      tipiDbPath: dbPath,
      dbDir: dir,
      getPaliSentDb: () => null,
      translationEngine: null,
    });
    engine.ensureBoldDb();

    const tLinks = engine.getLinksForChapter('s0101t.tik', 0);
    const p30ByLine = tLinks.paragraphs['30'].by_line;

    // (a) Multi-paragraph para_num resolves to p22 line 2, NOT limited to first para_index=20
    assert.ok(p30ByLine['1'].some((l) => l.word === 'me saddo' && l.target_book === 's0101a.att' && l.target_para_index === 22 && l.target_line_id === 2));
    // (c) Comma-stripped multi-word phrase matches p22 line 3
    assert.ok(p30ByLine['2'].some((l) => l.word === 'evametaṃ bhagavā evametaṃ sugatā' && l.target_book === 's0101a.att' && l.target_para_index === 22 && l.target_line_id === 3));
    // (c) `‘ mayā ’ ti` normalized spacing matches `mayāti atthe satī` on p21 line 1
    assert.ok(p30ByLine['3'].some((l) => l.word === 'mayāti atthe satī' && l.target_book === 's0101a.att' && l.target_para_index === 21 && l.target_line_id === 1));
    // (c) Compound-initial multi-word hit `paṭipanno hotī` matches Mula `addhānamaggappaṭipanno hoti`
    assert.ok(p30ByLine['4'].some((l) => l.word === 'paṭipanno hotī' && l.target_book === 's0101m.mul' && l.target_para_index === 5 && l.target_line_id === 1));
    // (c) `pe` ellipsis matches `Evaṃ te bhikkhave upadese` on p22 line 4
    assert.ok(p30ByLine['5'].some((l) => l.word === 'evaṃ te pe upadese' && l.target_book === 's0101a.att' && l.target_para_index === 22 && l.target_line_id === 4));
    // (b) Commentary-only term `sambandho` must NOT emit a bogus forced line-1 link
    assert.equal((p30ByLine['6'] || []).length, 0);

    // (d) Preview highlighting: paraHtml has `<b>me</b>`, target line is `Samena vuttanti.`,
    // word is `samena` -> must NOT highlight `me` inside `Samena`, and multi-para `paraNum` finds p21 for `mayāti atthe satī`
    const prev1 = engine.getLinkedPreview({
      book: 's0101a.att',
      chapter: 0,
      paraIndex: 20,
      lineId: 1,
      word: 'samena',
    });
    assert.ok(prev1 && prev1.lines.length >= 1);
    const targetLine1 = prev1.lines.find((l) => l.is_target);
    assert.ok(targetLine1);
    assert.ok(!targetLine1.pali_html.includes('Sa<b>me</b>na'), `Unexpected mid-word bold in: ${targetLine1.pali_html}`);
    assert.ok(targetLine1.pali_html.includes('<b>Samena</b>'), `Expected whole word bold in: ${targetLine1.pali_html}`);

    const prev2 = engine.getLinkedPreview({
      book: 's0101a.att',
      chapter: 0,
      paraNum: '1',
      word: 'mayāti atthe satī',
    });
    assert.ok(prev2 && prev2.target_para_index === 21 && prev2.target_line_id === 1);

    engine.boldDb?.close();
  } finally {
    try { db.close(); } catch (_) {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
