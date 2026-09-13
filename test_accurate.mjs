import { spawn } from 'child_process';

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  const chrome = spawn('/snap/bin/chromium', [
    '--headless=new',
    '--remote-debugging-port=9222',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--window-size=1280,900'
  ]);

  try {
    await wait(1500);

    const newTabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book/vin01a.att/1', { method: 'PUT' });
    const tabData = await newTabRes.json();
    const ws = new WebSocket(tabData.webSocketDebuggerUrl);

    let msgId = 1;
    const callbacks = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => typeof a.value === 'object' ? JSON.stringify(a.value) : (a.value || a.description || '')).join(' ');
        console.log('[BROWSER CONSOLE]', msg.params.type, text);
      }
      if (callbacks.has(msg.id)) {
        const { resolve, reject } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };
    await new Promise((resolve) => ws.onopen = resolve);

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        callbacks.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    async function evaluate(expression, awaitPromise = true) {
      const res = await send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true
      });
      if (res.exceptionDetails) {
        throw new Error(JSON.stringify(res.exceptionDetails));
      }
      return res.result?.value;
    }

    await send('Page.enable');
    await send('Runtime.enable');
    await wait(3500);

    // Apply settings: English + Vietnamese, sentence mode
    await evaluate(`(() => {
      let s = {};
      try { s = JSON.parse(localStorage.getItem('tipitaka_theme_settings') || '{}'); } catch(e){}
      s.translationGranularity = 'sentence';
      s.paliEnabled = true;
      s.activeLangs = ['en', 'vi'];
      s.pulseAnimation = true;
      localStorage.setItem('tipitaka_theme_settings', JSON.stringify(s));

      const layers = [
        { type: 'pali', id: 'layer-pali', enabled: true },
        { type: 'trans', lang: 'en', id: 'trans-en', enabled: true },
        { type: 'trans', lang: 'vi', id: 'trans-vi', enabled: true }
      ];
      localStorage.setItem('tipitaka_layers_order', JSON.stringify(layers));
    })()`);

    await send('Page.navigate', { url: 'http://localhost:3000/book/vin01a.att/1' });
    await wait(4000);

    console.log('Clicking footer Go button...');
    await evaluate(`(() => {
      const goBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.title === 'Go to Paragraph or Page Number' || b.textContent.trim() === 'Go'
      );
      if (goBtn) goBtn.click();
    })()`);
    await wait(800);

    console.log('Clicking Page Number tab...');
    await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      const pageBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.includes('Page Number'));
      if (pageBtn) pageBtn.click();
    })()`);
    await wait(500);

    console.log('Selecting M and typing 222...');
    const fillResult = await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      const mBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('Myanmar') || b.textContent.trim().startsWith('M'));
      if (mBtn) mBtn.click();

      const input = modal.querySelector('input');
      if (!input) return { error: 'no input' };

      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '222');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Find SPECIFIC "Go to Page" submit button
      const submitBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.trim() === 'Go to Page');
      if (submitBtn) {
        submitBtn.click();
        return { success: true, btnText: submitBtn.textContent.trim() };
      }
      return { error: 'no Go to Page submit btn' };
    })()`);
    console.log('Fill & submit result:', fillResult);

    // Monitor for 10 seconds
    for (let t = 1; t <= 10; t++) {
      await wait(1000);
      const state = await evaluate(`(() => {
        const container = document.querySelector('main.content-area');
        const m2222 = document.getElementById('M2.0222') || document.querySelector('[data-ed="M"][data-page="2.0222"]');
        const m1222 = document.getElementById('M1.0222') || document.querySelector('[data-ed="M"][data-page="1.0222"]');
        const anchor = m2222 || m1222;

        const targetEl = (anchor && anchor.closest('.sent-pair')) || (anchor && anchor.getClientRects().length > 0 ? anchor : anchor?.closest('.reader-para-row, p') || anchor?.parentElement);
        const containerRect = container?.getBoundingClientRect();
        const targetRect = targetEl?.getBoundingClientRect();

        const relTop = (targetRect && containerRect) ? Math.round(targetRect.top - containerRect.top) : null;
        const banners = document.querySelectorAll('.reader-trans-pending-banner').length;
        const loadingHappiness = document.querySelectorAll('.reader-chapter-trans-loading').length;
        const hasPulse = Boolean(targetEl?.classList.contains('pulse-highlight'));

        return {
          second: ${t},
          scrollTop: Math.round(container?.scrollTop || 0),
          relTop,
          targetTag: targetEl?.tagName,
          targetClass: targetEl?.className,
          anchorId: anchor?.id,
          banners,
          loadingHappiness,
          hasPulse
        };
      })()`);
      console.log(`[t=${t}s]`, JSON.stringify(state));
    }

    ws.close();
  } finally {
    chrome.kill();
  }
}

run().catch(console.error);
