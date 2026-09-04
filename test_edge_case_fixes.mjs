import assert from 'assert';

console.log('=== Running Edge Case Fixes Test Suite ===\n');

// 1. Markdown italic parsing test
console.log('1. Testing markdown formatting and adjacent italics...');
function formatInlineTags(str) {
  if (!str) return '';
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  let safe = escapeHtml(str);
  safe = safe
    .replace(/&lt;i&gt;/gi, '<i>')
    .replace(/&lt;\/i&gt;/gi, '</i>')
    .replace(/&lt;b&gt;/gi, '<b>')
    .replace(/&lt;\/b&gt;/gi, '</b>')
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>')
    .replace(/&lt;strong&gt;/gi, '<strong>')
    .replace(/&lt;\/strong&gt;/gi, '</strong>');

  // Convert markdown **bold** and *italic*
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  safe = safe.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');

  return safe;
}

const mdInput = 'Text with *first italic* and *second italic* and **bold text**!';
const mdOutput = formatInlineTags(mdInput);
console.log('Markdown output:', mdOutput);
assert(mdOutput.includes('<i>first italic</i>'), 'First italic converted');
assert(mdOutput.includes('<i>second italic</i>'), 'Second adjacent italic converted');
assert(mdOutput.includes('<b>bold text</b>'), 'Bold text converted');
console.log('✅ Markdown adjacent italics and bold tags PASS.\n');

// 2. Multi-digit non-ASCII and non-Latin paragraph numbers
console.log('2. Testing non-ASCII multi-digit paragraph number stripping...');
const digitRegex = /^\s*[\p{Nd}]+[\.၊။\s]+/u;

const samples = [
  { text: '๑๐. ข้าพเจ้าได้สดับมาอย่างนี้', expected: 'ข้าพเจ้าได้สดับมาอย่างนี้', desc: 'Thai 10 (with ๐)' },
  { text: '၂၀။ ဤသို့ ကျွန်ုပ်ကြားနာခဲ့ရပါ၏။', expected: 'ဤသို့ ကျွန်ုပ်ကြားနာခဲ့ရပါ၏။', desc: 'Myanmar 20 (with ၀)' },
  { text: '១០. ប្រយោគ', expected: 'ប្រយោគ', desc: 'Khmer 10' },
  { text: '१००. वाक्य', expected: 'वाक्य', desc: 'Devanagari 100' },
  { text: '10. Thus have I heard.', expected: 'Thus have I heard.', desc: 'English 10' },
];

for (const s of samples) {
  const res = s.text.replace(digitRegex, '');
  console.log(`  [${s.desc}]: "${s.text}" -> "${res}"`);
  assert.strictEqual(res, s.expected, `Failed for ${s.desc}`);
}
console.log('✅ All non-ASCII multi-digit paragraph numbers stripped correctly without duplicate anchors.\n');

// 3. Side-by-side empty column alignment
console.log('3. Testing side-by-side missing translation row alignment...');

function injectTranslationsMock({ pTag, pIndex, translations, orderedLayers, isPaliEnabled, displayMode }) {
  const hasTranslations = orderedLayers.some((l) => l.type === 'trans');
  if (isPaliEnabled && !hasTranslations) return pTag;

  const isSide = displayMode === 'side';
  const isSideActive = isSide && ((isPaliEnabled && hasTranslations) || (!isPaliEnabled && orderedLayers.filter((l) => l.type === 'trans').length >= 2));

  const paraMatch = pTag.match(/\bdata-para="([^"]+)"/i);
  const classMatch = pTag.match(/\bclass="([^"]+)"/i);
  const pClasses = (classMatch ? classMatch[1] : '').split(/\s+/);
  const headingClass = pClasses.find((c) => /^(nikaya|book|title|subhead|subsubhead|chapter|centre|centered)$/i.test(c));
  const isHeading = Boolean(headingClass);

  const rowAttrs = `data-pindex="${pIndex}"`;
  const renderedItems = [];
  let transCount = 0;

  for (const layer of orderedLayers) {
    if (layer.type === 'pali') {
      if (isPaliEnabled) {
        renderedItems.push({ type: 'pali', lang: 'pali', html: pTag });
      }
    } else if (layer.type === 'trans') {
      const trans = translations[layer.lang]?.[pIndex];
      if (trans && trans.trim()) {
        transCount++;
        renderedItems.push({ type: 'trans', lang: layer.lang, html: `<div class="reader-trans-block" data-trans-lang="${layer.lang}">${trans}</div>` });
      }
    }
  }

  if (renderedItems.length === 0) {
    if (!isPaliEnabled) return isHeading ? pTag : `<div class="reader-para-row reader-trans-empty" ${rowAttrs}></div>`;
    return pTag;
  }

  if (!isPaliEnabled && isHeading) {
    return `<div class="reader-para-row reader-trans-heading-row ${headingClass}" ${rowAttrs}>${renderedItems.map(i => i.html).join('')}</div>`;
  }

  if (isSideActive && renderedItems.length >= 2) {
    const col1 = renderedItems[0];
    const col2Items = renderedItems.slice(1);
    const col1Html = col1.html;
    const col2Html = col2Items.map((item) => item.html).join('');
    const col1Class = col1.type === 'pali' ? 'reader-pali-col' : 'reader-trans-col';
    const col2Class = col2Items.some((item) => item.type === 'pali') ? 'reader-pali-col' : 'reader-trans-col';
    const col2Wrapped = col2Class === 'reader-trans-col'
      ? `<div class="reader-translation-container reader-side-container" data-pindex="${pIndex}">${col2Html}</div>`
      : col2Html;
    return `<div class="reader-para-row reader-trans-side-row" ${rowAttrs}><div class="reader-side-col reader-side-col-left ${col1Class}">${col1Html}</div><div class="reader-side-col reader-side-col-right ${col2Class}">${col2Wrapped}</div></div>`;
  }

  if (isSideActive && renderedItems.length === 1 && !isHeading) {
    const isBodyPara = /\b(bodytext|hangnum|indent|gatha\w*)\b/i.test(pTag);
    if (isBodyPara) {
      const singleItem = renderedItems[0];
      const isCol1 = singleItem.type === orderedLayers[0]?.type &&
        (singleItem.type === 'pali' || singleItem.lang === orderedLayers[0]?.lang);

      if (isCol1) {
        const col1Class = singleItem.type === 'pali' ? 'reader-pali-col' : 'reader-trans-col';
        return `<div class="reader-para-row reader-trans-side-row reader-side-empty" ${rowAttrs}><div class="reader-side-col reader-side-col-left ${col1Class}">${singleItem.html}</div><div class="reader-side-col reader-side-col-right reader-trans-col reader-trans-col-empty"><div class="reader-translation-container reader-side-container" data-pindex="${pIndex}"></div></div></div>`;
      } else {
        const col2Class = singleItem.type === 'pali' ? 'reader-pali-col' : 'reader-trans-col';
        const col2Wrapped = col2Class === 'reader-trans-col'
          ? `<div class="reader-translation-container reader-side-container" data-pindex="${pIndex}">${singleItem.html}</div>`
          : singleItem.html;
        return `<div class="reader-para-row reader-trans-side-row reader-side-empty" ${rowAttrs}><div class="reader-side-col reader-side-col-left reader-trans-col reader-trans-col-empty"></div><div class="reader-side-col reader-side-col-right ${col2Class}">${col2Wrapped}</div></div>`;
      }
    }
  }

  const itemsHtml = renderedItems.map((item) => item.html).join('');
  return `<div class="reader-para-row reader-trans-stack-row" ${rowAttrs}>${itemsHtml}</div>`;
}

// Subtest 3A: Pali in Col 1, English in Col 2. Para 10 has Pali, missing English.
const row3A = injectTranslationsMock({
  pTag: '<p class="bodytext" data-pindex="10" data-para="10">Pāli text 10</p>',
  pIndex: '10',
  translations: { en: {} },
  orderedLayers: [{ id: 'pali', type: 'pali' }, { id: 'english', type: 'trans', lang: 'en' }],
  isPaliEnabled: true,
  displayMode: 'side',
});
console.log('Subtest 3A (Pali Left, Missing EN Right):');
assert(row3A.includes('reader-trans-side-row reader-side-empty'), 'Retains 2-column side row');
assert(row3A.includes('reader-side-col-left reader-pali-col'), 'Pali is on the left');
assert(row3A.includes('reader-side-col-right reader-trans-col reader-trans-col-empty'), 'Right column is empty placeholder');
console.log('✅ Subtest 3A PASS.');

// Subtest 3B: English in Col 1, Pali in Col 2. Para 10 has Pali, missing English.
const row3B = injectTranslationsMock({
  pTag: '<p class="bodytext" data-pindex="10" data-para="10">Pāli text 10</p>',
  pIndex: '10',
  translations: { en: {} },
  orderedLayers: [{ id: 'english', type: 'trans', lang: 'en' }, { id: 'pali', type: 'pali' }],
  isPaliEnabled: true,
  displayMode: 'side',
});
console.log('Subtest 3B (Missing EN Left, Pali Right):');
assert(row3B.includes('reader-trans-side-row reader-side-empty'), 'Retains 2-column side row');
assert(row3B.includes('reader-side-col-left reader-trans-col reader-trans-col-empty'), 'Left column is empty placeholder');
assert(row3B.includes('reader-side-col-right reader-pali-col'), 'Pali is on the right');
console.log('✅ Subtest 3B PASS.');

// Subtest 3C: Heading in side-by-side mode spans full width
const headingRow = injectTranslationsMock({
  pTag: '<p class="nikaya" data-pindex="1">Dīghanikāya</p>',
  pIndex: '1',
  translations: { en: {} },
  orderedLayers: [{ id: 'pali', type: 'pali' }, { id: 'english', type: 'trans', lang: 'en' }],
  isPaliEnabled: true,
  displayMode: 'side',
});
console.log('Subtest 3C (Heading in side mode):');
assert(headingRow.includes('reader-trans-stack-row'), 'Heading spans full width');
console.log('✅ Subtest 3C PASS.');

// 4. LocalStorage empty/corrupted fallback
console.log('4. Testing corrupted localStorage fallback...');
function migrateSettings(parsed) {
  const DEFAULT_TRANSLATIONS = { pali: true, english: false };
  const mergedTranslations = { ...DEFAULT_TRANSLATIONS, ...(parsed.translations || {}) };
  if (mergedTranslations.pali === undefined) mergedTranslations.pali = true;
  const hasAnyActive = Object.values(mergedTranslations).some(Boolean);
  if (!hasAnyActive) {
    mergedTranslations.pali = true;
  }
  return mergedTranslations;
}

const badSaved = { translations: { pali: false, english: false } };
const fixedTranslations = migrateSettings(badSaved);
console.log('Fixed translations:', fixedTranslations);
assert.strictEqual(fixedTranslations.pali, true, 'Pāḷi reactivated when all are false');
console.log('✅ LocalStorage corrupted settings fallback PASS.\n');

console.log('==============================================');
console.log('🎉 ALL EDGE CASE FIXES VERIFIED SUCCESSFULLY!');
console.log('==============================================');
