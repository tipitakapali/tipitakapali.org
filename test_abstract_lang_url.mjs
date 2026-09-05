import assert from 'assert';
import { spawn } from 'child_process';

console.log('=== Running Abstract Language URL & FTS Comprehensive Test Suite ===\n');

// ---------------------------------------------------------
// PART 1: Logic & Unit Tests for Language Resolution & URL Mapping
// ---------------------------------------------------------

const LANG_KEY_TO_CODE = {
  english: 'en',
  vietnamese: 'vi',
  myanmar: 'my',
  burmese: 'my',
  sinhala: 'si',
  chinese: 'zh',
  khmer: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  portuguese: 'pt',
  russian: 'ru',
  my_nissaya: 'my_nissaya',
  nissaya: 'my_nissaya',
};

const CODE_TO_LANG_KEY = {
  en: 'english',
  vi: 'vietnamese',
  my: 'myanmar',
  my_nissaya: 'my_nissaya',
  si: 'sinhala',
  th: 'thai',
  zh: 'chinese',
  km: 'khmer',
  lo: 'lao',
  ta: 'tamil',
  hi: 'hindi',
  de: 'german',
  ja: 'japanese',
  pt: 'portuguese',
  ru: 'russian',
  ko: 'korean',
};

const DEFAULT_FTS_DATABASES = [
  { id: 'fts_tipitaka.db', key: 'pali', label: 'Pāḷi CST', flag: '☸️', isPali: true },
  { id: 'fts_translation_en.db', key: 'en', label: 'English', flag: '🇬🇧' },
  { id: 'fts_translation_vi.db', key: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { id: 'fts_translation_my.db', key: 'my', label: 'မြန်မာ', flag: '🇲🇲' },
  { id: 'fts_translation_my_nissaya.db', key: 'my_nissaya', label: 'မြန်မာ နိဿယ', flag: '🇲🇲' },
  { id: 'fts_translation_si.db', key: 'si', label: 'සිංහල', flag: '🇱🇰' },
  { id: 'fts_translation_th.db', key: 'th', label: 'ไทย', flag: '🇹🇭' },
  { id: 'fts_translation_zh.db', key: 'zh', label: '中文', flag: '🇨🇳' },
  { id: 'fts_translation_km.db', key: 'km', label: 'ភាសាខ្មែរ', flag: '🇰🇭' },
  { id: 'fts_translation_lo.db', key: 'lo', label: 'ລາວ', flag: '🇱🇦' },
  { id: 'fts_translation_ta.db', key: 'ta', label: 'தமிழ்', flag: '🇮🇳' },
  { id: 'fts_translation_hi.db', key: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { id: 'fts_translation_de.db', key: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { id: 'fts_translation_ja.db', key: 'ja', label: '日本語', flag: '🇯🇵' },
  { id: 'fts_translation_pt.db', key: 'pt', label: 'Português', flag: '🇵🇹' },
  { id: 'fts_translation_ru.db', key: 'ru', label: 'Русский', flag: '🇷🇺' },
  { id: 'fts_translation_ko.db', key: 'ko', label: '한국어', flag: '🇰🇷' },
];

function normalizeLangCode(langOrDb) {
  if (!langOrDb) return null;
  const str = String(langOrDb).trim().toLowerCase();
  if (str === 'pali' || str === 'fts_tipitaka.db' || str === 'tipitaka.db' || str === 'fts_pali.db') return 'pali';
  const clean = str.replace(/^(?:fts_)?(?:translation_)?/i, '').replace(/\.db$/i, '');
  if (clean === 'pali' || clean === 'tipitaka') return 'pali';
  if (LANG_KEY_TO_CODE[clean]) return LANG_KEY_TO_CODE[clean];
  if (CODE_TO_LANG_KEY[clean]) return clean;
  return clean;
}

function resolveDbFromLangParam(param, databases = DEFAULT_FTS_DATABASES) {
  if (!param) return null;
  const normCode = normalizeLangCode(param);
  if (!normCode) return null;
  if (normCode === 'pali') return 'fts_tipitaka.db';
  const list = databases && databases.length > 0 ? databases : DEFAULT_FTS_DATABASES;
  const found = list.find(
    (d) => d.id === param || d.key === normCode || d.id === `fts_translation_${normCode}.db`
  );
  if (found) return found.id;
  return `fts_translation_${normCode}.db`;
}

function simulateUpdateUrlParams(initialUrlStr, paramsToUpdate) {
  const url = new URL(initialUrlStr);

  if (paramsToUpdate) {
    let targetLang = undefined;
    if (paramsToUpdate.l !== undefined) {
      targetLang = paramsToUpdate.l;
    } else if (paramsToUpdate.lang !== undefined) {
      targetLang = paramsToUpdate.lang;
    } else if (paramsToUpdate.db !== undefined) {
      targetLang = paramsToUpdate.db;
    }

    Object.entries(paramsToUpdate).forEach(([k, v]) => {
      if (k === 'book' || k === 'chapter' || k === 'c' || k === 'book_code') return;
      if (k === 'db' || k === 'lang' || k === 'l') return;
      if (v === null || v === undefined) {
        url.searchParams.delete(k);
      } else {
        url.searchParams.set(k, v);
      }
    });

    if (targetLang !== undefined) {
      const norm = normalizeLangCode(targetLang);
      if (norm && norm !== 'pali') {
        url.searchParams.set('l', norm);
      } else {
        url.searchParams.delete('l');
      }
    }

    if (paramsToUpdate.q === null && paramsToUpdate.l === undefined) {
      url.searchParams.delete('l');
    }
  }

  // Always clean up legacy 'db' and 'lang' from URL searchParams
  if (url.searchParams.has('db')) {
    const legacyDb = url.searchParams.get('db');
    url.searchParams.delete('db');
    if (!url.searchParams.has('l') && legacyDb) {
      const norm = normalizeLangCode(legacyDb);
      if (norm && norm !== 'pali') url.searchParams.set('l', norm);
    }
  }
  if (url.searchParams.has('lang')) {
    const legacyLang = url.searchParams.get('lang');
    url.searchParams.delete('lang');
    if (!url.searchParams.has('l') && legacyLang) {
      const norm = normalizeLangCode(legacyLang);
      if (norm && norm !== 'pali') url.searchParams.set('l', norm);
    }
  }
  if (url.searchParams.get('l') === 'pali') {
    url.searchParams.delete('l');
  }

  return url.pathname + (url.search || '');
}

console.log('1. Testing normalizeLangCode mapping:');
const normCases = [
  ['fts_translation_si.db', 'si'],
  ['fts_translation_en.db', 'en'],
  ['fts_translation_vi.db', 'vi'],
  ['fts_translation_my.db', 'my'],
  ['fts_translation_my_nissaya.db', 'my_nissaya'],
  ['fts_tipitaka.db', 'pali'],
  ['tipitaka.db', 'pali'],
  ['fts_pali.db', 'pali'],
  ['pali', 'pali'],
  ['sinhala', 'si'],
  ['si', 'si'],
  ['english', 'en'],
  ['en', 'en'],
  ['vietnamese', 'vi'],
  ['vi', 'vi'],
  ['my_nissaya', 'my_nissaya'],
  ['nissaya', 'my_nissaya'],
  ['thai', 'th'],
  ['th', 'th'],
  ['chinese', 'zh'],
  ['zh', 'zh'],
  ['hindi', 'hi'],
  ['hi', 'hi'],
  ['german', 'de'],
  ['de', 'de'],
];

for (const [input, expected] of normCases) {
  const result = normalizeLangCode(input);
  assert.strictEqual(result, expected, `Failed for normalizeLangCode("${input}")`);
}
console.log('  ✓ normalizeLangCode handles all databases, codes, and language names correctly.');

console.log('\n2. Testing resolveDbFromLangParam resolution:');
const resolveCases = [
  ['si', 'fts_translation_si.db'],
  ['en', 'fts_translation_en.db'],
  ['vi', 'fts_translation_vi.db'],
  ['my_nissaya', 'fts_translation_my_nissaya.db'],
  ['my', 'fts_translation_my.db'],
  ['pali', 'fts_tipitaka.db'],
  // Legacy / fallback cases:
  ['fts_translation_si.db', 'fts_translation_si.db'],
  ['fts_tipitaka.db', 'fts_tipitaka.db'],
  ['sinhala', 'fts_translation_si.db'],
  ['english', 'fts_translation_en.db'],
  ['vietnamese', 'fts_translation_vi.db'],
];

for (const [input, expected] of resolveCases) {
  const result = resolveDbFromLangParam(input);
  assert.strictEqual(result, expected, `Failed for resolveDbFromLangParam("${input}")`);
}
console.log('  ✓ resolveDbFromLangParam correctly maps primary "l" codes and legacy db/lang fallbacks.');

console.log('\n3. Testing URL parameter synchronization:');

// Pāḷi CST: l parameter omitted, db removed
const rPali = simulateUpdateUrlParams('http://85.190.97.158:3000/', { q: 'anatta', l: null, db: null });
assert.strictEqual(rPali, '/?q=anatta');

// Sinhala translation: l=si used, db not present
const rSi = simulateUpdateUrlParams('http://85.190.97.158:3000/', { q: 'buddha', l: 'si', db: null });
assert.strictEqual(rSi, '/?q=buddha&l=si');
assert(!rSi.includes('db='));

// Legacy link http://85.190.97.158:3000/?db=fts_translation_si.db&q=metta migrated to ?l=si&q=metta
const rLegacyDb = simulateUpdateUrlParams('http://85.190.97.158:3000/?db=fts_translation_si.db&q=metta', {});
assert.strictEqual(rLegacyDb, '/?q=metta&l=si');

// Legacy Pāḷi link ?db=fts_tipitaka.db&q=metta migrated to ?q=metta (l omitted)
const rLegacyPali = simulateUpdateUrlParams('http://85.190.97.158:3000/?db=fts_tipitaka.db&q=metta', {});
assert.strictEqual(rLegacyPali, '/?q=metta');

// Legacy lang link ?lang=vi&q=buddha migrated to ?l=vi&q=buddha
const rLegacyLang = simulateUpdateUrlParams('http://85.190.97.158:3000/?lang=vi&q=buddha', {});
assert.strictEqual(rLegacyLang, '/?q=buddha&l=vi');

console.log('  ✓ URL synchronization correctly strips db and uses l, omitting l for Pāḷi CST.');

// ---------------------------------------------------------
// PART 2: Real End-to-End Headless Browser CDP Tests
// ---------------------------------------------------------

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 100000);
  const msg = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(data.error);
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(msg);
  });
}

async function evaluate(ws, expression) {
  const res = await sendCdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return res.result?.value;
}

async function runBrowserTests() {
  console.log('\n4. Launching headless Chromium for live Next.js app testing...');
  const chrome = spawn(
    '/snap/bin/chromium',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/test-chrome-abstract-lang',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let ready = false;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }
  if (!ready) throw new Error('Chromium failed to start on port 9222');
  console.log('  ✓ Chromium debugger connected.');

  try {
    // 4.1 Test opening URL with clean abstract parameter: ?l=si&q=buddha
    console.log('\n[4.1] Navigating to http://localhost:3000/?l=si&q=buddha ...');
    const tabRes = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent('http://localhost:3000/?l=si&q=buddha')}`, { method: 'PUT' });
    const tab = await tabRes.json();
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));

    // Wait for search results to load
    let state41 = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      state41 = await evaluate(
        ws,
        `(() => {
          const select = document.querySelector('select[aria-label="Select FTS database"]');
          const summary = document.querySelector('.search-summary-bar');
          return {
            url: window.location.href,
            search: window.location.search,
            selectedDb: select ? select.value : null,
            summaryText: summary ? summary.innerText : null,
          };
        })()`
      );
      if (state41?.summaryText && state41.summaryText.includes('matches')) break;
    }
    console.log('  State:', state41);
    assert.strictEqual(state41.selectedDb, 'fts_translation_si.db', 'Selected DB must be Sinhala');
    assert(state41.search.includes('l=si'), 'URL must contain l=si');
    assert(!state41.search.includes('db='), 'URL must NOT contain db=');
    console.log('  ✓ http://localhost:3000/?l=si&q=buddha loaded Sinhala DB without db name in URL!');

    // 4.2 Test opening URL with legacy parameter: ?db=fts_translation_si.db&q=buddha
    console.log('\n[4.2] Navigating to legacy http://localhost:3000/?db=fts_translation_si.db&q=buddha ...');
    await evaluate(ws, `window.location.href = "http://localhost:3000/?db=fts_translation_si.db&q=buddha"`);
    let state42 = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      state42 = await evaluate(
        ws,
        `(() => {
          const select = document.querySelector('select[aria-label="Select FTS database"]');
          const summary = document.querySelector('.search-summary-bar');
          return {
            url: window.location.href,
            search: window.location.search,
            selectedDb: select ? select.value : null,
            summaryText: summary ? summary.innerText : null,
          };
        })()`
      );
      if (state42?.summaryText && state42.summaryText.includes('matches')) break;
    }
    console.log('  State:', state42);
    assert.strictEqual(state42.selectedDb, 'fts_translation_si.db', 'Legacy link must select Sinhala DB');
    assert(state42.search.includes('l=si'), 'URL must be updated to use l=si');
    assert(!state42.search.includes('db='), 'URL must have db= cleaned up/removed');
    console.log('  ✓ Legacy ?db=fts_translation_si.db cleaned up and migrated to ?l=si!');

    // 4.3 Test opening URL with Pāḷi CST: ?q=anatta (default) -> l must be omitted
    console.log('\n[4.3] Navigating to http://localhost:3000/?q=anatta ...');
    await evaluate(ws, `window.location.href = "http://localhost:3000/?q=anatta"`);
    let state43 = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      state43 = await evaluate(
        ws,
        `(() => {
          const select = document.querySelector('select[aria-label="Select FTS database"]');
          const summary = document.querySelector('.search-summary-bar');
          return {
            url: window.location.href,
            search: window.location.search,
            selectedDb: select ? select.value : null,
            summaryText: summary ? summary.innerText : null,
          };
        })()`
      );
      if (state43?.summaryText && state43.summaryText.includes('matches')) break;
    }
    console.log('  State:', state43);
    assert.strictEqual(state43.selectedDb, 'fts_tipitaka.db', 'Default search must select Pāḷi DB');
    assert(!state43.search.includes('l='), 'l parameter must be omitted for Pāḷi CST');
    assert(!state43.search.includes('db='), 'db parameter must not be present');
    console.log('  ✓ Pāḷi CST search leaves URL clean (?q=anatta without l or db)!');

    // 4.4 Test opening legacy Pāḷi link ?db=fts_tipitaka.db&q=anatta
    console.log('\n[4.4] Navigating to legacy http://localhost:3000/?db=fts_tipitaka.db&q=anatta ...');
    await evaluate(ws, `window.location.href = "http://localhost:3000/?db=fts_tipitaka.db&q=anatta"`);
    let state44 = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      state44 = await evaluate(
        ws,
        `(() => {
          const select = document.querySelector('select[aria-label="Select FTS database"]');
          const summary = document.querySelector('.search-summary-bar');
          return {
            url: window.location.href,
            search: window.location.search,
            selectedDb: select ? select.value : null,
            summaryText: summary ? summary.innerText : null,
          };
        })()`
      );
      if (state44?.summaryText && state44.summaryText.includes('matches')) break;
    }
    console.log('  State:', state44);
    assert.strictEqual(state44.selectedDb, 'fts_tipitaka.db');
    assert(!state44.search.includes('db='), 'db= must be cleaned up');
    assert(!state44.search.includes('l='), 'l= must be omitted');
    console.log('  ✓ Legacy ?db=fts_tipitaka.db cleaned up to clean ?q=anatta!');

    // 4.5 Test English translation ?l=en&q=truth
    console.log('\n[4.5] Navigating to http://localhost:3000/?l=en&q=truth ...');
    await evaluate(ws, `window.location.href = "http://localhost:3000/?l=en&q=truth"`);
    let state45 = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      state45 = await evaluate(
        ws,
        `(() => {
          const select = document.querySelector('select[aria-label="Select FTS database"]');
          const summary = document.querySelector('.search-summary-bar');
          return {
            url: window.location.href,
            search: window.location.search,
            selectedDb: select ? select.value : null,
            summaryText: summary ? summary.innerText : null,
          };
        })()`
      );
      if (state45?.summaryText && state45.summaryText.includes('matches')) break;
    }
    console.log('  State:', state45);
    assert.strictEqual(state45.selectedDb, 'fts_translation_en.db');
    assert(state45.search.includes('l=en'));
    assert(!state45.search.includes('db='));
    console.log('  ✓ English translation uses ?l=en without db=');

    // 4.6 Test Myanmar Nissaya ?l=my_nissaya&q=dhammo
    console.log('\n[4.6] Navigating to http://localhost:3000/?l=my_nissaya&q=dhammo ...');
    await evaluate(ws, `window.location.href = "http://localhost:3000/?l=my_nissaya&q=dhammo"`);
    let state46 = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      state46 = await evaluate(
        ws,
        `(() => {
          const select = document.querySelector('select[aria-label="Select FTS database"]');
          const summary = document.querySelector('.search-summary-bar');
          return {
            url: window.location.href,
            search: window.location.search,
            selectedDb: select ? select.value : null,
            summaryText: summary ? summary.innerText : null,
          };
        })()`
      );
      if (state46?.summaryText && state46.summaryText.includes('matches')) break;
    }
    console.log('  State:', state46);
    assert.strictEqual(state46.selectedDb, 'fts_translation_my_nissaya.db');
    assert(state46.search.includes('l=my_nissaya'));
    assert(!state46.search.includes('db='));
    console.log('  ✓ Myanmar Nissaya uses ?l=my_nissaya without db=');

    ws.close();
    console.log('\n🎉 ALL LIVE E2E BROWSER TESTS PASSED PERFECTLY!');
  } finally {
    chrome.kill();
  }
}

runBrowserTests().catch((err) => {
  console.error('\n❌ Browser test failed:', err);
  process.exit(1);
});
