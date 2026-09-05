import { spawn } from 'child_process';
import assert from 'assert';

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
  if (res.exceptionDetails) {
    throw new Error('CDP Eval Exception: ' + JSON.stringify(res.exceptionDetails));
  }
  return res.result?.value;
}

// -------------------------------------------------------------
// Part 1: Algorithmic unit tests for handleMoveTranslation logic
// -------------------------------------------------------------
function simulateMoveTranslation(translationOrder, dictId, direction) {
  const idx = translationOrder.indexOf(dictId);
  if (idx === -1) return translationOrder;
  const next = [...translationOrder];
  if (direction === 'top') {
    const isPaliAtTop = translationOrder[0] === 'pali';
    if (isPaliAtTop && dictId !== 'pali') {
      if (idx === 1) return next;
      const [item] = next.splice(idx, 1);
      next.splice(1, 0, item);
    } else {
      if (idx === 0) return next;
      const [item] = next.splice(idx, 1);
      next.unshift(item);
    }
  } else if (direction === 'up' && idx > 0) {
    const tmp = next[idx - 1];
    next[idx - 1] = next[idx];
    next[idx] = tmp;
  } else if (direction === 'down' && idx < next.length - 1) {
    const tmp = next[idx + 1];
    next[idx + 1] = next[idx];
    next[idx] = tmp;
  } else {
    return next;
  }
  return next;
}

function runAlgorithmUnitTests() {
  console.log('--- Running Algorithm Unit Tests for handleMoveTranslation ---');

  // Test A: Pali at top, click Move to top on index 2 (vietnamese)
  const initial = ['pali', 'english', 'vietnamese', 'myanmar', 'thai'];
  const res1 = simulateMoveTranslation(initial, 'vietnamese', 'top');
  assert.deepStrictEqual(res1, ['pali', 'vietnamese', 'english', 'myanmar', 'thai'], 'Vietnamese moves to index 1 when Pali is top');
  console.log('  ✓ PASS: Vietnamese moved to index 1 (second top) under Pali');

  // Test B: Pali at top, click Move to top on index 4 (thai)
  const res2 = simulateMoveTranslation(res1, 'thai', 'top');
  assert.deepStrictEqual(res2, ['pali', 'thai', 'vietnamese', 'english', 'myanmar'], 'Thai moves to index 1 when Pali is top');
  console.log('  ✓ PASS: Thai moved to index 1 (second top) under Pali');

  // Test C: Pali at top, click Move to top on index 1 (already second top)
  const res3 = simulateMoveTranslation(res2, 'thai', 'top');
  assert.deepStrictEqual(res3, res2, 'Clicking top on index 1 is a no-op');
  console.log('  ✓ PASS: Clicking top on index 1 maintains position');

  // Test D: Move up on index 1 (thai) swaps with Pali (index 0)
  const res4 = simulateMoveTranslation(res2, 'thai', 'up');
  assert.deepStrictEqual(res4, ['thai', 'pali', 'vietnamese', 'english', 'myanmar'], 'Move up allows moving above Pali');
  console.log('  ✓ PASS: Move up moves language above Pali to index 0');

  // Test E: Pali NOT at top, click Move to top on vietnamese (index 2)
  const res5 = simulateMoveTranslation(res4, 'vietnamese', 'top');
  assert.deepStrictEqual(res5, ['vietnamese', 'thai', 'pali', 'english', 'myanmar'], 'Move to top moves to index 0 when Pali is not top');
  console.log('  ✓ PASS: Move to top moves language to index 0 when Pali is not top');

  // Test F: Pali NOT at top, click Move to top on Pali (index 2)
  const res6 = simulateMoveTranslation(res5, 'pali', 'top');
  assert.deepStrictEqual(res6, ['pali', 'vietnamese', 'thai', 'english', 'myanmar'], 'Move to top on Pali moves Pali to index 0');
  console.log('  ✓ PASS: Move to top on Pali returns Pali to index 0');

  // Test G: Pali back at top, click Move to top on english (index 3)
  const res7 = simulateMoveTranslation(res6, 'english', 'top');
  assert.deepStrictEqual(res7, ['pali', 'english', 'vietnamese', 'thai', 'myanmar'], 'English moves to index 1 under Pali');
  console.log('  ✓ PASS: English moves to index 1 when Pali is restored to top');

  // Test H: Move down on Pali (index 0)
  const res8 = simulateMoveTranslation(res7, 'pali', 'down');
  assert.deepStrictEqual(res8, ['english', 'pali', 'vietnamese', 'thai', 'myanmar'], 'Move down on Pali works');
  console.log('  ✓ PASS: Move down works normally');

  console.log('  ✓ All 8 algorithm unit tests passed!\n');
}

// -------------------------------------------------------------
// Part 2: End-to-End CDP browser verification
// -------------------------------------------------------------
async function main() {
  runAlgorithmUnitTests();

  console.log('=== Automated CDP End-to-End Verification ===\n');
  console.log('Launching headless Chromium on port 9222...');
  const chrome = spawn(
    '/snap/bin/chromium',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/test-chrome-tasks-1-2',
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
    chrome.kill();
    throw new Error('Chromium failed to start');
  }

  const tabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book/s0101m.mul/0', { method: 'PUT' });
  const tab = await tabRes.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));

  await sendCdp(ws, 'Runtime.enable');
  await sendCdp(ws, 'Page.enable');

  const waitFor = async (fn, timeout = 12000, interval = 400) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const res = await fn();
      if (res && !res.error) return res;
      await sleep(interval);
    }
    return await fn();
  };

  try {
    console.log('Waiting for reader to load initial state...');
    await sleep(4000);

    // -----------------------------------------------------------
    // TEST TASK 1: Border-Left Reduction to 1.0px
    // -----------------------------------------------------------
    console.log('\n--- VERIFYING TASK 1: Border-Left = 1.0px ---');

    // Enable translations: Pali + English + Vietnamese
    await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      settings.translations = { ...(settings.translations || {}), pali: true, english: true, vietnamese: true };
      settings.translationOrder = ['pali', 'english', 'vietnamese'];
      settings.translationDisplayMode = 'stack';
      delete settings.translationColors;
      localStorage.setItem(key, JSON.stringify(settings));
      location.reload();
    })()`);
    await sleep(4500);

    // 1.1 Check English translation block border-left-width
    const transBlockBorder = await waitFor(async () => {
      return await evaluate(ws, `(() => {
        const enBlock = document.querySelector('.reader-trans-block[data-trans-lang="en"], .reader-trans-block[data-trans-lang="english"]');
        if (!enBlock) return { error: 'English block not found' };
        const style = window.getComputedStyle(enBlock);
        return {
          borderLeftWidth: style.borderLeftWidth,
          borderLeftStyle: style.borderLeftStyle,
          borderLeftColor: style.borderLeftColor,
        };
      })()`);
    });
    console.log('1.1 Translation block border metrics:', transBlockBorder);
    assert.strictEqual(transBlockBorder.borderLeftWidth, '1px', `Translation border-left-width is 1px (got ${transBlockBorder.borderLeftWidth})`);
    assert.strictEqual(transBlockBorder.borderLeftStyle, 'solid', 'Translation border-left-style is solid');
    console.log('  ✓ PASS: Translation block border-left is 1.0px (computed: 1px)');

    // 1.2 Check Pali block border-left-width when Pali is NOT at top
    console.log('\nSetting Pali not at top: translationOrder=["english", "pali", "vietnamese"]...');
    await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      settings.translationOrder = ['english', 'pali', 'vietnamese'];
      localStorage.setItem(key, JSON.stringify(settings));
      location.reload();
    })()`);
    await sleep(3000);

    const paliNotTopBorder = await waitFor(async () => {
      return await evaluate(ws, `(() => {
        const paliBlock = document.querySelector('.reader-pali-trans-block, .reader-trans-block[data-trans-lang="pali"]');
        if (!paliBlock) return { error: 'Pali block not found when not top' };
        const style = window.getComputedStyle(paliBlock);
        return {
          borderLeftWidth: style.borderLeftWidth,
          borderLeftStyle: style.borderLeftStyle,
          borderLeftColor: style.borderLeftColor,
        };
      })()`);
    });
    console.log('1.2 Pali not-top border metrics:', paliNotTopBorder);
    assert.strictEqual(paliNotTopBorder.borderLeftWidth, '1px', `Pali not-top border-left-width is 1px (got ${paliNotTopBorder.borderLeftWidth})`);
    assert.strictEqual(paliNotTopBorder.borderLeftStyle, 'solid', 'Pali not-top border-left-style is solid');
    console.log('  ✓ PASS: Pali block when not at top has border-left of 1.0px (computed: 1px)');

    // 1.3 Check Pali block when in top position with custom border color configured
    console.log('\nSetting Pali at top with custom border: translationOrder=["pali", "english"], pali custom border=#7c3aed...');
    await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      settings.translationOrder = ['pali', 'english'];
      settings.translationColors = { pali: { border: '#7c3aed' } };
      localStorage.setItem(key, JSON.stringify(settings));
      location.reload();
    })()`);
    await sleep(3000);

    const paliTopCustomBorder = await waitFor(async () => {
      return await evaluate(ws, `(() => {
        const paliBlock = document.querySelector('.reader-pali-top-block, .reader-trans-block[data-trans-lang="pali"]');
        if (!paliBlock) return { error: 'Pali top block not found' };
        const style = window.getComputedStyle(paliBlock);
        return {
          borderLeftWidth: style.borderLeftWidth,
          borderLeftStyle: style.borderLeftStyle,
          borderLeftColor: style.borderLeftColor,
        };
      })()`);
    });
    console.log('1.3 Pali top with custom border metrics:', paliTopCustomBorder);
    assert.strictEqual(paliTopCustomBorder.borderLeftWidth, '1px', `Pali top custom border-left-width is 1px (got ${paliTopCustomBorder.borderLeftWidth})`);
    console.log('  ✓ PASS: Pali block in top position with custom border has border-left of 1.0px (computed: 1px)');

    // -----------------------------------------------------------
    // TEST TASK 2: Language Menu Move-to-Top Behavior
    // -----------------------------------------------------------
    console.log('\n--- VERIFYING TASK 2: Language Menu Move-to-Top in UI ---');

    // Reset settings to default order
    await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      settings.translationOrder = ['pali', 'english', 'vietnamese', 'myanmar', 'thai', 'sinhala'];
      delete settings.translationColors;
      localStorage.setItem(key, JSON.stringify(settings));
      location.reload();
    })()`);
    await sleep(3000);

    // Open Language Modal
    console.log('Opening Language Menu...');
    await sleep(2000);
    const openMenuRes = await waitFor(async () => {
      return await evaluate(ws, `(() => {
        const btn = document.querySelector('button[aria-label="Pāḷi script and translation Language"]');
        if (btn) {
          btn.click();
          return { clicked: true };
        }
        return { error: 'Language button not yet in DOM' };
      })()`);
    });
    console.log('Language button click result:', openMenuRes);

    // Wait until modal with Move to top buttons is mounted
    const modalReady = await waitFor(async () => {
      return await evaluate(ws, `(() => {
        const topBtns = document.querySelectorAll('button[title="Move to top"]');
        if (topBtns.length >= 5) {
          return { count: topBtns.length };
        }
        return { error: 'Modal not rendered yet' };
      })()`);
    });
    console.log('Modal ready result:', modalReady);

    // Helper to find move-to-top or move-up button by language label or flag
    const clickRowBtn = async (langKey, btnTitle) => {
      return await evaluate(ws, `(() => {
        const allBtns = Array.from(document.querySelectorAll('button[title="${btnTitle}"]'));
        const targetBtn = allBtns.find(btn => {
          const row = btn.closest('.rounded-xl');
          return row && row.textContent.includes('${langKey}');
        });
        if (!targetBtn) {
          const available = allBtns.map(b => b.closest('.rounded-xl')?.textContent?.trim().slice(0, 25));
          return { error: 'Button ${btnTitle} not found for ${langKey}', available };
        }
        targetBtn.click();
        return { success: true, disabled: targetBtn.disabled };
      })()`);
    };

    // Step 2.1: Pali is at top. Click "Move to top" on Vietnamese (Tiếng Việt)
    console.log('\nClicking "Move to top" on Tiếng Việt (Vietnamese)...');
    const clickViRes = await clickRowBtn('Tiếng Việt', 'Move to top');
    console.log('Click Vietnamese result:', clickViRes);
    assert.strictEqual(clickViRes.success, true, 'Clicked Vietnamese Move to top');
    await sleep(600);

    const orderAfterVi = await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      return settings.translationOrder;
    })()`);
    console.log('Order after moving Vietnamese to top:', orderAfterVi?.slice(0, 5));
    assert.strictEqual(orderAfterVi[0], 'pali', 'Pali REMAINED at index 0 (top)');
    assert.strictEqual(orderAfterVi[1], 'vietnamese', 'Vietnamese moved to index 1 (second top)!');
    assert.strictEqual(orderAfterVi[2], 'english', 'English was shifted to index 2');
    console.log('  ✓ PASS: Clicking "Move to top" on Vietnamese moved it to index 1 (right below Pali)');

    // Step 2.2: Pali is at top. Click "Move to top" on Myanmar (မြန်မာ)
    console.log('\nClicking "Move to top" on မြန်မာ (Myanmar)...');
    const clickMyRes = await clickRowBtn('မြန်မာ', 'Move to top');
    assert.strictEqual(clickMyRes.success, true, 'Clicked Myanmar Move to top');
    await sleep(600);

    const orderAfterMy = await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      return settings.translationOrder;
    })()`);
    console.log('Order after moving Myanmar to top:', orderAfterMy?.slice(0, 5));
    assert.strictEqual(orderAfterMy[0], 'pali', 'Pali REMAINED at index 0 (top)');
    assert.strictEqual(orderAfterMy[1], 'myanmar', 'Myanmar moved to index 1 (second top)!');
    assert.strictEqual(orderAfterMy[2], 'vietnamese', 'Vietnamese shifted to index 2');
    console.log('  ✓ PASS: Clicking "Move to top" on Myanmar moved it to index 1 (right below Pali)');

    // Step 2.3: Move up Myanmar (index 1) - should move it to index 0 above Pali
    console.log('\nClicking "Move up" (▲) on မြန်မာ (at index 1)...');
    const clickUpMyRes = await clickRowBtn('မြန်မာ', 'Move up');
    assert.strictEqual(clickUpMyRes.success, true, 'Clicked Myanmar Move up');
    await sleep(600);

    const orderAfterMoveUp = await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      return settings.translationOrder;
    })()`);
    console.log('Order after Move Up on Myanmar:', orderAfterMoveUp?.slice(0, 5));
    assert.strictEqual(orderAfterMoveUp[0], 'myanmar', 'Myanmar moved to index 0 via Move Up');
    assert.strictEqual(orderAfterMoveUp[1], 'pali', 'Pali shifted to index 1');
    console.log('  ✓ PASS: "Move up" moved Myanmar to index 0, unrestricted');

    // Step 2.4: Pali is NOT at top (Myanmar is at top).
    // Clicking "Move to top" on Vietnamese MUST move it to index 0!
    console.log('\nPali NOT at top. Clicking "Move to top" on Tiếng Việt...');
    const clickViTopWhenPaliNotTop = await clickRowBtn('Tiếng Việt', 'Move to top');
    assert.strictEqual(clickViTopWhenPaliNotTop.success, true, 'Clicked Vietnamese Move to top');
    await sleep(600);

    const orderAfterViTop = await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      return settings.translationOrder;
    })()`);
    console.log('Order after moving Vietnamese to top (Pali not top):', orderAfterViTop?.slice(0, 5));
    assert.strictEqual(orderAfterViTop[0], 'vietnamese', 'Vietnamese moved to index 0 (very top)');
    assert.strictEqual(orderAfterViTop[1], 'myanmar', 'Myanmar shifted to index 1');
    assert.strictEqual(orderAfterViTop[2], 'pali', 'Pali is at index 2');
    console.log('  ✓ PASS: Clicking "Move to top" moves language to index 0 when Pali is NOT at top');

    // Step 2.5: Click "Move to top" on Pali (now at index 2) -> Pali moves to index 0!
    console.log('\nClicking "Move to top" on Pāḷi (at index 2)...');
    const clickPaliTopRes = await clickRowBtn('Pāḷi', 'Move to top');
    assert.strictEqual(clickPaliTopRes.success, true, 'Clicked Pali Move to top');
    await sleep(600);

    const orderAfterPaliTop = await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      return settings.translationOrder;
    })()`);
    console.log('Order after moving Pali to top:', orderAfterPaliTop?.slice(0, 5));
    assert.strictEqual(orderAfterPaliTop[0], 'pali', 'Pali moved back to index 0 (top)');
    console.log('  ✓ PASS: Clicking "Move to top" on Pali restores Pali to index 0');

    // Step 2.6: Now Pali is back at top. Click "Move to top" on English -> moves to index 1!
    console.log('\nPali is back at top. Clicking "Move to top" on English...');
    const clickEnTopRes = await clickRowBtn('English', 'Move to top');
    assert.strictEqual(clickEnTopRes.success, true, 'Clicked English Move to top');
    await sleep(600);

    const orderAfterEnTop = await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      return settings.translationOrder;
    })()`);
    console.log('Order after moving English to top with Pali at top:', orderAfterEnTop?.slice(0, 5));
    assert.strictEqual(orderAfterEnTop[0], 'pali', 'Pali is still at index 0');
    assert.strictEqual(orderAfterEnTop[1], 'english', 'English moved to index 1 (second top only)!');
    console.log('  ✓ PASS: English moved to index 1 only, Pali remained at index 0');

    // Reset settings before completing
    await evaluate(ws, `(() => {
      const key = 'tipitaka_advanced_settings_v4';
      const settings = JSON.parse(localStorage.getItem(key) || '{}');
      settings.translationOrder = ['pali', 'english', 'vietnamese'];
      localStorage.setItem(key, JSON.stringify(settings));
    })()`);

    // Close modal
    await evaluate(ws, `(() => {
      const doneBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Done');
      if (doneBtn) doneBtn.click();
    })()`);
    await sleep(500);

    console.log('\n============================================================');
    console.log('🎉 ALL TESTS FOR TASK 1 AND TASK 2 PASSED SUCCESSFULLY!');
    console.log('============================================================\n');
  } finally {
    ws.close();
    chrome.kill();
  }
}

main().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
