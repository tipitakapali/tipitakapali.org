/**
 * test_seo_comprehensive.mjs
 * ==========================
 * Automated Headless Chromium E2E verification of Multilingual Translation SEO,
 * hreflang alternates, Schema.org JSON-LD structured data, pre-rendered <noscript>
 * fallbacks, and XML sitemaps.
 */

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendCdp(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 100000);
  const msg = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error(`CDP method ${method} timed out after 15s`));
    }, 15000);

    const handler = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id === id) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      } catch (e) {}
    };
    ws.addEventListener('message', handler);
    ws.send(msg);
  });
}

async function evaluate(ws, expression) {
  const res = await sendCdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (res?.exceptionDetails) {
    console.error('CDP Evaluate Exception:', res.exceptionDetails);
    throw new Error(JSON.stringify(res.exceptionDetails));
  }
  return res?.result?.value;
}

async function run() {
  console.log('=== MULTILINGUAL TRANSLATION SEO COMPREHENSIVE VERIFICATION ===\n');

  // Step 1: Verify XML Sitemaps and robots.txt
  console.log('1. Verifying XML Sitemaps & robots.txt...');
  const sitemapTransPath = path.join(process.cwd(), 'public', 'sitemap-translations.xml');
  const sitemapIndexPath = path.join(process.cwd(), 'public', 'sitemap.xml');
  const robotsPath = path.join(process.cwd(), 'public', 'robots.txt');

  if (!fs.existsSync(sitemapTransPath)) {
    throw new Error('public/sitemap-translations.xml not found!');
  }
  const sitemapTransContent = fs.readFileSync(sitemapTransPath, 'utf8');
  const urlCount = (sitemapTransContent.match(/<url>/g) || []).length;
  console.log(`✓ sitemap-translations.xml found with ${urlCount} translation URLs (expected 3,255).`);
  if (urlCount !== 3255) {
    throw new Error(`Expected 3,255 URLs in sitemap-translations.xml, found ${urlCount}`);
  }

  const sitemapIndexContent = fs.readFileSync(sitemapIndexPath, 'utf8');
  if (!sitemapIndexContent.includes('sitemap-translations.xml')) {
    throw new Error('sitemap.xml index does not reference sitemap-translations.xml!');
  }
  console.log('✓ sitemap.xml index contains sitemap-translations.xml reference.');

  const robotsContent = fs.readFileSync(robotsPath, 'utf8');
  if (!robotsContent.includes('Sitemap: https://tipitakapali.org/sitemap-translations.xml')) {
    throw new Error('robots.txt does not declare sitemap-translations.xml!');
  }
  console.log('✓ robots.txt correctly declares sitemap-translations.xml.');

  // Step 2: Verify llms.txt & llms-full.txt
  console.log('\n2. Verifying llms.txt & llms-full.txt...');
  const llmsContent = fs.readFileSync(path.join(process.cwd(), 'public', 'llms.txt'), 'utf8');
  if (!llmsContent.includes('Supported 15 Modern Translation Languages') || !llmsContent.includes('?l=vi')) {
    throw new Error('llms.txt does not document 15 translation languages or ?l= parameter!');
  }
  console.log('✓ llms.txt successfully documents 15 translation languages and ?l= syntax.');

  const llmsFullContent = fs.readFileSync(path.join(process.cwd(), 'public', 'llms-full.txt'), 'utf8');
  if (!llmsFullContent.includes('Multilingual Translation Deep-Linking Guide') || !llmsFullContent.includes('?l=de')) {
    throw new Error('llms-full.txt does not document translation deep-linking table!');
  }
  console.log('✓ llms-full.txt contains translation deep-linking guide and reference table.');

  // Step 3: Launch Chromium
  try {
    execSync('pkill -f /snap/chromium || true; rm -f /home/administrator/tipitaka-xml-vri/chromium-data/Singleton*');
  } catch (e) {}

  console.log('\n3. Launching headless Chromium on port 9223...');
  const chrome = spawn('bash', [
    '-c',
    'ulimit -n 65536 && exec /snap/bin/chromium --headless=new --remote-debugging-port=9223 --no-sandbox --disable-gpu --user-data-dir=/home/administrator/tipitaka-xml-vri/chromium-data http://127.0.0.1:3000/'
  ], { stdio: 'ignore' });

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9223/json/version');
      if (res.ok) break;
    } catch (e) {}
    await sleep(500);
  }

  const tabListRes = await fetch('http://127.0.0.1:9223/json/list');
  const tabs = await tabListRes.json();
  const pageTab = tabs.find(t => t.type === 'page');
  const ws = new WebSocket(pageTab.webSocketDebuggerUrl);

  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  await sendCdp(ws, 'Page.enable');
  await sendCdp(ws, 'Runtime.enable');
  await sleep(2500);

  // Step 4: Check Homepage (/) SEO & JSON-LD
  console.log('\n4. Checking Homepage (/) SEO & JSON-LD...');
  const homeSeo = await evaluate(ws, `(() => {
    const desc = document.querySelector('meta[name="description"]')?.content || '';
    const kw = document.querySelector('meta[name="keywords"]')?.content || '';
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
    const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => {
      try { return JSON.parse(s.textContent); } catch (e) { return null; }
    }).filter(Boolean);
    return {
      title: document.title,
      description: desc,
      keywords: kw,
      ogDescription: ogDesc,
      jsonLdCount: jsonLdScripts.length,
      websiteLd: jsonLdScripts.find(j => j['@type'] === 'WebSite' || j?.['@graph']?.some(g => g['@type'] === 'WebSite')),
    };
  })()`);

  console.log('Homepage SEO check:', {
    title: homeSeo.title,
    descSnippet: homeSeo.description.slice(0, 70) + '...',
    hasTranslationsInDesc: homeSeo.description.includes('15 modern translations'),
    hasTranslationKw: homeSeo.keywords.includes('Tipitaka translations'),
  });

  if (!homeSeo.description.includes('15 modern translations')) {
    throw new Error('Homepage meta description does not mention 15 modern translations!');
  }
  if (!homeSeo.keywords.includes('Tipitaka translations')) {
    throw new Error('Homepage keywords do not include translation keywords!');
  }
  console.log('✓ Homepage SEO metadata verified.');

  // Step 5: Test Book Page (/book/s0101m.mul)
  console.log('\n5. Navigating to Book page: http://127.0.0.1:3000/book/s0101m.mul...');
  await sendCdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:3000/book/s0101m.mul' });
  await sleep(3500);

  const bookSeo = await evaluate(ws, `(() => {
    const desc = document.querySelector('meta[name="description"]')?.content || '';
    const kw = document.querySelector('meta[name="keywords"]')?.content || '';
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
    
    // Check hreflang alternates
    const alternates = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(l => ({
      hreflang: l.getAttribute('hreflang'),
      href: l.getAttribute('href'),
    }));

    // Check JSON-LD
    const jsonLdScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => {
      try { return JSON.parse(s.textContent); } catch (e) { return null; }
    }).filter(Boolean);

    const bookSchema = jsonLdScripts.find(j => j['@type'] === 'Book');
    const breadcrumbSchema = jsonLdScripts.find(j => j['@type'] === 'BreadcrumbList');

    // Check noscript crawler fallback
    const noscript = document.querySelector('noscript');
    const noscriptHtml = noscript ? noscript.innerHTML : '';
    const hasNoscriptChapters = noscriptHtml.includes('/book/s0101m.mul/1');
    const hasNoscriptTranslations = noscriptHtml.includes('/book/s0101m.mul?l=en') && noscriptHtml.includes('/book/s0101m.mul?l=vi');

    return {
      title: document.title,
      description: desc,
      keywords: kw,
      canonical,
      hreflangCount: alternates.length,
      sampleHreflangs: alternates.slice(0, 6),
      hasBookSchema: Boolean(bookSchema),
      bookSchemaTranslations: bookSchema?.workTranslation?.length || 0,
      bookSchemaLangs: bookSchema?.inLanguage || [],
      hasBreadcrumb: Boolean(breadcrumbSchema),
      breadcrumbItems: breadcrumbSchema?.itemListElement?.map(i => i.name) || [],
      hasNoscript: Boolean(noscript),
      hasNoscriptChapters,
      hasNoscriptTranslations,
    };
  })()`);

  console.log('Book SEO check:', {
    title: bookSeo.title,
    descSnippet: bookSeo.description.slice(0, 80) + '...',
    canonical: bookSeo.canonical,
    hreflangCount: bookSeo.hreflangCount,
    hasBookSchema: bookSeo.hasBookSchema,
    bookSchemaTranslations: bookSeo.bookSchemaTranslations,
    hasBreadcrumb: bookSeo.hasBreadcrumb,
    breadcrumbItems: bookSeo.breadcrumbItems,
    hasNoscriptChapters: bookSeo.hasNoscriptChapters,
    hasNoscriptTranslations: bookSeo.hasNoscriptTranslations,
  });

  if (!bookSeo.description.includes('translations in English, Vietnamese, Burmese')) {
    throw new Error('Book meta description does not mention available translations!');
  }
  if (!bookSeo.keywords.includes('Sīlakkhandhavaggapāḷi translation')) {
    throw new Error('Book keywords do not include translation keywords!');
  }
  if (bookSeo.hreflangCount < 15) {
    throw new Error(`Expected at least 15 hreflang tags, found ${bookSeo.hreflangCount}`);
  }
  if (!bookSeo.hasBookSchema || bookSeo.bookSchemaTranslations < 15) {
    throw new Error('Schema.org Book structured data is missing or incomplete!');
  }
  if (!bookSeo.hasBreadcrumb || bookSeo.breadcrumbItems.length < 3) {
    throw new Error('Schema.org BreadcrumbList structured data is missing!');
  }
  if (!bookSeo.hasNoscriptChapters || !bookSeo.hasNoscriptTranslations) {
    throw new Error('Pre-rendered <noscript> crawler content does not contain chapter or translation links!');
  }
  console.log('✓ Book SEO metadata, hreflang, JSON-LD, and <noscript> crawl links verified.');

  // Step 6: Test Deep-Link with Translation (?l=vi)
  console.log('\n6. Testing deep-link navigation with Vietnamese translation (?l=vi)...');
  await sendCdp(ws, 'Page.navigate', { url: 'http://127.0.0.1:3000/book/s0101m.mul?l=vi' });
  await sleep(4000);

  const transCheck = await evaluate(ws, `(() => {
    const url = window.location.href;
    const viLayers = Array.from(document.querySelectorAll('.reader-trans-col, .reader-translation-container, [data-lang="vi"]'));
    return {
      url,
      hasViParam: url.includes('l=vi'),
      renderedLayersCount: viLayers.length,
    };
  })()`);

  console.log('Translation deep-link check:', transCheck);
  if (!transCheck.hasViParam) {
    throw new Error('URL does not preserve ?l=vi!');
  }
  console.log('✓ Translation deep-link (?l=vi) verified.');

  try {
    ws.close();
    chrome.kill('SIGTERM');
  } catch (e) {}

  console.log('\n=== ALL SEO CHECKS PASSED SUCCESSFULLY! ===\n');
}

run().catch((err) => {
  console.error('\n✗ TEST FAILED:', err.message);
  process.exit(1);
});
