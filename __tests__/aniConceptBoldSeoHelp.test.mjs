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
const serverRequire = createRequire(path.join(rootDir, 'server_api', 'package.json'));
const Database = serverRequire('better-sqlite3');

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

const iconProxy = new Proxy(
  {},
  {
    get: (_, prop) => (props) =>
      React.createElement('svg', { 'data-icon': String(prop), ...props }),
  }
);

// =========================================================================
// Task 1: Ani (AI Nissaya) — Concept Groups, Bold Definitions & Client Agent
// =========================================================================

test('Task 1: aiQueryUnderstanding detects languages, decomposes Concept Groups with Pāḷi+English synonyms, and fixes AN 1 book code', () => {
  const qu = require(path.join(rootDir, 'server_api', 'aiQueryUnderstanding.js'));

  assert.equal(qu.detectLanguage('What does the Buddha teach about mindfulness of breathing?'), 'en');
  assert.equal(qu.detectLanguage('Tìm giúp tôi bài kinh về chánh niệm hơi thở'), 'vi');
  assert.equal(qu.detectLanguage('သတိပဋ္ဌာန် တရားအကြောင်း ရှင်းပြပါ'), 'my');
  assert.equal(qu.detectLanguage('สติปัฏฐานคืออะไร'), 'th');
  assert.equal(qu.detectLanguage('සතිපට්ඨානය යනු කුමක්ද?'), 'si');

  // AN 1 book code must resolve to s0401m.mul (NOT s0401m1.mul)
  const an1Citation = qu.parseCanonicalCitation('AN 1.1');
  assert.ok(an1Citation);
  const an1Resolved = qu.resolveCanonicalCitation(an1Citation.book, an1Citation.num, an1Citation.subNum, null);
  assert.equal(an1Resolved?.book_code, 's0401m.mul');

  // Concept-group extraction on multi-concept question
  const und = qu.heuristicQueryUnderstanding(
    'What does the Buddha teach about mindfulness of breathing leading to liberation?',
    []
  );
  assert.equal(und.detected_language, 'en');
  assert.ok(Array.isArray(und.concept_groups) && und.concept_groups.length >= 2, `Expected >=2 concept_groups, got ${JSON.stringify(und.concept_groups)}`);
  const hasPaliTerms = und.concept_groups.every((g) => Array.isArray(g.pali_terms) && g.pali_terms.length > 0);
  const hasEnglishTerms = und.concept_groups.every((g) => Array.isArray(g.english_keywords) && g.english_keywords.length > 0);
  assert.ok(hasPaliTerms, 'Every concept group must include Pāḷi terms');
  assert.ok(hasEnglishTerms, 'Every concept group must include English keywords');

  // Normalize edge cases: empty / malformed / oversized inputs
  assert.deepEqual(qu.normalizeConceptGroups(null), []);
  assert.deepEqual(qu.normalizeConceptGroups([]), []);
  const norm = qu.normalizeConceptGroups([
    { concept: 'Mindfulness', pali_terms: ['sati', 'sati', ''], pali_stems: ['sati'], english_keywords: ['mindfulness'] },
    { concept: '', pali_terms: [] },
  ]);
  assert.equal(norm.length, 1);
  assert.deepEqual(norm[0].pali_terms, ['sati']);

  // safeParseJsonObject handles fenced JSON and garbage cleanly
  assert.deepEqual(qu.safeParseJsonObject('```json\n{"intent":"term_analysis"}\n```'), { intent: 'term_analysis' });
  assert.equal(qu.safeParseJsonObject('not json at all'), null);
});

test('Task 1: aiController real-DB integration — search_concepts, bold_definitions, commentaries, dictionary splitter, and citation parsing', () => {
  const dbDir = path.join(rootDir, 'server_api', 'db');
  const tipitakaDbPath = path.join(dbDir, 'tipitaka.db');
  const ftsDbPath = path.join(dbDir, 'fts_tipitaka.db');
  const boldDbPath = path.join(dbDir, 'bold_definitions.db');

  assert.ok(fs.existsSync(tipitakaDbPath), 'tipitaka.db must exist');
  assert.ok(fs.existsSync(ftsDbPath), 'fts_tipitaka.db must exist');
  assert.ok(fs.existsSync(boldDbPath), 'bold_definitions.db must exist');

  const db = new Database(tipitakaDbPath, { readonly: true });
  const dbFts = new Database(ftsDbPath, { readonly: true });
  const aiCtrl = require(path.join(rootDir, 'server_api', 'aiController.js'));

  try {
    aiCtrl.initAiController({
      db,
      dbFts,
      resolveDbPath: (filename) => path.join(dbDir, filename),
    });

    // 1. Multi-concept boolean intersection search (Mindfulness ∩ Breathing)
    const conceptRes = aiCtrl.aiSearchConcepts({
      concept_groups: [
        { concept: 'Mindfulness', pali_terms: ['sati', 'satipaṭṭhāna'], pali_stems: ['sati'], english_keywords: ['mindfulness'] },
        { concept: 'Breathing', pali_terms: ['ānāpāna', 'assāsa', 'passāsa'], pali_stems: ['ānāpān', 'assās'], english_keywords: ['breathing', 'breath'] },
      ],
      langs: ['en'],
      limit: 8,
    });
    assert.equal(conceptRes.success, true);
    assert.ok(conceptRes.results.length > 0, 'search_concepts must return intersecting passages');
    assert.ok(
      conceptRes.results[0].matched_concepts.length >= 2,
      `Top hit should intersect both concepts, got: ${JSON.stringify(conceptRes.results[0])}`
    );
    assert.match(conceptRes.results[0].citation_ref, /^\[[a-z0-9_.-]+:c\d+:p\d+\]$/i);
    assert.match(conceptRes.results[0].citation_url, /^https:\/\/tipitakapali\.org\/book\//);

    // Edge cases for search_concepts: empty & non-matching fallback
    const emptyConcepts = aiCtrl.aiSearchConcepts({ concept_groups: [] });
    assert.equal(emptyConcepts.success, true);
    assert.equal(emptyConcepts.count, 0);
    assert.deepEqual(emptyConcepts.results, []);

    const sparseConcepts = aiCtrl.aiSearchConcepts({
      concept_groups: [
        { concept: 'Mindfulness', pali_terms: ['sati'], english_keywords: ['mindfulness'] },
        { concept: 'Impossible', pali_terms: ['zzzznonexistentpaliword999'], english_keywords: ['zzzznonexistentenglish999'] },
      ],
      langs: ['en'],
      limit: 5,
    });
    assert.equal(sparseConcepts.success, true);
    assert.ok(sparseConcepts.results.length > 0, 'Should gracefully fall back to single-group hits when full intersection is empty');

    // 2. Canonical Bold Definitions (real 387K-row bold_definitions.db)
    const boldRes = aiCtrl.aiGetBoldDefinitions({ word: 'mettā', langs: ['en'], limit: 6 });
    assert.equal(boldRes.success, true);
    assert.ok(boldRes.definitions.length > 0, 'Should find canonical bold definitions for mettā');
    const firstDef = boldRes.definitions[0];
    assert.ok(firstDef.pali_definition.includes('**'), 'Bold definition should format lemma in Markdown bold');
    assert.match(firstDef.citation_ref, /^\[[a-z0-9_.-]+:c\d+:p\d+-L\d+\]$/i);
    assert.match(firstDef.citation_url, /^https:\/\/tipitakapali\.org\/book\//);

    // Alias parameter `term` and empty input edge case
    const boldViaTerm = aiCtrl.aiGetBoldDefinitions({ term: 'sati', langs: ['en'], limit: 3 });
    assert.equal(boldViaTerm.success, true);
    assert.ok(boldViaTerm.definitions.length > 0);
    assert.equal(aiCtrl.aiGetBoldDefinitions({ word: '' }).success, false);

    // Batch bold definitions with `terms` alias
    const batchBold = aiCtrl.aiGetBoldDefinitionsBatch({ terms: ['sati', 'samādhi'], langs: ['en'], limit: 2 });
    assert.equal(batchBold.success, true);
    assert.ok(batchBold.definitions.length >= 2);

    // 3. Commentaries bug fix check (atthaBook block must NOT use tikaBook)
    const commRes = aiCtrl.aiGetCommentaries({ book_code: 's0101m.mul', chapter_index: 0, para_num: '1' });
    assert.equal(commRes.success, true);
    assert.ok(Array.isArray(commRes.atthakatha) && commRes.atthakatha.length > 0, 'Should retrieve Aṭṭhakathā for s0101m.mul §1');
    assert.match(commRes.atthakatha[0].citation_url, /^https:\/\/tipitakapali\.org\/book\/s0101a\.att/);

    // 4. Dictionary lookup (exact + empty input safety)
    const dictRes = aiCtrl.aiGetDictionary({ word: 'mettā' });
    assert.equal(dictRes.success, true);
    assert.ok(dictRes.entries.length > 0);
    assert.equal(aiCtrl.aiGetDictionary({ word: '' }).success, false);

    // 5. Citation parser handles single para, para ranges (-pZ and -Z), sentence lines (-LZ, –LZ, :LZ)
    // Note: parseCitations sorts canonically (s0101m.mul before s0102m.mul)
    const parsedCites = aiCtrl.parseCitations(
      'See [s0102m.mul:c8:p373], range [s0102m.mul:c8:p374-p376], sentence [s0101m.mul:c0:p1-L2], en-dash [s0101m.mul:c0:p1–L3], colon [s0101m.mul:c0:p2:L1].'
    );
    assert.equal(parsedCites.length, 5);
    const rangeCite = parsedCites.find((c) => c.ref === '[s0102m.mul:c8:p374-p376]');
    assert.ok(rangeCite, 'Should parse [s0102m.mul:c8:p374-p376]');
    assert.equal(rangeCite.paraNum, '374');
    assert.equal(rangeCite.paraEnd, 376);
    assert.equal(rangeCite.lineId, null);
    const dashLineCite = parsedCites.find((c) => c.bookCode === 's0101m.mul' && c.lineId === 2);
    assert.ok(dashLineCite && dashLineCite.paraEnd === null);
    const enDashLineCite = parsedCites.find((c) => c.bookCode === 's0101m.mul' && c.lineId === 3);
    assert.ok(enDashLineCite && enDashLineCite.paraEnd === null);
    const colonLineCite = parsedCites.find((c) => c.bookCode === 's0101m.mul' && c.paraIndex === 2 && c.lineId === 1);
    assert.ok(colonLineCite);
  } finally {
    db.close();
    dbFts.close();
  }
});

test('Task 1: Client aiClientAgent exports concept-group & bold-def tools, merges understanding, ranks passages, and renders citation chips', () => {
  const clientAgent = compileModule('services/aiClientAgent.js', {
    './api': { fetchAiEndpoint: async () => ({ ok: false }) },
  });

  const toolNames = clientAgent.kAiToolDeclarations.map((t) => t.name);
  assert.ok(toolNames.includes('search_concepts'), 'Client agent must declare search_concepts');
  assert.ok(toolNames.includes('get_bold_definitions'), 'Client agent must declare get_bold_definitions');
  assert.ok(toolNames.includes('get_bold_definitions_batch'), 'Client agent must declare get_bold_definitions_batch');

  const merged = clientAgent.mergeUnderstandingWithLocal(
    {
      intent: 'doctrinal_explanation',
      detected_language: 'vi',
      concept_groups: [
        { concept: 'Chánh niệm', pali_terms: ['sati'], pali_stems: ['sati'], english_keywords: ['mindfulness'] },
      ],
      key_terms_for_bold_def: ['sati'],
    },
    {
      detected_language: 'vi',
      concept_groups: [
        { concept: 'Breathing', pali_terms: ['ānāpāna'], pali_stems: ['ānāpān'], english_keywords: ['breathing'] },
      ],
      recommended_locations: { nikayas: ['mn'], books: ['s0203m.mul'] },
      translation_languages: ['vi', 'en'],
    },
    'Giải thích về chánh niệm hơi thở'
  );
  assert.equal(merged.detected_language, 'vi');
  assert.ok(merged.concept_groups.length >= 2, 'Merged understanding should preserve both AI & local concept groups');
  assert.ok(merged.translation_languages.includes('vi') && merged.translation_languages.includes('en'));

  // Language directive matches detected language
  assert.match(clientAgent.buildLanguageDirective('vi'), /tiếng Việt|Vietnamese/i);
  assert.match(clientAgent.buildLanguageDirective('my'), /မြန်မာ|Burmese|Myanmar/i);

  // Deduplication prefers full passage over snippet & higher concept coverage
  const ranked = clientAgent.mergeAndRankPassages([
    { book_code: 's0102m.mul', chapter_index: 8, para_index: 373, snippet: 'short', matched_concepts: ['A'] },
    { book_code: 's0102m.mul', chapter_index: 8, para_index: 373, pali: 'full canonical pali text', matched_concepts: ['A', 'B'] },
  ]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].pali, 'full canonical pali text');

  // Evidence block includes Bold Definitions section
  const ctxBlock = clientAgent.buildEvidenceContextBlock({
    passages: [],
    sentences: [],
    boldDefinitions: [
      {
        word: 'mettā',
        book_code: 's0101a.att',
        book_title: 'Sīlakkhandhavagga-Aṭṭhakathā',
        category: 'aṭṭhakathā',
        citation_ref: '[s0101a.att:c0:p1-L1]',
        pali_definition: '**mettā** ti siniddhabhāvo',
        translations: { en: 'Loving-kindness means gentleness.' },
      },
    ],
    commentaries: [],
    dictionaries: [],
    sections: [],
  });
  assert.match(ctxBlock, /Bold Definitions/i);
  assert.match(ctxBlock, /\[s0101a\.att:c0:p1-L1\]/);

  // Citation enrichment & range parsing
  const cites = clientAgent.parseCitationsFromText(
    'See [s0102m.mul:c8:p373-p375] and [s0101a.att:c0:p1–L2].',
    {
      passages: [{ book_code: 's0102m.mul', book_title: 'Mahāvaggapāḷi' }],
      boldDefinitions: [{ book_code: 's0101a.att', book_title: 'Sīlakkhandhavagga-Aṭṭhakathā', category: 'aṭṭhakathā' }],
    }
  );
  assert.equal(cites.length, 2);
  assert.equal(cites[0].paraEnd, 375);
  assert.equal(cites[0].lineId, null);
  assert.equal(cites[0].bookTitle, 'Mahāvaggapāḷi');
  assert.equal(cites[1].lineId, 2);
  assert.equal(cites[1].paraEnd, null);

  // AiMarkdown renders interactive chips for -pZ ranges and –LZ en-dash lines
  const AiMarkdown = compileModule('components/AiChat/AiMarkdown.jsx', {
    react: React,
    'lucide-react': iconProxy,
    '../../context/DictionaryContext': { useDictionary: () => ({ lookupWord: () => {} }) },
    '../../context/ThemeSettingsContext': { useThemeSettings: () => ({ settings: { paliScript: 'roman' } }) },
    '../../services/transliterate': { convertPaliScript: (s) => s },
  }).default;
  const mdHtml = renderToStaticMarkup(
    React.createElement(AiMarkdown, {
      content: 'Passages [s0102m.mul:c8:p373-p375] and [s0101a.att:c0:p1–L2].',
    })
  );
  assert.match(mdHtml, /s0102m\.mul §373–375/);
  assert.match(mdHtml, /s0101a\.att §1:L2/);

  // AiChatView renders Concept Groups + aria-expanded + bold_def/search_concepts tool meta
  const aiChatSrc = fs.readFileSync(path.join(rootDir, 'components', 'AiChat', 'AiChatView.jsx'), 'utf8');
  assert.match(aiChatSrc, /case 'search_concepts':/);
  assert.match(aiChatSrc, /case 'get_bold_definitions':/);
  assert.match(aiChatSrc, /Concept Groups &amp; Keywords:/);
  assert.match(aiChatSrc, /aria-expanded=\{isExpanded\}/);
});

// =========================================================================
// Task 2: /llms.txt, /llms-full.txt, OpenAPI, Well-Known & WebMCP
// =========================================================================

test('Task 2: /llms.txt, /llms-full.txt, OpenAPI and well-known files document bold definitions, concept search, and accurate citations without template bugs', () => {
  const llms = fs.readFileSync(path.join(rootDir, 'public', 'llms.txt'), 'utf8');
  const llmsFull = fs.readFileSync(path.join(rootDir, 'public', 'llms-full.txt'), 'utf8');

  for (const [name, content] of [['llms.txt', llms], ['llms-full.txt', llmsFull]]) {
    assert.ok(!content.includes('{site_url}'), `${name} must not contain uninterpolated {site_url}`);
    assert.ok(!content.includes('{api_url}'), `${name} must not contain uninterpolated {api_url}`);
    assert.ok(!content.includes('বাংলা अनुवाद'), `${name} must not have Bengali/Devanagari typo`);
    assert.match(content, /\/api\/ai\/bold_definitions/, `${name} must document bold_definitions API`);
    assert.match(content, /\/api\/ai\/search_concepts/, `${name} must document search_concepts API`);
    assert.match(content, /\/api\/ai\/sentences/, `${name} must document sentence alignment API`);
    assert.match(content, /\/api\/links\/preview/, `${name} must document linked preview API`);
    assert.match(content, /387,006/, `${name} should note 387,006 pre-indexed bold definitions`);
    assert.match(content, /e0101n\.mul/, `${name} should use verified Visuddhimagga code e0101n.mul`);
    assert.match(content, /abh07t\.nrf/, `${name} should use verified Abhidhammatthasaṅgaha code abh07t.nrf`);
    assert.match(content, /s0401m\.mul/, `${name} should use verified AN 1 code s0401m.mul`);
  }

  // llms-full.txt must list all 217 books
  const catalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'server_api', 'cst_books_catalog.json'), 'utf8'));
  for (const code of Object.keys(catalog)) {
    assert.ok(llmsFull.includes(`\`${code}\``), `llms-full.txt missing book ${code}`);
  }

  // OpenAPI & well-known JSON validity & endpoints
  const openapi = JSON.parse(fs.readFileSync(path.join(rootDir, 'public', 'openapi.json'), 'utf8'));
  assert.ok(openapi.paths['/api/ai/bold_definitions']);
  assert.ok(openapi.paths['/api/ai/bold_definitions_batch']);
  assert.ok(openapi.paths['/api/ai/search_concepts']);
  assert.ok(openapi.paths['/api/links/preview']);

  for (const rel of [
    'public/.well-known/mcp.json',
    'public/.well-known/mcp/server-card.json',
    'public/.well-known/ai-plugin.json',
    'public/.well-known/agent-card.json',
  ]) {
    const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
    assert.ok(parsed && typeof parsed === 'object', `${rel} must be valid JSON`);
    const raw = JSON.stringify(parsed);
    assert.match(raw, /bold_definitions|bold-definitions/i, `${rel} should expose bold definitions`);
    assert.match(raw, /search_concepts|concept-search/i, `${rel} should expose concept search`);
  }

  const webMcpSrc = fs.readFileSync(path.join(rootDir, 'components', 'WebMcpRegistration.jsx'), 'utf8');
  assert.match(webMcpSrc, /lookup_bold_definitions/);
  assert.match(webMcpSrc, /search_concepts/);
});

// =========================================================================
// Task 3: SEO Fixes (Unique Titles/Descriptions, Canonical, Sitemap, IndexNow)
// =========================================================================

test('Task 3: All 217 canonical books produce 100% unique titles (>=42 chars) & unique descriptions (110–160 chars)', () => {
  const transliterate = compileModule('services/transliterate.js');
  const seoMod = compileModule('services/seoMetadata.js', {
    './transliterate.js': transliterate,
  });

  assert.ok(seoMod.DEFAULT_SEO_TITLE.length >= 45, `Default title too short: ${seoMod.DEFAULT_SEO_TITLE.length}`);
  assert.ok(seoMod.DEFAULT_SEO_DESCRIPTION.length >= 120 && seoMod.DEFAULT_SEO_DESCRIPTION.length <= 160);

  const catalog = JSON.parse(fs.readFileSync(path.join(rootDir, 'server_api', 'cst_books_catalog.json'), 'utf8'));
  const chapters = JSON.parse(fs.readFileSync(path.join(rootDir, 'server_api', 'chapters_catalog.json'), 'utf8'));
  const chapMap = new Map();
  for (const ch of chapters) {
    if (!chapMap.has(ch.book_code)) chapMap.set(ch.book_code, []);
    chapMap.get(ch.book_code).push(ch);
  }

  const seenTitles = new Map();
  const seenDescs = new Map();

  for (const [code, entry] of Object.entries(catalog)) {
    const m = seoMod.buildBookSeoMetadata(code, entry, chapMap.get(code) || []);
    assert.ok(m.title.length >= 42, `Title too short for ${code}: "${m.title}" (${m.title.length})`);
    assert.ok(!seenTitles.has(m.title), `Duplicate title for ${code} & ${seenTitles.get(m.title)}: "${m.title}"`);
    seenTitles.set(m.title, code);

    assert.ok(
      m.description.length >= 110 && m.description.length <= 160,
      `Description length out of bounds for ${code}: ${m.description.length}`
    );
    assert.ok(!seenDescs.has(m.description), `Duplicate description for ${code} & ${seenDescs.get(m.description)}`);
    seenDescs.set(m.description, code);
  }

  assert.equal(seenTitles.size, 217);
  assert.equal(seenDescs.size, 217);

  // Verify previously colliding books are properly disambiguated
  const dn2 = seoMod.buildBookSeoMetadata('s0102m.mul', catalog['s0102m.mul'], chapMap.get('s0102m.mul'));
  const sn5 = seoMod.buildBookSeoMetadata('s0305m.mul', catalog['s0305m.mul'], chapMap.get('s0305m.mul'));
  const vin3 = seoMod.buildBookSeoMetadata('vin02m2.mul', catalog['vin02m2.mul'], chapMap.get('vin02m2.mul'));
  assert.match(dn2.title, /Dīgha Nikāya/);
  assert.match(sn5.title, /Saṃyutta Nikāya/);
  assert.match(vin3.title, /Vinaya Piṭaka/);
});

test('Task 3: Next.js routes eliminate duplicate <title>, canonical collapsing, and conflicting hreflang', () => {
  const pageSrc = fs.readFileSync(path.join(rootDir, 'app', 'page.js'), 'utf8');
  assert.ok(!pageSrc.includes('<title>{pageTitle}</title>'), 'app/page.js must NOT emit a duplicate <title> tag in JSX');
  assert.match(pageSrc, /!activeTab && !isNotFound && \(pathname\.startsWith\('\/book\/'\)/, 'app/page.js must guard SSR metadata on /book/* during hydration');

  const layoutSrc = fs.readFileSync(path.join(rootDir, 'app', 'layout.js'), 'utf8');
  assert.ok(!layoutSrc.includes('userScalable: false'), 'app/layout.js should allow mobile pinch-zoom');
  assert.ok(!layoutSrc.includes('15 modern translations'), 'app/layout.js should not have stale 15 translations count');

  const bookPageSrc = fs.readFileSync(path.join(rootDir, 'app', 'book', '[...slug]', 'page.js'), 'utf8');
  assert.match(bookPageSrc, /title:\s*\{\s*absolute:\s*seo\.title\s*\}/, 'book page must use title.absolute to avoid double suffix');
  assert.ok(!bookPageSrc.includes('languages[t.code]'), 'book page must not emit conflicting hreflang to non-canonical ?l= URLs');
  assert.match(bookPageSrc, /SsrBookArticle/, 'book page must render semantic SSR article content');
});

test('Task 3: Full XML Sitemap Index (40 child sitemaps), clean robots.txt, and valid IndexNow key + dry-run', () => {
  const publicDir = path.join(rootDir, 'public');
  const sitemapFiles = fs.readdirSync(publicDir).filter((f) => f.startsWith('sitemap') && f.endsWith('.xml')).sort();
  assert.equal(sitemapFiles.length, 41, `Expected 41 sitemap files (sitemap.xml + 40 child sitemaps), got ${sitemapFiles.length}`);
  assert.ok(sitemapFiles.includes('sitemap.xml'));
  assert.ok(sitemapFiles.includes('sitemap-main.xml'));
  assert.ok(sitemapFiles.includes('sitemap-hi.xml'));
  assert.ok(sitemapFiles.includes('sitemap-lang-vi.xml'));
  assert.ok(!sitemapFiles.includes('sitemap-translations.xml'), 'Legacy sitemap-translations.xml must not remain');

  const indexXml = fs.readFileSync(path.join(publicDir, 'sitemap.xml'), 'utf8');
  assert.match(indexXml, /<sitemapindex\b/);
  const childLocs = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(childLocs.length, 40, `Expected 40 child sitemaps in index, got ${childLocs.length}`);

  const mainXml = fs.readFileSync(path.join(publicDir, 'sitemap-main.xml'), 'utf8');
  const mainLocs = [...mainXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(mainLocs.length, 2917, `Expected 2,917 URLs in sitemap-main.xml (5 static + 217 books + 2,695 chapters), got ${mainLocs.length}`);
  for (const u of mainLocs) {
    assert.ok(!u.includes('?l='), `Non-canonical ?l= URL leaked into sitemap: ${u}`);
  }

  const robots = fs.readFileSync(path.join(publicDir, 'robots.txt'), 'utf8');
  const sitemapDecls = robots.split('\n').filter((l) => l.startsWith('Sitemap:'));
  assert.deepEqual(sitemapDecls, ['Sitemap: https://tipitakapali.org/sitemap.xml']);
  assert.match(robots, /Allow:\s*\/translation\//, 'robots.txt must allow /translation/ clean translation routes');

  // IndexNow verification key file & _headers
  const keyFiles = fs.readdirSync(publicDir).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  assert.equal(keyFiles.length, 1, 'Expected exactly one 32-hex IndexNow key file in public/');
  const keyName = keyFiles[0];
  const keyStem = keyName.replace(/\.txt$/, '');
  const keyBody = fs.readFileSync(path.join(publicDir, keyName), 'utf8').trim();
  assert.equal(keyBody, keyStem, 'IndexNow key file contents must match filename stem');

  const headers = fs.readFileSync(path.join(publicDir, '_headers'), 'utf8');
  assert.ok(headers.includes(`/${keyName}`), `public/_headers must configure Content-Type for /${keyName}`);

  // Run scripts/submit_indexnow.py --only-books --dry-run
  const out = execFileSync('python3', [path.join(rootDir, 'scripts', 'submit_indexnow.py'), '--only-books', '--dry-run'], {
    encoding: 'utf8',
  });
  assert.match(out, /URLs to submit\s*:\s*8425/);
  assert.match(out, /Dry run validated successfully/);
});

// =========================================================================
// Task 4: Updated Help (HelpGuideContent.jsx) & Info (public/info.html)
// =========================================================================

test('Task 4: HelpGuideContent.jsx and public/info.html document all recent features accurately', () => {
  const HelpMod = compileModule('components/Help/HelpGuideContent.jsx', {
    react: React,
    'lucide-react': iconProxy,
  });
  const helpHtml = renderToStaticMarkup(React.createElement(HelpMod.default, { showTabBar: true }));
  const infoHtml = fs.readFileSync(path.join(rootDir, 'public', 'info.html'), 'utf8');

  for (const [label, html] of [['HelpGuideContent.jsx', helpHtml], ['public/info.html', infoHtml]]) {
    assert.ok(!/24\s+(modern\s+)?(translations|languages)/i.test(html), `${label} should not say 24 modern translations (23 translations / 24 layers incl. Pali)`);
    assert.match(html, /23 modern translations/i, `${label} should state 23 modern translations`);
    assert.match(html, /floating overlays/i, `${label} should mention non-shifting floating overlays`);
    assert.match(html, /Pin/i, `${label} should mention opt-in Pin`);
    assert.match(html, /empty space/i, `${label} should mention empty-space click dismissal`);
    assert.match(html, /Columns \| Tabs \| Single/, `${label} should document Columns | Tabs | Single order`);
    assert.match(html, /Sync/, `${label} should mention Sync next to Columns`);
    assert.match(html, /live per-column section title/i, `${label} should mention live per-column section titles`);
    assert.match(html, /Open Tabs switcher/i, `${label} should mention Open Tabs switcher`);
    assert.match(html, /\+Aṭṭha/, `${label} should mention +Aṭṭha / +Ṭīkā / +Mūla scroll preservation`);
    assert.match(html, /Linked Definition Popup Preview/i, `${label} should document Linked Definition Popup Previews`);
    assert.match(html, /per-line selection/i, `${label} should mention per-line selection`);
    assert.match(html, /387,000\+|387K\+/i, `${label} should document pre-indexed bold definitions`);
    assert.match(html, /Two-Zone Language Menu/i, `${label} should document redesigned two-zone Language Menu`);
    assert.match(html, /Download.*Update.*Delete/is, `${label} should document offline Download/Update/Delete controls`);
    assert.match(html, /without auto-reloading/i, `${label} should document clean app launch without auto-reloading old tabs`);
    assert.match(html, /Concept[- ]Groups?/i, `${label} should document Ani Concept Groups`);
  }

  // HelpGuideContent dropdown uses aria-expanded
  assert.match(helpHtml, /aria-expanded="false"/);
  // Preserve Play Store badge / link pattern for offline bundle sync_web_bundle.sh
  assert.match(infoHtml, /href="https:\/\/play\.google\.com\/store\/apps\/details\?id=org\.tipitakapali\.android"/);
  assert.ok(HelpMod.SHOW_ANDROID_BADGE === true || HelpMod.SHOW_ANDROID_BADGE === false);
});

// =========================================================================
// Review Regression Tests: Deep Edge Cases & Mocked Multi-Provider E2E
// =========================================================================

test('Review fixes: Language detection avoids FR/ES/PT/DE/EN->VI misclassification & Vietnamese lexicon false positives', () => {
  const qu = require(path.join(rootDir, 'server_api', 'aiQueryUnderstanding.js'));
  const clientAgent = compileModule('services/aiClientAgent.js', {
    './api': { fetchAiEndpoint: async () => ({ ok: true, json: async () => ({}) }) },
  });

  // European & accented English queries must NEVER be classified as Vietnamese
  assert.equal(qu.detectLanguage("Qu'est-ce que l'équanimité (upekkhā)?"), 'fr');
  assert.equal(clientAgent.detectClientQueryLanguage("Qu'est-ce que l'équanimité (upekkhā)?"), 'fr');
  assert.equal(qu.detectLanguage('¿Qué enseña el Buda sobre el sufrimiento?'), 'es');
  assert.equal(clientAgent.detectClientQueryLanguage('¿Qué enseña el Buda sobre el sufrimiento?'), 'es');
  assert.equal(qu.detectLanguage('O que é a compaixão no Cânone Páli?'), 'pt');
  assert.equal(qu.detectLanguage('Was lehrt der Buddha über Geduld?'), 'de');
  assert.equal(qu.detectLanguage('What is café in Pali?'), 'en');
  // Real Vietnamese still detected as vi
  assert.equal(qu.detectLanguage('Định nghĩa của từ sati là gì?'), 'vi');
  assert.equal(clientAgent.detectClientQueryLanguage('Định nghĩa của từ sati là gì?'), 'vi');

  // Vietnamese lexicon must not false-match "định nghĩa" as Concentration or "thế giới" as Virtue/Vinaya
  const defVi = qu.heuristicQueryUnderstanding('Định nghĩa của từ sati là gì?');
  assert.ok(!defVi.concept_groups.some((g) => /Concentration/i.test(g.concept)), 'định nghĩa must not trigger Concentration & Jhāna');
  const satiGroup = defVi.concept_groups.find((g) => /Mindfulness/i.test(g.concept));
  assert.ok(satiGroup && satiGroup.pali_stems.includes('sati*') && !satiGroup.pali_stems.includes('sat*'), 'sati must use sati*, never sat*');

  const worldVi = qu.heuristicQueryUnderstanding('Thế giới quan trong kinh tạng là gì?');
  assert.ok(!worldVi.concept_groups.some((g) => /Virtue|Vinaya/i.test(g.concept)), 'thế giới must not trigger Virtue/Vinaya');
});

test('Review fixes: Vinaya/Abhidhamma scope preserved, local_keywords search vi FTS, verified DB paras & citation false-positive rejection', async () => {
  const Database = require(path.join(rootDir, 'server_api', 'node_modules', 'better-sqlite3'));
  const aiCtrl = require(path.join(rootDir, 'server_api', 'aiController.js'));
  const qu = require(path.join(rootDir, 'server_api', 'aiQueryUnderstanding.js'));

  const db = new Database(path.join(rootDir, 'server_api', 'db', 'tipitaka.db'), { readonly: true });
  const dbFts = new Database(path.join(rootDir, 'server_api', 'db', 'fts_tipitaka.db'), { readonly: true });

  try {
    aiCtrl.initAiController({ db, dbFts, resolveDbPath: (f) => path.join(rootDir, 'server_api', 'db', f) });

    // 1. Vinaya + Sutta with nikayas must NOT wipe out Vinaya books
    const vinRes = aiCtrl.aiSearchConcepts({
      concept_groups: [{ concept: 'Gold & Silver', pali_terms: ['jātarūpa', 'rajata'], english_keywords: ['gold', 'silver'] }],
      categories: ['vinaya', 'sutta'],
      nikayas: ['mn', 'sn', 'dn', 'an'],
      langs: ['en'],
      limit: 10,
    });
    assert.ok(vinRes.results.some((r) => r.book_code.startsWith('vin')), 'Expected Vinaya books to remain included alongside Sutta nikayas');

    // 2. General heuristic understanding leaves pitakas/nikayas empty (no artificial sutta-only filter)
    const genUnd = qu.heuristicQueryUnderstanding('How does the Buddha teach overcoming anger with loving-kindness?', [], db, null);
    assert.deepEqual(genUnd.recommended_locations.pitakas, []);
    assert.deepEqual(genUnd.recommended_locations.nikayas, []);
    const vinUnd = qu.heuristicQueryUnderstanding('What is the Vinaya rule on bhikkhus accepting gold?', [], db, null);
    assert.deepEqual(vinUnd.recommended_locations.pitakas, ['vinaya']);

    // 3. Vietnamese local_keywords query fts_translation_vi.db cleanly (never English words into vi DB)
    const viRes = aiCtrl.aiSearchConcepts({
      concept_groups: [
        { concept: 'Anger', pali_terms: ['kodha'], english_keywords: ['anger'], local_keywords: ['sân hận', 'phẫn nộ'] },
        { concept: 'Metta', pali_terms: ['mettā'], english_keywords: ['loving-kindness'], local_keywords: ['tâm từ', 'từ ái'] },
      ],
      langs: ['en', 'vi'],
      limit: 10,
    });
    const viQ = viRes.queries_executed.find((q) => q.source === 'translation_vi');
    assert.ok(viQ && !viQ.fts.includes('anger') && /sân hận/i.test(viQ.fts), `Expected Vietnamese FTS query to use local_keywords, got: ${viQ?.fts}`);

    // 4. Verified canonical sutta para coordinates match tipitaka.db
    for (const [book, num, sub, expectedPara] of [
      ['SN', 12, 2, 9],
      ['SN', 35, 28, 83],
      ['SN', 45, 8, 46],
      ['AN', 5, 161, 1089],
    ]) {
      const resolved = qu.resolveCanonicalCitation(book, num, sub, db);
      assert.equal(resolved.start_para, expectedPara, `${book} ${num}.${sub} should start at para_index ${expectedPara}`);
    }

    // 5. DN 22 example from llms.txt & openapi.json returns actual Mahāsatipaṭṭhāna Sutta + citation_url
    const dn22 = aiCtrl.aiGetParagraphContent({ book_code: 's0102m.mul', chapter_index: 8, para_start: 1341, para_end: 1345, langs: ['en'] });
    assert.equal(dn22.success, true);
    assert.ok(dn22.count >= 4);
    assert.equal(dn22.passages[0].chapter_index, 8);
    assert.match(dn22.passages[0].citation_url, /^https:\/\/tipitakapali\.org\/book\/s0102m\.mul\/9#/);

    // 6. get_paragraph_content_batch accepts both ranges AND requests (backwards compat)
    const batchReq = await aiCtrl.executeAiTool('get_paragraph_content_batch', {
      requests: [{ book_code: 's0102m.mul', chapter_index: 8, para_start: 1341, para_end: 1342 }],
      langs: ['en'],
    });
    assert.equal(batchReq.success, true);
    assert.ok(batchReq.count >= 2, 'get_paragraph_content_batch must accept "requests" alias as well as "ranges"');

    // 7. Citation parsers and AiMarkdown reject bogus non-book tags like [12:30], [Note:1], [Figure:2]
    const sample = 'Meeting at [12:30], see [Note:1] and [Figure:2], plus [s0101m.mul:c0:p5-L1] and [s0201m.mul:c0:p7-p10].';
    const srvCites = aiCtrl.parseCitations(sample);
    assert.equal(srvCites.length, 2, `Server parseCitations must ignore bogus tags, got: ${srvCites.map((c) => c.ref)}`);

    const clientAgent = compileModule('services/aiClientAgent.js', {
      './api': { fetchAiEndpoint: async () => ({ ok: true, json: async () => ({}) }) },
    });
    const cliCites = clientAgent.parseCitationsFromText(sample);
    assert.equal(cliCites.length, 2, `Client parseCitationsFromText must ignore bogus tags, got: ${cliCites.map((c) => c.ref)}`);

    const AiMarkdown = compileModule('components/AiChat/AiMarkdown.jsx', {
      react: React,
      'lucide-react': iconProxy,
      '../../context/DictionaryContext': { useDictionary: () => ({ openDictionary: () => {} }) },
      '../../context/ThemeSettingsContext': { useThemeSettings: () => ({ settings: { paliScript: 'roman' } }) },
      '../../services/transliterate': { cleanDictionaryQuery: (s) => s },
    }).default;
    const rendered = renderToStaticMarkup(React.createElement(AiMarkdown, { content: sample }));
    assert.match(rendered, /\[12:30\]/, '[12:30] should remain plain text');
    assert.match(rendered, /\[Note:1\]/, '[Note:1] should remain plain text');
    assert.ok(!rendered.includes('12 §30'), '[12:30] must not render as a citation button');
    assert.ok(!rendered.includes('Note §1'), '[Note:1] must not render as a citation button');
    assert.match(rendered, /s0101m\.mul §5:L1/);
  } finally {
    db.close();
    dbFts.close();
  }
});

test('Review fixes: Mocked E2E runClientAiAgent for OpenRouter (400 json_object retry + history alternation + SSE flush) and Gemini', async () => {
  const fetchCalls = [];
  const origFetch = global.fetch;

  const makeSseStream = (chunks) => {
    const encoder = new TextEncoder();
    let idx = 0;
    return {
      getReader() {
        return {
          async read() {
            if (idx >= chunks.length) return { done: true, value: undefined };
            return { done: false, value: encoder.encode(chunks[idx++]) };
          },
        };
      },
    };
  };

  const clientAgent = compileModule('services/aiClientAgent.js', {
    './api': {
      fetchAiEndpoint: async (endpoint, opts) => {
        const body = JSON.parse(opts.body || '{}');
        if (endpoint === '/api/ai/understand') {
          return {
            ok: true,
            json: async () => ({
              success: true,
              understanding: {
                intent: 'doctrinal_explanation',
                detected_language: 'en',
                concept_groups: [{ concept: 'Anger', pali_terms: ['kodha'], pali_stems: ['kodh*'], english_keywords: ['anger'] }],
                recommended_locations: { pitakas: [], nikayas: [], books: [] },
                translation_languages: ['en'],
                source: 'heuristic_general',
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => {
            if (body.name === 'search_concepts') {
              return {
                success: true,
                results: [{ book_code: 's0403m1.mul', book_title: 'Pañcakanipātapāḷi', chapter_index: 16, para_index: 1090, para_num: '161', snippet: 'kodhaṃ vineyya', citation_ref: '[s0403m1.mul:c16:p1090]' }],
              };
            }
            if (body.name === 'get_bold_definitions_batch') {
              return {
                success: true,
                definitions: [{ word: 'mettā', book_code: 's0101a.att', book_title: 'Sumaṅgalavilāsinī', category: 'aṭṭhakathā', chapter_index: 0, para_index: 1, line_id: 1, citation_ref: '[s0101a.att:c0:p1-L1]', pali_definition: '**Mettā** ti hitākārapavatti.', translations: { en: 'Loving-kindness means benevolence.' } }],
              };
            }
            return { success: true, summary: 'done' };
          },
        };
      },
    },
  });

  // Verify sanitizeConversationHistory strips duplicate trailing user msg & enforces alternation
  const cleaned = clientAgent.sanitizeConversationHistory(
    [
      { id: '1', role: 'user', content: 'Previous question', extra: true },
      { id: '2', role: 'assistant', content: 'Previous answer', citations: [] },
      { id: '3', role: 'user', content: 'Active question' },
    ],
    'Active question'
  );
  assert.deepEqual(cleaned, [
    { role: 'user', content: 'Previous question' },
    { role: 'assistant', content: 'Previous answer' },
  ]);

  try {
    // 1. OpenRouter E2E: Step 1 rejects response_format with 400 -> retries without response_format -> Step 2 calls final_answer -> Step 3 streams SSE without trailing newline
    let openRouterCall = 0;
    global.fetch = async (url, opts) => {
      const payload = JSON.parse(opts.body || '{}');
      fetchCalls.push({ url, payload });
      openRouterCall++;
      if (openRouterCall === 1) {
        assert.ok(payload.response_format?.type === 'json_object');
        return { ok: false, status: 400, text: async () => 'json_object unsupported' };
      }
      if (openRouterCall === 2) {
        assert.equal(payload.response_format, undefined, 'Retry must omit response_format');
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  intent: 'doctrinal_explanation',
                  detected_language: 'en',
                  concept_groups: [
                    { concept: 'Anger', pali_terms: ['kodha'], pali_stems: ['kodh*'], english_keywords: ['anger'] },
                    { concept: 'Loving-kindness', pali_terms: ['mettā'], pali_stems: ['mett*'], english_keywords: ['loving-kindness'] },
                  ],
                  needs_bold_definitions: true,
                  key_terms_for_bold_def: ['mettā'],
                  recommended_locations: { categories: ['vinaya'], nikayas: [], books: [] },
                }),
              },
            }],
          }),
        };
      }
      if (openRouterCall === 3) {
        // Ensure no consecutive user messages in OpenRouter messages
        const roles = payload.messages.map((m) => m.role);
        assert.deepEqual(roles, ['system', 'user', 'assistant', 'user'], `Unexpected role order: ${roles}`);
        return {
          ok: true,
          json: async () => ({
            choices: [{
              message: {
                role: 'assistant',
                tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'final_answer', arguments: '{"summary":"Collected"}' } }],
              },
            }],
          }),
        };
      }
      // Step 3 streaming — intentionally omit trailing \n on final data line to test buffer flush
      return {
        ok: true,
        body: makeSseStream([
          'data: {"choices":[{"delta":{"content":"Overcome anger with mettā "}}]}\n',
          'data: {"choices":[{"delta":{"content":"[s0403m1.mul:c16:p1090] and [s0101a.att:c0:p1-L1]."}}]}',
        ]),
      };
    };

    let streamed = '';
    let finalCites = [];
    let finalUnd = null;
    await clientAgent.runClientAiAgent({
      userQuery: 'How to overcome anger with metta?',
      conversationHistory: [
        { role: 'user', content: 'Hi', id: 'u1' },
        { role: 'assistant', content: 'Hello', citations: [] },
        { role: 'user', content: 'How to overcome anger with metta?', id: 'u2' },
      ],
      aiSettings: { provider: 'openrouter', apiKey: 'sk-or-test-key-12345', toolModel: 'test/model', answerModel: 'test/model' },
      onUnderstanding: (u) => { finalUnd = u; },
      onToken: (t) => { streamed += t; },
      onCitations: (c) => { finalCites = c; },
      onError: (e) => { throw e; },
    });

    assert.equal(finalUnd.concept_groups.length, 2);
    assert.deepEqual(finalUnd.recommended_locations.categories, ['vinaya'], 'AI Vinaya scope must not be overwritten by generic heuristic');
    assert.match(streamed, /\[s0101a\.att:c0:p1-L1\]/, 'Final non-newline-terminated SSE chunk must be flushed');
    assert.equal(finalCites.length, 2);

    // 2. Gemini E2E: verify alternating turns + Step 3 SSE buffer flush
    let geminiCall = 0;
    global.fetch = async (url, opts) => {
      const payload = JSON.parse(opts.body || '{}');
      geminiCall++;
      if (geminiCall === 1) {
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    intent: 'term_analysis',
                    detected_language: 'en',
                    concept_groups: [{ concept: 'Metta', pali_terms: ['mettā'], pali_stems: ['mett*'], english_keywords: ['loving-kindness'] }],
                    needs_bold_definitions: true,
                    key_terms_for_bold_def: ['mettā'],
                  }),
                }],
              },
            }],
          }),
        };
      }
      if (geminiCall === 2) {
        const roles = payload.contents.map((c) => c.role);
        assert.deepEqual(roles, ['user', 'model', 'user'], `Gemini turns must strictly alternate, got: ${roles}`);
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'final_answer', args: { summary: 'Done' } } }] } }],
          }),
        };
      }
      return {
        ok: true,
        body: makeSseStream([
          'data: {"candidates":[{"content":{"parts":[{"text":"Mettā means benevolence [s0101a.att:c0:p1-L1]."}]}}]}',
        ]),
      };
    };

    let geminiText = '';
    await clientAgent.runClientAiAgent({
      userQuery: 'What is metta?',
      conversationHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'What is metta?' },
      ],
      aiSettings: { provider: 'gemini', apiKey: 'AIzaTestKey12345', toolModel: 'gemini-flash-lite-latest', answerModel: 'gemini-flash-lite-latest' },
      onToken: (t) => { geminiText += t; },
      onError: (e) => { throw e; },
    });
    assert.match(geminiText, /benevolence \[s0101a\.att:c0:p1-L1\]/);
  } finally {
    global.fetch = origFetch;
  }
});

test('Review fixes: SEO 404 metadata, SPA-shell canonical stabilizer, offline converter noindex, and llms.txt ranges/DN22 coords', () => {
  const notFoundSrc = fs.readFileSync(path.join(rootDir, 'app', 'not-found.jsx'), 'utf8');
  assert.match(notFoundSrc, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  assert.match(notFoundSrc, /canonical:\s*null/);

  const layoutSrc = fs.readFileSync(path.join(rootDir, 'app', 'layout.js'), 'utf8');
  assert.match(layoutSrc, /link\[rel="canonical"\]/);
  assert.match(layoutSrc, /noindex, follow/);

  const offlineConv = fs.readFileSync(path.join(rootDir, 'public', 'pali-script-converter-offline.html'), 'utf8');
  assert.match(offlineConv, /<meta\s+name="robots"\s+content="noindex,\s*follow"/i);

  const onlineConv = fs.readFileSync(path.join(rootDir, 'public', 'pali-script-converter.html'), 'utf8');
  const descMatch = onlineConv.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  assert.ok(descMatch && descMatch[1].length <= 160, `pali-script-converter.html description too long: ${descMatch?.[1]?.length}`);

  const llms = fs.readFileSync(path.join(rootDir, 'public', 'llms.txt'), 'utf8');
  const llmsFull = fs.readFileSync(path.join(rootDir, 'public', 'llms-full.txt'), 'utf8');
  assert.match(llms, /"ranges":\s*\[/);
  assert.match(llmsFull, /"ranges":\s*\[/);
  assert.match(llms, /start=1341&end=1345/);
  assert.ok(!llms.includes('"requests":'), 'llms.txt must document "ranges", not "requests"');
  assert.ok(!llmsFull.includes('"requests":'), 'llms-full.txt must document "ranges", not "requests"');
});
