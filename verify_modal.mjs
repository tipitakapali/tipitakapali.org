/** Verify CitationQuickviewModal: Pali + next 2 enabled languages in order */
import { spawn } from 'child_process';
const CDP = 'http://127.0.0.1:9233';
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
async function openTab(url) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const tab = await res.json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    const readyState = await evaluate(ws, `document.readyState`).catch(() => null);
    if (readyState === 'complete') break;
  }
  return { tab, ws };
}
async function run() {
  const chrome = spawn('/snap/bin/chromium',
    ['--headless=new', '--remote-debugging-port=9233', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/opencode/chrome-modal', 'about:blank'], { stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      try { const r = await fetch(`${CDP}/json/version`); if (r.ok) { ready = true; break; } } catch {}
    }
    if (!ready) throw new Error('cdp down');

    // languages enabled: vietnamese + myanmar + sinhala + thai (ENGLISH DISABLED, in order vi,my first)
    const settings = {
      translations: { pali: true, english: false, vietnamese: true, myanmar: true, sinhala: true, thai: true, chinese: false, khmer: false, lao: false, tamil: false, hindi: false, german: false, japanese: false, korean: false, portuguese: false, russian: false, my_nissaya: false },
      translationOrder: ['pali', 'english', 'vietnamese', 'myanmar', 'my_nissaya', 'sinhala', 'chinese', 'khmer', 'thai', 'lao', 'tamil', 'hindi', 'german', 'japanese', 'korean', 'portuguese', 'russian'],
      translationDisplayMode: 'stack', scrollMotion: 'instant', pulseAnimation: false,
    };
    const threads = [{
      id: 't_seed', title: 'Seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }];
    const messages = {
      t_seed: [
        { id: 'm_user', role: 'user', content: 'Please quote the passage' },
        {
          id: 'm_ai', role: 'assistant',
          content: 'Here is the canonical passage for you: [s0101m.mul:c0:p40]',
          citations: [{ bookCode: 's0101m.mul', chapterIndex: 0, paraIndex: 40, ref: '[s0101m.mul:c0:p40]' }],
          isStreaming: false,
        },
      ],
    };

    const t = await openTab(`${APP}/?tab=ai`);
    // Seed localStorage and patch fetch capture, then reload
    await evaluate(t.ws, `(() => {
      try {
        localStorage.setItem('tipitaka_advanced_settings_v5', ${JSON.stringify(JSON.stringify(settings))});
        localStorage.setItem('tipitaka_ai_threads_v1', ${JSON.stringify(JSON.stringify(threads))});
        localStorage.setItem('tipitaka_ai_messages_v1', ${JSON.stringify(JSON.stringify(messages))});
        window.__capturedFetch = [];
        const orig = window.fetch;
        window.fetch = async (...args) => {
          try { window.__capturedFetch.push(String(args[0])); } catch (e) {}
          return orig.apply(window, args);
        };
      } catch (e) { window.__seedError = e.message; }
    })()`);
    await evaluate(t.ws, `window.location.reload()`);

    // Wait for the assistant message & click the inline citation chip
    let clicked = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const chip = await evaluate(t.ws, `document.querySelector('.ai-citation-chip') ? 'yes' : 'no'`);
      if (chip === 'yes') {
        await evaluate(t.ws, `document.querySelector('.ai-citation-chip').click(); 'clicked'`);
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('citation chip not found');

    // Wait for modal content (not loading)
    let modal = null;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      modal = await evaluate(t.ws, `(() => {
        const m = document.querySelector('.citation-quickview-modal');
        if (!m) return null;
        const loading = !!m.querySelector('.animate-spin');
        const headers = Array.from(m.querySelectorAll('.space-y-4 > div')).map((d) => (d.innerText || '').split('\\n')[0]);
        const body = m.innerText;
        return { loading, headers, hasEn: /English Translation/.test(body), hasVi: /Bản dịch Tiếng Việt/.test(body), hasMy: /မြန်မာဘာသာပြန်/.test(body), hasPali: /Chaṭṭha Saṅgāyana Pāḷi/.test(body), fetchLog: (window.__capturedFetch || []).filter((u) => u.includes('/api/ai/paragraph_content')).slice(-1)[0] || null };
      })()`);
      if (modal && !modal.loading && modal.hasPali) break;
    }
    console.log('MODAL:', JSON.stringify(modal, null, 2));
    const pass = modal && !modal.loading && modal.hasPali && modal.hasVi && modal.hasMy && !modal.hasEn &&
      /langs=vi,my(&|$)/.test(modal.fetchLog || '');
    console.log(`\n=== MODAL VERDICT: ${pass ? 'PASS' : 'FAIL'} ===`);
    process.exitCode = pass ? 0 : 1;
    await fetch(`${CDP}/json/close/${t.tab.id}`, { method: 'PUT' }).catch(() => {});
  } finally { chrome.kill(); }
}
run().catch((e) => { console.error('ERR:', e.message); process.exitCode = 2; });
