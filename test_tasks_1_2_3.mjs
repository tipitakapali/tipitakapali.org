import { spawn } from 'child_process';

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
  console.log('=== Automated CDP Test for Tasks 1, 2, and 3 ===\n');

  console.log('1. Launching headless Chromium on port 9222...');
  const chrome = spawn(
    '/snap/bin/chromium',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
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

  console.log('2. Opening /book/s0101m.mul/0 in Chromium...');
  const tabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book/s0101m.mul/0', { method: 'PUT' });
  const tab = await tabRes.json();

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));

  await sendCdp(ws, 'Runtime.enable');
  await sendCdp(ws, 'Page.enable');

  console.log('3. Waiting for reader to load initial state...');
  await sleep(4000);

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
  // TEST SUITE 1: Task 1 - Traditional Tipitaka Indents
  // ----------------------------------------------------
  console.log('\n--- SUITE 1: Task 1 - Traditional Tipitaka Indents ---');

  // Test 1.1: When paragraphIndent is TRUE (default), both Pali and Translation have indent
  console.log('Setting paragraphIndent=true, translationOrder=["pali", "english"], english=true (Stack Mode)...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translations = { ...(existing.translations || {}), pali: true, english: true };
      existing.translationOrder = ['pali', 'english'];
      existing.translationDisplayMode = 'stack';
      existing.paragraphIndent = true;
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const indentMetricsEnabled = await evaluate(ws, `(() => {
    const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
    if (!row) return { error: 'Row not found' };
    const paliP = row.querySelector('p.bodytext, p[data-pindex="5"]');
    const transBlock = row.querySelector('.reader-trans-block[data-trans-lang="en"]');
    const transContent = transBlock?.querySelector('.reader-trans-content');
    return {
      bodyNoIndent: document.body.classList.contains('no-indent'),
      paliTextIndent: paliP ? window.getComputedStyle(paliP).textIndent : null,
      transTextIndent: transContent ? window.getComputedStyle(transContent).textIndent : null,
      transClasses: transContent ? transContent.className : null,
    };
  })()`);

  console.log('Indent metrics when paragraphIndent=true:', indentMetricsEnabled);
  assert(!indentMetricsEnabled.bodyNoIndent, 'Body should NOT have .no-indent class');
  assert(indentMetricsEnabled.transClasses?.includes('bodytext'), 'Translation content has bodytext class matching Pali');
  assert(
    parseFloat(indentMetricsEnabled.paliTextIndent) > 0,
    `Pali text has text-indent > 0 (${indentMetricsEnabled.paliTextIndent})`
  );
  assert(
    parseFloat(indentMetricsEnabled.transTextIndent) > 0,
    `Translation text has text-indent > 0 (${indentMetricsEnabled.transTextIndent})`
  );

  // Test 1.2: When paragraphIndent is FALSE, indents are removed on BOTH Pali and Translation
  console.log('\nSetting paragraphIndent=false...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.paragraphIndent = false;
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const indentMetricsDisabled = await evaluate(ws, `(() => {
    const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
    if (!row) return { error: 'Row not found' };
    const paliP = row.querySelector('p.bodytext, p[data-pindex="5"]');
    const transBlock = row.querySelector('.reader-trans-block[data-trans-lang="en"]');
    const transContent = transBlock?.querySelector('.reader-trans-content');
    return {
      bodyNoIndent: document.body.classList.contains('no-indent'),
      paliTextIndent: paliP ? window.getComputedStyle(paliP).textIndent : null,
      transTextIndent: transContent ? window.getComputedStyle(transContent).textIndent : null,
    };
  })()`);

  console.log('Indent metrics when paragraphIndent=false:', indentMetricsDisabled);
  assert(indentMetricsDisabled.bodyNoIndent, 'Body has .no-indent class');
  assert(
    parseFloat(indentMetricsDisabled.paliTextIndent) === 0,
    `Pali text-indent is 0px when disabled (${indentMetricsDisabled.paliTextIndent})`
  );
  assert(
    parseFloat(indentMetricsDisabled.transTextIndent) === 0,
    `Translation text-indent is 0px when disabled (${indentMetricsDisabled.transTextIndent})`
  );

  // Test 1.3: Indents in Side-by-Side Mode
  console.log('\nTesting indents in Side-by-Side Mode...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translationDisplayMode = 'side';
      existing.paragraphIndent = true;
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const sideIndentMetrics = await evaluate(ws, `(() => {
    const row = document.querySelector('.reader-trans-side-row[data-pindex="5"]');
    if (!row) return { error: 'Side row not found' };
    const paliP = row.querySelector('p.bodytext, p[data-pindex="5"]');
    const transContent = row.querySelector('.reader-trans-content');
    return {
      paliTextIndent: paliP ? window.getComputedStyle(paliP).textIndent : null,
      transTextIndent: transContent ? window.getComputedStyle(transContent).textIndent : null,
    };
  })()`);

  console.log('Side-by-side indent metrics:', sideIndentMetrics);
  assert(
    parseFloat(sideIndentMetrics.paliTextIndent) > 0,
    `Side mode: Pali text has text-indent > 0 (${sideIndentMetrics.paliTextIndent})`
  );
  assert(
    parseFloat(sideIndentMetrics.transTextIndent) > 0,
    `Side mode: Translation has text-indent > 0 (${sideIndentMetrics.transTextIndent})`
  );

  // ----------------------------------------------------
  // TEST SUITE 2: Task 2 - Pali border-left when not top
  // ----------------------------------------------------
  console.log('\n--- SUITE 2: Task 2 - Pali Border-Left When Not Top ---');

  // Test 2.1: Default order ['pali', 'english'] - Pali is at top, should NOT have border-left
  console.log('Setting translationOrder=["pali", "english"] (Stack Mode)...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translationOrder = ['pali', 'english'];
      existing.translationDisplayMode = 'stack';
      existing.paragraphIndent = true;
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const paliTopMetrics = await evaluate(ws, `(() => {
    const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
    if (!row) return { error: 'Row not found' };
    const paliP = row.querySelector('p.bodytext, p[data-pindex="5"]');
    const paliTransBlock = row.querySelector('.reader-pali-trans-block');
    const englishBlock = row.querySelector('.reader-trans-block[data-trans-lang="en"]');
    return {
      paliIsWrappedInTransBlock: Boolean(paliTransBlock),
      paliBorderWidth: paliP ? window.getComputedStyle(paliP).borderLeftWidth : null,
      englishBorderWidth: englishBlock ? window.getComputedStyle(englishBlock).borderLeftWidth : null,
    };
  })()`);

  console.log('Metrics when Pali is top:', paliTopMetrics);
  assert(!paliTopMetrics.paliIsWrappedInTransBlock, 'Pali is NOT wrapped in reader-pali-trans-block when in top position');
  assert(
    parseFloat(paliTopMetrics.paliBorderWidth || '0') === 0,
    `Pali has no border-left when in top position (${paliTopMetrics.paliBorderWidth})`
  );
  assert(
    parseFloat(paliTopMetrics.englishBorderWidth || '0') > 0,
    `English translation block has border-left (${paliTopMetrics.englishBorderWidth})`
  );

  // Test 2.2: Reordered ['english', 'pali'] - English is top, Pali is NOT top: Pali MUST have border-left!
  console.log('\nSetting translationOrder=["english", "pali"] (Stack Mode)...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translationOrder = ['english', 'pali'];
      existing.translationDisplayMode = 'stack';
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const paliNotTopMetrics = await evaluate(ws, `(() => {
    const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
    if (!row) return { error: 'Row not found' };
    const firstChild = row.firstElementChild;
    const paliTransBlock = row.querySelector('.reader-pali-trans-block, .reader-trans-block[data-trans-lang="pali"]');
    const paliP = paliTransBlock?.querySelector('p.bodytext, p[data-pindex="5"]');
    return {
      firstBlockLang: firstChild ? firstChild.getAttribute('data-trans-lang') : null,
      paliBlockFound: Boolean(paliTransBlock),
      paliBorderLeftWidth: paliTransBlock ? window.getComputedStyle(paliTransBlock).borderLeftWidth : null,
      paliBorderLeftColor: paliTransBlock ? window.getComputedStyle(paliTransBlock).borderLeftColor : null,
      paliBackground: paliTransBlock ? window.getComputedStyle(paliTransBlock).backgroundColor : null,
      paliPInside: Boolean(paliP),
    };
  })()`);

  console.log('Metrics when Pali is NOT top (Stack Mode):', paliNotTopMetrics);
  assert(paliNotTopMetrics.firstBlockLang === 'en', 'English block is first in the row');
  assert(paliNotTopMetrics.paliBlockFound, 'Pali is wrapped in .reader-pali-trans-block / [data-trans-lang="pali"]');
  assert(
    parseFloat(paliNotTopMetrics.paliBorderLeftWidth || '0') > 0,
    `Pali has border-left when not in top position (${paliNotTopMetrics.paliBorderLeftWidth})`
  );
  assert(paliNotTopMetrics.paliPInside, 'Pali original paragraph is preserved inside the block');

  // Test 2.3: Reordered ['english', 'pali'] in Side-by-Side Mode
  console.log('\nSetting translationOrder=["english", "pali"] (Side-by-Side Mode)...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translationOrder = ['english', 'pali'];
      existing.translationDisplayMode = 'side';
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const paliNotTopSideMetrics = await evaluate(ws, `(() => {
    const row = document.querySelector('.reader-trans-side-row[data-pindex="5"]');
    if (!row) return { error: 'Side row not found' };
    const colLeft = row.querySelector('.reader-side-col-left');
    const colRight = row.querySelector('.reader-side-col-right');
    const leftTransBlock = colLeft?.querySelector('.reader-trans-block');
    const paliTransBlock = colRight?.querySelector('.reader-pali-trans-block, .reader-trans-block[data-trans-lang="pali"]');
    return {
      leftTransLang: leftTransBlock ? leftTransBlock.getAttribute('data-trans-lang') : null,
      paliBlockInRightCol: Boolean(paliTransBlock),
      paliBorderLeftWidth: paliTransBlock ? window.getComputedStyle(paliTransBlock).borderLeftWidth : null,
    };
  })()`);

  console.log('Metrics when Pali is NOT top (Side-by-Side Mode):', paliNotTopSideMetrics);
  assert(paliNotTopSideMetrics.leftTransLang === 'en', 'Side mode: English is in left column');
  assert(paliNotTopSideMetrics.paliBlockInRightCol, 'Side mode: Pali block is in right column');
  assert(
    parseFloat(paliNotTopSideMetrics.paliBorderLeftWidth || '0') > 0,
    `Side mode: Pali has border-left when in right column (${paliNotTopSideMetrics.paliBorderLeftWidth})`
  );

  // ----------------------------------------------------
  // TEST SUITE 3: Task 3 - Color Customization UI & Rendering
  // ----------------------------------------------------
  console.log('\n--- SUITE 3: Task 3 - Color Customization UI & Dynamic Styling ---');

  // Test 3.1: Open Language Menu and verify "Color" (Palette) button exists for each language
  console.log('Testing Language Menu Color buttons...');
  await evaluate(ws, `(() => {
    const langBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Language'));
    if (langBtn) langBtn.click();
  })()`);
  await sleep(600);

  const paletteButtonsCount = await evaluate(ws, `(() => {
    const paletteButtons = document.querySelectorAll('button[title*="Customize colors"]');
    return paletteButtons.length;
  })()`);

  console.log('Palette buttons found in LanguageMenu:', paletteButtonsCount);
  assert(paletteButtonsCount >= 17, `Color button exists for all languages (found ${paletteButtonsCount})`);

  // Test 3.2: Click Palette button for English to open Color Picker Modal
  console.log('\nClicking Color button for English...');
  await evaluate(ws, `(() => {
    const enBtn = document.querySelector('button[aria-label*="Customize colors for English"]');
    if (enBtn) enBtn.click();
  })()`);
  await sleep(600);

  const colorModalElements = await evaluate(ws, `(() => {
    const colorInputs = document.querySelectorAll('input[type="color"]');
    const textInputs = document.querySelectorAll('input[placeholder*="hex"], input[placeholder*="Default"]');
    const randomBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Random Color'));
    const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Reset'));
    return {
      colorInputsCount: colorInputs.length,
      textInputsCount: textInputs.length,
      hasRandomBtn: Boolean(randomBtn),
      hasResetBtn: Boolean(resetBtn),
    };
  })()`);

  console.log('Color picker modal structure:', colorModalElements);
  assert(colorModalElements.colorInputsCount >= 3, `Has native color pickers for bg, text, border (${colorModalElements.colorInputsCount})`);
  assert(colorModalElements.textInputsCount >= 3, `Has manual text inputs for bg, text, border (${colorModalElements.textInputsCount})`);
  assert(colorModalElements.hasRandomBtn, 'Has "Random Color" button');
  assert(colorModalElements.hasResetBtn, 'Has "Reset" button');

  // Test 3.3: Apply custom colors via settings and verify rendering in ReaderView
  console.log('\nApplying custom colors to English: bg=#e0e7ff, text=#1e3a8a, border=#4f46e5...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translations = { ...(existing.translations || {}), pali: true, english: true };
      existing.translationOrder = ['pali', 'english'];
      existing.translationDisplayMode = 'stack';
      existing.translationColors = {
        ...(existing.translationColors || {}),
        english: {
          bg: '#e0e7ff',
          text: '#1e3a8a',
          border: '#4f46e5',
        },
      };
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const englishRenderedColors = await evaluate(ws, `(() => {
    const enBlock = document.querySelector('.reader-trans-block[data-trans-lang="en"]');
    const enContent = enBlock?.querySelector('.reader-trans-content');
    if (!enBlock) return { error: 'English block not found' };
    const computedBlock = window.getComputedStyle(enBlock);
    const computedContent = enContent ? window.getComputedStyle(enContent) : null;
    return {
      borderLeftColor: computedBlock.borderLeftColor,
      backgroundColor: computedBlock.backgroundColor,
      textColor: computedContent?.color || computedBlock.color,
    };
  })()`);

  console.log('English rendered colors in Reader:', englishRenderedColors);
  // #4f46e5 -> rgb(79, 70, 229)
  assert(
    englishRenderedColors.borderLeftColor.includes('79, 70, 229'),
    `English border-left-color is #4f46e5 (${englishRenderedColors.borderLeftColor})`
  );
  // #e0e7ff -> rgb(224, 231, 255)
  assert(
    englishRenderedColors.backgroundColor.includes('224, 231, 255'),
    `English background-color is #e0e7ff (${englishRenderedColors.backgroundColor})`
  );
  // #1e3a8a -> rgb(30, 58, 138)
  assert(
    englishRenderedColors.textColor.includes('30, 58, 138'),
    `English text color is #1e3a8a (${englishRenderedColors.textColor})`
  );

  // Test 3.4: Test Random Color generation button in UI
  console.log('\nTesting Random Color button generation in LanguageMenu...');
  await evaluate(ws, `(() => {
    const langBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Language'));
    if (langBtn) langBtn.click();
  })()`);
  await sleep(500);
  await evaluate(ws, `(() => {
    const enBtn = document.querySelector('button[aria-label*="Customize colors for English"]');
    if (enBtn) enBtn.click();
  })()`);
  await sleep(500);

  const beforeRandom = await evaluate(ws, `JSON.parse(localStorage.getItem('tipitaka_advanced_settings_v4') || '{}')`);
  console.log('Before random color:', beforeRandom.translationColors?.english);

  await evaluate(ws, `(() => {
    const randomBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Random Color'));
    if (randomBtn) randomBtn.click();
  })()`);
  await sleep(400);

  const afterRandom = await evaluate(ws, `JSON.parse(localStorage.getItem('tipitaka_advanced_settings_v4') || '{}')`);
  const randomEnglish = afterRandom.translationColors?.english;
  console.log('After random color click:', randomEnglish);

  assert(Boolean(randomEnglish?.bg), `Random background color generated (${randomEnglish?.bg})`);
  assert(Boolean(randomEnglish?.text), `Random text color generated (${randomEnglish?.text})`);
  assert(Boolean(randomEnglish?.border), `Random border color generated (${randomEnglish?.border})`);
  assert(
    randomEnglish?.bg !== beforeRandom.translationColors?.english?.bg,
    'Random color updated the background'
  );

  // Test 3.5: Test Reset button in UI
  console.log('\nTesting Reset button in Color Customizer...');
  await evaluate(ws, `(() => {
    const resetBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Reset'));
    if (resetBtn) resetBtn.click();
  })()`);
  await sleep(400);

  const afterReset = await evaluate(ws, `JSON.parse(localStorage.getItem('tipitaka_advanced_settings_v4') || '{}')`);
  console.log('After reset:', afterReset.translationColors?.english);
  assert(!afterReset.translationColors?.english, 'English custom colors removed from settings on reset');

  // Test 3.6: Test Pali Custom Colors when Pali is reordered below English
  console.log('\nTesting custom colors on Pali block when reordered...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translations = { ...(existing.translations || {}), pali: true, english: true };
      existing.translationOrder = ['english', 'pali'];
      existing.translationDisplayMode = 'stack';
      existing.translationColors = {
        pali: {
          bg: '#fee2e2',
          text: '#881337',
          border: '#dc2626',
        },
      };
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const paliCustomRendered = await evaluate(ws, `(() => {
    const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
    const paliBlock = row?.querySelector('.reader-pali-trans-block');
    const paliP = paliBlock?.querySelector('p.bodytext, p[data-pindex="5"]');
    if (!paliBlock) return { error: 'Pali block not found' };
    return {
      borderLeftColor: window.getComputedStyle(paliBlock).borderLeftColor,
      backgroundColor: window.getComputedStyle(paliBlock).backgroundColor,
      textColor: paliP ? window.getComputedStyle(paliP).color : null,
    };
  })()`);

  console.log('Pali custom rendered colors when reordered:', paliCustomRendered);
  assert(
    paliCustomRendered.borderLeftColor.includes('220, 38, 38'),
    `Pali custom border-left-color applied (${paliCustomRendered.borderLeftColor})`
  );
  assert(
    paliCustomRendered.backgroundColor.includes('254, 226, 226'),
    `Pali custom background-color applied (${paliCustomRendered.backgroundColor})`
  );
  assert(
    paliCustomRendered.textColor.includes('136, 19, 55'),
    `Pali custom text color applied (${paliCustomRendered.textColor})`
  );

  // Test 3.7: Enter manual hex codes WITHOUT leading '#' and verify proper formatting
  console.log('\nTesting manual hex input WITHOUT leading hash (#): bg=dcfce7, text=064e3b, border=059669...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translations = { ...(existing.translations || {}), pali: true, english: true };
      existing.translationOrder = ['pali', 'english'];
      existing.translationDisplayMode = 'stack';
      existing.translationColors = {
        english: {
          bg: 'dcfce7',
          text: '064e3b',
          border: '059669',
        },
      };
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(4000);

  const rawHexMetrics = await evaluate(ws, `(() => {
    const enBlock = document.querySelector('.reader-trans-block[data-trans-lang="en"]');
    const enContent = enBlock?.querySelector('.reader-trans-content');
    if (!enBlock) return { error: 'English block not found' };
    const computedBlock = window.getComputedStyle(enBlock);
    const computedContent = enContent ? window.getComputedStyle(enContent) : null;
    return {
      borderLeftColor: computedBlock.borderLeftColor,
      backgroundColor: computedBlock.backgroundColor,
      textColor: computedContent?.color || computedBlock.color,
      contentMarginBottom: enContent ? window.getComputedStyle(enContent).marginBottom : null,
    };
  })()`);

  console.log('Raw hex rendered colors:', rawHexMetrics);
  // #059669 -> rgb(5, 150, 105)
  assert(
    rawHexMetrics.borderLeftColor.includes('5, 150, 105'),
    `Raw hex without '#' rendered border-left correctly (${rawHexMetrics.borderLeftColor})`
  );
  // #dcfce7 -> rgb(220, 252, 231)
  assert(
    rawHexMetrics.backgroundColor.includes('220, 252, 231'),
    `Raw hex without '#' rendered background correctly (${rawHexMetrics.backgroundColor})`
  );
  // #064e3b -> rgb(6, 78, 59)
  assert(
    rawHexMetrics.textColor.includes('6, 78, 59'),
    `Raw hex without '#' rendered text color correctly (${rawHexMetrics.textColor})`
  );
  // Test 1.4: Translation content margin bottom is 0
  assert(
    parseFloat(rawHexMetrics.contentMarginBottom || '0') === 0,
    `Translation content margin-bottom is 0px (${rawHexMetrics.contentMarginBottom})`
  );

  // Test 3.8: Palette button active styling when custom colors are applied
  await evaluate(ws, `(() => {
    const langBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Language'));
    if (langBtn) langBtn.click();
  })()`);
  await sleep(500);

  const paletteActiveClasses = await evaluate(ws, `(() => {
    const enBtn = document.querySelector('button[aria-label*="Customize colors for English"]');
    return enBtn ? enBtn.className : null;
  })()`);
  console.log('English palette button classes with custom colors:', paletteActiveClasses);
  assert(
    paletteActiveClasses?.includes('text-[var(--accent)]'),
    'Palette button reflects active custom color state'
  );

  // Restore default clean settings
  console.log('\nCleaning up settings back to defaults...');
  await evaluate(
    ws,
    `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing.translations = { ...(existing.translations || {}), pali: true, english: false };
      existing.translationOrder = ['pali', 'english', 'vietnamese'];
      existing.translationDisplayMode = 'stack';
      existing.paragraphIndent = true;
      existing.translationColors = {};
      localStorage.setItem(key, JSON.stringify(existing));
      location.reload();
    })()`
  );
  await sleep(2000);

  ws.close();
  chrome.kill();

  console.log('\n========================================================');
  if (allPassed) {
    console.log('🎉 ALL TASKS (1, 2, 3) PASSED DEEP AUTOMATED VERIFICATION!');
    console.log('========================================================\n');
    process.exit(0);
  } else {
    console.error('❌ SOME TESTS FAILED.');
    console.log('========================================================\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in test script:', err);
  process.exit(1);
});
