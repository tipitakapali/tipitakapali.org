import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

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

async function main() {
  console.log('=== Automated Headless Chromium CDP Test for Tasks 1, 2, and 3 ===\n');

  let allPassed = true;
  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      allPassed = false;
    }
  }

  // ----------------------------------------------------
  // SUITE 3: Task 3 - Font Inspection & Local @font-face
  // ----------------------------------------------------
  console.log('--- SUITE 3: Task 3 - Be_Vietnam_Pro Font Verification ---');
  const fontDir = path.resolve('public/fonts/pali/Be_Vietnam_Pro');
  const files = fs.readdirSync(fontDir);
  console.log('Remaining files in Be_Vietnam_Pro:', files);

  const requiredFiles = [
    'BeVietnamPro-Regular.ttf',
    'BeVietnamPro-Italic.ttf',
    'BeVietnamPro-Medium.ttf',
    'BeVietnamPro-SemiBold.ttf',
    'BeVietnamPro-Bold.ttf',
  ];
  for (const rf of requiredFiles) {
    assert(files.includes(rf), `Core font file ${rf} exists`);
  }

  const deletedFiles = [
    'BeVietnamPro-Thin.ttf',
    'BeVietnamPro-ThinItalic.ttf',
    'BeVietnamPro-ExtraLight.ttf',
    'BeVietnamPro-Light.ttf',
    'BeVietnamPro-ExtraBold.ttf',
    'BeVietnamPro-Black.ttf',
  ];
  for (const df of deletedFiles) {
    assert(!files.includes(df), `Unnecessary font file ${df} was deleted`);
  }

  const globalsCss = fs.readFileSync('app/globals.css', 'utf8');
  assert(!globalsCss.includes('fonts.googleapis.com'), 'globals.css does NOT use external Google Fonts CDN');
  assert(globalsCss.includes('/fonts/pali/Be_Vietnam_Pro/'), 'globals.css defines local @font-face for Be Vietnam Pro');

  const paliFontsCss = fs.readFileSync('app/pali-fonts.css', 'utf8');
  assert(paliFontsCss.includes('/fonts/pali/Be_Vietnam_Pro/'), 'pali-fonts.css defines local @font-face for Be Vietnam Pro');
  assert(paliFontsCss.includes('.reader-trans-block[data-trans-lang="vi"]'), 'pali-fonts.css applies font to Vietnamese blocks');

  // ----------------------------------------------------
  // Launch Headless Chromium for Browser Verification
  // ----------------------------------------------------
  console.log('\nLaunching headless Chromium on port 9222...');
  const chrome = spawn(
    '/snap/bin/chromium',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1280,900',
      '--user-data-dir=/tmp/test-chrome-tasks-123-clean',
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

  if (!ready) {
    throw new Error('Chromium failed to become ready on port 9222');
  }

  console.log('Opening /book/s0101m.mul/0 in Chromium...');
  const tabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book/s0101m.mul/0', { method: 'PUT' });
  const tab = await tabRes.json();

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));

  await sendCdp(ws, 'Runtime.enable');
  await sendCdp(ws, 'Page.enable');

  console.log('Waiting for reader to load initial state...');
  await sleep(4000);

  // ----------------------------------------------------
  // SUITE 2: Task 2 - Language Menu & Translation Order
  // ----------------------------------------------------
  console.log('\n--- SUITE 2: Task 2 - Myanmar Nissaya Position Verification ---');

  // Test 2.1: Clean reset to verify default positions
  await evaluate(ws, `(() => {
    localStorage.removeItem('tipitaka_advanced_settings_v4');
    localStorage.removeItem('tipitaka_advanced_settings_v3');
    location.reload();
  })()`);
  await sleep(3500);

  // Open Language Menu via button click
  await evaluate(ws, `(() => {
    const allBtns = Array.from(document.querySelectorAll('button'));
    const langBtn = allBtns.find(b => b.querySelector('svg.lucide-languages') || b.textContent.includes('Languages') || b.title?.toLowerCase().includes('translation'));
    if (langBtn) langBtn.click();
  })()`);
  await sleep(1000);

  const menuItems = await evaluate(ws, `(() => {
    const items = Array.from(document.querySelectorAll('span, div, button'))
      .map(el => el.textContent?.trim())
      .filter(t => t === 'မြန်မာ' || t === 'မြန်မာ နိဿယ');
    return items;
  })()`);

  console.log('Language menu detected items sequence:', menuItems);
  const myanmarFirstIdx = menuItems.indexOf('မြန်မာ');
  const nissayaFirstIdx = menuItems.indexOf('မြန်မာ နိဿယ');
  assert(myanmarFirstIdx !== -1, 'Found မြန်မာ in language menu');
  assert(nissayaFirstIdx !== -1, 'Found မြန်မာ နိဿယ in language menu');
  assert(nissayaFirstIdx === myanmarFirstIdx + 1, 'မြန်မာ နိဿယ is located RIGHT UNDER မြန်မာ in Language Menu');

  // Test 2.2: Verify migration from old settings where my_nissaya was at the end
  await evaluate(ws, `(() => {
    const key = 'tipitaka_advanced_settings_v4';
    const oldSettings = {
      translations: { pali: true },
      translationOrder: ['pali', 'english', 'vietnamese', 'myanmar', 'sinhala', 'chinese', 'khmer', 'thai', 'lao', 'tamil', 'hindi', 'german', 'japanese', 'korean', 'portuguese', 'russian', 'my_nissaya']
    };
    localStorage.setItem(key, JSON.stringify(oldSettings));
    location.reload();
  })()`);
  await sleep(4000);

  const migratedOrder = await evaluate(ws, `(() => {
    const key = 'tipitaka_advanced_settings_v4';
    const settings = JSON.parse(localStorage.getItem(key) || '{}');
    const order = settings.translationOrder || [];
    const myIdx = order.indexOf('myanmar');
    const nisIdx = order.indexOf('my_nissaya');
    return { order, myIdx, nisIdx };
  })()`);

  console.log('Migrated order check:', migratedOrder);
  assert(migratedOrder.nisIdx === migratedOrder.myIdx + 1, 'Migration places my_nissaya right under myanmar');

  // ----------------------------------------------------
  // SUITE 1: Task 1 - Click on custom colored Pali & Translations
  // ----------------------------------------------------
  console.log('\n--- SUITE 1: Task 1 - Word Lookup on Custom Colored Pali & Translations ---');

  // Enable multiple translations (English, Vietnamese, Myanmar, my_nissaya) and custom Pali color
  await evaluate(ws, `(() => {
    const key = 'tipitaka_advanced_settings_v4';
    const settings = {
      translations: {
        pali: true,
        english: true,
        vietnamese: true,
        myanmar: true,
        my_nissaya: true,
      },
      translationColors: {
        pali: {
          bg: '#fee2e2',
          text: '#7f1d1d',
          border: '#b91c1c',
        }
      },
      translationOrder: ['pali', 'english', 'vietnamese', 'myanmar', 'my_nissaya'],
      translationDisplayMode: 'stack',
      dictLookupTrigger: 'single',
    };
    localStorage.setItem(key, JSON.stringify(settings));
    localStorage.setItem('tipitaka_dict_click_mode', 'single');
    localStorage.setItem('tipitaka_dict_click_lookup', 'true');
    location.reload();
  })()`);
  await sleep(4500);

  // Test 1.1: Verify custom Pali colors are applied and Pali is wrapped in .reader-pali-trans-block
  const paliWrapper = await evaluate(ws, `(() => {
    const paliBlock = document.querySelector('.reader-pali-trans-block, .reader-trans-block[data-trans-lang="pali"]');
    return {
      hasPaliBlock: Boolean(paliBlock),
      classes: paliBlock?.className,
      style: paliBlock?.getAttribute('style'),
    };
  })()`);
  console.log('Pali custom color block:', paliWrapper);
  assert(paliWrapper.hasPaliBlock, 'Pali has custom color block (.reader-pali-trans-block)');

  // Test 1.2: Click on Pali word with custom colors applied
  const paliClickResult = await evaluate(ws, `(() => {
    const paliP = document.querySelector('.reader-pali-trans-block p, .reader-trans-block[data-trans-lang="pali"] p');
    if (!paliP) return { error: 'No Pali paragraph found' };

    paliP.scrollIntoView({ block: 'center' });

    const textNode = Array.from(paliP.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 3);
    if (!textNode) return { error: 'No suitable text node in Pali' };

    const text = textNode.textContent;
    const match = /\\b([a-zA-ZāīūṭḍṇṅñḷṃA-ZĀĪŪṬḌṆṄÑḶṂ]{3,})\\b/.exec(text);
    if (!match) return { error: 'No match in text' };
    const word = match[1];
    const offset = match.index + 1;

    const range = document.createRange();
    range.setStart(textNode, offset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();

    const targetEl = document.elementFromPoint(rect.left, rect.top) || paliP;
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left,
      clientY: rect.top,
    });
    targetEl.dispatchEvent(clickEvent);

    return { clickedWord: word, clientX: rect.left, clientY: rect.top };
  })()`);
  console.log('Pali click simulation:', paliClickResult);
  await sleep(1500);

  const dictStateAfterPaliClick = await evaluate(ws, `(() => {
    const dictInput = document.querySelector('input[placeholder*="dictionary" i], input[placeholder*="word" i], input[type="search"]');
    const headerWord = document.querySelector('.dict-query-display, .font-serif');
    return {
      dictVisible: Boolean(dictInput || document.querySelector('.dictionary-modal, [data-dict-dock]')),
      inputValue: dictInput?.value,
      headerText: headerWord?.textContent,
    };
  })()`);
  console.log('Dictionary state after clicking custom colored Pali:', dictStateAfterPaliClick);
  assert(dictStateAfterPaliClick.dictVisible, 'Dictionary opened when clicking Pali word with custom color applied');
  assert(
    dictStateAfterPaliClick.inputValue?.toLowerCase() === paliClickResult.clickedWord?.toLowerCase() ||
    dictStateAfterPaliClick.headerText?.toLowerCase().includes(paliClickResult.clickedWord?.toLowerCase()),
    `Dictionary displays clicked Pali word "${paliClickResult.clickedWord}"`
  );

  // Test 1.3: Click on an English translation word
  console.log('\nTesting click on English translation word...');
  const enClickResult = await evaluate(ws, `(() => {
    const enBlock = document.querySelector('.reader-trans-block[data-trans-lang="english"] .reader-trans-content, .reader-trans-block[data-trans-lang="en"] .reader-trans-content');
    if (!enBlock) return { error: 'No English translation block found' };

    enBlock.scrollIntoView({ block: 'center' });

    const textNode = Array.from(enBlock.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 3)
      || enBlock.firstChild;
    if (!textNode) return { error: 'No text node in English block' };

    const text = textNode.textContent || '';
    const match = /\\b([A-Za-z]{4,})\\b/.exec(text);
    if (!match) return { error: 'No word found in English' };
    const word = match[1];
    const offset = match.index + 2;

    const range = document.createRange();
    range.setStart(textNode, offset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();

    const targetEl = document.elementFromPoint(rect.left, rect.top) || enBlock;
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left,
      clientY: rect.top,
    });
    targetEl.dispatchEvent(clickEvent);

    return { clickedWord: word, clientX: rect.left, clientY: rect.top };
  })()`);
  console.log('English click simulation:', enClickResult);
  await sleep(1500);

  const dictStateAfterEnClick = await evaluate(ws, `(() => {
    const dictInput = document.querySelector('input[placeholder*="dictionary" i], input[placeholder*="word" i], input[type="search"]');
    const headerWord = document.querySelector('.dict-query-display, .font-serif');
    return {
      inputValue: dictInput?.value,
      headerText: headerWord?.textContent,
      isOpen: Boolean(document.querySelector('.dict-dock-panel, .dict-panel-modal, .dict-header-bar')),
    };
  })()`);
  console.log('Dictionary state after English click:', dictStateAfterEnClick);
  assert(dictStateAfterEnClick.isOpen, 'Dictionary opened when clicking on English translation');
  if (enClickResult.clickedWord) {
    assert(
      dictStateAfterEnClick.inputValue?.toLowerCase() === enClickResult.clickedWord?.toLowerCase() ||
      dictStateAfterEnClick.headerText?.toLowerCase().includes(enClickResult.clickedWord?.toLowerCase()),
      `Dictionary looked up English word "${enClickResult.clickedWord}"`
    );
  }

  // Test 1.4: Click on Vietnamese translation word
  console.log('\nTesting click on Vietnamese translation word...');
  const viClickResult = await evaluate(ws, `(() => {
    const viBlock = document.querySelector('.reader-trans-block[data-trans-lang="vietnamese"] .reader-trans-content, .reader-trans-block[data-trans-lang="vi"] .reader-trans-content');
    if (!viBlock) return { error: 'No Vietnamese translation block found' };

    viBlock.scrollIntoView({ block: 'center' });

    const textNode = Array.from(viBlock.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 2)
      || viBlock.firstChild;
    if (!textNode) return { error: 'No text node in Vietnamese block' };

    const text = textNode.textContent || '';
    const match = /\\b([a-zA-ZàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]{3,})\\b/u.exec(text);
    if (!match) return { error: 'No word found in Vietnamese' };
    const word = match[1];
    const offset = match.index + 1;

    const range = document.createRange();
    range.setStart(textNode, offset);
    range.collapse(true);
    const rect = range.getBoundingClientRect();

    const targetEl = document.elementFromPoint(rect.left, rect.top) || viBlock;
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left,
      clientY: rect.top,
    });
    targetEl.dispatchEvent(clickEvent);

    return { clickedWord: word, clientX: rect.left, clientY: rect.top };
  })()`);
  console.log('Vietnamese click simulation:', viClickResult);
  await sleep(1500);

  const dictStateAfterViClick = await evaluate(ws, `(() => {
    const dictInput = document.querySelector('input[placeholder*="dictionary" i], input[placeholder*="word" i], input[type="search"]');
    const headerWord = document.querySelector('.dict-query-display, .font-serif');
    return {
      inputValue: dictInput?.value,
      headerText: headerWord?.textContent,
      isOpen: Boolean(document.querySelector('.dict-dock-panel, .dict-panel-modal, .dict-header-bar')),
    };
  })()`);
  console.log('Dictionary state after Vietnamese click:', dictStateAfterViClick);
  assert(dictStateAfterViClick.isOpen, 'Dictionary opened when clicking on Vietnamese translation');
  if (viClickResult.clickedWord) {
    assert(
      dictStateAfterViClick.inputValue?.toLowerCase() === viClickResult.clickedWord?.toLowerCase() ||
      dictStateAfterViClick.headerText?.toLowerCase().includes(viClickResult.clickedWord?.toLowerCase()),
      `Dictionary looked up Vietnamese word "${viClickResult.clickedWord}"`
    );
  }

  // Test 1.5: Double click word lookup
  console.log('\nTesting double click on translation word...');
  await evaluate(ws, `(() => {
    const key = 'tipitaka_advanced_settings_v4';
    const settings = JSON.parse(localStorage.getItem(key) || '{}');
    settings.dictLookupTrigger = 'double';
    localStorage.setItem(key, JSON.stringify(settings));
    localStorage.setItem('tipitaka_dict_click_mode', 'double');
    location.reload();
  })()`);
  await sleep(3500);

  const doubleClickResult = await evaluate(ws, `(() => {
    const enBlock = document.querySelector('.reader-trans-block[data-trans-lang="english"] .reader-trans-content, .reader-trans-block[data-trans-lang="en"] .reader-trans-content');
    if (!enBlock) return { error: 'No English block' };

    enBlock.scrollIntoView({ block: 'center' });

    const textNode = Array.from(enBlock.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 3) || enBlock.firstChild;
    const text = textNode?.textContent || '';
    const match = /\\b([A-Za-z]{4,})\\b/.exec(text);
    if (!match) return { error: 'No word' };
    const word = match[1];

    const range = document.createRange();
    range.setStart(textNode, match.index);
    range.setEnd(textNode, match.index + word.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const rect = range.getBoundingClientRect();
    const targetEl = document.elementFromPoint(rect.left + 5, rect.top + 5) || enBlock;

    const dblClickEvent = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 5,
      clientY: rect.top + 5,
    });
    targetEl.dispatchEvent(dblClickEvent);

    return { word };
  })()`);
  console.log('Double click result:', doubleClickResult);
  await sleep(1500);

  const dictStateAfterDblClick = await evaluate(ws, `(() => {
    const dictInput = document.querySelector('input[placeholder*="dictionary" i], input[placeholder*="word" i], input[type="search"]');
    const headerWord = document.querySelector('.dict-query-display, .font-serif');
    return {
      inputValue: dictInput?.value,
      headerText: headerWord?.textContent,
      isOpen: Boolean(document.querySelector('.dict-dock-panel, .dict-panel-modal, .dict-header-bar')),
    };
  })()`);
  console.log('Dictionary state after double click:', dictStateAfterDblClick);
  assert(dictStateAfterDblClick.isOpen, 'Dictionary opened on double click');

  // Test 3.2: Computed font family for Vietnamese translation
  console.log('\nChecking computed font family on Vietnamese translation...');
  const viFont = await evaluate(ws, `(() => {
    const viBlock = document.querySelector('.reader-trans-block[data-trans-lang="vietnamese"], .reader-trans-block[data-trans-lang="vi"]');
    const content = viBlock?.querySelector('.reader-trans-content');
    return {
      blockFont: viBlock ? window.getComputedStyle(viBlock).fontFamily : null,
      contentFont: content ? window.getComputedStyle(content).fontFamily : null,
    };
  })()`);
  console.log('Vietnamese computed font styles:', viFont);
  assert(viFont.blockFont?.includes('Be Vietnam Pro'), 'Vietnamese block computed font includes "Be Vietnam Pro"');
  assert(viFont.contentFont?.includes('Be Vietnam Pro'), 'Vietnamese content computed font includes "Be Vietnam Pro"');

  // Close chrome
  try {
    chrome.kill();
  } catch {}

  console.log('\n=======================================');
  if (allPassed) {
    console.log('✓ ALL TESTS PASSED SUCCESSFULLY (0 ERRORS)');
    process.exit(0);
  } else {
    console.error('✗ SOME TESTS FAILED');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
