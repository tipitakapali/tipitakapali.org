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

async function runBackendTests() {
  console.log('\n--- 1. Testing Backend REST API (port 8400 and port 3000) ---');

  const testPairs = [
    { name: 'Phật vs Phat (any distance)', q1: 'Phật', q2: 'Phat', dist: 'any' },
    { name: 'PHẬT vs phật (case insensitivity)', q1: 'PHẬT', q2: 'phật', dist: 'any' },
    { name: 'giác ngộ vs giac ngo (any distance)', q1: 'giác ngộ', q2: 'giac ngo', dist: 'any' },
    { name: 'giác ngộ vs giac ngo (exact phrase)', q1: 'giác ngộ', q2: 'giac ngo', dist: '1' },
    { name: 'Thế Tôn vs The Ton (any distance)', q1: 'Thế Tôn', q2: 'The Ton', dist: 'any' },
    { name: 'Thế Tôn vs The Ton (exact phrase)', q1: 'Thế Tôn', q2: 'The Ton', dist: '1' },
    { name: 'Thế Tôn vs The Ton (proximity dist=2)', q1: 'Thế Tôn', q2: 'The Ton', dist: '2' },
    { name: 'A-la-hán vs A la han (hyphenated word)', q1: 'A-la-hán', q2: 'A la han', dist: 'any' },
    { name: 'Niết-bàn vs Niet-ban (exact phrase)', q1: 'Niết-bàn', q2: 'Niet-ban', dist: '1' },
  ];

  for (const pair of testPairs) {
    const u1 = `http://127.0.0.1:8400/api/search?q=${encodeURIComponent(pair.q1)}&db=vi&distance=${pair.dist}&limit=5`;
    const u2 = `http://127.0.0.1:8400/api/search?q=${encodeURIComponent(pair.q2)}&db=vi&distance=${pair.dist}&limit=5`;

    const r1 = await (await fetch(u1)).json();
    const r2 = await (await fetch(u2)).json();

    console.log(`[API 8400] ${pair.name}:`);
    console.log(`  q1 "${pair.q1}" -> total: ${r1.total}, ftsQuery: ${r1.ftsQuery}`);
    console.log(`  q2 "${pair.q2}" -> total: ${r2.total}, ftsQuery: ${r2.ftsQuery}`);

    if (r1.total !== r2.total || r1.total === 0) {
      throw new Error(`Mismatch or zero results for ${pair.name}: ${r1.total} vs ${r2.total}`);
    }

    // Verify snippet has <mark> tags
    const snip1 = r1.results[0]?.snippet || '';
    const snip2 = r2.results[0]?.snippet || '';
    if (!snip1.includes('<mark>') || !snip2.includes('<mark>')) {
      throw new Error(`Snippet missing <mark> highlight in ${pair.name}`);
    }
    console.log(`  ✓ Matches identical (${r1.total}), snippet highlight verified.`);
  }

  // Filter parity tests (MAT and Piṭaka)
  console.log('\n[API 8400] Testing filter parity:');
  const mula1 = await (await fetch('http://127.0.0.1:8400/api/search?q=Ph%E1%BA%ADt&db=vi&mat=mula')).json();
  const mula2 = await (await fetch('http://127.0.0.1:8400/api/search?q=Phat&db=vi&mat=mula')).json();
  if (mula1.total !== mula2.total || mula1.total === 0) {
    throw new Error(`MAT=mula filter mismatch: ${mula1.total} vs ${mula2.total}`);
  }
  console.log(`  ✓ MAT=mula filter parity verified: ${mula1.total} matches for both.`);

  const sutta1 = await (await fetch('http://127.0.0.1:8400/api/search?q=gi%C3%A1c%20ng%E1%BB%99&db=vi&pitaka=sutta')).json();
  const sutta2 = await (await fetch('http://127.0.0.1:8400/api/search?q=giac%20ngo&db=vi&pitaka=sutta')).json();
  if (sutta1.total !== sutta2.total || sutta1.total === 0) {
    throw new Error(`Piṭaka=sutta filter mismatch: ${sutta1.total} vs ${sutta2.total}`);
  }
  console.log(`  ✓ Piṭaka=sutta filter parity verified: ${sutta1.total} matches for both.`);

  // Pagination parity test
  const p0 = await (await fetch('http://127.0.0.1:8400/api/search?q=Phat&db=vi&offset=0&limit=10')).json();
  const p10 = await (await fetch('http://127.0.0.1:8400/api/search?q=Phat&db=vi&offset=10&limit=10')).json();
  if (p0.total !== p10.total || p0.results[0]?.rowid === p10.results[0]?.rowid) {
    throw new Error(`Pagination failure: rowids overlap or totals differ`);
  }
  console.log(`  ✓ Pagination verified: consistent total (${p0.total}) and distinct rowids across offsets.`);

  // Also verify port 3000 proxy
  const proxyRes1 = await (await fetch('http://127.0.0.1:3000/api/search?q=Phat&db=vi&limit=1')).json();
  const proxyRes2 = await (await fetch('http://127.0.0.1:3000/api/search?q=Ph%E1%BA%ADt&db=vi&limit=1')).json();
  if (proxyRes1.total !== proxyRes2.total || proxyRes1.total === 0) {
    throw new Error(`Proxy port 3000 total mismatch: ${proxyRes1.total} vs ${proxyRes2.total}`);
  }
  console.log(`[Proxy 3000] Verified Next.js proxy returns ${proxyRes1.total} matches for both Phat and Phật.`);
}

async function typeIntoSearch(ws, text) {
  return await evaluate(
    ws,
    `(() => {
      const input = document.querySelector('input[placeholder*="translation"]') || document.querySelector('.modal-card-search input');
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`
  );
}

async function waitForSummaryMatch(ws, expectedTerm, maxWaitSec = 10) {
  const steps = maxWaitSec * 4;
  for (let i = 0; i < steps; i++) {
    await sleep(250);
    const data = await evaluate(
      ws,
      `(() => {
        const summary = document.querySelector('.search-summary-bar');
        const marks = document.querySelectorAll('.search-results-list mark');
        const select = document.querySelector('select[aria-label="Select FTS database"]');
        return {
          summaryText: summary ? summary.innerText : null,
          marksCount: marks.length,
          selectedDb: select ? select.value : null
        };
      })()`
    );

    if (
      data?.summaryText &&
      data.summaryText.includes('matches') &&
      data.summaryText.includes(expectedTerm)
    ) {
      return data;
    }
  }
  return null;
}

async function runBrowserTests() {
  console.log('\n--- 2. Testing Frontend UI via Headless Chromium (CDP) ---');

  console.log('Launching headless Chromium on port 9222...');
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

  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        const res = await fetch('http://127.0.0.1:9222/json/version');
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
    }
    if (!ready) throw new Error('Chromium failed to start on port 9222');

    // 2.1 Test unaccented "Phat" via URL params
    const testUrl = 'http://localhost:3000/?q=Phat&db=vi';
    console.log(`\n[2.1] Opening page: ${testUrl} ...`);
    const tabRes = await fetch(`http://127.0.0.1:9222/json/new?${encodeURIComponent(testUrl)}`, { method: 'PUT' });
    const tab = await tabRes.json();

    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.addEventListener('open', resolve));

    const resPhat = await waitForSummaryMatch(ws, 'Phat');
    if (!resPhat) throw new Error('Timed out waiting for search results for "Phat"');
    console.log(`  ✓ Unaccented "Phat" loaded: "${resPhat.summaryText.replace(/\n/g, ' ')}", marks: ${resPhat.marksCount}, db: ${resPhat.selectedDb}`);
    if (resPhat.marksCount === 0) throw new Error('No marks highlighted for "Phat"');

    // 2.2 Test accented "Phật" via navigation
    console.log('\n[2.2] Navigating to http://localhost:3000/?q=Ph%E1%BA%ADt&db=vi ...');
    await evaluate(ws, `window.location.href = "http://localhost:3000/?q=Ph%E1%BA%ADt&db=vi"`);
    await sleep(1500);

    const resPhatAccented = await waitForSummaryMatch(ws, 'Phật');
    if (!resPhatAccented) throw new Error('Timed out waiting for search results for "Phật"');
    console.log(`  ✓ Accented "Phật" loaded: "${resPhatAccented.summaryText.replace(/\n/g, ' ')}", marks: ${resPhatAccented.marksCount}`);

    // 2.3 Test dynamic typing: "giac ngo"
    console.log('\n[2.3] Typing into search input: "giac ngo" ...');
    await typeIntoSearch(ws, 'giac ngo');
    const resGiacNgo = await waitForSummaryMatch(ws, 'giac ngo');
    if (!resGiacNgo) throw new Error('Timed out waiting for search results for "giac ngo"');
    console.log(`  ✓ Dynamic search "giac ngo" loaded: "${resGiacNgo.summaryText.replace(/\n/g, ' ')}", marks: ${resGiacNgo.marksCount}`);

    // 2.4 Test dynamic typing: "giác ngộ"
    console.log('\n[2.4] Typing into search input: "giác ngộ" ...');
    await typeIntoSearch(ws, 'giác ngộ');
    const resGiacNgoAccented = await waitForSummaryMatch(ws, 'giác ngộ');
    if (!resGiacNgoAccented) throw new Error('Timed out waiting for search results for "giác ngộ"');
    console.log(`  ✓ Dynamic search "giác ngộ" loaded: "${resGiacNgoAccented.summaryText.replace(/\n/g, ' ')}", marks: ${resGiacNgoAccented.marksCount}`);

    // 2.5 Test dynamic typing: "The Ton"
    console.log('\n[2.5] Typing into search input: "The Ton" ...');
    await typeIntoSearch(ws, 'The Ton');
    const resTheTon = await waitForSummaryMatch(ws, 'The Ton');
    if (!resTheTon) throw new Error('Timed out waiting for search results for "The Ton"');
    console.log(`  ✓ Dynamic search "The Ton" loaded: "${resTheTon.summaryText.replace(/\n/g, ' ')}", marks: ${resTheTon.marksCount}`);

    // 2.6 Test dynamic typing: "Thế Tôn"
    console.log('\n[2.6] Typing into search input: "Thế Tôn" ...');
    await typeIntoSearch(ws, 'Thế Tôn');
    const resTheTonAccented = await waitForSummaryMatch(ws, 'Thế Tôn');
    if (!resTheTonAccented) throw new Error('Timed out waiting for search results for "Thế Tôn"');
    console.log(`  ✓ Dynamic search "Thế Tôn" loaded: "${resTheTonAccented.summaryText.replace(/\n/g, ' ')}", marks: ${resTheTonAccented.marksCount}`);

    ws.close();
    console.log('\n✓ All browser CDP tests passed successfully!');
  } finally {
    chrome.kill('SIGKILL');
  }
}

async function main() {
  console.log('=== Vietnamese Full-Text Search Comprehensive Verification ===');
  await runBackendTests();
  await runBrowserTests();
  console.log('\n===============================================================');
  console.log('🎉 ALL VERIFICATIONS (REST API + BROWSER UI) PASSED WITH 100% SUCCESS!');
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('\n❌ VERIFICATION FAILED:', err);
  process.exit(1);
});
