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

async function main() {
  console.log('=== Automated Comprehensive CDP Test for Tasks 1, 2, 3, and 4 ===\n');

  console.log('1. Launching headless Chromium on port 9222...');
  const chrome = spawn(
    '/snap/bin/chromium',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--user-data-dir=/tmp/test-chrome-tasks-clean-four',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let ready = false;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    try {
      const res = await fetch('http://127.0.0.1:9222/json/version');
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }

  if (!ready) {
    throw new Error('Chromium failed to become ready on port 9222');
  }

  console.log('2. Opening /book/s0101m.mul/0 in Chromium...');
  const tabRes = await fetch('http://127.0.0.1:9222/json/new?http://localhost:3000/book/s0101m.mul/0', { method: 'PUT' });
  const tab = await tabRes.json();

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve));

  await sendCdp(ws, 'Runtime.enable');
  await sendCdp(ws, 'Page.enable');

  console.log('3. Waiting for reader to load initial state...');
  await sleep(4000);

  let allPassed = true;
  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
    } else {
      console.error(`  ✗ FAIL: ${message}`);
      allPassed = false;
    }
  }

  try {
    // ----------------------------------------------------
    // TEST SUITE 1: Task 1 - AI Notice Modal Always Shows, No Checkbox
    // ----------------------------------------------------
    console.log('\n--- SUITE 1: Task 1 - AI Notice Modal Always Shows & Checkbox Removed ---');

    // Reset settings to fresh state
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { pali: true, english: false, vietnamese: false };
        existing.translationOrder = ['pali', 'english', 'vietnamese'];
        existing.translationColors = {};
        localStorage.setItem(key, JSON.stringify(existing));
        localStorage.removeItem('tipitaka_ai_trans_disclaimer_accepted');
        location.reload();
      })()`
    );
    await sleep(4000);

    // 1.1 Open Language Menu
    console.log('Opening Language Menu...');
    const openedMenu = await evaluate(
      ws,
      `(() => {
        const globeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Script') || b.querySelector('svg.lucide-globe') || b.querySelector('svg.lucide-languages'));
        if (globeBtn) {
          globeBtn.click();
          return true;
        }
        return false;
      })()`
    );
    await sleep(600);
    assert(openedMenu, 'Language Menu opened');

    // 1.2 Enable English translation
    console.log('Clicking to enable English translation...');
    const clickedEnglish = await evaluate(
      ws,
      `(() => {
        const labels = Array.from(document.querySelectorAll('label'));
        const enLabel = labels.find(l => l.textContent?.includes('English'));
        if (enLabel) {
          const input = enLabel.querySelector('input[type="checkbox"]');
          if (input) {
            input.click();
            return true;
          }
        }
        return false;
      })()`
    );
    await sleep(600);
    assert(clickedEnglish, 'Clicked English translation checkbox');

    // 1.3 Verify AI Notice modal opened, and "Do not show this notice again" checkbox is REMOVED
    const modalCheck1 = await evaluate(
      ws,
      `(() => {
        const modal = Array.from(document.querySelectorAll('div')).find(d => d.textContent?.includes('AI-Assisted Translation Notice'));
        if (!modal) return { open: false };
        const checkboxLabel = Array.from(modal.querySelectorAll('label, span')).find(el => el.textContent?.includes('Do not show this notice again'));
        const understandBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent?.includes('I Understand & Enable'));
        return {
          open: true,
          hasDoNotShowCheckbox: Boolean(checkboxLabel),
          hasUnderstandBtn: Boolean(understandBtn),
        };
      })()`
    );
    assert(modalCheck1.open, 'AI Notice modal opened upon enabling English');
    assert(!modalCheck1.hasDoNotShowCheckbox, '"Do not show this notice again" checkbox is REMOVED from modal');
    assert(modalCheck1.hasUnderstandBtn, '"I Understand & Enable" button is present');

    // 1.4 Click "I Understand & Enable"
    console.log('Clicking "I Understand & Enable"...');
    await evaluate(
      ws,
      `(() => {
        const modal = Array.from(document.querySelectorAll('div')).find(d => d.textContent?.includes('AI-Assisted Translation Notice'));
        const understandBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent?.includes('I Understand & Enable'));
        if (understandBtn) understandBtn.click();
      })()`
    );
    await sleep(600);

    // 1.5 Now enable Vietnamese translation -> AI Notice Modal MUST appear AGAIN!
    console.log('Clicking to enable Vietnamese translation...');
    const clickedVietnamese = await evaluate(
      ws,
      `(() => {
        const labels = Array.from(document.querySelectorAll('label'));
        const viLabel = labels.find(l => l.textContent?.includes('Tiếng Việt') || l.textContent?.includes('Vietnamese'));
        if (viLabel) {
          const input = viLabel.querySelector('input[type="checkbox"]');
          if (input) {
            input.click();
            return true;
          }
        }
        return false;
      })()`
    );
    await sleep(600);
    assert(clickedVietnamese, 'Clicked Vietnamese translation checkbox');

    const modalCheck2 = await evaluate(
      ws,
      `(() => {
        const modal = Array.from(document.querySelectorAll('div')).find(d => d.textContent?.includes('AI-Assisted Translation Notice'));
        if (!modal) return { open: false };
        const checkboxLabel = Array.from(modal.querySelectorAll('label, span')).find(el => el.textContent?.includes('Do not show this notice again'));
        return {
          open: true,
          hasDoNotShowCheckbox: Boolean(checkboxLabel),
        };
      })()`
    );
    assert(modalCheck2.open, 'AI Notice modal ALWAYS appears when enabling another translation (Task 1 satisfied)');
    assert(!modalCheck2.hasDoNotShowCheckbox, 'Checkbox remains absent on subsequent prompts');

    // Click "I Understand & Enable" for Vietnamese
    await evaluate(
      ws,
      `(() => {
        const modal = Array.from(document.querySelectorAll('div')).find(d => d.textContent?.includes('AI-Assisted Translation Notice'));
        const understandBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent?.includes('I Understand & Enable'));
        if (understandBtn) understandBtn.click();
      })()`
    );
    await sleep(1000);

    // Close Language Menu
    await evaluate(
      ws,
      `(() => {
        const closeBtn = document.querySelector('button[title*="Close (Esc)"], button[aria-label*="Close language modal"]');
        if (closeBtn) closeBtn.click();
      })()`
    );
    await sleep(500);

    // ----------------------------------------------------
    // TEST SUITE 2: Task 2 - Pali Custom Colors in Top Position
    // ----------------------------------------------------
    console.log('\n--- SUITE 2: Task 2 - Pali in Top Position Custom Colors ---');

    console.log('Setting translationOrder=["pali", "english"], with custom colors for Pali...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translationOrder = ['pali', 'english'];
        existing.translations = { pali: true, english: true };
        existing.translationDisplayMode = 'stack';
        existing.translationColors = {
          pali: {
            bg: '#fef3c7', // soft amber
            text: '#1e3a8a', // navy blue
            border: '#dc2626', // crimson red
          }
        };
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );
    await sleep(4000);

    const paliColorsTopMetrics = await evaluate(
      ws,
      `(() => {
        const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
        if (!row) return { error: 'Row 5 not found' };
        const paliTopBlock = row.querySelector('.reader-pali-top-block, .reader-pali-trans-block, [data-trans-lang="pali"]');
        if (!paliTopBlock) return { error: 'Pali top block not found', rowHtml: row.innerHTML.slice(0, 300) };
        const pEl = paliTopBlock.querySelector('p, p.bodytext') || paliTopBlock;
        const blockStyle = window.getComputedStyle(paliTopBlock);
        const pStyle = window.getComputedStyle(pEl);
        return {
          foundBlock: true,
          borderLeftColor: blockStyle.borderLeftColor,
          borderLeftWidth: blockStyle.borderLeftWidth,
          backgroundColor: blockStyle.backgroundColor,
          textColor: pStyle.color,
        };
      })()`
    );
    console.log('Pali custom colors when in top position:', paliColorsTopMetrics);
    assert(paliColorsTopMetrics.foundBlock, 'Pali top block is rendered');
    assert(
      paliColorsTopMetrics.borderLeftColor === 'rgb(220, 38, 38)',
      `Pali borderLeftColor in top position is #dc2626 / rgb(220, 38, 38) (got ${paliColorsTopMetrics.borderLeftColor})`
    );
    assert(
      parseFloat(paliColorsTopMetrics.borderLeftWidth) > 0,
      `Pali borderLeftWidth in top position is > 0 (got ${paliColorsTopMetrics.borderLeftWidth})`
    );
    assert(
      paliColorsTopMetrics.backgroundColor === 'rgb(254, 243, 199)',
      `Pali backgroundColor in top position is #fef3c7 / rgb(254, 243, 199) (got ${paliColorsTopMetrics.backgroundColor})`
    );
    assert(
      paliColorsTopMetrics.textColor === 'rgb(30, 58, 138)',
      `Pali text color in top position is #1e3a8a / rgb(30, 58, 138) (got ${paliColorsTopMetrics.textColor})`
    );

    // Test 2.2: When Pali is in top position and custom colors are REMOVED, no border-left is rendered
    console.log('Clearing custom colors for Pali in top position...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translationColors = {};
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );
    await sleep(4000);

    const paliDefaultTopMetrics = await evaluate(
      ws,
      `(() => {
        const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
        if (!row) return { error: 'Row 5 not found' };
        const pEl = row.querySelector('p.bodytext, p[data-pindex="5"]');
        const pStyle = pEl ? window.getComputedStyle(pEl) : null;
        const topBlock = row.querySelector('.reader-pali-top-block');
        return {
          hasTopBlock: Boolean(topBlock),
          borderLeftWidth: pStyle ? pStyle.borderLeftWidth : null,
        };
      })()`
    );
    console.log('Pali metrics when custom colors cleared:', paliDefaultTopMetrics);
    assert(!paliDefaultTopMetrics.hasTopBlock, 'Pali is not wrapped in styled custom block when colors cleared');
    assert(
      parseFloat(paliDefaultTopMetrics.borderLeftWidth || '0') === 0,
      'Pali has 0 border-left when in top position with default colors'
    );

    // Test 2.3: Pali in top position with ONLY text color
    console.log('Testing Pali in top position with ONLY text color (#059669)...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translationColors = { pali: { text: '#059669' } };
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );
    await sleep(4000);

    const paliTextOnlyMetrics = await evaluate(
      ws,
      `(() => {
        const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
        const block = row ? row.querySelector('.reader-pali-top-block') : null;
        const pEl = row ? row.querySelector('p.bodytext, p[data-pindex="5"]') : null;
        const pStyle = pEl ? window.getComputedStyle(pEl) : null;
        const blockStyle = block ? window.getComputedStyle(block) : null;
        return {
          foundBlock: Boolean(block),
          textColor: pStyle ? pStyle.color : null,
          borderLeftWidth: blockStyle ? blockStyle.borderLeftWidth : null,
        };
      })()`
    );
    console.log('Pali text-only metrics:', paliTextOnlyMetrics);
    assert(paliTextOnlyMetrics.foundBlock, 'Pali top block rendered when text color is customized');
    assert(paliTextOnlyMetrics.textColor === 'rgb(5, 150, 105)', `Pali text color is #059669 / rgb(5, 150, 105) (got ${paliTextOnlyMetrics.textColor})`);
    assert(parseFloat(paliTextOnlyMetrics.borderLeftWidth || '0') === 0, 'Pali border-left is 0 when no border is configured');

    // Test 2.4: Pali in top position with ONLY border color
    console.log('Testing Pali in top position with ONLY border color (#7c3aed)...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translationColors = { pali: { border: '#7c3aed' } };
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );
    await sleep(4000);

    const paliBorderOnlyMetrics = await evaluate(
      ws,
      `(() => {
        const row = document.querySelector('.reader-trans-stack-row[data-pindex="5"]');
        const block = row ? row.querySelector('.reader-pali-top-block') : null;
        const blockStyle = block ? window.getComputedStyle(block) : null;
        return {
          foundBlock: Boolean(block),
          borderLeftColor: blockStyle ? blockStyle.borderLeftColor : null,
          borderLeftWidth: blockStyle ? blockStyle.borderLeftWidth : null,
        };
      })()`
    );
    console.log('Pali border-only metrics:', paliBorderOnlyMetrics);
    assert(paliBorderOnlyMetrics.foundBlock, 'Pali top block rendered when border color is customized');
    assert(paliBorderOnlyMetrics.borderLeftColor === 'rgb(124, 58, 237)', `Pali border-left-color is #7c3aed / rgb(124, 58, 237) (got ${paliBorderOnlyMetrics.borderLeftColor})`);
    assert(parseFloat(paliBorderOnlyMetrics.borderLeftWidth || '0') > 0, 'Pali border-left-width is > 0 when border is configured');

    // ----------------------------------------------------
    // TEST SUITE 3: Task 3 - Vietnamese Font Selection & Diacritics
    // ----------------------------------------------------
    console.log('\n--- SUITE 3: Task 3 - Vietnamese Font Selection & Diacritics ---');

    console.log('Enabling Vietnamese translation layer...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const existing = JSON.parse(localStorage.getItem(key) || '{}');
        existing.translations = { pali: true, vietnamese: true };
        existing.translationOrder = ['pali', 'vietnamese'];
        localStorage.setItem(key, JSON.stringify(existing));
        location.reload();
      })()`
    );
    await sleep(4000);

    const viTypography = await evaluate(
      ws,
      `(() => {
        const viBlock = document.querySelector('.reader-trans-block[data-trans-lang="vi"], .reader-trans-block[data-trans-lang="vietnamese"]');
        if (!viBlock) return { error: 'Vietnamese translation block not found in reader' };
        const content = viBlock.querySelector('.reader-trans-content');
        const style = window.getComputedStyle(content || viBlock);
        return {
          fontFamily: style.fontFamily,
          lineHeight: style.lineHeight,
        };
      })()`
    );
    console.log('Vietnamese typography metrics:', viTypography);
    assert(
      viTypography.fontFamily?.includes('Be Vietnam Pro') || viTypography.fontFamily?.includes('Noto Serif'),
      `Vietnamese translation font includes 'Be Vietnam Pro' or 'Noto Serif' (got: ${viTypography.fontFamily})`
    );

    // ----------------------------------------------------
    // TEST SUITE 4: Task 4 - Language Menu Theme-Aware Random Color Choices
    // ----------------------------------------------------
    console.log('\n--- SUITE 4: Task 4 - Theme-Aware Random Color Choices in Language Menu ---');

    // Reopen Language Menu
    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Script') || b.querySelector('svg.lucide-globe') || b.querySelector('svg.lucide-languages'));
        if (btn) btn.click();
      })()`
    );
    await sleep(800);

    // 4.1 Verify Toggle on/off is REMOVED
    const toggleCheck = await evaluate(
      ws,
      `(() => {
        const spans = Array.from(document.querySelectorAll('span'));
        const toggleSpan = spans.find(s => s.textContent?.trim() === 'Toggle on/off');
        return Boolean(toggleSpan);
      })()`
    );
    assert(!toggleCheck, '"Toggle on/off" span is REMOVED from the Language menu');

    // 4.2 Verify random color buttons exist with descriptive titles
    const colorButtonsCheck = await evaluate(
      ws,
      `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const randomAllBtn = buttons.find(b => b.textContent?.includes('Random Colors'));
        const bgBtn = buttons.find(b => b.textContent?.trim() === 'BG');
        const textBtn = buttons.find(b => b.textContent?.trim() === 'Text');
        const borderBtn = buttons.find(b => b.textContent?.trim() === 'Border');
        const resetBtn = buttons.find(b => b.title?.includes('Reset colors for all') || b.getAttribute('aria-label')?.includes('Reset translation colors'));
        return {
          hasRandomAll: Boolean(randomAllBtn),
          randomAllTitle: randomAllBtn ? randomAllBtn.title : null,
          hasBg: Boolean(bgBtn),
          bgTitle: bgBtn ? bgBtn.title : null,
          hasText: Boolean(textBtn),
          textTitle: textBtn ? textBtn.title : null,
          hasBorder: Boolean(borderBtn),
          borderTitle: borderBtn ? borderBtn.title : null,
          hasReset: Boolean(resetBtn),
          resetTitle: resetBtn ? resetBtn.title : null,
        };
      })()`
    );
    assert(colorButtonsCheck.hasRandomAll, 'Has "Random Colors" button');
    assert(Boolean(colorButtonsCheck.randomAllTitle), `"Random Colors" button has descriptive hover tooltip: "${colorButtonsCheck.randomAllTitle}"`);
    assert(colorButtonsCheck.hasBg, 'Has "BG" button');
    assert(Boolean(colorButtonsCheck.bgTitle), `"BG" button has hover tooltip: "${colorButtonsCheck.bgTitle}"`);
    assert(colorButtonsCheck.hasText, 'Has "Text" button');
    assert(Boolean(colorButtonsCheck.textTitle), `"Text" button has hover tooltip: "${colorButtonsCheck.textTitle}"`);
    assert(colorButtonsCheck.hasBorder, 'Has "Border" button');
    assert(Boolean(colorButtonsCheck.borderTitle), `"Border" button has hover tooltip: "${colorButtonsCheck.borderTitle}"`);
    assert(colorButtonsCheck.hasReset, 'Has "Reset" button');
    assert(Boolean(colorButtonsCheck.resetTitle), `"Reset" button has hover tooltip: "${colorButtonsCheck.resetTitle}"`);

    // 4.3 Click "Random Colors" in light theme (classic)
    console.log('Testing "Random Colors" click in Classic/Light Theme...');
    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Random Colors'));
        if (btn) btn.click();
      })()`
    );
    await sleep(600);

    const lightColors = await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        return s.translationColors;
      })()`
    );
    console.log('Generated Light Theme translationColors:', lightColors);
    assert(Boolean(lightColors?.pali?.bg && lightColors?.pali?.text && lightColors?.pali?.border), 'Pali received bg, text, and border');
    assert(Boolean(lightColors?.vietnamese?.bg && lightColors?.vietnamese?.text && lightColors?.vietnamese?.border), 'Vietnamese received bg, text, and border');

    // 4.4 Test "BG" button only updates background
    const prevText = lightColors.pali.text;
    const prevBorder = lightColors.pali.border;
    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === 'BG');
        if (btn) btn.click();
      })()`
    );
    await sleep(400);
    const afterBgColors = await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        return s.translationColors;
      })()`
    );
    assert(afterBgColors.pali.text === prevText, '"BG" button preserved existing text color');
    assert(afterBgColors.pali.border === prevBorder, '"BG" button preserved existing border color');

    // 4.5 Test "Reset" button clears colors
    console.log('Testing "Reset" button in Language Menu...');
    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.title?.includes('Reset colors for all'));
        if (btn) btn.click();
      })()`
    );
    await sleep(400);
    const afterResetColors = await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        return s.translationColors;
      })()`
    );
    console.log('After Reset button click:', afterResetColors);
    assert(!afterResetColors?.pali && !afterResetColors?.vietnamese, 'All enabled language colors reset to default');

    // 4.6 Test Dark / OLED Theme awareness
    console.log('Setting theme="oled", reloading and testing "Random Colors"...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        s.theme = 'oled';
        localStorage.setItem(key, JSON.stringify(s));
        location.reload();
      })()`
    );
    await sleep(4000);

    // Open Language Menu again in OLED mode
    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Script') || b.querySelector('svg.lucide-globe') || b.querySelector('svg.lucide-languages'));
        if (btn) btn.click();
      })()`
    );
    await sleep(800);

    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Random Colors'));
        if (btn) btn.click();
      })()`
    );
    await sleep(400);

    const oledColors = await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        return s.translationColors;
      })()`
    );
    console.log('Generated OLED Theme translationColors:', oledColors);
    const paliBgHex = oledColors?.pali?.bg || '';
    assert(Boolean(paliBgHex), 'OLED colors generated');
    console.log(`OLED Pali Background: ${paliBgHex}, Text: ${oledColors?.pali?.text}`);

    // 4.7 Test Warm / Sepia Theme awareness
    console.log('Setting theme="sepia", reloading and testing "Random Colors"...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        s.theme = 'sepia';
        localStorage.setItem(key, JSON.stringify(s));
        location.reload();
      })()`
    );
    await sleep(4000);

    // Open Language Menu in Sepia mode
    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Script') || b.querySelector('svg.lucide-globe') || b.querySelector('svg.lucide-languages'));
        if (btn) btn.click();
      })()`
    );
    await sleep(800);

    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Random Colors'));
        if (btn) btn.click();
      })()`
    );
    await sleep(400);

    const sepiaColors = await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        return s.translationColors;
      })()`
    );
    console.log('Generated Sepia (Warm) Theme translationColors:', sepiaColors);
    assert(Boolean(sepiaColors?.pali?.bg && sepiaColors?.pali?.text), 'Sepia (Warm) theme generated colors');

    // 4.8 Test Dusk Theme awareness
    console.log('Setting theme="dusk", reloading and testing "Random Colors"...');
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        s.theme = 'dusk';
        localStorage.setItem(key, JSON.stringify(s));
        location.reload();
      })()`
    );
    await sleep(4000);

    // Open Language Menu in Dusk mode
    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Script') || b.querySelector('svg.lucide-globe') || b.querySelector('svg.lucide-languages'));
        if (btn) btn.click();
      })()`
    );
    await sleep(800);

    await evaluate(
      ws,
      `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Random Colors'));
        if (btn) btn.click();
      })()`
    );
    await sleep(400);

    const duskColors = await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        return s.translationColors;
      })()`
    );
    console.log('Generated Dusk Theme translationColors:', duskColors);
    assert(Boolean(duskColors?.pali?.bg && duskColors?.pali?.text), 'Dusk theme generated colors');

    // Cleanup settings
    await evaluate(
      ws,
      `(() => {
        const key = 'tipitaka_advanced_settings_v4';
        const s = JSON.parse(localStorage.getItem(key) || '{}');
        s.theme = 'classic';
        s.translationColors = {};
        s.translations = { pali: true, english: false, vietnamese: false };
        s.translationOrder = ['pali', 'english', 'vietnamese'];
        localStorage.setItem(key, JSON.stringify(s));
      })()`
    );
    await sleep(500);

    console.log('\n========================================================');
    if (allPassed) {
      console.log('🎉 ALL 4 TASKS PASSED COMPREHENSIVE AUTOMATED VERIFICATION!');
    } else {
      console.error('❌ SOME CHECKS FAILED!');
    }
    console.log('========================================================\n');
  } finally {
    ws.close();
    chrome.kill('SIGTERM');
  }

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
