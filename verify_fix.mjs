/** Final verification: deep multi-chapter para jump + chapter jump + shallow jump with 7 langs */
import { spawn } from 'child_process';
const CDP = 'http://127.0.0.1:9230';
const APP = 'http://localhost:3000';
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function sendCdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1000000) + 1;
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
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
  const res = await sendCdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return res.result?.value;
}
async function openTab(url, seedSettingsJson = null) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  if (seedSettingsJson) {
    for (let i = 0; i < 30; i++) {
      await sleep(400);
      const readyState = await evaluate(ws, `document.readyState`).catch(() => null);
      if (readyState === 'complete') break;
    }
    await evaluate(ws, `try { localStorage.setItem('tipitaka_advanced_settings_v5', ${JSON.stringify(seedSettingsJson)}); 'ok'; } catch (e) { 'seed-failed:' + e.message; }`);
    await evaluate(ws, `window.location.reload()`);
  }
  return { tab, ws };
}
async function closeTab(tab) {
  try { await fetch(`${CDP}/json/close/${tab.id}`, { method: 'PUT' }); } catch {}
}

const SETTINGS = {
  translations: { pali: true, english: true, vietnamese: true, myanmar: true, sinhala: true, thai: true, chinese: true, khmer: false, lao: false, hindi: true, german: false, japanese: false, korean: false, portuguese: false, russian: false, my_nissaya: false },
  translationOrder: ['pali', 'english', 'vietnamese', 'myanmar', 'my_nissaya', 'sinhala', 'chinese', 'khmer', 'thai', 'lao', 'tamil', 'hindi', 'german', 'japanese', 'korean', 'portuguese', 'russian'],
  translationDisplayMode: 'stack', scrollMotion: 'instant', pulseAnimation: false,
};

async function caseParaJump(ws, book, chap, pindex, label) {
  const expr = `(() => {
    const row = document.querySelector('[data-chapter="${chap}"] .reader-para-row[data-pindex="${pindex}"]');
    const container = document.querySelector('main.content-area');
    if (!row || !container) return null;
    const r = row.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    return { relTop: Math.round((r.top - c.top) * 10) / 10 };
  })()`;
  let pass = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const m = await evaluate(ws, expr).catch(() => null);
    if (m && Math.abs(m.relTop - 60) <= 30) { pass = true; break; }
  }
  const m = await evaluate(ws, expr).catch(() => null);
  console.log(`CASE ${label}: relTop=${m?.relTop} => ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function caseChapterJump(ws, book, chap, label) {
  const expr = `(() => {
    const el = document.querySelector('[data-chapter="${chap}"]');
    const container = document.querySelector('main.content-area');
    if (!el || !container || el.classList.contains('chapter-placeholder')) return null;
    const r = el.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    return { relTop: Math.round((r.top - c.top) * 10) / 10, trans: el.querySelectorAll('.reader-trans-block').length };
  })()`;
  let pass = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const m = await evaluate(ws, expr).catch(() => null);
    if (m && Math.abs(m.relTop - 60) <= 30 && m.trans > 50) { pass = true; break; }
  }
  const m = await evaluate(ws, expr).catch(() => null);
  console.log(`CASE ${label}: chapterTop relTop=${m?.relTop} trans=${m?.trans} => ${pass ? 'PASS' : 'FAIL'}`);
  return pass;
}

async function run() {
  const chrome = spawn('/snap/bin/chromium',
    ['--headless=new', '--remote-debugging-port=9230', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/opencode/chrome-verify', 'about:blank'], { stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { const r = await fetch(`${CDP}/json/version`); if (r.ok) { ready = true; break; } } catch {}
    }
    if (!ready) throw new Error('cdp down');

    const results = [];
    let t = await openTab(`${APP}/book/s0302m.mul/6?pindex=1120`, JSON.stringify(SETTINGS));
    results.push(await caseParaJump(t.ws, 's0302m.mul', 5, 1120, 'deep multi-chapter para jump (ch5 p1120)'));
    await closeTab(t.tab);

    t = await openTab(`${APP}/book/s0101m.mul/1?pindex=40`, JSON.stringify(SETTINGS));
    results.push(await caseParaJump(t.ws, 's0101m.mul', 0, 40, 'single-chapter para jump (ch0 p40)'));
    await closeTab(t.tab);

    t = await openTab(`${APP}/book/s0302m.mul/6`, JSON.stringify(SETTINGS));
    results.push(await caseChapterJump(t.ws, 's0302m.mul', 5, 'chapter jump (sidebar-style ch5)'));
    await closeTab(t.tab);

    console.log(`\n=== VERDICT: ${results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED'} ===`);
    process.exitCode = results.every(Boolean) ? 0 : 1;
  } finally { chrome.kill(); }
}
run().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
