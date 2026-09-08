'use client';

// Web-first Text-to-Speech helpers (browser SpeechSynthesis).
// Reads translation layers from the rendered reader DOM so speech follows
// exactly the visible layer stack order. No server audio, no native bridge v1.

export const TTS_LANG_ID_TO_CODE = {
  english: 'en',
  vietnamese: 'vi',
  myanmar: 'my',
  my_nissaya: 'my_nissaya',
  sinhala: 'si',
  chinese: 'zh',
  khmer: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  german: 'de',
  japanese: 'ja',
  portuguese: 'pt',
  russian: 'ru',
};

export const TTS_LANG_ID_TO_BCP47 = {
  english: 'en-US',
  vietnamese: 'vi-VN',
  myanmar: 'my-MM',
  my_nissaya: 'my-MM',
  sinhala: 'si-LK',
  chinese: 'zh-CN',
  khmer: 'km-KH',
  thai: 'th-TH',
  lao: 'lo-LA',
  tamil: 'ta-IN',
  hindi: 'hi-IN',
  german: 'de-DE',
  japanese: 'ja-JP',
  portuguese: 'pt-PT',
  russian: 'ru-RU',
};

export const TTS_LANG_LABEL = {
  english: 'English',
  vietnamese: 'Tiếng Việt',
  myanmar: 'မြန်မာ',
  my_nissaya: 'နိဿယ',
  sinhala: 'සිංහල',
  chinese: '中文',
  khmer: 'ខ្មែរ',
  thai: 'ไทย',
  lao: 'ລາວ',
  tamil: 'தமிழ்',
  hindi: 'हिन्दी',
  german: 'Deutsch',
  japanese: '日本語',
  portuguese: 'Português',
  russian: 'Русский',
};

export const TTS_LANG_FLAG = {
  english: '🇬🇧',
  vietnamese: '🇻🇳',
  myanmar: '🇲🇲',
  my_nissaya: '🇲🇲',
  sinhala: '🇱🇰',
  chinese: '🇨🇳',
  khmer: '🇰🇭',
  thai: '🇹🇭',
  lao: '🇱🇦',
  tamil: '🇮🇳',
  hindi: '🇮🇳',
  german: '🇩🇪',
  japanese: '🇯🇵',
  portuguese: '🇵🇹',
  russian: '🇷🇺',
};

export function isTtsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function isAndroidChrome() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android/i.test(ua) && /Chrome|CriOS/i.test(ua);
}

// Chrome on Android returns [] from getVoices() until voiceschanged fires.
// Wait for real voices (with timeout) before starting, otherwise utterances
// with no usable voice end instantly and the queue skips silently para by para.
export function ensureTtsVoices(timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!isTtsSupported()) return resolve([]);
    const first = getTtsVoices();
    if (first.length > 0) return resolve(first);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(getTtsVoices());
    };
    try {
      const prev = window.speechSynthesis.onvoiceschanged;
      window.speechSynthesis.onvoiceschanged = () => {
        try {
          if (typeof prev === 'function') prev();
        } catch {}
        finish();
      };
    } catch {}
    setTimeout(finish, timeoutMs);
  });
}

// Enabled non-Pali translation lang ids in display order.
export function getEnabledTtsLangIds(settings) {
  if (!settings?.translations) return [];
  const order = Array.isArray(settings.translationOrder) ? settings.translationOrder : [];
  const ids = [];
  for (const id of order) {
    if (id === 'pali') continue;
    if (settings.translations[id] && TTS_LANG_ID_TO_CODE[id] && !ids.includes(id)) {
      ids.push(id);
    }
  }
  // Include enabled ids missing from the order list (same fallback as ReaderView).
  for (const [id, enabled] of Object.entries(settings.translations)) {
    if (id !== 'pali' && enabled && TTS_LANG_ID_TO_CODE[id] && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

// Viewport-top paragraph (same threshold as the MAT button in Footer.jsx).
export function detectViewportTopPara() {
  if (typeof document === 'undefined') return null;
  const container =
    document.querySelector('main.content-area') ||
    document.querySelector('.content-area') ||
    document.querySelector('main');
  if (!container) return null;
  const containerRect = container.getBoundingClientRect();
  const targetY = containerRect.top + 100;
  const paras = container.querySelectorAll('.reader-para-row[data-para]');
  let currentVisible = null;
  for (const p of paras) {
    const r = p.getBoundingClientRect();
    if (r.top <= targetY && r.bottom > containerRect.top) {
      currentVisible = p.getAttribute('data-para');
    }
  }
  if (!currentVisible) {
    for (const p of paras) {
      const r = p.getBoundingClientRect();
      if (r.bottom >= containerRect.top) {
        currentVisible = p.getAttribute('data-para');
        break;
      }
    }
  }
  return currentVisible;
}

function cleanSpokenText(raw) {
  if (!raw) return '';
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^\s*\d+\s*[.।၊။]\s*/, '')
    .trim();
}

// Split long paragraphs into ~200-char sentence chunks (iOS Safari safety).
export function chunkTextForTts(text, maxLen = 200) {
  const clean = cleanSpokenText(text);
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];
  const sentences = clean.match(/[^.!?…。។၊।\n]+[.!?…。។၊।\n]+|[^.!?…。။၊।\n]+$/g) || [clean];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    const part = s.trim();
    if (!part) continue;
    if ((current + ' ' + part).trim().length <= maxLen) {
      current = (current + ' ' + part).trim();
    } else {
      if (current) chunks.push(current);
      if (part.length <= maxLen) {
        current = part;
      } else {
        // Hard-split very long runs without sentence boundaries.
        for (let i = 0; i < part.length; i += maxLen) {
          chunks.push(part.slice(i, i + maxLen).trim());
        }
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

// Build speak items from the live DOM in document order, starting at startPara.
// One item per (paragraph × selected language), in visible stack order.
export function buildTtsQueueFromDom(selectedLangIds, startPara = null) {
  if (typeof document === 'undefined' || !Array.isArray(selectedLangIds) || selectedLangIds.length === 0) {
    return [];
  }
  const container =
    document.querySelector('main.content-area') ||
    document.querySelector('.content-area') ||
    document.querySelector('main');
  if (!container) return [];
  const rows = Array.from(container.querySelectorAll('.reader-para-row[data-para]'));
  if (rows.length === 0) return [];

  let startIdx = 0;
  if (startPara) {
    const clean = String(startPara).replace(/^(?:para-?|p)/i, '').trim();
    const found = rows.findIndex((r) => (r.getAttribute('data-para') || '').trim() === clean);
    if (found >= 0) startIdx = found;
  }

  const items = [];
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    const para = (row.getAttribute('data-para') || '').trim();
    const pindex = row.getAttribute('data-pindex') || '';
    if (!para) continue;
    // DOM order of .reader-trans-block matches the visible stack order.
    const blocks = Array.from(row.querySelectorAll('.reader-trans-block[data-trans-lang]'));
    const byCode = new Map();
    for (const b of blocks) {
      const code = (b.getAttribute('data-trans-lang') || '').trim().toLowerCase();
      if (code && !byCode.has(code)) byCode.set(code, b);
    }
    for (const langId of selectedLangIds) {
      const code = TTS_LANG_ID_TO_CODE[langId];
      if (!code) continue;
      const block = byCode.get(code);
      if (!block) continue;
      const content = block.querySelector('.reader-trans-content');
      const raw = cleanSpokenText((content || block).textContent || '');
      if (!raw) continue;
      const chunks = chunkTextForTts(raw);
      chunks.forEach((text, ci) => {
        items.push({
          para,
          pindex,
          langId,
          langCode: code,
          text,
          chunkIndex: ci,
          chunkTotal: chunks.length,
          paraStart: ci === 0,
        });
      });
    }
  }
  return items;
}

export function getTtsVoices() {
  if (!isTtsSupported()) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch {
    return [];
  }
}

// Voice scoring: Google voices first (male preferred), then premium/Siri/
// neural quality, exact-locale match, enhanced, remote. Eloquence/novelty/
// whisper/bubbles fallbacks are filtered out when alternatives exist.
function scoreTtsVoice(v, bcp47, prefix) {
  let s = 0;
  const id = `${v.voiceURI || ''} ${v.name || ''}`.toLowerCase();
  const isMale = /male/.test(id) && !/female/.test(id);
  if (id.includes('google')) s += 5;
  if (isMale) s += 4;
  if (/premium|siri|neural|natural/.test(id)) s += 3;
  else if (v.quality === 'premium') s += 3;
  if (v.quality === 'enhanced' || /enhanced/.test(id)) s += 2;
  if (v.localService === false) s += 1;
  if ((v.lang || '').toLowerCase() === bcp47) s += 2;
  else if (prefix && (v.lang || '').toLowerCase().startsWith(prefix + '-')) s += 1;
  return s;
}

function isJunkTtsVoice(v) {
  const id = `${v.voiceURI || ''} ${v.name || ''}`.toLowerCase();
  return id.includes('eloquence') || id.includes('novelty') || id.includes('whisper') || id.includes('bubbles');
}

// Best voice for a TTS language: lang-prefix match, Google male first.
export function pickVoiceForLang(voices, langId) {
  if (!Array.isArray(voices) || voices.length === 0) return null;
  const bcp47 = (TTS_LANG_ID_TO_BCP47[langId] || '').toLowerCase();
  const prefix = bcp47.split('-')[0] || '';
  const matching = voices.filter((v) => {
    const vl = (v.lang || '').toLowerCase();
    return vl === bcp47 || (prefix && (vl === prefix || vl.startsWith(prefix + '-')));
  });
  const pool = matching.length > 0 ? matching : voices;
  const usable = pool.filter((v) => !isJunkTtsVoice(v));
  const list = usable.length > 0 ? usable : pool;
  return list.slice().sort((a, b) => scoreTtsVoice(b, bcp47, prefix) - scoreTtsVoice(a, bcp47, prefix))[0] || null;
}

export function voicesForLang(voices, langId) {
  if (!Array.isArray(voices)) return [];
  const bcp47 = (TTS_LANG_ID_TO_BCP47[langId] || '').toLowerCase();
  const prefix = bcp47.split('-')[0] || '';
  return voices
    .filter((v) => {
      const vl = (v.lang || '').toLowerCase();
      return vl === bcp47 || (prefix && (vl === prefix || vl.startsWith(prefix + '-')));
    })
    .slice()
    .sort((a, b) => scoreTtsVoice(b, bcp47, prefix) - scoreTtsVoice(a, bcp47, prefix));
}
