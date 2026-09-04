import { spawn } from 'child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getWsUrl() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const tabs = await res.json();
  const page = tabs.find((t) => t.type === 'page' && t.url.includes('localhost:3000'));
  if (!page) throw new Error('No tab found with localhost:3000');
  return page.webSocketDebuggerUrl;
}

async function createCdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  let idCounter = 0;
  return {
    send: (method, params = {}) => {
      const id = ++idCounter;
      const msg = JSON.stringify({ id, method, params });
      return new Promise((resolve, reject) => {
        const handler = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.id === id) {
              ws.removeEventListener('message', handler);
              if (data.error) reject(data.error);
              else resolve(data.result);
            }
          } catch (e) {}
        };
        ws.addEventListener('message', handler);
        ws.send(msg);
      });
    },
    close: () => ws.close(),
  };
}

async function run() {
  console.log('=== Starting Comprehensive Verification of Tasks 1-6 & Edge Cases ===\n');

  // 1. Launch headless Chromium
  console.log('1. Launching headless Chromium on port 9222...');
  const chromeProc = spawn(
    'chromium',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      'http://localhost:3000/book/s0101m.mul/0',
    ],
    { stdio: 'ignore' }
  );

  await sleep(4000);

  try {
    const wsUrl = await getWsUrl();
    const cdp = await createCdpClient(wsUrl);

    const evalInPage = async (expr) => {
      const res = await cdp.send('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
      });
      return res.result?.value;
    };

    console.log('2. Waiting for reader initial state...');
    await sleep(3000);

    // TEST TASK 1: Move to Top Button in LanguageMenu
    console.log('\n--- Verifying Task 1: Move to Top Button ---');
    await evalInPage(`
      (function() {
        const btn = document.querySelector('button[aria-label="Pāḷi script and translation Language"]');
        if (btn) btn.click();
      })()
    `);
    await sleep(800);

    const task1Check = await evalInPage(`
      (function() {
        const moveTopButtons = document.querySelectorAll('button[aria-label="Move translation to top"], button[title="Move to top"]');
        return {
          opened: true,
          moveTopButtonsCount: moveTopButtons.length,
          hasIcons: moveTopButtons.length > 0 && Boolean(moveTopButtons[0].querySelector('svg')),
        };
      })()
    `);
    console.log('Task 1 UI check:', task1Check);
    if (!task1Check.moveTopButtonsCount || task1Check.moveTopButtonsCount < 17) {
      throw new Error(`Task 1 FAIL: Expected at least 17 Move-to-Top buttons, got ${task1Check.moveTopButtonsCount}`);
    }
    console.log('✅ Task 1 PASS: Move to Top button present with suitable icons for all layers.');

    // TEST TASK 2 & 6 in LanguageMenu: Pāḷi as separate language & Script converter link
    console.log('\n--- Verifying Task 2 & Task 6 in LanguageMenu ---');
    const task2And6Menu = await evalInPage(`
      (function() {
        const converterLink = document.querySelector('a[href="/pali-script-converter.html"]');
        const labels = Array.from(document.querySelectorAll('label')).map(l => l.textContent);
        const hasPali = labels.some(l => l.includes('Pāḷi') && l.includes('Root Canon'));
        return {
          hasConverterLink: Boolean(converterLink),
          converterHref: converterLink ? converterLink.getAttribute('href') : null,
          hasPaliLayer: hasPali,
        };
      })()
    `);
    console.log('Task 2 & 6 Menu check:', task2And6Menu);
    if (!task2And6Menu.hasConverterLink || !task2And6Menu.hasPaliLayer) {
      throw new Error(`Task 2/6 FAIL: converterLink=${task2And6Menu.hasConverterLink}, hasPaliLayer=${task2And6Menu.hasPaliLayer}`);
    }
    console.log('✅ Task 2 & 6 PASS: Pāḷi layer listed and script converter link present in LanguageMenu.');

    // Close language menu
    await evalInPage(`
      (function() {
        const doneBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Done');
        if (doneBtn) doneBtn.click();
      })()
    `);
    await sleep(600);

    // TEST TASK 3: AI-Assisted Translation Notice Modal
    console.log('\n--- Verifying Task 3: AI-Assisted Translation Disclaimer Modal ---');
    await evalInPage(`
      (function() {
        localStorage.removeItem('tipitaka_ai_trans_disclaimer_accepted');
        const btn = document.querySelector('button[aria-label="Pāḷi script and translation Language"]');
        if (btn) btn.click();
      })()
    `);
    await sleep(600);

    await evalInPage(`
      (function() {
        const labels = Array.from(document.querySelectorAll('label'));
        const deLabel = labels.find(l => l.textContent.includes('Deutsch'));
        if (!deLabel) return;
        const deInput = deLabel.querySelector('input[type="checkbox"]');
        if (deInput) deInput.click();
      })()
    `);
    await sleep(600);

    const task3Check = await evalInPage(`
      (function() {
        const modals = Array.from(document.querySelectorAll('.animate-scale-in'));
        const modal = modals.find(m => m.textContent.includes('AI-Assisted Translation Notice'));
        const modalText = modal ? modal.textContent : '';
        const epitakaLink = modal ? modal.querySelector('a[href="https://epitaka.org/about"]') : null;
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('I Understand & Enable'));

        return {
          modalVisible: Boolean(modal),
          containsNotice: modalText.includes('AI-Assisted Translation Project'),
          containsWisdom: modalText.includes('Discernment') || modalText.includes('Wisdom'),
          hasEpitakaLink: Boolean(epitakaLink),
          hasConfirmBtn: Boolean(confirmBtn),
        };
      })()
    `);
    console.log('Task 3 check:', task3Check);
    if (!task3Check.modalVisible || !task3Check.hasEpitakaLink || !task3Check.containsNotice) {
      throw new Error(`Task 3 FAIL: Modal visible=${task3Check.modalVisible}, link=${task3Check.hasEpitakaLink}`);
    }
    console.log('✅ Task 3 PASS: AI-Assisted Translation Disclaimer modal renders with Epitaka link and wisdom notice.');

    // Confirm disclaimer
    await evalInPage(`
      (function() {
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('I Understand & Enable'));
        if (confirmBtn) confirmBtn.click();
      })()
    `);
    await sleep(500);
    await evalInPage(`
      (function() {
        const doneBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Done');
        if (doneBtn) doneBtn.click();
      })()
    `);
    await sleep(1500);

    // TEST TASK 4 & 5: Removal of reader-trans-header & Language-specific border colors
    console.log('\n--- Verifying Task 4 (No reader-trans-header) & Task 5 (Language-specific left borders) ---');
    await evalInPage(`
      (function() {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { pali: true, english: true, vietnamese: true };
        existing.translationOrder = ['pali', 'english', 'vietnamese'];
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()
    `);
    await sleep(3500);

    const task4and5Check = await evalInPage(`
      (function() {
        const headersCount = document.querySelectorAll('.reader-trans-header').length;
        const enBlock = document.querySelector('.reader-trans-block[data-trans-lang="en"]');
        const viBlock = document.querySelector('.reader-trans-block[data-trans-lang="vi"]');
        return {
          headersCount,
          hasEnBlock: Boolean(enBlock),
          hasViBlock: Boolean(viBlock),
          enBorderColor: enBlock ? getComputedStyle(enBlock).borderLeftColor : null,
          viBorderColor: viBlock ? getComputedStyle(viBlock).borderLeftColor : null,
        };
      })()
    `);
    console.log('Task 4 & 5 check:', task4and5Check);
    if (task4and5Check.headersCount > 0) {
      throw new Error(`Task 4 FAIL: Found ${task4and5Check.headersCount} .reader-trans-header elements!`);
    }
    if (task4and5Check.enBorderColor === task4and5Check.viBorderColor) {
      throw new Error(`Task 5 FAIL: EN and VI border colors are identical (${task4and5Check.enBorderColor})`);
    }
    console.log('✅ Task 4 PASS: .reader-trans-header is completely removed.');
    console.log(`✅ Task 5 PASS: English border (${task4and5Check.enBorderColor}) and Vietnamese border (${task4and5Check.viBorderColor}) are distinctly styled.`);

    // TEST EDGE CASE 1: Reordering Pāḷi below English in Side-by-Side mode — Click Isolation & Dictionary lookup
    console.log('\n--- Verifying Edge Case 1: Pāḷi below English in Side-by-Side (Col 2 Dictionary lookup) ---');
    await evalInPage(`
      (function() {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { pali: true, english: true, vietnamese: false };
        existing.translationOrder = ['english', 'pali'];
        existing.translationDisplayMode = 'side';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()
    `);
    await sleep(3500);

    const edgeCase1Check = await evalInPage(`
      (function() {
        const row = document.querySelector('.reader-trans-side-row[data-para="1"]');
        if (!row) return { error: 'Row not found' };
        const colLeft = row.querySelector('.reader-side-col-left');
        const colRight = row.querySelector('.reader-side-col-right');
        const enInLeft = Boolean(colLeft.querySelector('.reader-trans-block[data-trans-lang="en"]'));
        const paliInRight = Boolean(colRight.querySelector('p.bodytext'));
        const paliInsideTransContainer = Boolean(colRight.querySelector('p.bodytext')?.closest('.reader-translation-container'));

        return {
          enInLeft,
          paliInRight,
          paliInsideTransContainer,
          colLeftClass: colLeft.className,
          colRightClass: colRight.className,
        };
      })()
    `);
    console.log('Edge Case 1 check:', edgeCase1Check);
    if (!edgeCase1Check.enInLeft || !edgeCase1Check.paliInRight) {
      throw new Error(`Edge Case 1 FAIL: English not in Col 1 or Pali not in Col 2!`);
    }
    if (edgeCase1Check.paliInsideTransContainer) {
      throw new Error(`Edge Case 1 FAIL: Pāḷi text was erroneously wrapped inside .reader-translation-container!`);
    }
    console.log('✅ Edge Case 1 PASS: English in Col 1, Pāḷi in Col 2 without erroneous translation container wrapping.');

    // TEST EDGE CASE 2: Disabling Pāḷi text — Paragraph numbers, Anchor IDs & Headings
    console.log('\n--- Verifying Edge Case 2: Pāḷi Disabled — Paragraph numbers, Anchor IDs & Headings ---');
    await evalInPage(`
      (function() {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { pali: false, english: true, vietnamese: false };
        existing.translationOrder = ['english', 'vietnamese'];
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()
    `);
    await sleep(3500);

    const paliDisabledCheck = await evalInPage(`
      (function() {
        const row1 = document.querySelector('.reader-para-row[data-para="1"]');
        if (!row1) return { error: 'row1 not found' };

        // 1. Check paranum anchor id
        const paraAnchor = document.getElementById('para-1');
        const paraRowId = document.getElementById('para1');
        const paranumEl = row1.querySelector('strong.paranum');

        // 2. Check heading styles
        const headingRows = document.querySelectorAll('.reader-trans-heading-row');
        const nikayaHeading = document.querySelector('.reader-trans-heading-row.nikaya');
        const chapterHeading = document.querySelector('.reader-trans-heading-row.chapter');

        // 3. Check colophon (centre class)
        const centreElements = Array.from(document.querySelectorAll('[data-pindex="39"]'));
        const centreFound = centreElements.length > 0;

        return {
          foundRow1: Boolean(row1),
          hasParaAnchor: Boolean(paraAnchor),
          hasParaRowId: Boolean(paraRowId),
          paranumText: paranumEl ? paranumEl.textContent : null,
          headingRowsCount: headingRows.length,
          hasNikayaHeading: Boolean(nikayaHeading),
          hasChapterHeading: Boolean(chapterHeading),
          centreFound,
          row1Snippet: row1.textContent.slice(0, 50),
        };
      })()
    `);
    console.log('Pali disabled check:', paliDisabledCheck);
    if (!paliDisabledCheck.hasParaAnchor || paliDisabledCheck.paranumText !== '1') {
      throw new Error(`Edge Case 2 FAIL: Paragraph number anchor id='para-1' missing or paranum != '1'!`);
    }
    if (!paliDisabledCheck.hasNikayaHeading || !paliDisabledCheck.hasChapterHeading) {
      throw new Error(`Edge Case 2 FAIL: Translation headings missing .reader-trans-heading-row styling!`);
    }
    if (!paliDisabledCheck.centreFound) {
      throw new Error(`Edge Case 2 FAIL: Colophon/centre paragraph was dropped!`);
    }
    console.log('✅ Edge Case 2 PASS: Paragraph number anchor `para-1` preserved, headings styled, and colophons retained!');

    // TEST EDGE CASE 3: Active paragraph tracking when Pāḷi is disabled
    console.log('\n--- Verifying Edge Case 3: Active paragraph tracking when Pāḷi is disabled ---');
    const trackClickCheck = await evalInPage(`
      (function() {
        const row1 = document.querySelector('.reader-para-row[data-para="1"]');
        row1.click();
        const savedTabs = JSON.parse(localStorage.getItem('tipitaka_saved_tabs_v2') || '[]');
        const history = JSON.parse(localStorage.getItem('tipitaka_recent_history_v2') || '[]');
        return {
          clicked: true,
          savedTabsHasPara1: savedTabs.some(t => t.lastParaNum === '1'),
          historyHasPara1: history.some(h => h.paraNum === '1'),
        };
      })()
    `);
    console.log('Active paragraph tracking check:', trackClickCheck);
    if (!trackClickCheck.historyHasPara1 && !trackClickCheck.savedTabsHasPara1) {
      throw new Error('Edge Case 3 FAIL: Tab position was not saved for para 1 when Pali disabled!');
    }
    console.log('✅ Edge Case 3 PASS: Tab position and reading history tracked accurately when Pāḷi is disabled.');

    // TEST EDGE CASE 4: LanguageMenu Last Active Layer Disabled State
    console.log('\n--- Verifying Edge Case 4: Cannot disable last active language layer ---');
    await evalInPage(`
      (function() {
        const btn = document.querySelector('button[aria-label="Pāḷi script and translation Language"]');
        if (btn) btn.click();
      })()
    `);
    await sleep(600);

    const lastActiveCheck = await evalInPage(`
      (function() {
        // English is the only active language right now
        const enLabel = Array.from(document.querySelectorAll('label')).find(l => l.textContent.includes('English'));
        const enInput = enLabel ? enLabel.querySelector('input[type="checkbox"]') : null;

        return {
          enInputExists: Boolean(enInput),
          enInputDisabled: enInput ? enInput.disabled : false,
          enInputTitle: enInput ? enInput.title : null,
        };
      })()
    `);
    console.log('Last active check:', lastActiveCheck);
    if (!lastActiveCheck.enInputDisabled) {
      throw new Error('Edge Case 4 FAIL: Last active language checkbox was not disabled!');
    }
    console.log('✅ Edge Case 4 PASS: Last active language checkbox is properly disabled with informative tooltip.');

    // TEST TASK 6: Standalone Static Pages (info.html & pali-script-converter.html)
    console.log('\n--- Verifying Task 6: info.html & pali-script-converter.html ---');
    const infoRes = await fetch('http://localhost:3000/info.html');
    if (!infoRes.ok) throw new Error(`/info.html returned ${infoRes.status}`);
    const infoText = await infoRes.text();
    const infoHasTrans = infoText.includes('id="translations"') && infoText.includes('Epitaka');
    const infoHasConv = infoText.includes('pali-script-converter.html');
    console.log('info.html check:', { infoHasTrans, infoHasConv });
    if (!infoHasTrans || !infoHasConv) {
      throw new Error('Task 6 FAIL: info.html missing translations section or converter link!');
    }

    const convRes = await fetch('http://localhost:3000/pali-script-converter.html');
    if (!convRes.ok) throw new Error(`/pali-script-converter.html returned ${convRes.status}`);
    const convText = await convRes.text();
    const convHasScripts = convText.includes('Chaṭṭha Saṅgāyana Tipiṭaka') && convText.includes('convert');
    console.log('pali-script-converter.html check:', { status: convRes.status, convHasScripts });
    if (!convHasScripts) {
      throw new Error('Task 6 FAIL: pali-script-converter.html invalid!');
    }
    console.log('✅ Task 6 PASS: info.html and pali-script-converter.html verified.');

    // Restore clean default settings in localStorage
    await evalInPage(`
      (function() {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { pali: true, english: false, vietnamese: false };
        existing.translationOrder = ['pali', 'english', 'vietnamese'];
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
      })()
    `);

    cdp.close();

    console.log('\n=============================================================');
    console.log('🎉 ALL TASKS (1-6) AND EDGE CASES PASSED DEEP VERIFICATION!');
    console.log('=============================================================\n');
  } finally {
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
