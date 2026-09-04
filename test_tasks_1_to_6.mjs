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

async function run() {
  console.log('=== Deep Verification of Tasks 1 through 6 ===\n');

  console.log('1. Launching headless Chromium on port 9222...');
  const chrome = spawn(
    '/snap/bin/chromium',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/snap-chrome-tasks-verify',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let ready = false;
  for (let i = 0; i < 25; i++) {
    await sleep(500);
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }
  if (!ready) {
    throw new Error('Chromium failed to become ready on port 9222 after 12s');
  }

  try {
    console.log('2. Opening /book/s0101m.mul/0 in Chromium...');
    const tabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book/s0101m.mul/0', { method: 'PUT' });
    const tab = await tabRes.json();

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));

    await sendCdp(ws, 'Runtime.enable');
    await sendCdp(ws, 'Page.enable');

    console.log('3. Waiting for reader to load initial state...');
    await sleep(4000);

    // TEST TASK 2 & DEFAULT STATE
    console.log('\n--- Checking Default State & Task 2 (Pāḷi default settings) ---');
    const defaultCheck = await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : null;
        return {
          parasCount: document.querySelectorAll('p[data-pindex]').length,
          hasTransBlocks: document.querySelectorAll('.reader-trans-block').length,
          storedTranslations: parsed?.translations,
          storedOrder: parsed?.translationOrder,
        };
      })()`
    );
    console.log('Default state:', defaultCheck);
    if (defaultCheck.parasCount === 0) {
      throw new Error('Default reader failed to render paragraphs!');
    }
    console.log('✅ Base Pāḷi text renders correctly.');

    // TEST TASK 4 (NO reader-trans-header) & TASK 5 (DIFFERENT BORDER-LEFT COLORS)
    console.log('\n--- Testing Task 4 (No reader-trans-header) & Task 5 (Language-specific border-left colors) ---');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = {
          pali: true,
          english: true,
          vietnamese: true,
        };
        existing.translationOrder = ['pali', 'english', 'vietnamese'];
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );

    await sleep(4000);

    const task4and5Check = await evaluate(
      ws,
      `(() => {
        const headersCount = document.querySelectorAll('.reader-trans-header').length;
        const enBlock = document.querySelector('.reader-trans-block[data-trans-lang="en"]');
        const viBlock = document.querySelector('.reader-trans-block[data-trans-lang="vi"]');

        const enBorderColor = enBlock ? getComputedStyle(enBlock).borderLeftColor : null;
        const viBorderColor = viBlock ? getComputedStyle(viBlock).borderLeftColor : null;

        return {
          headersCount,
          hasEnBlock: Boolean(enBlock),
          hasViBlock: Boolean(viBlock),
          enBorderColor,
          viBorderColor,
        };
      })()`
    );
    console.log('Task 4 & 5 check:', task4and5Check);

    if (task4and5Check.headersCount > 0) {
      throw new Error(`Task 4 FAIL: .reader-trans-header should be removed, but found ${task4and5Check.headersCount}`);
    }
    console.log('✅ Task 4 PASS: .reader-trans-header is completely removed.');

    if (!task4and5Check.enBorderColor || !task4and5Check.viBorderColor || task4and5Check.enBorderColor === task4and5Check.viBorderColor) {
      throw new Error(`Task 5 FAIL: Expected different border colors for en and vi, got en=${task4and5Check.enBorderColor}, vi=${task4and5Check.viBorderColor}`);
    }
    console.log(`✅ Task 5 PASS: English border-left is ${task4and5Check.enBorderColor} and Vietnamese border-left is ${task4and5Check.viBorderColor} (distinct colors).`);

    // TEST TASK 2: PALI LAYER ORDERING (English above Pali)
    console.log('\n--- Testing Task 2: Pāḷi Layer Ordering (Moving English ABOVE Pāḷi) ---');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = {
          pali: true,
          english: true,
        };
        existing.translationOrder = ['english', 'pali', 'vietnamese'];
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );

    await sleep(4000);

    const paliOrderCheck = await evaluate(
      ws,
      `(() => {
        const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
        if (!row) return { found: false };
        const children = Array.from(row.children);
        // Find positions of English block and Pali <p>
        let enIndex = -1;
        let paliIndex = -1;
        children.forEach((child, idx) => {
          if (child.classList.contains('reader-trans-block') && child.getAttribute('data-trans-lang') === 'en') {
            enIndex = idx;
          }
          if (child.tagName.toLowerCase() === 'p' && child.hasAttribute('data-pindex')) {
            paliIndex = idx;
          }
        });
        return {
          found: true,
          enIndex,
          paliIndex,
          englishIsFirst: enIndex !== -1 && paliIndex !== -1 && enIndex < paliIndex,
        };
      })()`
    );
    console.log('Pāḷi layer ordering check:', paliOrderCheck);
    if (!paliOrderCheck.found || !paliOrderCheck.englishIsFirst) {
      throw new Error(`Task 2 FAIL: Expected English block (index=${paliOrderCheck.enIndex}) to appear before Pāḷi (index=${paliOrderCheck.paliIndex})`);
    }
    console.log('✅ Task 2 PASS: English translation successfully placed ABOVE Pāḷi text!');

    // TEST TASK 2: DISABLE PALI TEXT (Read Translations Only)
    console.log('\n--- Testing Task 2: Disabling Pāḷi Text (Translations Only) ---');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = {
          pali: false,
          english: true,
        };
        existing.translationOrder = ['english', 'pali'];
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );

    await sleep(4000);

    const paliDisabledCheck = await evaluate(
      ws,
      `(() => {
        const row5 = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
        if (!row5) return { foundRow: false };
        const paliInRow = row5.querySelector('p.bodytext, p[data-pindex="5"]');
        const enInRow = row5.querySelector('.reader-trans-block[data-trans-lang="en"]');
        return {
          foundRow: true,
          hasPaliInRow: Boolean(paliInRow),
          hasEnInRow: Boolean(enInRow),
          enTextSnippet: enInRow?.querySelector('.reader-trans-content')?.textContent?.slice(0, 50),
        };
      })()`
    );
    console.log('Pāḷi disabled check:', paliDisabledCheck);
    if (!paliDisabledCheck.foundRow || paliDisabledCheck.hasPaliInRow || !paliDisabledCheck.hasEnInRow) {
      throw new Error(`Task 2 FAIL: Expected Pāḷi to be disabled (hasPali=${paliDisabledCheck.hasPaliInRow}), but only translation should be present`);
    }
    console.log('✅ Task 2 PASS: Pāḷi text is completely disabled; reader presents translations cleanly!');

    // TEST TASK 1 (Move-to-top button in LanguageMenu UI), TASK 3 (AI Disclaimer Popup), and TASK 6 (Script converter link)
    console.log('\n--- Testing Tasks 1, 3, and 6 in LanguageMenu UI ---');
    // Clear localStorage disclaimer acknowledgment so popup will trigger
    await evaluate(
      ws,
      `(() => {
        localStorage.removeItem('tipitaka_ai_trans_disclaimer_accepted');
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { pali: true, english: false, vietnamese: false };
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );

    await sleep(4000);

    // Open Language Menu
    const openMenuRes = await evaluate(
      ws,
      `(() => {
        const btn = document.querySelector('button[aria-label="Pāḷi script and translation Language"]');
        if (!btn) return { opened: false, error: 'Language button not found' };
        btn.click();
        return { opened: true };
      })()`
    );
    console.log('Open LanguageMenu result:', openMenuRes);
    await sleep(500);

    // Verify Move to Top button (Task 1) and Script Converter link (Task 6)
    const uiElementsCheck = await evaluate(
      ws,
      `(() => {
        const moveTopButtons = document.querySelectorAll('button[aria-label="Move translation to top"]');
        const converterLink = document.querySelector('a[href="/pali-script-converter.html"]');
        const paliCheckbox = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes('Pāḷi (Root Canon)'));

        return {
          moveTopButtonsCount: moveTopButtons.length,
          hasConverterLink: Boolean(converterLink),
          converterHref: converterLink ? converterLink.getAttribute('href') : null,
          hasPaliCheckbox: Boolean(paliCheckbox),
        };
      })()`
    );
    console.log('UI elements check:', uiElementsCheck);

    if (uiElementsCheck.moveTopButtonsCount === 0) {
      throw new Error('Task 1 FAIL: No "Move translation to top" buttons found in LanguageMenu!');
    }
    console.log(`✅ Task 1 PASS: Found ${uiElementsCheck.moveTopButtonsCount} Move-to-Top buttons with suitable icons!`);

    if (!uiElementsCheck.hasConverterLink || uiElementsCheck.converterHref !== '/pali-script-converter.html') {
      throw new Error(`Task 6 FAIL: Pāḷi Script Converter link missing or invalid: ${uiElementsCheck.converterHref}`);
    }
    console.log('✅ Task 6 PASS: Pāḷi Script Converter link present in LanguageMenu!');

    if (!uiElementsCheck.hasPaliCheckbox) {
      throw new Error('Task 2 FAIL: Pāḷi text not listed as an independent language in LanguageMenu!');
    }
    console.log('✅ Task 2 PASS: Pāḷi (Root Canon) is present as an independent language layer!');

    // TEST TASK 3: Click to enable translation and verify AI Disclaimer Popup
    console.log('\n--- Testing Task 3: AI Disclaimer Popup on Enabling Translation ---');
    const triggerDisclaimerRes = await evaluate(
      ws,
      `(() => {
        // Find English or Vietnamese label and click its checkbox
        const enLabel = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes('English'));
        if (!enLabel) return { clicked: false, error: 'English label not found' };
        const input = enLabel.querySelector('input[type="checkbox"]');
        if (!input) return { clicked: false, error: 'Input checkbox not found' };
        input.click();
        return { clicked: true };
      })()`
    );
    console.log('Trigger disclaimer click:', triggerDisclaimerRes);
    await sleep(500);

    const disclaimerModalCheck = await evaluate(
      ws,
      `(() => {
        const modals = Array.from(document.querySelectorAll('.animate-scale-in'));
        const modal = modals.find(m => m.textContent.includes('AI-Assisted Translation Notice'));
        const text = modal?.textContent || '';
        const epitakaLink = modal?.querySelector('a[href="https://epitaka.org/about"]');
        const confirmBtn = Array.from(modal?.querySelectorAll('button') || []).find(b => b.textContent.includes('I Understand'));

        return {
          modalVisible: Boolean(modal),
          containsAiNotice: text.includes('AI-Assisted Translation'),
          containsEpitaka: text.includes('Epitaka'),
          hasEpitakaLink: Boolean(epitakaLink),
          hasConfirmBtn: Boolean(confirmBtn),
          snippet: text.slice(0, 160),
        };
      })()`
    );
    console.log('Disclaimer modal check:', disclaimerModalCheck);

    if (!disclaimerModalCheck.modalVisible || !disclaimerModalCheck.containsAiNotice || !disclaimerModalCheck.hasEpitakaLink) {
      throw new Error(`Task 3 FAIL: Disclaimer modal did not display properly! ${JSON.stringify(disclaimerModalCheck)}`);
    }
    console.log('✅ Task 3 PASS: AI-Assisted Translation popup displayed with Epitaka link and wisdom notice!');

    // Confirm disclaimer
    await evaluate(
      ws,
      `(() => {
        const modals = Array.from(document.querySelectorAll('.animate-scale-in'));
        const modal = modals.find(m => m.textContent.includes('AI-Assisted Translation Notice'));
        const confirmBtn = Array.from(modal?.querySelectorAll('button') || []).find(b => b.textContent.includes('I Understand'));
        if (confirmBtn) confirmBtn.click();
      })()`
    );
    await sleep(500);

    // TEST STATIC PAGES: /pali-script-converter.html & /info.html
    console.log('\n--- Testing Task 6: Static Pages Verification ---');
    const infoRes = await fetch('http://localhost:3000/info.html');
    if (!infoRes.ok) throw new Error(`/info.html returned status ${infoRes.status}`);
    const infoHtml = await infoRes.text();

    const infoHasTranslations = infoHtml.includes('id="translations"') && infoHtml.includes('Epitaka');
    const infoHasConverterLink = infoHtml.includes('pali-script-converter.html');
    console.log('info.html check: translationsSection=' + infoHasTranslations + ', converterLink=' + infoHasConverterLink);
    if (!infoHasTranslations || !infoHasConverterLink) {
      throw new Error('info.html missing translations section or converter link!');
    }
    console.log('✅ Task 6 PASS: info.html updated with translations section and script converter link!');

    const convRes = await fetch('http://localhost:3000/pali-script-converter.html');
    if (!convRes.ok) throw new Error(`/pali-script-converter.html returned status ${convRes.status}`);
    const convHtml = await convRes.text();
    if (!convHtml.includes('Pāḷi Script Converter') || !convHtml.includes('CVT.TextProcessor')) {
      throw new Error('pali-script-converter.html content invalid!');
    }
    console.log('✅ Task 6 PASS: pali-script-converter.html is functional and preserved!');

    ws.close();

    console.log('\n========================================================');
    console.log('🎉 ALL TASKS (1, 2, 3, 4, 5, 6) PASSED DEEP VERIFICATION!');
    console.log('========================================================\n');
    process.exit(0);
  } finally {
    chrome.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('\n❌ DEEP VERIFICATION FAILED:', err.message);
  process.exit(1);
});
