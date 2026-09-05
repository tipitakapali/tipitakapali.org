import assert from 'assert';
import { spawn } from 'child_process';

console.log('=== Running Edge Cases & Attack Tests ===\n');

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

async function openTestTab(url) {
  const tabRes = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const tab = await tabRes.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  return { tab, ws };
}

async function waitForSearchModal(ws) {
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const state = await evaluate(ws, `(() => {
      const select = document.querySelector('select[aria-label="Select FTS database"]');
      const summary = document.querySelector('.search-summary-bar');
      return {
        search: window.location.search,
        selectedDb: select ? select.value : null,
        hasSummary: !!(summary && summary.innerText.includes('matches')),
      };
    })()`);
    if (state?.hasSummary) return state;
  }
  return null;
}

async function run() {
  const chrome = spawn(
    '/snap/bin/chromium',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/test-chrome-attack',
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

  try {
    // Attack 1: Switching dropdown database in SearchModal when initial query is active
    console.log('\n[Attack 1] Testing interactive DB switch in SearchModal (?l=si&q=buddha -> switch to en)...');
    const { ws: ws1 } = await openTestTab('http://localhost:3000/?l=si&q=buddha');
    await waitForSearchModal(ws1);

    console.log('  Triggering select change to English (fts_translation_en.db)...');
    await evaluate(ws1, `(() => {
      const select = document.querySelector('select[aria-label="Select FTS database"]');
      if (!select) throw new Error('Select element not found');
      select.value = 'fts_translation_en.db';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);

    // Wait for search update
    await sleep(2000);

    const stateAfterSwitch = await evaluate(ws1, `(() => {
      const select = document.querySelector('select[aria-label="Select FTS database"]');
      return {
        url: window.location.href,
        search: window.location.search,
        selectedDb: select ? select.value : null,
      };
    })()`);
    console.log('  State after switch to en:', stateAfterSwitch);
    assert.strictEqual(stateAfterSwitch.selectedDb, 'fts_translation_en.db', 'Dropdown should stay English');
    assert(stateAfterSwitch.search.includes('l=en'), 'URL should have updated to l=en');
    assert(!stateAfterSwitch.search.includes('l=si'), 'URL should no longer have l=si');

    // Attack 2: Switch from English to Pāḷi CST (fts_tipitaka.db)
    console.log('\n[Attack 2] Testing switch from English to Pāḷi CST (fts_tipitaka.db)...');
    await evaluate(ws1, `(() => {
      const select = document.querySelector('select[aria-label="Select FTS database"]');
      select.value = 'fts_tipitaka.db';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);

    await sleep(2000);
    const stateAfterPali = await evaluate(ws1, `(() => {
      const select = document.querySelector('select[aria-label="Select FTS database"]');
      return {
        url: window.location.href,
        search: window.location.search,
        selectedDb: select ? select.value : null,
      };
    })()`);
    console.log('  State after switch to pali:', stateAfterPali);
    assert.strictEqual(stateAfterPali.selectedDb, 'fts_tipitaka.db', 'Dropdown should stay Pāḷi CST');
    assert(!stateAfterPali.search.includes('l='), 'URL should NOT have l= parameter for Pāḷi CST');
    assert(!stateAfterPali.search.includes('db='), 'URL should NOT have db= parameter');

    // Attack 3: Legacy URL with both l and lang: ?l=si&lang=si&q=buddha
    console.log('\n[Attack 3] Navigating to http://localhost:3000/?l=si&lang=si&q=buddha ...');
    const { ws: ws3 } = await openTestTab('http://localhost:3000/?l=si&lang=si&q=buddha');
    await waitForSearchModal(ws3);
    const stateLegacyBoth = await evaluate(ws3, `(() => ({ search: window.location.search }))()`);
    console.log('  State legacy both:', stateLegacyBoth);
    assert(!stateLegacyBoth.search.includes('lang='), 'Legacy lang= must be stripped even when l= is present');
    assert(stateLegacyBoth.search.includes('l=si'), 'l=si must be present');

    // Attack 4: Legacy URL ?db=tipitaka&q=anatta
    console.log('\n[Attack 4] Navigating to legacy http://localhost:3000/?db=tipitaka&q=anatta ...');
    const { ws: ws4 } = await openTestTab('http://localhost:3000/?db=tipitaka&q=anatta');
    await waitForSearchModal(ws4);
    const stateTipitaka = await evaluate(ws4, `(() => {
      const select = document.querySelector('select[aria-label="Select FTS database"]');
      return {
        search: window.location.search,
        selectedDb: select ? select.value : null,
      };
    })()`);
    console.log('  State ?db=tipitaka:', stateTipitaka);
    assert.strictEqual(stateTipitaka.selectedDb, 'fts_tipitaka.db', 'db=tipitaka should resolve to fts_tipitaka.db');
    assert(!stateTipitaka.search.includes('l='), 'db=tipitaka should omit l= parameter because it is Pali');
    assert(!stateTipitaka.search.includes('db='), 'db= parameter must be cleaned up');

    // Attack 5: Legacy URL ?lang=english&q=truth
    console.log('\n[Attack 5] Navigating to legacy http://localhost:3000/?lang=english&q=truth ...');
    const { ws: ws5 } = await openTestTab('http://localhost:3000/?lang=english&q=truth');
    await waitForSearchModal(ws5);
    const stateEnglish = await evaluate(ws5, `(() => {
      const select = document.querySelector('select[aria-label="Select FTS database"]');
      return {
        search: window.location.search,
        selectedDb: select ? select.value : null,
      };
    })()`);
    console.log('  State ?lang=english:', stateEnglish);
    assert.strictEqual(stateEnglish.selectedDb, 'fts_translation_en.db', 'lang=english should resolve to fts_translation_en.db');
    assert(stateEnglish.search.includes('l=en'), 'lang=english should become l=en');
    assert(!stateEnglish.search.includes('english'), 'URL should not have full word english');
    assert(!stateEnglish.search.includes('lang='), 'lang= parameter must be cleaned up');

    // Attack 6: Legacy URL ?l=pali&q=anatta (clean up l=pali)
    console.log('\n[Attack 6] Navigating to http://localhost:3000/?l=pali&q=anatta ...');
    const { ws: ws6 } = await openTestTab('http://localhost:3000/?l=pali&q=anatta');
    await waitForSearchModal(ws6);
    const statePaliClean = await evaluate(ws6, `(() => ({ search: window.location.search }))()`);
    console.log('  State ?l=pali&q=anatta:', statePaliClean);
    assert(!statePaliClean.search.includes('l='), 'l=pali must be removed from URL');

    // Attack 7: Clicking search result in translation
    console.log('\n[Attack 7] Clicking a search result in English translation (?l=en&q=truth)...');
    await evaluate(ws5, `(() => {
      const item = document.querySelector('.search-result-item, .search-result-card');
      if (item) item.click();
    })()`);
    await sleep(2000);
    const stateResultClicked = await evaluate(ws5, `(() => ({
      pathname: window.location.pathname,
      search: window.location.search,
    }))()`);
    console.log('  State after result clicked:', stateResultClicked);
    assert(stateResultClicked.pathname.startsWith('/book/'), 'Should have navigated to /book/');
    assert(stateResultClicked.search.includes('l=en'), 'Search highlighting URL must have l=en');
    assert(!stateResultClicked.search.includes('db='), 'Book URL must NOT contain db=');

    // Attack 8: Clear search query
    console.log('\n[Attack 8] Clicking clear button in SearchModal...');
    const { ws: ws8 } = await openTestTab('http://localhost:3000/?l=si&q=buddha');
    await waitForSearchModal(ws8);
    await evaluate(ws8, `(() => {
      const clearBtn = document.querySelector('button[title="Clear input"]');
      if (clearBtn) clearBtn.click();
    })()`);
    await sleep(1000);
    const stateCleared = await evaluate(ws8, `(() => ({ search: window.location.search }))()`);
    console.log('  State after clear query:', stateCleared);
    assert(!stateCleared.search.includes('q='), 'q must be removed when cleared');
    assert(!stateCleared.search.includes('l='), 'l must be removed when query is cleared');
    assert(!stateCleared.search.includes('db='), 'db must not be present');

    console.log('\n🎉 ALL ATTACK TESTS PASSED PERFECTLY!');
  } finally {
    chrome.kill('SIGKILL');
  }
}

run().catch((err) => {
  console.error('\n❌ ATTACK TEST FAILED:', err);
  process.exit(1);
});
