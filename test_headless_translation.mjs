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
  console.log('=== Headless Chrome Translation End-to-End Verification ===\n');

  console.log('1. Launching headless Chromium on port 9222...');
  const chrome = spawn(
    '/usr/bin/chromium-browser',
    [
      '--headless',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  await sleep(1500);

  try {
    console.log('2. Opening /book/s0101m.mul/0 in Chromium...');
    const tabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book/s0101m.mul/0', { method: 'PUT' });
    const tab = await tabRes.json();
    console.log('Tab URL:', tab.webSocketDebuggerUrl);

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));

    await sendCdp(ws, 'Runtime.enable');
    await sendCdp(ws, 'Page.enable');

    console.log('3. Waiting for reader to load and render chapters...');
    await sleep(4000);

    const baseCheck = await evaluate(
      ws,
      `(() => {
        return {
          title: document.title,
          parasCount: document.querySelectorAll('p[data-pindex]').length,
          chaptersCount: document.querySelectorAll('.chapter-content-block').length,
          transBlocksCount: document.querySelectorAll('.reader-trans-block').length,
        };
      })()`
    );
    console.log('Base render check:', baseCheck);

    if (baseCheck.parasCount === 0) {
      throw new Error('No paragraphs rendered on reader page!');
    }

    // Step 4: Enable English and Vietnamese in Stack mode
    console.log('\n4. Enabling English and Vietnamese in Stack mode...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = {
          ...(existing.translations || {}),
          english: true,
          vietnamese: true
        };
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );

    await sleep(4000);

    const stackCheck = await evaluate(
      ws,
      `(() => {
        const transBlocks = document.querySelectorAll('.reader-trans-block');
        const enBlocks = document.querySelectorAll('.reader-trans-block[data-trans-lang="en"]');
        const viBlocks = document.querySelectorAll('.reader-trans-block[data-trans-lang="vi"]');
        const stackRows = document.querySelectorAll('.reader-trans-stack-row');
        
        let samplePara5En = null;
        let samplePara5Vi = null;
        const row5 = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
        if (row5) {
          samplePara5En = row5.querySelector('.reader-trans-block[data-trans-lang="en"] .reader-trans-content')?.textContent;
          samplePara5Vi = row5.querySelector('.reader-trans-block[data-trans-lang="vi"] .reader-trans-content')?.textContent;
        }

        return {
          totalTransBlocks: transBlocks.length,
          enCount: enBlocks.length,
          viCount: viBlocks.length,
          stackRowsCount: stackRows.length,
          samplePara5En,
          samplePara5Vi,
        };
      })()`
    );

    console.log('Stack mode check:', JSON.stringify(stackCheck, null, 2));

    if (stackCheck.enCount === 0 || stackCheck.viCount === 0) {
      throw new Error(`Expected English and Vietnamese blocks, got en=${stackCheck.enCount}, vi=${stackCheck.viCount}`);
    }

    // Step 5: Switch to Side-by-Side mode
    console.log('\n5. Switching to Side-by-Side mode...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translationDisplayMode = 'side';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );

    await sleep(4000);

    const sideCheck = await evaluate(
      ws,
      `(() => {
        const sideRows = document.querySelectorAll('.reader-trans-side-row');
        const paliCols = document.querySelectorAll('.reader-pali-col');
        const transCols = document.querySelectorAll('.reader-trans-col');
        const container = document.querySelector('.reader-container');

        let samplePara5SideEn = null;
        const row5 = document.querySelector('.reader-trans-side-row[data-pindex="5"]');
        if (row5) {
          samplePara5SideEn = row5.querySelector('.reader-trans-block[data-trans-lang="en"] .reader-trans-content')?.textContent;
        }

        return {
          sideRowsCount: sideRows.length,
          paliColsCount: paliCols.length,
          transColsCount: transCols.length,
          containerMaxWidth: container ? getComputedStyle(container).maxWidth : null,
          samplePara5SideEn,
        };
      })()`
    );

    console.log('Side-by-side mode check:', JSON.stringify(sideCheck, null, 2));

    if (sideCheck.sideRowsCount === 0 || sideCheck.paliColsCount === 0 || sideCheck.transColsCount === 0) {
      throw new Error(`Expected side rows and columns, got sideRows=${sideCheck.sideRowsCount}`);
    }

    // Step 6: Test Asian scripts (Myanmar & Sinhala & Thai)
    console.log('\n6. Testing Asian scripts (Myanmar, Sinhala, Thai)...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = {
          myanmar: true,
          sinhala: true,
          thai: true
        };
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );

    await sleep(4000);

    const asianCheck = await evaluate(
      ws,
      `(() => {
        const myBlocks = document.querySelectorAll('.reader-trans-block[data-trans-lang="my"]');
        const siBlocks = document.querySelectorAll('.reader-trans-block[data-trans-lang="si"]');
        const thBlocks = document.querySelectorAll('.reader-trans-block[data-trans-lang="th"]');
        
        const row5 = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
        return {
          myCount: myBlocks.length,
          siCount: siBlocks.length,
          thCount: thBlocks.length,
          mySample: row5?.querySelector('.reader-trans-block[data-trans-lang="my"] .reader-trans-content')?.textContent?.slice(0, 80),
          siSample: row5?.querySelector('.reader-trans-block[data-trans-lang="si"] .reader-trans-content')?.textContent?.slice(0, 80),
          thSample: row5?.querySelector('.reader-trans-block[data-trans-lang="th"] .reader-trans-content')?.textContent?.slice(0, 80),
        };
      })()`
    );

    console.log('Asian scripts check:', JSON.stringify(asianCheck, null, 2));

    if (asianCheck.myCount === 0 || asianCheck.siCount === 0 || asianCheck.thCount === 0) {
      throw new Error('Expected Myanmar, Sinhala, and Thai translation blocks!');
    }

    // Step 7: Test Inline HTML formatting preservation (Vietnamese paragraph 114)
    console.log('\n7. Testing Inline HTML tag preservation (Vietnamese paragraph 114 with <i> tags)...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { vietnamese: true };
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );

    await sleep(4000);

    const inlineHtmlCheck = await evaluate(
      ws,
      `(() => {
        const row114 = document.querySelector('[data-pindex="114"]');
        const transContent = row114?.querySelector('.reader-trans-block[data-trans-lang="vi"] .reader-trans-content');
        const iTags = transContent ? Array.from(transContent.querySelectorAll('i')).map(el => el.textContent) : [];
        const rawText = transContent?.innerHTML || '';
        return {
          foundRow114: Boolean(row114),
          hasITags: iTags.length > 0,
          iTagsList: iTags,
          containsEscapedLt: rawText.includes('&lt;i&gt;'),
        };
      })()`
    );

    console.log('Inline HTML check:', JSON.stringify(inlineHtmlCheck, null, 2));
    if (!inlineHtmlCheck.hasITags || inlineHtmlCheck.containsEscapedLt) {
      throw new Error(`Expected preserved <i> tags in translation, got iTags=${inlineHtmlCheck.iTagsList}, containsEscapedLt=${inlineHtmlCheck.containsEscapedLt}`);
    }

    // Step 8: Test Myanmar Nissaya mode (formatted word pairs, no raw JSON)
    console.log('\n8. Testing Myanmar Nissaya mode (Khuddakapatha s0501m.mul)...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { my_nissaya: true };
        existing.translationDisplayMode = 'stack';
        localStorage.setItem(key, JSON.stringify(existing));
        window.location.href = 'http://localhost:3000/book/s0501m.mul/0';
      })()`
    );

    await sleep(4500);

    const nissayaCheck = await evaluate(
      ws,
      `(() => {
        const blocks = document.querySelectorAll('.reader-trans-block[data-trans-lang="my_nissaya"]');
        const row4 = document.querySelector('[data-pindex="4"]');
        const content4 = row4?.querySelector('.reader-trans-block[data-trans-lang="my_nissaya"] .reader-trans-content');
        const pairsCount = content4?.querySelectorAll('.reader-nissaya-pair').length || 0;
        const rawHtml = content4?.innerHTML || '';
        const rawText = content4?.textContent || '';
        const containsRawJson = rawHtml.includes('[{&quot;') || rawText.includes('[{"');
        return {
          nissayaBlocksCount: blocks.length,
          foundRow4: Boolean(row4),
          pairsCount,
          sampleText: rawText.slice(0, 100),
          containsRawJson,
        };
      })()`
    );

    console.log('Myanmar Nissaya check:', JSON.stringify(nissayaCheck, null, 2));
    if (nissayaCheck.nissayaBlocksCount === 0 || nissayaCheck.containsRawJson || nissayaCheck.pairsCount === 0) {
      throw new Error(`Nissaya check failed! blocks=${nissayaCheck.nissayaBlocksCount}, containsRawJson=${nissayaCheck.containsRawJson}, pairsCount=${nissayaCheck.pairsCount}`);
    }

    // Step 9: Test Click Isolation (clicking inside translation container does not trigger Pali dictionary)
    console.log('\n9. Testing click isolation on translation blocks...');
    const clickCheck = await evaluate(
      ws,
      `(() => {
        const transBlock = document.querySelector('.reader-trans-content');
        if (!transBlock) return { clicked: false, error: 'No translation block found' };
        transBlock.click();
        const modal = document.querySelector('.dict-modal, [data-dialog="dict"]');
        return {
          clicked: true,
          dictModalOpened: Boolean(modal),
        };
      })()`
    );

    console.log('Click isolation check:', JSON.stringify(clickCheck, null, 2));
    if (clickCheck.dictModalOpened) {
      throw new Error('Clicking translation container erroneously opened dictionary modal!');
    }

    ws.close();

    console.log('\n========================================================');
    console.log('🎉 ALL END-TO-END VERIFICATION CHECKS PASSED WITH FLYING COLORS!');
    console.log('========================================================\n');
    process.exit(0);
  } finally {
    chrome.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
