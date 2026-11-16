import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transform } = require('sucrase');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ROOT = path.resolve(import.meta.dirname, '..');

function loadBanner({ offlineApp = false, settings = { translations: { pali: true, english: true } }, initialDismissed = false } = {}) {
  const fullPath = path.join(ROOT, 'components/AiTranslationNoticeBanner.jsx');
  const raw = fs.readFileSync(fullPath, 'utf8');
  const replacedEnv = raw.replace(
    /process\.env\.NEXT_PUBLIC_OFFLINE_APP\s*!==\s*'true'/g,
    offlineApp ? 'false' : 'true'
  );
  const { code } = transform(replacedEnv, {
    transforms: ['jsx', 'imports'],
    filePath: fullPath,
  });

  const reactStub = Object.assign({}, React, {
    __esModule: true,
    default: React,
    useEffect: () => {},
    useState: () => [initialDismissed, () => {}],
  });

  const mod = { exports: {} };
  const localRequire = (spec) => {
    if (spec === 'react') return reactStub;
    if (spec === 'lucide-react') {
      return {
        AlertTriangle: () => React.createElement('span', null, '!'),
        X: () => React.createElement('span', null, 'x'),
      };
    }
    if (spec === '../context/ThemeSettingsContext') {
      return {
        useThemeSettings: () => ({ settings, isMounted: true }),
      };
    }
    return require(spec);
  };

  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', code);
  fn(mod.exports, localRequire, mod, fullPath, path.dirname(fullPath));
  return mod.exports.default;
}

test('ThemeSettingsContext enables English translation by default and RootLayout mounts notice', () => {
  const ctxSrc = fs.readFileSync(path.join(ROOT, 'context/ThemeSettingsContext.jsx'), 'utf8');
  assert.match(ctxSrc, /translations:\s*\{[\s\S]*?pali:\s*true,[\s\S]*?english:\s*true,/);

  const layoutSrc = fs.readFileSync(path.join(ROOT, 'app/layout.js'), 'utf8');
  assert.match(layoutSrc, /AiTranslationNoticeBanner/);
});

test('AiTranslationNoticeBanner renders cookie-style warning on web when a translation is enabled', () => {
  const Banner = loadBanner({
    offlineApp: false,
    settings: { translations: { pali: true, english: true } },
    initialDismissed: false,
  });
  const html = renderToStaticMarkup(React.createElement(Banner));
  assert.match(html, /role="region"/);
  assert.match(html, /aria-label="AI translation notice"/);
  assert.match(html, /AI Translation Notice:/);
  assert.match(html, />Got it</);
});

test('AiTranslationNoticeBanner hides when dismissed, when no translation is enabled, or in offline app', () => {
  const DismissedBanner = loadBanner({
    offlineApp: false,
    settings: { translations: { pali: true, english: true } },
    initialDismissed: true,
  });
  assert.equal(renderToStaticMarkup(React.createElement(DismissedBanner)), '');

  const PaliOnlyBanner = loadBanner({
    offlineApp: false,
    settings: { translations: { pali: true, english: false } },
    initialDismissed: false,
  });
  assert.equal(renderToStaticMarkup(React.createElement(PaliOnlyBanner)), '');

  const OfflineBanner = loadBanner({
    offlineApp: true,
    settings: { translations: { pali: true, english: true } },
    initialDismissed: false,
  });
  assert.equal(renderToStaticMarkup(React.createElement(OfflineBanner)), '');
});
