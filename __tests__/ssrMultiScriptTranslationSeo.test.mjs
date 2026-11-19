import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transform } = require('sucrase');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function compileModule(relPath, stubs = {}) {
  const fullPath = path.resolve(rootDir, relPath);
  const src = fs.readFileSync(fullPath, 'utf8');
  const { code } = transform(src, {
    transforms: ['jsx', 'imports'],
    filePath: fullPath,
  });

  const mod = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.prototype.hasOwnProperty.call(stubs, specifier)) {
      return stubs[specifier];
    }
    return require(specifier);
  };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', code);
  fn(mod.exports, localRequire, mod, fullPath, path.dirname(fullPath));
  return mod.exports;
}

const catalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'server_api', 'cst_books_catalog.json'), 'utf8'));
const chapters = JSON.parse(fs.readFileSync(path.join(rootDir, 'server_api', 'chapters_catalog.json'), 'utf8'));
const chapMap = new Map();
for (const ch of chapters) {
  if (!chapMap.has(ch.book_code)) chapMap.set(ch.book_code, []);
  chapMap.get(ch.book_code).push(ch);
}
for (const list of chapMap.values()) {
  list.sort((a, b) => (a.chapter_index ?? 0) - (b.chapter_index ?? 0));
}

const transliterate = compileModule('services/transliterate.js');
const seoMod = compileModule('services/seoMetadata.js', {
  './transliterate.js': transliterate,
});

const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const BCP47_RE = /^(?:x-default|[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2})?)$/;

test('All 217 books x 17 Pali scripts & 217 books x 23 translations have 100% unique titles (>=42), descriptions (110-160), self-canonicals, and valid bidirectional hreflang', () => {
  const seenTitles = new Map();
  const seenDescs = new Map();
  const seenCanonicals = new Set();

  const bookEntries = Object.entries(catalog);
  assert.equal(bookEntries.length, 217);
  assert.equal(seoMod.PALI_SCRIPT_LIST.length, 16);
  assert.equal(seoMod.TRANSLATION_LANGS.length, 23);

  const checkMeta = (label, meta, expectedCanonicalPath, expectedInLang) => {
    assert.ok(meta.title.length >= 42, `Title too short for ${label}: "${meta.title}" (${meta.title.length})`);
    assert.ok(!LONE_SURROGATE_RE.test(meta.title), `Broken UTF-16 surrogate in title for ${label}`);
    assert.ok(!seenTitles.has(meta.title), `Duplicate title: ${label} vs ${seenTitles.get(meta.title)} ("${meta.title}")`);
    seenTitles.set(meta.title, label);

    assert.ok(
      meta.description.length >= 110 && meta.description.length <= 160,
      `Description out of [110, 160] for ${label}: len=${meta.description.length} ("${meta.description}")`
    );
    assert.ok(!LONE_SURROGATE_RE.test(meta.description), `Broken UTF-16 surrogate in description for ${label}`);
    assert.ok(!seenDescs.has(meta.description), `Duplicate description: ${label} vs ${seenDescs.get(meta.description)}`);
    seenDescs.set(meta.description, label);

    assert.equal(meta.canonicalPath, expectedCanonicalPath, `Unexpected canonicalPath for ${label}`);
    assert.equal(meta.canonicalUrl, `${seoMod.SITE_URL}${expectedCanonicalPath}`);
    assert.ok(!seenCanonicals.has(meta.canonicalUrl), `Duplicate canonical URL for ${label}`);
    seenCanonicals.add(meta.canonicalUrl);
    assert.equal(meta.inLanguage, expectedInLang, `Unexpected inLanguage for ${label}`);

    // Bidirectional hreflang validation
    const langs = meta.alternatesLanguages;
    const keys = Object.keys(langs);
    assert.equal(keys.length, 41, `Expected 41 hreflang keys (x-default + pi + 16 scripts + 23 translations) for ${label}`);
    assert.equal(langs['x-default'], `${seoMod.SITE_URL}/book/${meta.canonicalPath.split('/').pop()}`);
    assert.equal(langs.bn, langs.bn && langs.bn.includes('/translation/be/') ? langs.bn : '');
    assert.ok(!Object.prototype.hasOwnProperty.call(langs, 'be'), 'Bengali must use BCP-47 "bn", never "be"');
    assert.ok(langs.my && langs.my.includes('/translation/my/'), 'Burmese must map "my" -> /translation/my/...');
    assert.ok(langs['my-MM'] && langs['my-MM'].includes('/translation/my_nissaya/'), 'Myanmar Nissaya must map to distinct BCP-47 "my-MM"');
    assert.ok(Object.values(langs).includes(meta.canonicalUrl), `hreflang must self-reference ${meta.canonicalUrl}`);
    for (const k of keys) {
      assert.match(k, BCP47_RE, `Invalid BCP-47 hreflang tag "${k}" for ${label}`);
      assert.ok(!langs[k].includes('?l='), `Non-canonical ?l= URL in hreflang for ${label}: ${langs[k]}`);
    }
  };

  for (const [code, entry] of bookEntries) {
    const chs = chapMap.get(code) || [];

    // Roman Pali
    const rom = seoMod.buildBookSeoMetadata(code, entry, chs);
    checkMeta(`roman:${code}`, rom, `/book/${code}`, 'pi');
    const romAltSnapshot = JSON.stringify(rom.alternatesLanguages);

    // 16 non-Roman Pali scripts
    for (const sc of seoMod.PALI_SCRIPT_LIST) {
      const sm = seoMod.buildBookSeoMetadata(code, entry, chs, { scriptPrefix: sc.code });
      assert.equal(JSON.stringify(sm.alternatesLanguages), romAltSnapshot, `Non-bidirectional hreflang on ${sc.code}.${code}`);
      // Override x-default check helper expects book code at end, so verify explicitly
      assert.equal(sm.alternatesLanguages['x-default'], `${seoMod.SITE_URL}/book/${code}`);
      assert.equal(sm.alternatesLanguages[sc.bcp47], `${seoMod.SITE_URL}/book/${sc.code}.${code}`);
      assert.ok(sm.title.length >= 42);
      assert.ok(sm.description.length >= 110 && sm.description.length <= 160);
      assert.ok(!LONE_SURROGATE_RE.test(sm.title) && !LONE_SURROGATE_RE.test(sm.description));
      assert.ok(!seenTitles.has(sm.title), `Duplicate title on ${sc.code}.${code}`);
      seenTitles.set(sm.title, `script:${sc.code}:${code}`);
      assert.ok(!seenDescs.has(sm.description), `Duplicate desc on ${sc.code}.${code}`);
      seenDescs.set(sm.description, `script:${sc.code}:${code}`);
      assert.equal(sm.canonicalPath, `/book/${sc.code}.${code}`);
      assert.equal(sm.inLanguage, sc.bcp47);
    }

    // 23 modern translations
    for (const tr of seoMod.TRANSLATION_LANGS) {
      const tm = seoMod.buildBookSeoMetadata(code, entry, chs, { translationLang: tr.code });
      assert.equal(JSON.stringify(tm.alternatesLanguages), romAltSnapshot, `Non-bidirectional hreflang on /translation/${tr.code}/${code}`);
      assert.equal(tm.alternatesLanguages[tr.hreflang], `${seoMod.SITE_URL}/translation/${tr.code}/${code}`);
      checkMeta(`trans:${tr.code}:${code}`, tm, `/translation/${tr.code}/${code}`, tr.bcp47);
    }
  }

  assert.equal(seenTitles.size, 217 * 40);
  assert.equal(seenDescs.size, 217 * 40);
});

test('All 2,695 chapters (including duplicate chapter titles) produce unique titles, descriptions, JSON-LD Chapter, and unique breadcrumb URLs', () => {
  const seenTitles = new Map();
  const seenDescs = new Map();
  const sampleScripts = ['hi', 'my', 'si', 'brah'];
  const sampleLangs = ['en', 'vi', 'hi', 'be', 'my_nissaya'];

  for (const [code, entry] of Object.entries(catalog)) {
    const chs = chapMap.get(code) || [];
    for (let i = 1; i <= chs.length; i++) {
      const variants = [
        { opts: { chapterNum: i }, path: `/book/${code}/${i}`, inLang: 'pi' },
        ...sampleScripts.map((sc) => ({
          opts: { scriptPrefix: sc, chapterNum: i },
          path: `/book/${sc}.${code}/${i}`,
          inLang: seoMod.getPaliScriptMeta(sc).bcp47,
        })),
        ...sampleLangs.map((lang) => ({
          opts: { translationLang: lang, chapterNum: i },
          path: `/translation/${lang}/${code}/${i}`,
          inLang: seoMod.getTranslationLangMeta(lang).bcp47,
        })),
      ];

      for (const v of variants) {
        const m = seoMod.buildBookSeoMetadata(code, entry, chs, v.opts);
        assert.ok(m.title.length >= 42, `Short chapter title for ${v.path}: ${m.title}`);
        assert.ok(m.description.length >= 110 && m.description.length <= 160, `Bad chapter desc len (${m.description.length}) for ${v.path}`);
        assert.ok(!seenTitles.has(m.title), `Duplicate chapter title for ${v.path} vs ${seenTitles.get(m.title)}`);
        seenTitles.set(m.title, v.path);
        assert.ok(!seenDescs.has(m.description), `Duplicate chapter desc for ${v.path} vs ${seenDescs.get(m.description)}`);
        seenDescs.set(m.description, v.path);
        assert.equal(m.canonicalPath, v.path);
        assert.equal(m.inLanguage, v.inLang);
        assert.equal(m.alternatesLanguages['x-default'], `${seoMod.SITE_URL}/book/${code}/${i}`);
      }
    }
  }

  // Validate Book + Chapter JSON-LD & BreadcrumbList uniqueness on DN 2 (s0102m.mul)
  const dn2Chaps = chapMap.get('s0102m.mul');
  for (const opts of [
    {},
    { scriptPrefix: 'hi' },
    { translationLang: 'vi' },
    { chapterNum: 9 },
    { scriptPrefix: 'hi', chapterNum: 9 },
    { translationLang: 'vi', chapterNum: 9 },
  ]) {
    const seo = seoMod.buildBookSeoMetadata('s0102m.mul', catalog['s0102m.mul'], dn2Chaps, opts);
    const { primaryJsonLd, breadcrumbJsonLd } = seoMod.buildPageJsonLd('s0102m.mul', catalog['s0102m.mul'], dn2Chaps, seo);

    assert.equal(primaryJsonLd['@type'], opts.chapterNum ? 'Chapter' : 'Book');
    assert.equal(primaryJsonLd.url, seo.canonicalUrl);
    assert.equal(primaryJsonLd.inLanguage, seo.inLanguage);
    if (opts.translationLang) {
      assert.ok(primaryJsonLd.translationOfWork, 'Translation JSON-LD must link translationOfWork');
      assert.equal(primaryJsonLd.translationOfWork.inLanguage, 'pi');
    }

    const bcUrls = breadcrumbJsonLd.itemListElement.map((it) => it.item);
    assert.equal(new Set(bcUrls).size, bcUrls.length, `Duplicate breadcrumb URLs: ${JSON.stringify(bcUrls)}`);
    assert.equal(bcUrls[bcUrls.length - 1], seo.canonicalUrl, 'Final breadcrumb must match canonical URL');
  }
});

test('ssrCatalog route parser validates all valid routes and strictly rejects invalid books, scripts, langs, chapters, and extra segments', () => {
  const ssrCat = compileModule('services/ssrCatalog.js', {
    './transliterate.js': transliterate,
    './seoMetadata.js': seoMod,
  });

  // Valid /book/* routes
  assert.equal(ssrCat.parseBookRouteParams(['s0102m.mul']).valid, true);
  const hiBook = ssrCat.parseBookRouteParams(['hi.s0102m.mul']);
  assert.equal(hiBook.valid, true);
  assert.equal(hiBook.scriptPrefix, 'hi');
  assert.equal(hiBook.scriptId, 'devanagari');
  const ch9 = ssrCat.parseBookRouteParams(['my.s0102m.mul', '9']);
  assert.equal(ch9.valid, true);
  assert.equal(ch9.chapterNum, 9);
  assert.equal(ch9.chapterIndex, 8);

  // Legacy 0-based suffix redirect
  const legacy = ssrCat.parseBookRouteParams(['s0102m.mul8']);
  assert.equal(legacy.valid, false);
  assert.equal(legacy.redirectTo, '/book/s0102m.mul/9');

  // Invalid /book/* routes -> 404
  for (const badSlug of [
    [],
    ['invalid.mul'],
    ['xx.s0102m.mul'],
    ['ro.s0102m.mul'],
    ['HI.s0102m.mul'],
    ['s0102m.mul', '0'],
    ['s0102m.mul', '-1'],
    ['s0102m.mul', '01'],
    ['s0102m.mul', 'abc'],
    ['s0102m.mul', '999'],
    ['s0102m.mul', '9', 'extra'],
  ]) {
    const res = ssrCat.parseBookRouteParams(badSlug);
    assert.equal(res.valid, false, `Expected invalid for /book/${badSlug.join('/')}`);
    assert.equal(res.redirectTo, undefined);
  }

  // Valid /translation/* routes
  const viBook = ssrCat.parseTranslationRouteParams(['vi', 's0102m.mul']);
  assert.equal(viBook.valid, true);
  assert.equal(viBook.translationLang, 'vi');
  assert.equal(viBook.chapterNum, null);
  const viCh9 = ssrCat.parseTranslationRouteParams(['vi', 's0102m.mul', '9']);
  assert.equal(viCh9.valid, true);
  assert.equal(viCh9.chapterNum, 9);
  assert.equal(viCh9.chapterIndex, 8);
  assert.equal(ssrCat.parseTranslationRouteParams(['my_nissaya', 's0102m.mul']).valid, true);

  // Invalid /translation/* routes -> 404
  for (const badSlug of [
    [],
    ['vi'],
    ['xx', 's0102m.mul'],
    ['VI', 's0102m.mul'],
    ['pali', 's0102m.mul'],
    ['bn', 's0102m.mul'],
    ['vi', 'invalid.mul'],
    ['vi', 'hi.s0102m.mul'],
    ['vi', 's0102m.mul', '0'],
    ['vi', 's0102m.mul', '999'],
    ['vi', 's0102m.mul', '9', 'extra'],
  ]) {
    assert.equal(
      ssrCat.parseTranslationRouteParams(badSlug).valid,
      false,
      `Expected invalid for /translation/${badSlug.join('/')}`
    );
  }

  // Query param normalization
  assert.equal(ssrCat.resolveQueryTranslationLang({ l: 'vi' }), 'vi');
  assert.equal(ssrCat.resolveQueryTranslationLang({ lang: 'vietnamese' }), 'vi');
  assert.equal(ssrCat.resolveQueryTranslationLang({ db: 'translation_en.db' }), 'en');
  assert.equal(ssrCat.resolveQueryTranslationLang({ l: 'pali' }), null);
  assert.equal(ssrCat.resolveQueryTranslationLang({ l: 'bogus' }), null);
});

test('Client route parser handles /translation/{lang}/{book}/{ch}, /book/{script}.{book}/{ch}, ?l={lang}, and hash anchors', () => {
  const parserMod = compileModule('services/clientRouteParser.js', {
    '../context/TabContext': {
      normalizeLangCode: (v) => {
        const s = String(v || '').toLowerCase().replace(/^(?:fts_)?(?:translation_)?/, '').replace(/\.db$/, '');
        if (s === 'vietnamese') return 'vi';
        return s;
      },
    },
  });

  const tBook = parserMod.parseClientRouteLocation({ pathname: '/translation/vi/s0102m.mul' });
  assert.equal(tBook.bookParam, 's0102m.mul');
  assert.equal(tBook.effectiveLang, 'vi');
  assert.equal(tBook.fromTranslationRoute, true);
  assert.equal(tBook.chapterParam, null);

  const tChap = parserMod.parseClientRouteLocation({
    pathname: '/translation/hi/s0102m.mul/9',
    hash: '#para372',
  });
  assert.equal(tChap.bookParam, 's0102m.mul');
  assert.equal(tChap.effectiveLang, 'hi');
  assert.equal(tChap.chapterParam, '9');
  assert.equal(tChap.explicitParaNum, '372');
  assert.equal(tChap.fromTranslationRoute, true);

  const legacyQ = parserMod.parseClientRouteLocation({
    pathname: '/book/s0102m.mul',
    search: '?l=vi',
  });
  assert.equal(legacyQ.bookParam, 's0102m.mul');
  assert.equal(legacyQ.effectiveLang, 'vi');
  assert.equal(legacyQ.fromTranslationRoute, false);

  const scriptChap = parserMod.parseClientRouteLocation({
    pathname: '/book/hi.s0102m.mul/9',
    hash: '#pindex-1341',
  });
  assert.equal(scriptChap.bookParam, 'hi.s0102m.mul');
  assert.equal(scriptChap.chapterParam, '9');
  assert.equal(scriptChap.explicitParaIndex, 1341);

  const tabCtxSrc = fs.readFileSync(path.join(rootDir, 'context', 'TabContext.jsx'), 'utf8');
  assert.match(tabCtxSrc, /pathname\.startsWith\('\/translation\/'\)/, 'hasDeepLinkInLocation must recognize /translation/ routes');
  assert.match(tabCtxSrc, /\bbn:\s*'be'/, 'TabContext LANG_KEY_TO_CODE must map BCP-47 bn -> be');
  assert.match(tabCtxSrc, /delete tabTransRouteLangRef\.current\[bookCode\]/, 'closeTab must clear tabTransRouteLangRef');
  assert.match(tabCtxSrc, /updateSetting\('translations',\s*\(prevTrans\)\s*=>/, 'openBook must use functional updater so saved translations are never wiped by stale closure');

  const themeCtxSrc = fs.readFileSync(path.join(rootDir, 'context', 'ThemeSettingsContext.jsx'), 'utf8');
  assert.match(themeCtxSrc, /typeof value === 'function'/, 'ThemeSettingsContext.updateSetting must support functional updaters');
  assert.match(themeCtxSrc, /preLoadOverridesRef/, 'ThemeSettingsContext must preserve pre-load deep-link overrides on localStorage hydration');

  const layoutSrc = fs.readFileSync(path.join(rootDir, 'app', 'layout.js'), 'utf8');
  assert.match(layoutSrc, /\/noindex\/i\.test/, 'layout.js canonical stabilizer must not mutate noindex/404 pages');
});

test('getSsrChapterContent reads real Pali scripts & translations from SQLite and SsrBookArticle renders clean semantic HTML', async () => {
  const {
    getSsrChapterContent,
    getAvailableTranslationLangs,
    getTranslatedChapterIndices,
  } = await import(path.join(rootDir, 'services', 'ssrContent.js'));
  const SsrBookArticle = compileModule('components/SsrBookArticle.jsx', {
    react: React,
    '../services/transliterate.js': transliterate,
    '../services/seoMetadata.js': seoMod,
  }).default;

  const dn2Chaps = chapMap.get('s0102m.mul');

  // 1. Devanagari Pali chapter 9 (verify true heading classification & data-para preservation)
  const hiPali = await getSsrChapterContent({
    bookCode: 's0102m.mul',
    chapterIndex: 8,
    scriptId: 'devanagari',
    maxParagraphs: 10,
  });
  assert.ok(hiPali && hiPali.source === 'sqlite' && hiPali.paragraphs.length > 0);
  assert.match(hiPali.paragraphs.map((p) => p.pali).join(' '), /महासतिपट्ठानसुत्तं/);
  assert.match(hiPali.paragraphs.map((p) => p.pali).join(' '), /एवं मे सुतं/);
  const p1340 = hiPali.paragraphs.find((p) => p.paraIndex === 1340);
  const p1341 = hiPali.paragraphs.find((p) => p.paraIndex === 1341);
  const p1342 = hiPali.paragraphs.find((p) => p.paraIndex === 1342);
  const p1344 = hiPali.paragraphs.find((p) => p.paraIndex === 1344);
  assert.equal(p1340?.isHeading, true, 'Chapter title p1340 must be a heading');
  assert.equal(p1341?.isHeading, false, 'Bodytext p1341 must not be a heading');
  assert.equal(p1341?.paraNum, '372', 'Bodytext p1341 must preserve data-para=372');
  assert.equal(p1342?.isHeading, true, 'Subhead p1342 (Uddeso) must be a heading');
  assert.equal(p1344?.isHeading, false, 'Bodytext p1344 (Katame cattaro...) must NOT be falsely marked as heading');

  // 2. Myanmar Pali chapter 9
  const myPali = await getSsrChapterContent({
    bookCode: 's0102m.mul',
    chapterIndex: 8,
    scriptId: 'myanmar',
    maxParagraphs: 10,
  });
  assert.ok(myPali && myPali.paragraphs.length > 0);
  assert.match(myPali.paragraphs.map((p) => p.pali).join(' '), /မဟာသတိပဋ္ဌာနသုတ္တံ/);

  // 3. Vietnamese translation chapter 9
  const viTrans = await getSsrChapterContent({
    bookCode: 's0102m.mul',
    chapterIndex: 8,
    translationLang: 'vi',
    maxParagraphs: 10,
  });
  assert.ok(viTrans && viTrans.translatedCount > 0);
  assert.match(viTrans.paragraphs.map((p) => p.translation).join(' '), /Như vầy tôi đã nghe/);

  // 4. Partial-coverage book availability & Dhammapada Myanmar Nissaya Ch. 0 fallback
  const dn1AttLangs = await getAvailableTranslationLangs('s0101a.att', null);
  assert.ok(dn1AttLangs instanceof Set, 'Should inspect local SQLite coverage');
  assert.equal(dn1AttLangs.has('lo'), false, 's0101a.att has no Lao translation in translation_lo.db');
  assert.equal(dn1AttLangs.has('vi'), true, 's0101a.att has Vietnamese translation');
  const dn1AttRomSeo = seoMod.buildBookSeoMetadata('s0101a.att', catalog['s0101a.att'], chapMap.get('s0101a.att'), {
    availableTranslationLangs: dn1AttLangs,
  });
  const dn1AttViSeo = seoMod.buildBookSeoMetadata('s0101a.att', catalog['s0101a.att'], chapMap.get('s0101a.att'), {
    translationLang: 'vi',
    availableTranslationLangs: dn1AttLangs,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(dn1AttRomSeo.alternatesLanguages, 'lo'), false, 'Untranslated lo must be omitted from hreflang');
  assert.equal(JSON.stringify(dn1AttRomSeo.alternatesLanguages), JSON.stringify(dn1AttViSeo.alternatesLanguages), 'Filtered hreflang must remain strictly bidirectional');

  const dhpNissayaChaps = await getTranslatedChapterIndices('s0502m.mul', 'my_nissaya');
  assert.ok(dhpNissayaChaps && dhpNissayaChaps.has(2) && !dhpNissayaChaps.has(0));
  const dhpNissayaRoot = await getSsrChapterContent({
    bookCode: 's0502m.mul',
    chapterIndex: 0,
    translationLang: 'my_nissaya',
    isBookRoot: true,
    maxParagraphs: 10,
  });
  assert.equal(dhpNissayaRoot?.chapterIndex, 2, 'Book root /translation/my_nissaya/s0502m.mul must pick first translated chapter (index 2 / Ch. 3)');
  assert.ok(dhpNissayaRoot?.translatedCount > 0, 'Book root /translation/my_nissaya/s0502m.mul must include real Myanmar Nissaya translations');
  const dhpSeo = seoMod.buildBookSeoMetadata('s0502m.mul', catalog['s0502m.mul'], chapMap.get('s0502m.mul'), {
    translationLang: 'my_nissaya',
  });
  const dhpHtml = renderToStaticMarkup(
    React.createElement(SsrBookArticle, {
      bookCode: 's0502m.mul',
      entry: catalog['s0502m.mul'],
      chaptersForBook: chapMap.get('s0502m.mul'),
      seo: dhpSeo,
      chapterContent: dhpNissayaRoot,
      availableChapterIndices: dhpNissayaChaps,
    })
  );
  assert.match(dhpHtml, /\(Ch\. 3\)/, 'SsrBookArticle must show actual rendered chapter number (Ch. 3)');
  assert.match(dhpHtml, /href="\/translation\/my_nissaya\/s0502m\.mul\/3"/, 'Translated Ch. 3 must link to /translation/my_nissaya/...');
  assert.match(dhpHtml, /href="\/book\/s0502m\.mul\/1"/, 'Untranslated Ch. 1 must link to Roman /book/s0502m.mul/1 instead of noindex /translation/my_nissaya/.../1');

  // Render semantic SSR article for Vietnamese ch 9 & assert accessibility + zero inline styles + no <main>
  const viSeo = seoMod.buildBookSeoMetadata('s0102m.mul', catalog['s0102m.mul'], dn2Chaps, {
    translationLang: 'vi',
    chapterNum: 9,
  });
  const html = renderToStaticMarkup(
    React.createElement(SsrBookArticle, {
      bookCode: 's0102m.mul',
      entry: catalog['s0102m.mul'],
      chaptersForBook: dn2Chaps,
      seo: viSeo,
      chapterContent: viTrans,
    })
  );

  assert.equal((html.match(/<h1\b/g) || []).length, 1, 'SsrBookArticle must emit exactly one <h1>');
  assert.ok(!/<main\b/i.test(html), 'SsrBookArticle must not nest a duplicate <main> landmark');
  assert.ok(!/\sstyle="/i.test(html), 'SsrBookArticle should use CSS classes rather than inline styles');
  assert.match(html, /lang="vi"/);
  assert.match(html, /lang="pi"/);
  assert.match(html, /Như vầy tôi đã nghe/);
  assert.match(html, /href="\/translation\/vi\/s0102m\.mul\/8"/, 'Should render prev chapter link');
  assert.match(html, /href="\/translation\/vi\/s0102m\.mul\/10"/, 'Should render next chapter link');
  assert.match(html, /href="\/book\/hi\.s0102m\.mul\/9"/, 'Should link to script transliterations');
  assert.match(html, /href="\/translation\/be\/s0102m\.mul\/9"/, 'Should link to Bengali translation');
  assert.match(html, /hreflang="bn"/i, 'Bengali link must use BCP-47 hreflang="bn"');
});

test('XML Sitemap Index, all 40 child sitemaps, llms.txt, and IndexNow CLI flags pass strict validation', () => {
  const publicDir = path.join(rootDir, 'public');
  const indexXml = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
  const childUrls = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(childUrls.length, 40);

  const globalSeen = new Set();
  for (const childUrl of childUrls) {
    const fname = childUrl.split('/').pop();
    const fpath = path.join(publicDir, fname);
    assert.ok(fs.existsSync(fpath), `Missing child sitemap referenced by index: ${fname}`);
    const stat = fs.statSync(fpath);
    assert.ok(stat.size < 50 * 1024 * 1024, `${fname} exceeds 50MB sitemap limit`);
    const xml = fs.readFileSync(fpath, 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length > 0 && locs.length <= 50000, `${fname} URL count out of bounds: ${locs.length}`);
    for (const u of locs) {
      assert.ok(!u.includes('?l='), `Leaked ?l= query URL in ${fname}: ${u}`);
      assert.ok(!globalSeen.has(u), `Duplicate URL across sitemaps (${fname}): ${u}`);
      globalSeen.add(u);
    }
  }

  // Verify partial languages (lo & my_nissaya) reflect real DB coverage, not blind 217 books
  const loXml = fs.readFileSync(path.join(publicDir, 'sitemap-lang-lo.xml'), 'utf8');
  const loLocs = [...loXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(loLocs.length, 62 + 718, `Expected 780 Lao URLs (62 books + 718 chapters), got ${loLocs.length}`);

  const nissayaXml = fs.readFileSync(path.join(publicDir, 'sitemap-lang-my_nissaya.xml'), 'utf8');
  const nissayaLocs = [...nissayaXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(nissayaLocs.length, 121 + 1518, `Expected 1,639 Myanmar Nissaya URLs, got ${nissayaLocs.length}`);

  // Verify llms.txt & llms-full.txt document clean /translation/{lang}/{book_code} URLs
  const llms = fs.readFileSync(path.join(publicDir, 'llms.txt'), 'utf8');
  const llmsFull = fs.readFileSync(path.join(publicDir, 'llms-full.txt'), 'utf8');
  assert.match(llms, /\/translation\/en\/s0101m\.mul/);
  assert.match(llmsFull, /\/translation\/vi\/s0101m\.mul/);

  // IndexNow --limit & full multi-batch dry-run
  const limitOut = execFileSync(
    'python3',
    [path.join(rootDir, 'scripts', 'submit_indexnow.py'), '--limit', '30', '--dry-run'],
    { encoding: 'utf8' }
  );
  assert.match(limitOut, /URLs to submit\s*:\s*30/);
  assert.match(limitOut, /Batches \(<= 10000\)\s*:\s*1/);

  const fullOut = execFileSync(
    'python3',
    [path.join(rootDir, 'scripts', 'submit_indexnow.py'), '--dry-run'],
    { encoding: 'utf8' }
  );
  assert.match(fullOut, new RegExp(`URLs to submit\\s*:\\s*${globalSeen.size}`));
  assert.match(fullOut, /Batches \(<= 10000\)\s*:\s*12/);
  assert.match(fullOut, /Dry run validated successfully/);
});
