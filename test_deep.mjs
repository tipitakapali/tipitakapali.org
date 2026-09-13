import { spawn } from 'child_process';

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function testMode(modeName, settingsConfig) {
  console.log(`\n========================================`);
  console.log(`TESTING MODE: ${modeName}`);
  console.log(`========================================`);

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
    await wait(3000);

    // Apply test settings in localStorage
    await evaluate(`(() => {
      const config = ${JSON.stringify(settingsConfig)};
      let s = {};
      try { s = JSON.parse(localStorage.getItem('tipitaka_theme_settings') || '{}'); } catch(e){}
      Object.assign(s, config.themeSettings);
      localStorage.setItem('tipitaka_theme_settings', JSON.stringify(s));

      if (config.layersOrder) {
        localStorage.setItem('tipitaka_layers_order', JSON.stringify(config.layersOrder));
      }
      return true;
    })()`);

    // Reload page to start clean with this configuration
    await send('Page.navigate', { url: 'http://localhost:3000/book/vin01a.att/1' });
    await wait(4000);

    // Check pre-jump state
    const preJump = await evaluate(`(() => {
      const container = document.querySelector('main.content-area');
      const banners = document.querySelectorAll('.reader-trans-pending-banner').length;
      const loadingHappiness = document.querySelectorAll('.reader-chapter-trans-loading').length;
      return {
        hasContainer: Boolean(container),
        initialScrollTop: container?.scrollTop,
        banners,
        loadingHappiness
      };
    })()`);
    console.log('Pre-jump status:', preJump);

    // Open Go To Modal by clicking the Go button or via GoToModal direct open
    console.log('Opening Go To Modal...');
    const opened = await evaluate(`(() => {
      const goBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.title === 'Go to Paragraph or Page Number' || b.textContent.trim() === 'Go'
      );
      if (goBtn) {
        goBtn.click();
        return true;
      }
      return false;
    })()`);
    console.log('Clicked Go button:', opened);
    await wait(600);

    // Switch to Page tab, select 'M' edition, type '222', and submit
    console.log('Submitting Go To Myanmar Page 222...');
    const submitted = await evaluate(`(() => {
      const pageTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Page');
      if (pageTab) pageTab.click();

      // Find edition select/buttons
      const mBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'M' || b.textContent.includes('Myanmar'));
      if (mBtn) mBtn.click();

      // Input 222
      const pageInput = document.querySelector('input[placeholder*="page" i]') || document.querySelector('input[type="text"]') || document.querySelector('input');
      if (!pageInput) return { success: false, reason: 'no input' };

      // Set native value
      const proto = Object.getPrototypeOf(pageInput);
      const setVal = Object.getOwnPropertyDescriptor(proto, 'value')?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setVal) {
        setVal.call(pageInput, '222');
      } else {
        pageInput.value = '222';
      }
      pageInput.dispatchEvent(new Event('input', { bubbles: true }));
      pageInput.dispatchEvent(new Event('change', { bubbles: true }));

      // Find submit button (Go or icon)
      const submitBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent.trim() === 'Go' ||
        b.querySelector('svg.lucide-corner-down-left') ||
        b.type === 'submit'
      );
      if (submitBtn) {
        submitBtn.click();
        return { success: true, method: 'submitBtn' };
      }

      // Or dispatch enter on input
      pageInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return { success: true, method: 'enter' };
    })()`);
    console.log('Submitted GoTo:', submitted);

    // Monitor scroll settling over 8 seconds
    console.log('Monitoring landing and stability...');
    for (let t = 1; t <= 6; t++) {
      await wait(1000);
      const state = await evaluate(`(() => {
        const container = document.querySelector('main.content-area');
        const m2222 = document.getElementById('M2.0222') || document.querySelector('[data-ed="M"][data-page="2.0222"]');
        const m1222 = document.getElementById('M1.0222') || document.querySelector('[data-ed="M"][data-page="1.0222"]');
        const anchor = m2222 || m1222;

        const targetEl = anchor?.closest('.sent-pair') || (anchor?.getClientRects().length > 0 ? anchor : anchor?.closest('.reader-para-row, p') || anchor?.parentElement);
        const containerRect = container?.getBoundingClientRect();
        const targetRect = targetEl?.getBoundingClientRect();

        const relTop = (targetRect && containerRect) ? Math.round(targetRect.top - containerRect.top) : null;
        const banners = document.querySelectorAll('.reader-trans-pending-banner').length;
        const loadingHappiness = document.querySelectorAll('.reader-chapter-trans-loading').length;
        const hasPulse = Boolean(document.querySelector('.pulse-highlight'));

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

    const finalAudit = await evaluate(`(() => {
      const container = document.querySelector('main.content-area');
      const m2222 = document.getElementById('M2.0222') || document.querySelector('[data-ed="M"][data-page="2.0222"]');
      const anchor = m2222;
      const targetEl = anchor?.closest('.sent-pair') || (anchor?.getClientRects().length > 0 ? anchor : anchor?.closest('.reader-para-row, p') || anchor?.parentElement);
      const containerRect = container?.getBoundingClientRect();
      const targetRect = targetEl?.getBoundingClientRect();
      const relTop = (targetRect && containerRect) ? Math.round(targetRect.top - containerRect.top) : null;
      const banners = document.querySelectorAll('.reader-trans-pending-banner').length;
      const loadingHappiness = document.querySelectorAll('.reader-chapter-trans-loading').length;

      return {
        passedOffset: relTop !== null && Math.abs(relTop - 60) <= 24,
        relTop,
        banners,
        loadingHappiness,
        pulseHighlight: targetEl?.classList.contains('pulse-highlight')
      };
    })()`);

    console.log('Final Audit:', finalAudit);
    ws.close();
    return finalAudit;
  } finally {
    chrome.kill();
  }
}

async function main() {
  // Test 1: Sentence mode with English + Vietnamese
  const sentenceResult = await testMode('Sentence Mode (EN + VI)', {
    themeSettings: {
      translationGranularity: 'sentence',
      paliEnabled: true,
      activeLangs: ['en', 'vi'],
      pulseAnimation: true
    },
    layersOrder: [
      { type: 'pali', id: 'layer-pali', enabled: true },
      { type: 'trans', lang: 'en', id: 'trans-en', enabled: true },
      { type: 'trans', lang: 'vi', id: 'trans-vi', enabled: true }
    ]
  });

  // Test 2: Paragraph mode with English + Vietnamese
  const paraResult = await testMode('Paragraph Mode (EN + VI)', {
    themeSettings: {
      translationGranularity: 'paragraph',
      paliEnabled: true,
      activeLangs: ['en', 'vi'],
      pulseAnimation: true
    },
    layersOrder: [
      { type: 'pali', id: 'layer-pali', enabled: true },
      { type: 'trans', lang: 'en', id: 'trans-en', enabled: true },
      { type: 'trans', lang: 'vi', id: 'trans-vi', enabled: true }
    ]
  });

  // Test 3: Pāḷi-only mode
  const paliResult = await testMode('Pāḷi-only Mode', {
    themeSettings: {
      translationGranularity: 'sentence',
      paliEnabled: true,
      activeLangs: [],
      pulseAnimation: true
    },
    layersOrder: [
      { type: 'pali', id: 'layer-pali', enabled: true },
      { type: 'trans', lang: 'en', id: 'trans-en', enabled: false },
      { type: 'trans', lang: 'vi', id: 'trans-vi', enabled: false }
    ]
  });

  console.log('\n========================================');
  console.log('SUMMARY OF ALL MODES:');
  console.log('Sentence mode:', sentenceResult);
  console.log('Paragraph mode:', paraResult);
  console.log('Pali-only mode:', paliResult);
  console.log('========================================');
}

main().catch(console.error);
