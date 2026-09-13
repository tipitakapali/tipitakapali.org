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
        console.log('[BROWSER CONSOLE]', msg.params.type, msg.params.args.map(a => a.value || JSON.stringify(a)).join(' '));
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

    // Instrument console.log and error in the page
    await evaluate(`(() => {
      window.__logs = [];
      const origLog = console.log;
      const origWarn = console.warn;
      const origError = console.error;
      console.log = (...args) => { window.__logs.push({ level: 'log', args }); origLog(...args); };
      console.warn = (...args) => { window.__logs.push({ level: 'warn', args }); origWarn(...args); };
      console.error = (...args) => { window.__logs.push({ level: 'error', args }); origError(...args); };
    })()`);

    // Click Go button in footer
    console.log('Clicking footer Go button...');
    await evaluate(`(() => {
      const goBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.title === 'Go to Paragraph or Page Number' || b.textContent.trim() === 'Go'
      );
      if (goBtn) goBtn.click();
    })()`);
    await wait(800);

    // Inspect open modal
    const modalInfo = await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      if (!modal) return { modalFound: false };
      const buttons = Array.from(modal.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(),
        title: b.title,
        classes: b.className
      }));
      const inputs = Array.from(modal.querySelectorAll('input')).map(i => ({
        placeholder: i.placeholder,
        value: i.value,
        type: i.type
      }));
      return {
        modalFound: true,
        buttons,
        inputs
      };
    })()`);
    console.log('Modal inspection:', JSON.stringify(modalInfo, null, 2));

    // Now click Page tab in modal
    await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      const pageBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.trim() === 'Page');
      if (pageBtn) pageBtn.click();
    })()`);
    await wait(500);

    // Inspect inputs and edition buttons after switching to Page tab
    const pageTabInfo = await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      const buttons = Array.from(modal.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(),
        title: b.title
      }));
      const inputs = Array.from(modal.querySelectorAll('input')).map(i => ({
        placeholder: i.placeholder,
        value: i.value,
        type: i.type
      }));
      const errorEl = modal.querySelector('.text-rose-500, .text-red-500, [role="alert"]');
      return {
        buttons,
        inputs,
        errorMessage: errorEl?.textContent
      };
    })()`);
    console.log('Page tab inspection:', JSON.stringify(pageTabInfo, null, 2));

    // Type 222 in input and submit
    console.log('Filling input and submitting...');
    const submitResult = await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      const input = modal.querySelector('input');
      if (!input) return { error: 'no input' };

      // Set value via prototype setter for React 18/19 controlled input
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, '222');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      // Find form or submit button
      const form = modal.querySelector('form');
      const submitBtn = Array.from(modal.querySelectorAll('button')).find(b => b.type === 'submit' || b.textContent.includes('Go') || b.querySelector('svg.lucide-corner-down-left'));

      if (submitBtn) {
        submitBtn.click();
        return { submitted: true, via: 'submitBtn', val: input.value };
      } else if (form) {
        form.requestSubmit();
        return { submitted: true, via: 'formSubmit', val: input.value };
      }
      return { submitted: false };
    })()`);
    console.log('Submit result:', submitResult);

    await wait(1000);

    // Check if modal closed or has error
    const afterSubmit = await evaluate(`(() => {
      const modal = document.querySelector('.fixed.inset-0') || document.querySelector('[role="dialog"]');
      const errorEl = modal?.querySelector('.text-rose-500, .text-red-500, [role="alert"]');
      return {
        modalStillOpen: Boolean(modal),
        errorMessage: errorEl?.textContent,
        logs: window.__logs
      };
    })()`);
    console.log('After submit status:', JSON.stringify(afterSubmit, null, 2));

    ws.close();
  } finally {
    chrome.kill();
  }
}

run().catch(console.error);
