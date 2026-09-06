import { spawn } from 'child_process';
import fs from 'fs';
const CDP = 'http://127.0.0.1:9231';
const APP = 'http://localhost:3000';
const BOOK = 's0302m.mul';
const CHAP = 5;
const PINDEX = 1120;
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
async function runCase(ws, label, runIdx) {
  const logs = [];
  let lastRel = null;
  for (let i = 0; i < 35; i++) {
    await sleep(1000);
    const m = await evaluate(ws, `(() => {
      const row = document.querySelector('[data-chapter="${CHAP}"] .reader-para-row[data-pindex="${PINDEX}"]');
      const container = document.querySelector('main.content-area');
      if (!row || !container) return null;
      const r = row.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      return { relTop: Math.round((r.top - c.top) * 10) / 10, scrollTop: Math.round(container.scrollTop) };
    })()`).catch(() => null);
    if (m) { lastRel = m.relTop; logs.push(`t=${i}s relTop=${m.relTop} scrollTop=${m.scrollTop}`); }
    if (m && Math.abs(m.relTop - 60) <= 24) break;
  }
  const dbg = await evaluate(ws, `window.__jumpDbg || []`).catch(() => []);
  fs.writeFileSync(`/tmp/opencode/diag_${runIdx}.txt`, ['== samples ==', ...logs, '== dbg ==', ...(dbg || [])].join('\n'));
  console.log(`RUN ${runIdx} ${label} lastRel=${lastRel} PASS=${Math.abs(lastRel - 60) <= 24}`);
}
async function run() {
  const chrome = spawn('/snap/bin/chromium',
    ['--headless=new', '--remote-debugging-port=9231', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/opencode/chrome-diagfail', 'about:blank'], { stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { const r = await fetch(`${CDP}/json/version`); if (r.ok) { ready = true; break; } } catch {}
    }
    if (!ready) throw new Error('cdp down');
    const settings = {
      translations: { pali: true, english: true, vietnamese: true, myanmar: true, sinhala: true, thai: true, chinese: true, khmer: false, lao: false, hindi: true, german: false, japanese: false, korean: false, portuguese: false, russian: false, my_nissaya: false },
      translationOrder: ['pali', 'english', 'vietnamese', 'myanmar', 'my_nissaya', 'sinhala', 'chinese', 'khmer', 'thai', 'lao', 'tamil', 'hindi', 'german', 'japanese', 'korean', 'portuguese', 'russian'],
      translationDisplayMode: 'stack', scrollMotion: 'instant', pulseAnimation: false,
    };
    for (let r = 0; r < 4; r++) {
      const t = await openTab(`${APP}/book/${BOOK}/${CHAP + 1}?pindex=${PINDEX}&dbgjump=1`, JSON.stringify(settings));
      await runCase(t.ws, `run${r}`, r);
      await fetch(`${CDP}/json/close/${t.tab.id}`, { method: 'PUT' }).catch(() => {});
    }
  } finally { chrome.kill(); }
}
run().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
