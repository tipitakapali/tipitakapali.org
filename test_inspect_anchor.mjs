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
    await wait(2500);

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
    console.log('Applying translations: english + vietnamese, sentence mode...');
    await evaluate(`(() => {
      let s = {};
      try { s = JSON.parse(localStorage.getItem('tipitaka_theme_settings') || '{}'); } catch(e){}
      s.translations = {
        pali: true,
        english: true,
        vietnamese: true
      };
      s.translationGranularity = 'sentence';
      s.pulseAnimation = true;
      localStorage.setItem('tipitaka_theme_settings', JSON.stringify(s));
    })()`);

    await send('Page.navigate', { url: 'http://localhost:3000/book/vin01a.att/1' });
    await wait(4000);

    // Click Go button in footer
    console.log('Clicking footer Go button...');
    await evaluate(`(() => {
      const goBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.title === 'Go to Paragraph or Page Number' || b.textContent.trim() === 'Go'
      );
      if (goBtn) goBtn.click();
    })()`);
    await wait(800);

    // Click Page Number tab
    console.log('Clicking Page Number tab...');
    await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      const pageBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.includes('Page Number'));
      if (pageBtn) pageBtn.click();
    })()`);
    await wait(500);

    // Select M and type 222
    console.log('Selecting M and typing 222...');
    const fillResult = await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      const mBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.trim().startsWith('Myanmar') || b.textContent.trim().startsWith('M'));
      if (mBtn) mBtn.click();

      const input = modal.querySelector('input');
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '222');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const submitBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.trim() === 'Go to Page');
      if (submitBtn) {
        submitBtn.click();
        return { success: true };
      }
      return { error: 'no submit btn' };
    })()`);
    console.log('Fill result:', fillResult);

    // Monitor for 12 seconds
    for (let t = 1; t <= 12; t++) {
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

        const chap5 = document.querySelector('[data-chapter="5"]');
        const chap5Settled = chap5?.getAttribute('data-trans-settled');
        const chap5Loading = chap5?.getAttribute('data-trans-loading');
        const sentPairsInChap5 = chap5?.querySelectorAll('.sent-pair').length || 0;

        return {
          second: ${t},
          scrollTop: Math.round(container?.scrollTop || 0),
          relTop,
          targetTag: targetEl?.tagName,
          targetClass: targetEl?.className,
          anchorId: anchor?.id,
          chap5Settled,
          chap5Loading,
          sentPairsInChap5,
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
