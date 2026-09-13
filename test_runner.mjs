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

    // Create a new tab target
    const newTabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book/vin01a.att/1', { method: 'PUT' });
    const tabData = await newTabRes.json();
    console.log('Created tab:', tabData);
    const wsUrl = tabData.webSocketDebuggerUrl;

    const ws = new WebSocket(wsUrl);
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

    console.log('Waiting for initial page load...');
    await wait(4000);

    const initialInfo = await evaluate(`(() => {
      return {
        title: document.title,
        url: window.location.href,
        mainArea: Boolean(document.querySelector('main.content-area')),
        chapters: Array.from(document.querySelectorAll('[data-chapter]')).map(c => c.getAttribute('data-chapter')),
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.title || b.textContent.trim()).filter(Boolean).slice(0, 10)
      };
    })()`);
    console.log('Initial page info:', JSON.stringify(initialInfo, null, 2));

    ws.close();
  } finally {
    chrome.kill();
  }
}

run().catch(console.error);
