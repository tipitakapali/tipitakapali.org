/**
 * Phase 1 feedback loop for: "citation jump scrolls to wrong position when a
 * translation layer is enabled, correct without translation".
 *
 * Differential test: same citation-style jump (?pindex=40 in s0101m.mul ch.0)
 * with translations OFF vs ON. Measures the target row's position relative to
 * the reader viewport top after settling. Reader code scrolls to offset-60,
 * so relTop should be ≈ 60px.
 *
 * Exit codes: 0 = both PASS (bug absent), 1 = bug reproduced
 * (OFF passes, ON fails), 2 = loop invalid (OFF fails / preconditions unmet).
 */
import { spawn } from 'child_process';

const CDP = 'http://127.0.0.1:9222';
const APP = 'http://localhost:3000';
const BOOK_URL = `${APP}/book/s0101m.mul/1?pindex=40`;
const TARGET_PINDEX = 40;
const EXPECTED_TOP = 60;
const TOLERANCE = 40;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sendCdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1000000) + 1;
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
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

async function openTab(url, seedSettingsJson = null) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  if (seedSettingsJson) {
    // Same-origin only: seed AFTER the app document exists, then reload so the
    // provider picks the settings up on mount.
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const readyState = await evaluate(ws, `document.readyState`).catch(() => null);
      if (readyState) break;
    }
    const seedRes = await evaluate(
      ws,
      `try { localStorage.setItem('tipitaka_advanced_settings_v5', ${JSON.stringify(seedSettingsJson)}); localStorage.getItem('tipitaka_advanced_settings_v5').slice(0, 60); } catch (e) { 'seed-failed:' + e.message; }`
    );
    console.log('seed result:', seedRes);
    await evaluate(ws, `window.location.reload()`);
  }
  return { tab, ws };
}

async function closeTab(tab) {
  try {
    await fetch(`${CDP}/json/close/${tab.id}`, { method: 'PUT' });
  } catch {}
}

const MEASURE_EXPR = `(async () => {
  const row = document.querySelector('[data-chapter="0"] .reader-para-row[data-pindex="${TARGET_PINDEX}"]')
    || document.querySelector('.reader-para-row[data-pindex="${TARGET_PINDEX}"]')
    || document.querySelector('[data-pindex="${TARGET_PINDEX}"]');
  const container = document.querySelector('main.content-area');
  if (!row || !container) {
    return { ready: false, hasRow: !!row, hasContainer: !!container,
      transBlocks: document.querySelectorAll('.reader-trans-block[data-trans-lang="en"]').length,
      ch0: !!document.querySelector('[data-chapter="0"]') };
  }
  const r = row.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return {
    ready: true,
    relTop: Math.round((r.top - c.top) * 10) / 10,
    scrollTop: Math.round(container.scrollTop),
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    transBlocks: document.querySelectorAll('.reader-trans-block[data-trans-lang="en"]').length,
    rowText: (row.innerText || '').slice(0, 60),
  };
})()`;

async function runCase(ws, label, needTrans) {
  console.log(`\n--- case: ${label} ---`);
  let m = null;
  let preconditionMet = false;
  for (let i = 0; i < 40; i++) {
    await sleep(750);
    try {
      m = await evaluate(ws, MEASURE_EXPR);
    } catch (e) {
      continue;
    }
    if (!m) continue;
    const enoughTrans = needTrans ? m.transBlocks > 30 : true;
    if (m.ready && enoughTrans) {
      preconditionMet = true;
      break;
    }
  }
  if (!m || !m.ready || !preconditionMet) {
    console.log('NOT READY / precondition unmet:', JSON.stringify(m));
    return { label, valid: false, pass: false, m };
  }
  // Settle: allow late translation streaming / drift to manifest, measure twice.
  await sleep(4000);
  const m2 = await evaluate(ws, MEASURE_EXPR);
  await sleep(2000);
  const m3 = await evaluate(ws, MEASURE_EXPR);
  const clamped =
    m3.scrollTop + m3.clientHeight >= m3.scrollHeight - 4 ? '(BOTTOM-CLAMPED)' : '';
  const drift = Math.abs(m3.relTop - m2.relTop);
  const pass = Math.abs(m3.relTop - EXPECTED_TOP) <= TOLERANCE;
  console.log(`transBlocks=${m3.transBlocks} scrollTop=${m3.scrollTop} relTop: ${m2.relTop} -> ${m3.relTop} (drift ${drift}) ${clamped}`);
  console.log(`row: "${m3.rowText}..."`);
  console.log(`expected relTop ≈ ${EXPECTED_TOP}±${TOLERANCE} => ${pass ? 'PASS' : 'FAIL'}`);
  return { label, valid: true, pass, m: m3 };
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
      '--user-data-dir=/tmp/opencode/chrome-cite-scroll',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try {
        const r = await fetch(`${CDP}/json/version`);
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
    }
    if (!ready) throw new Error('chromium CDP did not come up');

    // Case 1: defaults (Pali only, no translation).
    const off = await openTab(BOOK_URL);
    const offRes = await runCase(off.ws, 'translation OFF', false);

    // Seed the ON case with a partial settings object (provider merges over defaults).
    const seeded = JSON.stringify({ translations: { english: true } });

    // Case 2: English translation enabled.
    const on = await openTab(BOOK_URL, seeded);
    const onRes = await runCase(on.ws, 'translation ON (english)', true);

    await closeTab(off.tab);
    await closeTab(on.tab);

    console.log('\n=== VERDICT ===');
    if (!offRes.valid || !onRes.valid) {
      console.log('LOOP INVALID — preconditions not met');
      process.exitCode = 2;
      return;
    }
    if (offRes.pass && !onRes.pass) {
      console.log('BUG REPRODUCED: OFF passes, ON fails');
      process.exitCode = 1;
      return;
    }
    if (offRes.pass && onRes.pass) {
      console.log('GREEN: both pass (bug absent)');
      process.exitCode = 0;
      return;
    }
    console.log(`UNEXPECTED: OFF ${offRes.pass ? 'pass' : 'FAIL'}, ON ${onRes.pass ? 'pass' : 'FAIL'}`);
    process.exitCode = 2;
  } finally {
    chrome.kill();
  }
}

run().catch((e) => {
  console.error('LOOP ERROR:', e.message);
  process.exitCode = 2;
});
