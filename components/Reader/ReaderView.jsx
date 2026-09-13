'use client';

import React, { useRef, useEffect, useLayoutEffect, useCallback, memo } from 'react';
import { Bookmark, BookmarkCheck, History } from 'lucide-react';
import WelcomeView from './WelcomeView';
import MeditationLoader from './MeditationLoader';
import BookTocView from './BookTocView';
import AiChatView from '../AiChat/AiChatView';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { useDictionary } from '../../context/DictionaryContext';

import { transliterateHtml, convertPaliScript, highlightHtmlText, highlightTranslationText, capitalizePali, convertAnyToRoman, cleanDictionaryQuery } from '../../services/transliterate';
import { smartScrollTo } from '../../services/scroll';
import { fetchChapterTranslations, fetchPaliSentences } from '../../services/api';

const TRANSLATION_METAS = {
  en: { label: 'English', flag: '🇬🇧' },
  vi: { label: 'Tiếng Việt', flag: '🇻🇳' },
  my: { label: 'မြန်မာ', flag: '🇲🇲' },
  si: { label: 'සිංහල', flag: '🇱🇰' },
  zh: { label: '中文', flag: '🇨🇳' },
  km: { label: 'ភាសាខ្មែរ', flag: '🇰🇭' },
  th: { label: 'ไทย', flag: '🇹🇭' },
  lo: { label: 'ລາວ', flag: '🇱🇦' },
  ta: { label: 'தமிழ்', flag: '🇮🇳' },
  hi: { label: 'हिन्दी', flag: '🇮🇳' },
  de: { label: 'Deutsch', flag: '🇩🇪' },
  ja: { label: '日本語', flag: '🇯🇵' },
  ko: { label: '한국어', flag: '🇰🇷' },
  pt: { label: 'Português', flag: '🇵🇹' },
  ru: { label: 'Русский', flag: '🇷🇺' },
  my_nissaya: { label: 'မြန်မာနိဿယ', flag: '🇲🇲' },
};

export const LANG_KEY_TO_CODE = {
  english: 'en',
  vietnamese: 'vi',
  myanmar: 'my',
  sinhala: 'si',
  chinese: 'zh',
  khmer: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  portuguese: 'pt',
  russian: 'ru',
  my_nissaya: 'my_nissaya',
};

export const CODE_TO_LANG_KEY = {
  en: 'english',
  vi: 'vietnamese',
  my: 'myanmar',
  my_nissaya: 'my_nissaya',
  si: 'sinhala',
  zh: 'chinese',
  km: 'khmer',
  th: 'thai',
  lo: 'lao',
  ta: 'tamil',
  hi: 'hindi',
  de: 'german',
  ja: 'japanese',
  ko: 'korean',
  pt: 'portuguese',
  ru: 'russian',
};

export function normalizeLangCode(langOrDb) {
  if (!langOrDb) return null;
  const str = String(langOrDb).trim().toLowerCase();
  if (str === 'pali' || str === 'fts_tipitaka.db') return 'pali';
  const clean = str.replace(/^fts_translation_|\.db$/g, '');
  if (LANG_KEY_TO_CODE[clean]) return LANG_KEY_TO_CODE[clean];
  return clean;
}

export function isSearchPali(searchHighlight) {
  if (!searchHighlight) return true;
  if (searchHighlight.isPali) return true;
  if (searchHighlight.lang === 'pali') return true;
  if (searchHighlight.db === 'fts_tipitaka.db' || searchHighlight.db === 'pali') return true;
  if (!searchHighlight.lang && !searchHighlight.db) return true;
  return false;
}

export function getSearchHighlightLang(searchHighlight) {
  if (!searchHighlight) return null;
  if (isSearchPali(searchHighlight)) return 'pali';
  if (searchHighlight.lang) return normalizeLangCode(searchHighlight.lang);
  if (searchHighlight.db) return normalizeLangCode(searchHighlight.db);
  return 'pali';
}

export function formatCssColor(val, fallback = '') {
  if (!val) return fallback;
  const trimmed = val.trim();
  if (!trimmed) return fallback;
  if (/^[0-9a-fA-F]{3}$/.test(trimmed) || /^[0-9a-fA-F]{6}$/.test(trimmed) || /^[0-9a-fA-F]{8}$/.test(trimmed)) {
    return `#${trimmed}`;
  }
  return trimmed;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineTags(str) {
  if (!str) return '';
  // First escape unsafe HTML
  let safe = escapeHtml(str);

  // Allow standard safe formatting tags used in Pali translations
  safe = safe
    .replace(/&lt;i&gt;/gi, '<i>')
    .replace(/&lt;\/i&gt;/gi, '</i>')
    .replace(/&lt;b&gt;/gi, '<b>')
    .replace(/&lt;\/b&gt;/gi, '</b>')
    .replace(/&lt;em&gt;/gi, '<em>')
    .replace(/&lt;\/em&gt;/gi, '</em>')
    .replace(/&lt;strong&gt;/gi, '<strong>')
    .replace(/&lt;\/strong&gt;/gi, '</strong>');

  // Convert markdown **bold** and *italic*
  safe = safe.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  safe = safe.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');

  return safe;
}

function formatTranslationContent(text, lang) {
  if (!text) return '';

  // For Myanmar Nissaya (or nissaya content), format word pairs if delimited by " | "
  if (lang === 'my_nissaya' && text.includes(' | ') && text.includes(': ')) {
    const pairs = text.split(' | ');
    const partsHtml = pairs
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return '';
        const colonIdx = trimmed.indexOf(': ');
        if (colonIdx > 0) {
          const pali = trimmed.substring(0, colonIdx).trim();
          const meaning = trimmed.substring(colonIdx + 2).trim();
          return `<span class="reader-nissaya-pair"><strong class="reader-nissaya-pali">${escapeHtml(pali)}</strong><span class="reader-nissaya-sep">:</span> <span class="reader-nissaya-meaning">${formatInlineTags(meaning)}</span></span>`;
        }
        return `<span class="reader-nissaya-meaning">${formatInlineTags(trimmed)}</span>`;
      })
      .filter(Boolean)
      .join('<span class="reader-nissaya-divider"> | </span>');

    return partsHtml;
  }

  return formatInlineTags(text);
}

// Pāḷi sentence lines for sentence display mode. Replaces the inside of
// prose <p data-para data-pindex> elements with numbered sentence spans
// from the precomputed pali_sentences map (epitaka.db segmentation, shared
// line numbers with translation line_ids), keeping the leading
// paragraph-number element and preserving all page break (<span class="pb">)
// elements so that edition pagination, page jumps, and indicators work.
function injectPaliSentencesIntoHtml(html, paliSentMap) {
  if (!html || !paliSentMap) return html;
  // NOTE: keyed by data-pindex (para_index), NOT data-para — some paragraphs
  // (e.g. s0201m.mul ch0 p7) carry no data-para attribute at all.
  return html.replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/gi, (full, open, inner, close) => {
    const pidxMatch = open.match(/\bdata-pindex="(\d+)"/i);
    if (!pidxMatch) return full;
    const cls = (open.match(/\bclass="([^"]*)"/i) || [])[1] || '';
    if (!/\b(bodytext|indent|hangnum|unindented)\b/i.test(cls)) return full;
    const sents = paliSentMap[pidxMatch[1]] || paliSentMap[Number(pidxMatch[1])];
    if (!Array.isArray(sents) || sents.length <= 1) return full;
    let prefix = '';
    const numMatch = inner.match(
      /^(\s*<strong\b[^>]*\bparanum\b[^>]*>[\s\S]*?<\/strong>\s*(?:<span\b[^>]*\bdot\b[^>]*>[\s\S]*?<\/span>)?\s*\.?\s*)/i
    );
    if (numMatch) prefix = numMatch[1];

    // Extract page breaks clustered by adjacency so they are preserved
    const pbRegex = /<span\b[^>]*\bclass="pb"[^>]*>[\s\S]*?<\/span>/gi;
    const pbClusters = [];
    let pbm;
    while ((pbm = pbRegex.exec(inner))) {
      const lastCluster = pbClusters[pbClusters.length - 1];
      if (lastCluster && inner.slice(lastCluster.endIndex, pbm.index).trim() === '') {
        lastCluster.html += ' ' + pbm[0];
        lastCluster.endIndex = pbm.index + pbm[0].length;
        lastCluster.items.push(pbm[0]);
      } else {
        pbClusters.push({
          startIndex: pbm.index,
          endIndex: pbm.index + pbm[0].length,
          html: pbm[0],
          items: [pbm[0]],
        });
      }
    }

    // Map each sentence (from 1 to N) to its approximate character offset in inner
    const sentOffsets = [0];
    let searchFrom = 0;
    for (let i = 1; i < sents.length; i++) {
      const s = sents[i];
      const raw = s && typeof s === 'object' ? s.text : s;
      const sText = String(raw || '').replace(/^\d+\s*\.\s*/, '').trim();
      const words = sText.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);
      if (words.length === 0) {
        sentOffsets.push(searchFrom);
        continue;
      }
      let foundIdx = -1;
      let pos = searchFrom;
      while (pos < inner.length) {
        const next = inner.indexOf(words[0], pos);
        if (next === -1) break;
        const lastOpen = inner.lastIndexOf('<', next);
        const lastClose = inner.lastIndexOf('>', next);
        if (lastOpen <= lastClose) {
          foundIdx = next;
          break;
        }
        pos = next + 1;
      }
      if (foundIdx !== -1) {
        sentOffsets.push(foundIdx);
        searchFrom = foundIdx;
      } else {
        sentOffsets.push(searchFrom);
      }
    }

    // Assign each pb cluster to a sentence index
    const sentPbs = Array.from({ length: sents.length }, () => []);
    for (const cluster of pbClusters) {
      let sentIdx = sentOffsets.length - 1;
      for (let s = 0; s < sentOffsets.length - 1; s++) {
        if (cluster.startIndex < sentOffsets[s + 1]) {
          sentIdx = s;
          break;
        }
      }
      sentPbs[sentIdx].push(cluster);
    }

    const numbered = sents
      .map((s, idx) => {
        const line = s && typeof s === 'object' ? s.line : null;
        const raw = s && typeof s === 'object' ? s.text : s;
        // Epitaka text keeps the paragraph number ("1. Evaṃ ...") but the
        // reader already renders it from the original markup — strip it here
        // to avoid a duplicated "1 1. ..." lead.
        let t = formatInlineTags(String(raw || '').trim().replace(/^\d+\s*\.\s*/, ''));
        if (!t) return '';

        // Inject preserved page breaks into this sentence
        const curClusters = sentPbs[idx];
        if (curClusters && curClusters.length > 0) {
          let pbPrefix = '';
          for (const cluster of curClusters) {
            const beforeText = inner
              .slice(Math.max(0, cluster.startIndex - 40), cluster.startIndex)
              .replace(/<[^>]+>/g, '')
              .trim();
            const lastWordMatch = beforeText.match(/([^\s]+)$/);
            const lastWord = lastWordMatch ? lastWordMatch[1].replace(/[.,;:!?–—"'\(\)\[\]]/g, '') : '';
            let inserted = false;
            if (lastWord && lastWord.length >= 2) {
              const wordIdx = t.indexOf(lastWord);
              if (wordIdx !== -1) {
                const insertPos = wordIdx + lastWord.length;
                t = t.slice(0, insertPos) + ' ' + cluster.html + t.slice(insertPos);
                inserted = true;
              }
            }
            if (!inserted) {
              pbPrefix += (pbPrefix ? ' ' : '') + cluster.html;
            }
          }
          if (pbPrefix) {
            t = pbPrefix + ' ' + t;
          }
        }

        const lid = line ?? '';
        return `<span class="pali-sent" data-line="${lid}"><span class="pali-sent-num">${lid}</span><span class="pali-sent-text">${t}</span></span>`;
      })
      .filter(Boolean);
    if (numbered.length === 0) return full;
    return `${open}${prefix}${numbered.join('')}${close}`;
  });
}

// Extract top-level <span class="...">...</span> items with balanced-tag
// scanning (machine-generated sentence spans may contain nested inline
// spans, so a flat regex is unsafe). Returns [{line, html}] in order.
function extractClassSpans(html, cls) {
  const out = [];
  if (!html) return out;
  const openRe = new RegExp(`<span\\b[^>]*\\bclass="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'gi');
  let m;
  while ((m = openRe.exec(html))) {
    const lineM = m[0].match(/data-line="([^"]*)"/i);
    const line = lineM ? lineM[1] : '';
    let depth = 1;
    let i = openRe.lastIndex;
    while (i < html.length && depth > 0) {
      const lt = html.indexOf('<', i);
      if (lt === -1) break;
      const rest = html.slice(lt, lt + 7).toLowerCase();
      if (rest.startsWith('</span')) {
        depth--;
        if (depth === 0) {
          out.push({ line, html: html.slice(openRe.lastIndex, lt) });
          i = lt + 7;
          break;
        }
        i = lt + 7;
      } else if (rest.startsWith('<span') && (html[lt + 5] === ' ' || html[lt + 5] === '>')) {
        const gt = html.indexOf('>', lt);
        if (gt !== -1 && html[gt - 1] === '/') {
          i = gt + 1; // self-closing: no depth change
        } else {
          depth++;
          i = lt + 5;
        }
      } else {
        const gt = html.indexOf('>', lt);
        i = gt === -1 ? html.length : gt + 1;
      }
    }
    openRe.lastIndex = i;
  }
  return out;
}

// Strip the muted line-number badge from a sentence cell (the pair row
// shows one shared gutter number instead).
function stripSentNumBadge(html) {
  return String(html || '').replace(/<span class="(?:pali|trans)-sent-num"[^>]*>.*?<\/span>/, '');
}

function injectTranslationsIntoHtml(
  html,
  translations,
  orderedLayers = [],
  isPaliEnabled = true,
  displayMode = 'stack',
  translationColors = {},
  searchHighlight = null,
  sentenceMode = false,
  transSentences = null
) {
  if (!html) return html;

  const hasTranslations = orderedLayers.some((l) => l.type === 'trans');
  const paliColors = translationColors?.pali || {};
  const hasCustomPaliColors = Boolean(
    formatCssColor(paliColors.border) ||
    formatCssColor(paliColors.bg) ||
    formatCssColor(paliColors.text)
  );
  if (isPaliEnabled && !hasTranslations && !hasCustomPaliColors) {
    return html;
  }

  const isSide = displayMode === 'side' || displayMode === 'side_rev';
  const isSwapped = displayMode === 'side_rev';
  const isSideActive = isSide && ((isPaliEnabled && hasTranslations) || (!isPaliEnabled && orderedLayers.filter((l) => l.type === 'trans').length >= 2));

  return html.replace(/(<p\b[^>]*\bdata-pindex="(\d+)"[^>]*>[\s\S]*?<\/p>)/gi, (fullMatch, pTag, pIndex) => {
    const paraMatch = pTag.match(/\bdata-para="([^"]+)"/i);
    const paraFirstMatch = pTag.match(/\bdata-para-first="([^"]+)"/i);
    const paraLastMatch = pTag.match(/\bdata-para-last="([^"]+)"/i);
    const idMatch = pTag.match(/\bid="([^"]+)"/i);
    const classMatch = pTag.match(/\bclass="([^"]+)"/i);
    const paranumMatch = pTag.match(/<strong\b[^>]*\bclass="[^"]*paranum[^"]*"[^>]*>([\s\S]*?)<\/strong>\.?\s*/i);

    // Determine if this paragraph is targeted by searchHighlight
    let isTargetPara = false;
    if (searchHighlight?.query && String(searchHighlight.query).trim()) {
      const hasParaTarget =
        (searchHighlight.paraIndex !== undefined && searchHighlight.paraIndex !== null && searchHighlight.paraIndex !== '') ||
        (searchHighlight.paraNum !== undefined && searchHighlight.paraNum !== null && searchHighlight.paraNum !== '');

      if (hasParaTarget) {
        const cleanTargetPara = searchHighlight.paraNum
          ? String(searchHighlight.paraNum).replace(/^(?:para-?|p)/i, '').trim()
          : null;
        const targetPIndexStr =
          searchHighlight.paraIndex !== null && searchHighlight.paraIndex !== undefined
            ? String(searchHighlight.paraIndex).trim()
            : null;

        if (targetPIndexStr && String(pIndex).trim() === targetPIndexStr) {
          isTargetPara = true;
        }
        if (!isTargetPara && cleanTargetPara) {
          const pNum = paraMatch ? paraMatch[1] : null;
          if (pNum && pNum === cleanTargetPara) {
            isTargetPara = true;
          } else {
            const targetInt = parseInt(cleanTargetPara, 10);
            if (!isNaN(targetInt) && paraFirstMatch && paraLastMatch) {
              const first = parseInt(paraFirstMatch[1], 10);
              const last = parseInt(paraLastMatch[1], 10);
              if (targetInt >= first && targetInt <= last) {
                isTargetPara = true;
              }
            }
          }
        }
      } else {
        // Global search highlight without specific paragraph target
        isTargetPara = true;
      }
    }

    const pClasses = (classMatch ? classMatch[1] : '').split(/\s+/);
    const headingClass = pClasses.find((c) =>
      /^(nikaya|book|title|subhead|subsubhead|chapter|centre|centered)$/i.test(c)
    );
    const isHeading = Boolean(headingClass);
    const paraType = pClasses.find((c) =>
      /^(bodytext|indent|hangnum|unindented|gatha1|gatha2|gatha3|gathalast|centre|centered)$/i.test(c)
    ) || (isHeading ? '' : 'bodytext');

    const rowAttrs = [
      `data-pindex="${pIndex}"`,
      paraMatch ? `data-para="${paraMatch[1]}"` : '',
      paraFirstMatch ? `data-para-first="${paraFirstMatch[1]}"` : '',
      paraLastMatch ? `data-para-last="${paraLastMatch[1]}"` : '',
      !isPaliEnabled && idMatch ? `id="${idMatch[1]}"` : '',
    ].filter(Boolean).join(' ');

    const renderedItems = [];
    let transCount = 0;
    for (const layer of orderedLayers) {
      if (layer.type === 'pali') {
        if (isPaliEnabled) {
          const isPaliInTopPosition = renderedItems.length === 0 && orderedLayers[0]?.type === 'pali';
          const isPaliTop = isPaliInTopPosition;
          const currentPaliColors = translationColors?.pali || {};
          const paliBorder = formatCssColor(currentPaliColors.border);
          const paliBg = formatCssColor(currentPaliColors.bg);
          const paliText = formatCssColor(currentPaliColors.text);
          const hasCustomPali = Boolean(paliBorder || paliBg || paliText);

          if (isPaliTop) {
            if (hasCustomPali) {
              const paliBlockStyles = [
                paliBorder ? `border-left: 1.5px solid ${paliBorder}` : 'border-left: none',
                paliBg ? `background-color: ${paliBg}` : '',
                paliText ? `color: ${paliText}` : '',
                (paliBorder || paliBg) ? 'padding: 0.5rem 0.85rem; border-radius: 8px; margin-bottom: 0.5rem;' : '',
              ].filter(Boolean).join('; ');

              const topBlockClasses = [
                'reader-trans-block',
                'reader-pali-trans-block',
                'reader-pali-top-block',
                paliBorder ? 'has-custom-border' : '',
                paliBg ? 'has-custom-bg' : '',
              ].filter(Boolean).join(' ');

              renderedItems.push({
                type: 'pali',
                lang: 'pali',
                html: `
      <div class="${topBlockClasses}" data-trans-lang="pali"${paliBlockStyles ? ` style="${paliBlockStyles}"` : ''}>
        ${pTag}
      </div>`,
              });
            } else {
              renderedItems.push({
                type: 'pali',
                lang: 'pali',
                html: pTag,
              });
            }
          } else {
            // Task 2: If Pali text is not in position top, add border-left to it as other translation languages
            // Task 3: Dynamically apply custom colors (background, text color, border-left color)
            const borderValue = paliBorder || 'color-mix(in srgb, var(--accent, #8b2500) 30%, transparent)';
            const paliBlockStyles = [
              `border-left: 1.5px solid ${borderValue}`,
              paliBg ? `background-color: ${paliBg}` : '',
              paliText ? `color: ${paliText}` : '',
            ].filter(Boolean).join('; ');

            renderedItems.push({
              type: 'pali',
              lang: 'pali',
              html: `
      <div class="reader-trans-block reader-pali-trans-block" data-trans-lang="pali"${paliBlockStyles ? ` style="${paliBlockStyles}"` : ''}>
        ${pTag}
      </div>`,
            });
          }
        }
      } else if (layer.type === 'trans') {
        const trans = translations[layer.lang]?.[pIndex];
        // Sentence mode may carry splits without the full paragraph text
        // (sentence files only) — splits alone are enough to render.
        const sentArr =
          sentenceMode && transSentences ? transSentences[layer.lang]?.[pIndex] : null;
        const hasSentArr = Array.isArray(sentArr) && sentArr.length > 0;
        if ((trans && trans.trim()) || hasSentArr) {
          transCount++;
          // Task 2: Highlight translation text ONLY if search was specifically in this translation database/language
          const searchLang = getSearchHighlightLang(searchHighlight);
          const doTransHL = Boolean(
            isTargetPara && searchHighlight?.query && searchLang &&
            (searchLang === layer.lang || searchLang === layer.id)
          );
          const highlightTrans = (t) =>
            doTransHL ? highlightTranslationText(t, searchHighlight.query, layer.lang) : t;

          // Sentence display mode: per-sentence items from sentences_json.
          // Kept structured for paired 1-vs-1 rows; classic blocks join them.
          // Single-sentence paras render unchanged (identical to paragraph mode).
          let sentItems = null;
          if (hasSentArr) {
            const built = [];
            for (const s of sentArr) {
              const t = formatTranslationContent(String(s?.translation || '').trim(), layer.lang);
              if (!t) continue;
              built.push({ line: String(s?.line_id ?? ''), html: highlightTrans(t) });
            }
            if (built.length > 0) sentItems = built;
          }

          let content;
          if (sentItems && sentItems.length > 1) {
            content = sentItems
              .map((it) => `<span class="trans-sent" data-line="${it.line}"><span class="trans-sent-num">${it.line}</span><span class="trans-sent-text">${it.html}</span></span>`)
              .join('');
          } else if (sentItems && sentItems.length === 1) {
            content = sentItems[0].html;
          } else {
            content = highlightTrans(formatTranslationContent((trans || '').trim(), layer.lang));
          }

          // If Pali is disabled and this is a numbered paragraph, display standard paragraph number anchor
          if (!isPaliEnabled && !isHeading && transCount === 1 && paraMatch) {
            content = content.replace(/^\s*[\p{Nd}]+[\.၊။\s]+/u, '');
            const pNumDisplay = paranumMatch ? paranumMatch[1] : paraMatch[1];
            content = `<strong class="paranum" id="para-${paraMatch[1]}">${pNumDisplay}</strong>. ` + content;
          }

          // Task 2: Typographic and formatting classes from the original Pali <p> inherited by translation content
          const inheritedClasses = pClasses.filter((c) =>
            /^(nikaya|book|title|subhead|subsubhead|chapter|centre|centered|bodytext|indent|hangnum|unindented|gatha1|gatha2|gatha3|gathalast)$/i.test(c)
          );
          if (inheritedClasses.length === 0 && paraType) {
            inheritedClasses.push(paraType);
          }

          // Heading type classes (nikaya/book/chapter/title/subhead/subsubhead) carry em
          // font-sizes: keep them on the content div only. If the wrapper block also has
          // e.g. .book, .reader-container .book scales the wrapper (1.85em) AND
          // .reader-container .reader-trans-content.book scales the content again
          // (1.85em x 1.85em ~= 75px vs Pali ~= 41px). Centering still holds via
          // .reader-trans-heading-block. Non-heading classes (gatha/bodytext/...) stay,
          // as block-level rules (e.g. gatha margin) depend on them and set no font-size.
          const blockClasses = [
            'reader-trans-block',
            isHeading ? 'reader-trans-heading-block' : '',
            ...inheritedClasses.filter(
              (c) => !/^(nikaya|book|title|subhead|subsubhead|chapter)$/i.test(c)
            ),
          ].filter(Boolean).join(' ');

          const contentClasses = [
            'reader-trans-content',
            ...inheritedClasses,
          ].filter(Boolean).join(' ');

          // Task 3: Dynamically apply custom colors for translation language
          const customColors = translationColors?.[layer.id] || translationColors?.[layer.lang] || {};
          const transBorder = formatCssColor(customColors.border);
          const transBg = formatCssColor(customColors.bg);
          const transText = formatCssColor(customColors.text);
          const blockStyles = [
            transBorder ? `border-left-color: ${transBorder}` : '',
            transBg ? `background-color: ${transBg}` : '',
            transText ? `color: ${transText}` : '',
          ].filter(Boolean).join('; ');

          const contentStyles = [
            transText ? `color: ${transText}` : '',
          ].filter(Boolean).join('; ');

          renderedItems.push({
            type: 'trans',
            lang: layer.lang,
            id: layer.id,
            sentItems,
            blockStyles,
            contentStyles,
            html: `
      <div class="${blockClasses}" data-trans-lang="${layer.lang}"${blockStyles ? ` style="${blockStyles}"` : ''}>
        <div class="${contentClasses}"${contentStyles ? ` style="${contentStyles}"` : ''}>${content}</div>
      </div>`,
          });
        }
      }
    }

    if (renderedItems.length === 0) {
      if (!isPaliEnabled) {
        // Keep section headings/titles/colophons so chapter hierarchy remains visible
        if (isHeading) return pTag;
        return `<div class="reader-para-row reader-trans-empty" ${rowAttrs}></div>`;
      }
      return fullMatch;
    }

    // Heading row styling when Pāḷi is disabled
    if (!isPaliEnabled && isHeading) {
      const headingItemsHtml = renderedItems.map((item) => item.html).join('');
      return `<div class="reader-para-row reader-trans-heading-row ${headingClass}" ${rowAttrs}>${headingItemsHtml}</div>`;
    }

    if (isSideActive && renderedItems.length >= 2) {
      // Swapped mode (Translation - Pali): translations left, Pāḷi right.
      const paliIdx = renderedItems.findIndex((item) => item.type === 'pali');
      if (isSwapped && paliIdx !== -1) {
        const paliItem = renderedItems[paliIdx];
        const leftHtml = renderedItems
          .filter((_, i) => i !== paliIdx)
          .map((item) => item.html)
          .join('');
        return `<div class="reader-para-row reader-trans-side-row" ${rowAttrs}><div class="reader-side-col reader-side-col-left reader-trans-col"><div class="reader-translation-container reader-side-container" data-pindex="${pIndex}">${leftHtml}</div></div><div class="reader-side-col reader-side-col-right reader-pali-col">${paliItem.html}</div></div>`;
      }
      const col1 = renderedItems[0];
      const col2Items = renderedItems.slice(1);
      const col1Html = col1.html;
      const col2Html = col2Items.map((item) => item.html).join('');
      const col1Class = col1.type === 'pali' ? 'reader-pali-col' : 'reader-trans-col';
      const col2Class = col2Items.some((item) => item.type === 'pali') ? 'reader-pali-col' : 'reader-trans-col';
      const col2Wrapped = col2Class === 'reader-trans-col'
        ? `<div class="reader-translation-container reader-side-container" data-pindex="${pIndex}">${col2Html}</div>`
        : col2Html;
      return `<div class="reader-para-row reader-trans-side-row" ${rowAttrs}><div class="reader-side-col reader-side-col-left ${col1Class}">${col1Html}</div><div class="reader-side-col reader-side-col-right ${col2Class}">${col2Wrapped}</div></div>`;
    }

    if (isSideActive && renderedItems.length === 1 && !isHeading) {
      const isBodyPara = /\b(bodytext|hangnum|indent|gatha\w*)\b/i.test(pTag);
      if (isBodyPara) {
        const singleItem = renderedItems[0];
        // Swapped mode: translation layers go left, Pāḷi goes right.
        const isCol1 = isSwapped
          ? singleItem.type !== 'pali'
          : singleItem.type === orderedLayers[0]?.type &&
            (singleItem.type === 'pali' || singleItem.lang === orderedLayers[0]?.lang);

        if (isCol1) {
          const col1Class = singleItem.type === 'pali' ? 'reader-pali-col' : 'reader-trans-col';
          return `<div class="reader-para-row reader-trans-side-row reader-side-empty" ${rowAttrs}><div class="reader-side-col reader-side-col-left ${col1Class}">${singleItem.html}</div><div class="reader-side-col reader-side-col-right reader-trans-col reader-trans-col-empty"><div class="reader-translation-container reader-side-container" data-pindex="${pIndex}"></div></div></div>`;
        } else {
          const col2Class = singleItem.type === 'pali' ? 'reader-pali-col' : 'reader-trans-col';
          const col2Wrapped = col2Class === 'reader-trans-col'
            ? `<div class="reader-translation-container reader-side-container" data-pindex="${pIndex}">${singleItem.html}</div>`
            : singleItem.html;
          return `<div class="reader-para-row reader-trans-side-row reader-side-empty" ${rowAttrs}><div class="reader-side-col reader-side-col-left reader-trans-col reader-trans-col-empty"></div><div class="reader-side-col reader-side-col-right ${col2Class}">${col2Wrapped}</div></div>`;
        }
      }
    }

    // Paired sentence rows (epitaka-style 1 Pāḷi vs 1 translation per line).
    // Stack mode only, Pāḷi enabled, prose paragraphs where every layer has
    // sentence splits. Missing lines render an empty cell so alignment holds.
    if (!isSideActive && sentenceMode && isPaliEnabled && !isHeading) {
      const isProse =
        pClasses.some((c) => /^(bodytext|indent|hangnum|unindented)$/i.test(c)) ||
        /^(bodytext|indent|hangnum|unindented)$/i.test(paraType || '');
      const paliItem = renderedItems.find((item) => item.type === 'pali');
      const transItems = renderedItems.filter((item) => item.type === 'trans');
      if (
        isProse && paliItem && transItems.length > 0 &&
        transItems.every((item) => item.sentItems && item.sentItems.length > 0)
      ) {
        const paliLines = extractClassSpans(paliItem.html, 'pali-sent');
        if (paliLines.length > 1) {
          const transByLang = transItems.map((item) => ({
            item,
            byLine: new Map(item.sentItems.map((s) => [s.line, s.html])),
          }));
          const lineOrder = [];
          const seen = new Set();
          for (const l of paliLines.map((p) => p.line)) {
            if (!seen.has(l)) {
              seen.add(l);
              lineOrder.push(l);
            }
          }
          for (const { byLine } of transByLang) {
            for (const l of byLine.keys()) {
              if (!seen.has(l)) {
                seen.add(l);
                lineOrder.push(l);
              }
            }
          }
          const paliByLine = new Map(paliLines.map((p) => [p.line, p.html]));
          const numMatch = paliItem.html.match(
            /<strong\b[^>]*\bparanum\b[^>]*>[\s\S]*?<\/strong>(?:\s*<span\b[^>]*\bdot\b[^>]*>[\s\S]*?<\/span>)?/
          );
          const paliColors = translationColors?.pali || {};
          const paliBorder = formatCssColor(paliColors.border);
          const paliBg = formatCssColor(paliColors.bg);
          const paliText = formatCssColor(paliColors.text);
          const hasPaliCustom = Boolean(paliBorder || paliBg || paliText);
          const paliSentStyle = hasPaliCustom
            ? [
                paliBorder ? `border-left: 1.5px solid ${paliBorder}` : 'border-left: 1.5px solid color-mix(in srgb, var(--accent, #8b2500) 30%, transparent)',
                paliBg ? `background-color: ${paliBg}` : '',
                paliText ? `color: ${paliText}` : '',
                'padding: 0.5rem 0.85rem; border-radius: 8px;',
              ]
                .filter(Boolean)
                .join('; ')
            : '';
          const pairs = lineOrder
            .map((ln) => {
              const pHtml = paliByLine.get(ln);
              const cells = transByLang
                .map(({ item, byLine }) => {
                  const tHtml = byLine.get(ln);
                  if (tHtml === undefined) return '';
                  return `<div class="sent-pair-trans reader-trans-block" data-trans-lang="${item.lang}" data-line="${ln}"${item.blockStyles ? ` style="${item.blockStyles}"` : ''}>` +
                    `<div class="reader-trans-content"${item.contentStyles ? ` style="${item.contentStyles}"` : ''}>${tHtml}</div></div>`;
                })
                .join('');
              if (pHtml === undefined && !cells) return '';
              return `<div class="sent-pair" data-line="${ln}">` +
                `<div class="sent-pair-num">${ln}</div>` +
                `<div class="sent-pair-body">` +
                (pHtml !== undefined
                  ? `<div class="sent-pair-pali reader-trans-block"${hasPaliCustom ? ` style="${paliSentStyle}"` : ''} data-line="${ln}">${stripSentNumBadge(pHtml)}</div>`
                  : '') +
                cells +
                `</div></div>`;
            })
            .filter(Boolean)
            .join('');
          if (pairs) {
            return `<div class="reader-para-row reader-sent-pairs" ${rowAttrs}>` +
              (numMatch ? `<div class="sent-paranum">${numMatch[0]}</div>` : '') +
              pairs +
              `</div>`;
          }
        }
      }
    }

    // Stack mode or single-layer side mode
    const itemsHtml = renderedItems.map((item) => item.html).join('');
    return `<div class="reader-para-row reader-trans-stack-row" ${rowAttrs}>${itemsHtml}</div>`;
  });
}

// Memoized Chapter Block with Pre-Buffering Intersection Observer, Lazy Translation Loading, and Scoped Highlighting
const ChapterBlock = memo(function ChapterBlock({
  chapter,
  bookCode,
  html,
  isLoading,
  onVisible,
  isCurrentOrTarget = false,
  paliScript = 'roman',
  searchHighlight = null,
  highlightSearchTerms = true,
  activeLangs = [],
  orderedLayers = [],
  isPaliEnabled = true,
  translationDisplayMode = 'stack',
  translationColors = {},
  sentenceMode = false,
}) {
  const blockRef = useRef(null);
  const [translations, setTranslations] = React.useState({});
  const [transSentences, setTransSentences] = React.useState({});
  const [paliSentMap, setPaliSentMap] = React.useState(null);
  const [isTransLoading, setIsTransLoading] = React.useState(false);
  const [isPaliSentLoading, setIsPaliSentLoading] = React.useState(false);
  const [isNearViewport, setIsNearViewport] = React.useState(isCurrentOrTarget);
  const activeLangsKey = activeLangs.join(',');

  useEffect(() => {
    if (isCurrentOrTarget) {
      setIsNearViewport(true);
    }
  }, [isCurrentOrTarget]);

  // IntersectionObserver for lazy loading chapter HTML & lazy loading translations
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return;
    }
    if (!blockRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          if (!html) {
            onVisible(chapter.chapter_index);
          }
          setIsNearViewport(true);
        }
      },
      { rootMargin: '800px 0px' } // Pre-load 800px before scrolling into view
    );

    observer.observe(blockRef.current);
    return () => observer.disconnect();
  }, [html, chapter.chapter_index, onVisible]);

  // Task 3: Lazy load translations ONLY when chapter is near viewport (or current/target) and active translation languages exist
  useEffect(() => {
    if (!html || !bookCode || !activeLangsKey || (!isNearViewport && !isCurrentOrTarget)) {
      if (!activeLangsKey) {
        setTranslations({});
        setTransSentences({});
        setIsTransLoading(false);
      }
      return;
    }

    let isMounted = true;
    const langsToFetch = activeLangsKey.split(',').filter(Boolean);
    if (langsToFetch.length === 0) {
      setTranslations({});
      setTransSentences({});
      setIsTransLoading(false);
      return;
    }

    // Expose the translation fetch state on the chapter block so the reader's
    // post-jump settle watcher knows whether this chapter can still grow:
    // rows above a jump target expand when the payload lands, shifting it.
    blockRef.current?.removeAttribute('data-trans-settled');
    blockRef.current?.setAttribute('data-trans-loading', '1');
    setIsTransLoading(true);

    fetchChapterTranslations(bookCode, chapter.chapter_index, langsToFetch, { sentences: sentenceMode })
      .then((data) => {
        if (!isMounted) return;
        blockRef.current?.removeAttribute('data-trans-loading');
        blockRef.current?.setAttribute('data-trans-settled', '1');
        if (data?.translations) {
          setTranslations(data.translations);
        }
        if (sentenceMode && data?.sentences) {
          setTransSentences(data.sentences);
        }
        setIsTransLoading(false);
      })
      .catch((err) => {
        console.warn(`[ChapterBlock] Error loading translations for ch ${chapter.chapter_index}:`, err);
        if (isMounted) {
          // Treat a failed fetch as final (rows stay Pāḷi-only) so watchers
          // don't wait forever for a payload that will never arrive.
          blockRef.current?.removeAttribute('data-trans-loading');
          blockRef.current?.setAttribute('data-trans-settled', '1');
          setIsTransLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [html, bookCode, chapter.chapter_index, activeLangsKey, isNearViewport, isCurrentOrTarget, sentenceMode]);

  // Pāḷi sentence map for sentence display mode (book-level, shared cache).
  useEffect(() => {
    if (!sentenceMode || !isPaliEnabled || !html || !bookCode) {
      if (!sentenceMode) setPaliSentMap(null);
      setIsPaliSentLoading(false);
      return;
    }
    let cancelled = false;
    setIsPaliSentLoading(true);
    fetchPaliSentences(bookCode)
      .then((data) => {
        if (cancelled) return;
        const chapMap = data?.chapters?.[String(chapter.chapter_index)];
        setPaliSentMap(chapMap || null);
        setIsPaliSentLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsPaliSentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sentenceMode, isPaliEnabled, html, bookCode, chapter.chapter_index]);

  const hasActiveTrans = activeLangs.length > 0;
  const hasTransData = Object.keys(translations).length > 0;
  const hasSentenceData = !sentenceMode || (Boolean(paliSentMap) && Object.keys(transSentences).length > 0);
  const isTransPending =
    hasActiveTrans &&
    (isTransLoading || isPaliSentLoading || !hasTransData || (sentenceMode && !hasSentenceData));

  const displayHtml = React.useMemo(() => {
    if (!html) return null;
    let processed = html;
    if (paliScript && paliScript !== 'roman') {
      processed = transliterateHtml(processed, paliScript);
    }
    // Sentence display mode: Pāḷi sentence lines from the precomputed map
    // (before search highlighting so marks nest inside the sentences).
    if (sentenceMode && isPaliEnabled && paliSentMap) {
      processed = injectPaliSentencesIntoHtml(processed, paliSentMap);
    }
    // Task 2: Only highlight Pāḷi text if search was in Root Pāḷi CST (not in translation database)
    const isPali = isSearchPali(searchHighlight);
    if (highlightSearchTerms && searchHighlight?.query && searchHighlight.query.trim() && isPali) {
      processed = highlightHtmlText(
        processed,
        searchHighlight.query.trim(),
        paliScript,
        searchHighlight.paraIndex,
        searchHighlight.paraNum
      );
    }
    const currentPaliColors = translationColors?.pali || {};
    const hasCustomPaliColors = Boolean(
      formatCssColor(currentPaliColors.border) ||
      formatCssColor(currentPaliColors.bg) ||
      formatCssColor(currentPaliColors.text)
    );
    if (hasActiveTrans || !isPaliEnabled || hasCustomPaliColors) {
      processed = injectTranslationsIntoHtml(
        processed,
        translations,
        orderedLayers,
        isPaliEnabled,
        translationDisplayMode,
        translationColors,
        highlightSearchTerms ? searchHighlight : null,
        sentenceMode,
        transSentences
      );
    }
    return processed;
  }, [
    html,
    paliScript,
    searchHighlight,
    highlightSearchTerms,
    hasActiveTrans,
    translations,
    orderedLayers,
    isPaliEnabled,
    translationDisplayMode,
    translationColors,
    sentenceMode,
    transSentences,
    paliSentMap,
  ]);

  if (displayHtml) {
    if (!isPaliEnabled && isTransPending) {
      return (
        <div
          ref={blockRef}
          id={`chap-${chapter.chapter_index}`}
          data-chapter={chapter.chapter_index}
          className="chapter-content-block reader-chapter-trans-loading py-14 px-6 my-6 border border-dashed border-[var(--border-color)] rounded-2xl flex flex-col items-center justify-center gap-3 bg-[var(--bg-secondary)]/30 text-center select-none animate-in fade-in duration-300"
        >
          <div className="flex items-center gap-2.5 text-sm font-semibold text-[var(--text-primary)]">
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
            <span>Loading happiness...</span>
          </div>
          <p className="text-xs text-[var(--text-muted)] max-w-md">
            Preparing {activeLangs.map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join(', ')} translation for{' '}
            <span className="font-medium text-[var(--text-secondary)]">
              {convertPaliScript(capitalizePali(chapter.title), paliScript)}
            </span>
          </p>
        </div>
      );
    }

    return (
      <div
        ref={blockRef}
        id={`chap-${chapter.chapter_index}`}
        data-chapter={chapter.chapter_index}
        className="chapter-content-block"
      >
        {isTransPending && (
          <div className="reader-trans-pending-banner my-2.5 mx-auto max-w-fit px-3.5 py-1.5 rounded-full flex items-center gap-2 text-xs font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-color)] shadow-xs transition-all animate-in fade-in slide-in-from-top-1 duration-200 select-none">
            <div className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-[var(--text-primary)] font-medium">Loading happiness...</span>
            <span className="text-[var(--text-muted)] hidden sm:inline">
              {sentenceMode ? 'Preparing sentence translations' : 'Fetching translations'}
            </span>
          </div>
        )}
        <div dangerouslySetInnerHTML={{ __html: displayHtml }} />
      </div>
    );
  }

  return (
    <div
      ref={blockRef}
      id={`chap-${chapter.chapter_index}`}
      data-chapter={chapter.chapter_index}
      className="chapter-placeholder py-8 px-4 my-6 border border-dashed border-[var(--border-color)] rounded-xl flex flex-col items-center justify-center gap-2 bg-[var(--bg-secondary)]/40 select-none"
    >
      <h3 className="text-sm sm:text-base font-bold text-[var(--text-primary)] text-center">
        {convertPaliScript(capitalizePali(chapter.title), paliScript)}
      </h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mt-1">
          <div className="w-3.5 h-3.5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <span>Loading happiness...</span>
        </div>
      ) : (
        <button
          className="text-xs px-3 py-1 mt-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition cursor-pointer"
          onClick={() => onVisible(chapter.chapter_index)}
        >
          Load Section
        </button>
      )}
    </div>
  );
});

const STORAGE_KEY_CLICKED_WORDS = 'tipitaka_last_clicked_words_v1';

// Helper to clear any clicked word highlight in Reader
function clearClickedWordHighlight(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  const elements = root.querySelectorAll('.reader-clicked-word');
  elements.forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
      parent.normalize();
    }
  });
}

// Helper to highlight a DOM range with dashed accent underline and background
function highlightRangeInReader(range) {
  if (!range) return;
  clearClickedWordHighlight();
  try {
    const span = document.createElement('span');
    span.className = 'reader-clicked-word';
    span.setAttribute('data-clicked-word', 'true');
    span.appendChild(range.extractContents());
    range.insertNode(span);
  } catch (err) {
    console.warn('Could not highlight clicked word range:', err);
  }
}

// Helper to compute exact character offset inside a parent element
function getCharOffsetInElement(parentEl, targetNode, targetOffset) {
  if (!parentEl || !targetNode) return 0;
  let offset = 0;
  const walker = document.createTreeWalker(parentEl, NodeFilter.SHOW_TEXT, null, false);
  let current;
  while ((current = walker.nextNode())) {
    if (current === targetNode) {
      return offset + targetOffset;
    }
    offset += current.textContent.length;
  }
  return offset;
}

// Helper to construct a DOM Range from character offset and length in a parent element
function createRangeFromCharOffset(parentEl, targetOffset, length) {
  if (!parentEl) return null;
  let offset = 0;
  let startNode = null;
  let startOffsetInNode = 0;
  let endNode = null;
  let endOffsetInNode = 0;

  const targetEnd = targetOffset + length;
  const walker = document.createTreeWalker(parentEl, NodeFilter.SHOW_TEXT, null, false);
  let current;

  while ((current = walker.nextNode())) {
    const nodeLen = current.textContent.length;
    if (!startNode && offset + nodeLen >= targetOffset) {
      startNode = current;
      startOffsetInNode = targetOffset - offset;
    }
    if (startNode && offset + nodeLen >= targetEnd) {
      endNode = current;
      endOffsetInNode = targetEnd - offset;
      break;
    }
    offset += nodeLen;
  }

  if (startNode && endNode) {
    try {
      const range = document.createRange();
      range.setStart(startNode, startOffsetInNode);
      range.setEnd(endNode, endOffsetInNode);
      return range;
    } catch (e) {}
  }
  return null;
}

// Cached Intl.Segmenter instances by locale for fast word extraction across languages
const wordSegmenters = new Map();
function getWordSegmenter(locale) {
  if (!wordSegmenters.has(locale)) {
    try {
      wordSegmenters.set(locale, new Intl.Segmenter(locale, { granularity: 'word' }));
    } catch (e) {
      try {
        wordSegmenters.set(locale, new Intl.Segmenter('en', { granularity: 'word' }));
      } catch (err) {
        wordSegmenters.set(locale, null);
      }
    }
  }
  return wordSegmenters.get(locale);
}

// Stop characters and word delimiters for Pāḷi, Nissaya, and Latin text
const STOP_CHAR = /[\s.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§`၊။，。！？；：（）【】《》、·'‘’’"“”«»‹›„“”「」『』]/;

function extractWordDelimiter(text, safeOffset) {
  if (!text || safeOffset < 0 || safeOffset >= text.length) return null;
  let start = safeOffset;
  let end = safeOffset;
  if (STOP_CHAR.test(text[safeOffset])) {
    if (safeOffset > 0 && !STOP_CHAR.test(text[safeOffset - 1])) {
      start = safeOffset - 1;
      end = safeOffset;
    } else if (safeOffset < text.length - 1 && !STOP_CHAR.test(text[safeOffset + 1])) {
      start = safeOffset + 1;
      end = safeOffset + 2;
    } else {
      return null;
    }
  } else {
    end = safeOffset + 1;
  }

  while (start > 0 && !STOP_CHAR.test(text[start - 1])) {
    start--;
  }
  while (end < text.length && !STOP_CHAR.test(text[end])) {
    end++;
  }

  const word = text.slice(start, end).trim();
  if (!word) return null;
  return { word, start, end };
}

// Extract word and boundaries at offset inside a text string (supports CJK, Myanmar, Indic, Latin)
function extractWordAtOffset(text, offset, lang = 'en') {
  if (!text || offset < 0 || offset > text.length) return null;
  const safeOffset = Math.min(offset, Math.max(0, text.length - 1));

  // Pali (in all scripts: Roman, Myanmar, Sinhala, Devanagari, Thai, etc.) and Myanmar Nissaya:
  // words are strictly space/punctuation delimited. Intl.Segmenter shatters non-Roman Pali
  // words into single syllables/characters. Use delimiter-based extraction first.
  if (lang === 'pali' || lang === 'pi' || lang === 'my_nissaya') {
    const delimMatch = extractWordDelimiter(text, safeOffset);
    if (delimMatch) return delimMatch;
  }

  const localeMap = {
    pali: 'pi',
    pi: 'pi',
    english: 'en',
    en: 'en',
    vietnamese: 'vi',
    vi: 'vi',
    myanmar: 'my',
    my: 'my',
    my_nissaya: 'my',
    sinhala: 'si',
    si: 'si',
    chinese: 'zh',
    zh: 'zh',
    khmer: 'km',
    km: 'km',
    thai: 'th',
    th: 'th',
    lao: 'lo',
    lo: 'lo',
    tamil: 'ta',
    ta: 'ta',
    hindi: 'hi',
    hi: 'hi',
    german: 'de',
    de: 'de',
    japanese: 'ja',
    ja: 'ja',
    korean: 'ko',
    ko: 'ko',
    portuguese: 'pt',
    pt: 'pt',
    russian: 'ru',
    ru: 'ru',
  };
  const locale = localeMap[lang] || 'en';

  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const segmenter = getWordSegmenter(locale);
      if (segmenter) {
        const segments = Array.from(segmenter.segment(text));
        // 1. Direct hit on a word-like segment
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const segStart = seg.index;
          const segEnd = seg.index + seg.segment.length;
          if (seg.isWordLike && safeOffset >= segStart && safeOffset < segEnd) {
            return { word: seg.segment, start: segStart, end: segEnd };
          }
        }
        // 2. Clicked at the trailing boundary of a word
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const segStart = seg.index;
          const segEnd = seg.index + seg.segment.length;
          if (seg.isWordLike && safeOffset === segEnd) {
            return { word: seg.segment, start: segStart, end: segEnd };
          }
        }
        // 3. Clicked on immediate adjacent punctuation/quote
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          const segStart = seg.index;
          const segEnd = seg.index + seg.segment.length;
          if (!seg.isWordLike && safeOffset >= segStart && safeOffset < segEnd) {
            if (i > 0 && segments[i - 1].isWordLike && safeOffset === segStart) {
              return {
                word: segments[i - 1].segment,
                start: segments[i - 1].index,
                end: segments[i - 1].index + segments[i - 1].segment.length,
              };
            }
            if (i < segments.length - 1 && segments[i + 1].isWordLike && safeOffset === segEnd - 1) {
              return {
                word: segments[i + 1].segment,
                start: segments[i + 1].index,
                end: segments[i + 1].index + segments[i + 1].segment.length,
              };
            }
          }
        }
      }
    } catch (e) {}
  }

  // Fallback for single characters in any script (Han, Kana, Latin, Myanmar, etc.)
  const char = text[safeOffset];
  if (char && /\p{L}/u.test(char)) {
    return { word: char, start: safeOffset, end: safeOffset + 1 };
  }

  return extractWordDelimiter(text, safeOffset);
}

// Helper to find and highlight a stored word inside a book container
function restoreClickedWordHighlight(bookCode, record, container = document) {
  if (!bookCode || !record || !container) return false;
  const { pIndex, paraNum, chapIdx, word, rawWord, charOffset, length, transLang } = record;

  let targetEl = null;

  // 1. Scoped language block resolution
  if (transLang && transLang !== 'pali') {
    if (pIndex) {
      targetEl = container.querySelector(
        `[data-pindex="${pIndex}"] .reader-trans-block[data-trans-lang="${transLang}"], ` +
        `.reader-trans-block[data-trans-lang="${transLang}"][data-pindex="${pIndex}"]`
      );
    }
    if (!targetEl && paraNum) {
      targetEl = container.querySelector(
        `[data-para="${paraNum}"] .reader-trans-block[data-trans-lang="${transLang}"], ` +
        `.reader-trans-block[data-trans-lang="${transLang}"][data-para="${paraNum}"]`
      );
    }
  }

  // 2. Scoped Pali block resolution
  if (!targetEl && transLang === 'pali') {
    if (pIndex) {
      targetEl = container.querySelector(
        `[data-pindex="${pIndex}"] .reader-pali-trans-block, ` +
        `p[data-pindex="${pIndex}"], ` +
        `[data-pindex="${pIndex}"] p`
      );
    }
    if (!targetEl && paraNum) {
      targetEl = container.querySelector(
        `[data-para="${paraNum}"] .reader-pali-trans-block, ` +
        `p[data-para="${paraNum}"], ` +
        `[data-para="${paraNum}"] p`
      );
    }
  }

  // 3. Fallback to generic paragraph resolution
  if (!targetEl) {
    if (pIndex) {
      targetEl = container.querySelector(`p[data-pindex="${pIndex}"]`) || container.querySelector(`[data-pindex="${pIndex}"]`);
    }
    if (!targetEl && paraNum) {
      targetEl = container.querySelector(`p[data-para="${paraNum}"]`) || container.querySelector(`[data-para="${paraNum}"]`);
    }
    if (!targetEl && chapIdx !== undefined) {
      targetEl = container.querySelector(`#chap-${chapIdx} p, #chap-${chapIdx} [data-pindex]`);
    }
  }

  if (targetEl) {
    // Try exact character offset
    if (charOffset !== undefined && length) {
      const range = createRangeFromCharOffset(targetEl, charOffset, length);
      if (range && range.toString().trim()) {
        highlightRangeInReader(range);
        return true;
      }
    }

    // Fallback: search word inside this block/paragraph
    const searchWord = rawWord || word;
    if (searchWord) {
      const pText = targetEl.textContent || '';
      const idx = pText.indexOf(searchWord);
      if (idx !== -1) {
        const range = createRangeFromCharOffset(targetEl, idx, searchWord.length);
        if (range) {
          highlightRangeInReader(range);
          return true;
        }
      }
    }
  }

  return false;
}

export default function ReaderView() {
  const {
    activeTab,
    loadChapter,
    bufferAdjacentChapters,
    saveTabScroll,
    getSavedScroll,
    targetScrollIntent,
    clearTargetScrollIntent,
    setIsSidebarOpen,
    isSidebarOpen,
    isHeaderVisible,
    setIsHeaderVisible,
    addBookmark,
    removeBookmark,
    isBookmarked,
    bookmarks,
    activeParaNum,
    setActiveParaNum,
    activeEditionPages,
    setActiveEditionPages,
    openGoToModal,
    addToHistory,
    saveTabPosition,
    searchHighlight,
    openBook,
    setIsHistoryOpen,
  } = useTabs();

  const { openDictionary, clickToLookupEnabled, clickLookupMode } = useDictionary();
  const { settings, setIsZenMode } = useThemeSettings();
  const pulseAnimation = Boolean(settings?.pulseAnimation);

  const isPaliEnabled = settings?.translations?.pali !== false;

  const orderedLayers = React.useMemo(() => {
    const order = settings?.translationOrder || [];
    const layers = [];
    for (const id of order) {
      if (id === 'pali') {
        if (isPaliEnabled) {
          layers.push({ id: 'pali', type: 'pali' });
        }
      } else if (settings?.translations?.[id] && LANG_KEY_TO_CODE[id]) {
        layers.push({ id, type: 'trans', lang: LANG_KEY_TO_CODE[id] });
      }
    }
    if (isPaliEnabled && !layers.some((l) => l.id === 'pali')) {
      layers.unshift({ id: 'pali', type: 'pali' });
    }
    if (settings?.translations) {
      for (const [id, enabled] of Object.entries(settings.translations)) {
        if (id !== 'pali' && enabled && LANG_KEY_TO_CODE[id] && !layers.some((l) => l.id === id)) {
          layers.push({ id, type: 'trans', lang: LANG_KEY_TO_CODE[id] });
        }
      }
    }
    return layers;
  }, [settings?.translations, settings?.translationOrder, isPaliEnabled]);

  const activeLangs = React.useMemo(() => {
    const langs = [];
    for (const layer of orderedLayers) {
      if (layer.type === 'trans' && !langs.includes(layer.lang)) {
        langs.push(layer.lang);
      }
    }
    return langs;
  }, [orderedLayers]);
  const containerRef = useRef(null);
  const contentHeaderRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const scrollAccDeltaRef = useRef(0);
  const scrollTimeoutRef = useRef(null);
  const prevBookCodeRef = useRef(null);
  const restoredContainerRef = useRef(null);
  const restoredBookCodeRef = useRef(null);
  const clickedWordsByBookRef = useRef({});

  // Chapter-jump settle tracking (sidebar chapter clicks): lazy translations streaming
  // into chapters above the target can shift it after we measured, so a guarded
  // one-shot drift correction is scheduled per jump. Any manual scroll cancels it.
  const chapterJumpRef = useRef({ key: null, lastOffset: 0, timer: null });

  // Paragraph-jump settle tracking (citation / search / bookmark / history / MAT /
  // GoTo jumps): translation batches stream in lazily AFTER the initial scroll and
  // expand content above the target, shifting it. A guarded watcher re-verifies the
  // landing until stable. Any manual scroll cancels it.
  const paraJumpRef = useRef({ key: null, lastOffset: 0, timer: null, deadline: 0 });

  useEffect(() => {
    const cancelJump = () => {
      const st = chapterJumpRef.current;
      if (st.key) {
        clearTimeout(st.timer);
        chapterJumpRef.current = { key: null, lastOffset: 0, timer: null };
        clearTargetScrollIntent();
      }
      const ps = paraJumpRef.current;
      if (ps.key) {
        clearTimeout(ps.timer);
        paraJumpRef.current = { key: null, lastOffset: 0, timer: null, deadline: 0 };
      }
    };
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', cancelJump, { passive: true });
      container.addEventListener('touchstart', cancelJump, { passive: true });
    }
    return () => {
      clearTimeout(chapterJumpRef.current.timer);
      clearTimeout(paraJumpRef.current.timer);
      if (container) {
        container.removeEventListener('wheel', cancelJump);
        container.removeEventListener('touchstart', cancelJump);
      }
    };
  }, [clearTargetScrollIntent]);

  // Initialize clicked words from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CLICKED_WORDS);
      if (saved) {
        clickedWordsByBookRef.current = JSON.parse(saved);
      }
    } catch (e) {}
  }, []);

  const recordClickedWord = useCallback((bookCode, record) => {
    if (!bookCode || !record) return;
    clickedWordsByBookRef.current[bookCode] = record;
    try {
      localStorage.setItem(STORAGE_KEY_CLICKED_WORDS, JSON.stringify(clickedWordsByBookRef.current));
    } catch (e) {}
  }, []);

  // Restore highlight when switching books / tabs or when chapters render
  useEffect(() => {
    if (!activeTab?.bookCode) return;
    const bookCode = activeTab.bookCode;
    const record = clickedWordsByBookRef.current[bookCode];

    clearClickedWordHighlight();

    if (record) {
      const timer = setTimeout(() => {
        restoreClickedWordHighlight(bookCode, record, containerRef.current || document);
      }, 70);
      return () => clearTimeout(timer);
    }
  }, [activeTab?.bookCode, activeTab?.currentChapterIdx, settings?.paliScript]);

  // Synchronously restore scroll position BEFORE browser paint (Zero jumping / bouncing!)
  useLayoutEffect(() => {
    if (!containerRef.current || !activeTab?.bookCode || activeTab.bookCode === 'ai_chat') return;

    const container = containerRef.current;
    const needsRestore =
      restoredContainerRef.current !== container ||
      restoredBookCodeRef.current !== activeTab.bookCode;

    if (needsRestore) {
      restoredContainerRef.current = container;
      restoredBookCodeRef.current = activeTab.bookCode;
      prevBookCodeRef.current = activeTab.bookCode;

      if (!targetScrollIntent) {
        const savedScroll = getSavedScroll(activeTab.bookCode);
        if (savedScroll > 0) {
          container.scrollTop = savedScroll;
          // Safeguard: re-verify in next frame in case DOM layout / fonts reflowed
          requestAnimationFrame(() => {
            if (containerRef.current && !targetScrollIntent && restoredBookCodeRef.current === activeTab.bookCode) {
              if (Math.abs(containerRef.current.scrollTop - savedScroll) > 5) {
                containerRef.current.scrollTop = savedScroll;
              }
            }
          });
        }
      }
    }
  }, [activeTab?.bookCode, getSavedScroll, targetScrollIntent]);

  // Synchronously save scroll position on unmount or tab switch, and reset restoration flag on unmount
  useEffect(() => {
    return () => {
      if (containerRef.current && activeTab?.bookCode && activeTab.bookCode !== 'ai_chat') {
        saveTabScroll(activeTab.bookCode, containerRef.current.scrollTop);
      }
      restoredContainerRef.current = null;
    };
  }, [activeTab?.bookCode, saveTabScroll]);

  // Handle Target Scroll Intent (Chapter jumping, Search jumping, Book TOC jumping, MAT jumping, Bookmarks, History)
  useEffect(() => {
    if (!targetScrollIntent || !containerRef.current || !activeTab) return;

    const { chapterIdx, paraIndex, paraNum, page, pageSystem, subBook, lang, db } = targetScrollIntent;
    const targetTransLang = normalizeLangCode(lang || db || searchHighlight?.lang || searchHighlight?.db);
    const isTransTarget = Boolean(targetTransLang && targetTransLang !== 'pali');

    if (chapterIdx !== undefined && chapterIdx !== null) {
      if (!activeTab.loadedChapters?.[chapterIdx]) {
        loadChapter(activeTab.bookCode, chapterIdx);
      }
      bufferAdjacentChapters(activeTab.bookCode, chapterIdx);
    }

    let retries = 0;
    const maxRetries = 80; // Check every 50ms for up to 4.0 seconds (sufficient time for chapter & translation loading)

    let timerId = null;

    // Safe DOM element finder by ID or data attributes (prevents selector SyntaxError on IDs with dots e.g. V3.0440)
    const findElement = (id, fallbackSelector = '') => {
      if (!containerRef.current) return null;
      const hasSpecificChapter = chapterIdx !== undefined && chapterIdx !== null;
      const chapterEl = hasSpecificChapter
        ? containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`)
        : null;

      // When a specific chapter is requested, ONLY search within that chapter's container
      if (hasSpecificChapter) {
        if (!chapterEl || chapterEl.classList.contains('chapter-placeholder')) {
          // Chapter is still loading/buffering, retry on next interval tick
          return null;
        }
        if (id) {
          try {
            if (subBook) {
              const inScopeSub = chapterEl.querySelector(`[data-sub-book="${CSS.escape(subBook)}"][id="${CSS.escape(id)}"]`);
              if (inScopeSub) return inScopeSub;
            }
            const inScope = chapterEl.querySelector(`[id="${CSS.escape(id)}"]`);
            if (inScope && (!subBook || inScope.getAttribute('data-sub-book') === subBook)) return inScope;
          } catch (_) {}
        }
        if (fallbackSelector) {
          try {
            if (subBook && !fallbackSelector.includes('data-sub-book')) {
              const inScopeSub = chapterEl.querySelector(`[data-sub-book="${CSS.escape(subBook)}"]${fallbackSelector}`);
              if (inScopeSub) return inScopeSub;
            }
            const inScopeFallback = chapterEl.querySelector(fallbackSelector);
            if (inScopeFallback && (!subBook || inScopeFallback.getAttribute('data-sub-book') === subBook)) return inScopeFallback;
          } catch (_) {}
        }
        return null; // NEVER fall back to another chapter when a specific chapter is targeted!
      }

      // If no specific chapter is specified, search the full container
      if (id) {
        try {
          if (subBook) {
            const inScopeSub = containerRef.current.querySelector(`[data-sub-book="${CSS.escape(subBook)}"][id="${CSS.escape(id)}"]`);
            if (inScopeSub) return inScopeSub;
          }
          const inScope = containerRef.current.querySelector(`[id="${CSS.escape(id)}"]`);
          if (inScope && (!subBook || inScope.getAttribute('data-sub-book') === subBook)) return inScope;
        } catch (_) {}

        if (!subBook) {
          const byId = document.getElementById(id);
          if (byId && containerRef.current.contains(byId)) return byId;
        }
      }
      if (fallbackSelector) {
        try {
          if (subBook && !fallbackSelector.includes('data-sub-book')) {
            const inScopeSub = containerRef.current.querySelector(`[data-sub-book="${CSS.escape(subBook)}"]${fallbackSelector}`);
            if (inScopeSub) return inScopeSub;
          }
          const inScopeFallback = containerRef.current.querySelector(fallbackSelector);
          if (inScopeFallback && (!subBook || inScopeFallback.getAttribute('data-sub-book') === subBook)) return inScopeFallback;
        } catch (_) {}
      }
      return null;
    };

    const attemptScroll = () => {
      if (!containerRef.current) return;

      // ── Paragraph-jump settle watcher ──────────────────────────────────
      // Re-resolve the paragraph target the jump scrolled to (same flavour:
      // translation block for translation-targeted jumps, row otherwise).
      // Returns null when the target is not (yet) measurably in the DOM.
      const resolveParaTarget = () => {
        const container = containerRef.current;
        if (!container) return null;
        const visible = (el) =>
          el && el.getClientRects && el.getClientRects().length > 0 ? el : null;
        const pickTransOrRow = (row, scopeForChapter) => {
          if (isTransTarget) {
            const transEl =
              (row.querySelector &&
                (row.querySelector(`.reader-trans-block[data-trans-lang="${targetTransLang}"]`) ||
                  row.querySelector(`[data-trans-lang="${targetTransLang}"]`))) ||
              null;
            if (visible(transEl)) return transEl;
            // Translations arrived for this chapter but this paragraph has none:
            // the jump fell back to Pāli — measure the same fallback.
            const chapterHasTranslations = Boolean(
              scopeForChapter?.querySelector(`.reader-trans-block[data-trans-lang="${targetTransLang}"]`)
            );
            if (chapterHasTranslations) return visible(row);
            return null; // translation batch still in flight — keep waiting
          }
          return visible(row);
        };

        if (paraIndex !== undefined && paraIndex !== null && paraIndex !== '') {
          const chapterEl =
            chapterIdx !== undefined && chapterIdx !== null
              ? container.querySelector(`[data-chapter="${chapterIdx}"]`)
              : null;
          if (
            chapterIdx !== undefined &&
            chapterIdx !== null &&
            (!chapterEl || chapterEl.classList.contains('chapter-placeholder'))
          ) {
            return null;
          }
          const scope = chapterEl || container;
          const el =
            scope.querySelector(`.reader-para-row[data-pindex="${paraIndex}"]`) ||
            scope.querySelector(`[data-pindex="${paraIndex}"]`) ||
            scope.querySelector(`p[data-pindex="${paraIndex}"]`) ||
            scope.querySelector(`[id="pindex-${paraIndex}"]`);
          if (!el) return null;
          const row = (el.closest && el.closest('.reader-para-row')) || el;
          return pickTransOrRow(row, chapterEl || container);
        }

        if (paraNum) {
          const cleanPara = String(paraNum).replace(/^(?:para-?|p)/i, '').trim();
          const activeSub =
            subBook ||
            activeTab.sub_book ||
            activeTab.chapter_to_sub_book?.[chapterIdx ?? activeTab.currentChapterIdx ?? 0];
          const scope =
            chapterIdx !== undefined && chapterIdx !== null
              ? container.querySelector(`[data-chapter="${chapterIdx}"]`) || container
              : container;
          if (scope.classList && scope.classList.contains('chapter-placeholder')) return null;
          // Exact paragraph match only — never "correct" onto a neighbouring paragraph.
          const candidates = scope.querySelectorAll(`[data-para="${cleanPara}"]`);
          let el = null;
          for (const c of candidates) {
            if (!activeSub || !c.getAttribute('data-sub-book') || c.getAttribute('data-sub-book') === activeSub) {
              el = c;
              break;
            }
          }
          if (!el) return null;
          const row = (el.closest && el.closest('.reader-para-row')) || el;
          return pickTransOrRow(row, scope);
        }

        return null;
      };

      // ── Translation-settle gate ────────────────────────────────────────
      // Returns true only once the content above the jump anchor can no longer
      // grow on its own. With translation layers enabled, each chapter streams
      // its payload lazily (`data-trans-loading` while a fetch is in flight,
      // `data-trans-settled` once it has landed/errored). While the target
      // chapter's own payload is pending, its rows above the target paragraph
      // expand when it lands; while any content chapter above the anchor is
      // still loading, the anchor itself can be pushed down. The settle watcher
      // must not declare stability until those conditions clear.
      const hasTransLayers = orderedLayers.some((l) => l.type === 'trans');
      const areaTranslationSettled = (hostChapterEl, { includeHost = true } = {}) => {
        if (!hasTransLayers) return true;
        const container = containerRef.current;
        if (!container) return true;
        if (includeHost && hostChapterEl && hostChapterEl.getAttribute('data-trans-settled') !== '1') {
          return false;
        }
        const targetIdx = hostChapterEl ? Number(hostChapterEl.getAttribute('data-chapter')) : null;
        if (targetIdx === null || Number.isNaN(targetIdx)) return true;
        const chapterEls = container.querySelectorAll('[data-chapter]');
        for (const chEl of chapterEls) {
          const idx = Number(chEl.getAttribute('data-chapter'));
          if (Number.isNaN(idx) || idx >= targetIdx) continue; // only chapters above the anchor
          if (chEl.classList.contains('chapter-placeholder')) continue; // no content yet → cannot grow
          if (chEl.getAttribute('data-trans-loading') === '1') return false;
        }
        return true;
      };

      // Arm a guarded settle watcher after a paragraph jump. Translation batches
      // streaming in later can shift the target; re-verify until stable (two
      // consecutive in-tolerance reads once the surrounding content has finished
      // streaming, so a wave landing between ticks can't fake a settle). Stands
      // down on manual scroll, stability, bottom-clamp, timeout, or a newer jump
      // superseding it.
      const armParaJumpWatcher = (jumpKey, jumpOffset) => {
        clearTimeout(paraJumpRef.current.timer);
        const state = {
          key: jumpKey,
          lastOffset: jumpOffset,
          timer: null,
          deadline: Date.now() + 30000, // payloads can stream several seconds after a deep jump
          stableCount: 0,
          lastScrollHeight: null,
        };
        paraJumpRef.current = state;
        const TOL = 24;
        const GAP = 600;
        const tick = () => {
          const cur = paraJumpRef.current;
          if (!cur || cur.key !== jumpKey) return; // superseded
          const container = containerRef.current;
          if (!container) {
            paraJumpRef.current.key = null;
            return;
          }
          if (Date.now() > cur.deadline) {
            paraJumpRef.current.key = null;
            return;
          }
          // Bottom-clamped targets can never reach top-60 — stand down.
          if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
            paraJumpRef.current.key = null;
            return;
          }
          const target = resolveParaTarget();
          if (!target) {
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          const hostChapter = target.closest ? target.closest('[data-chapter]') : null;
          const areaSettled = areaTranslationSettled(hostChapter);
          const cRect = container.getBoundingClientRect();
          const rRect = target.getBoundingClientRect();
          if (Math.abs(rRect.top - cRect.top - 60) > TOL) {
            cur.stableCount = 0;
            // Target drifted and the user hasn't touched the scroll: correct instantly.
            if (Math.abs(container.scrollTop - cur.lastOffset) > 8) {
              paraJumpRef.current.key = null;
              return;
            }
            const fresh = Math.max(0, rRect.top - cRect.top + container.scrollTop - 60);
            smartScrollTo(container, fresh, { scrollMotion: 'instant' });
            if (settings.pulseAnimation) {
              target.classList.remove('pulse-highlight');
              void target.offsetWidth;
              target.classList.add('pulse-highlight');
            }
            saveTabScroll(activeTab.bookCode, fresh);
            cur.lastOffset = fresh;
            cur.lastScrollHeight = container.scrollHeight;
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          // In tolerance, but the layout may still be growing above the anchor
          // (payloads in flight, chapters inserting) — hold, don't settle yet.
          const layoutChanged =
            cur.lastScrollHeight !== null && container.scrollHeight !== cur.lastScrollHeight;
          cur.lastScrollHeight = container.scrollHeight;
          if (!areaSettled || layoutChanged) {
            cur.stableCount = 0;
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          cur.stableCount += 1;
          if (cur.stableCount >= 2) paraJumpRef.current.key = null;
          else cur.timer = setTimeout(tick, GAP);
        };
        // First check after any in-flight smooth animation has finished (max ~450ms).
        state.timer = setTimeout(tick, 900);
      };

      // Chapter-jump settle watcher (sidebar chapter clicks / chapter-only
      // intents). Shares the same guarded settle behaviour as paragraph jumps so
      // both scroll the same way: re-verify the anchor while translation batches
      // stream in above/below it, correct once the content has settled, and only
      // stand down after two consecutive stable reads. Manual scroll, timeout,
      // bottom-clamp or a newer jump supersede it.
      const armChapterJumpWatcher = (jumpKey, jumpOffset, chapIdx) => {
        clearTimeout(chapterJumpRef.current.timer);
        const state = {
          key: jumpKey,
          lastOffset: jumpOffset,
          timer: null,
          deadline: Date.now() + 30000,
          stableCount: 0,
          lastScrollHeight: null,
        };
        chapterJumpRef.current = state;
        const TOL = 24;
        const GAP = 600;
        const tick = () => {
          const cur = chapterJumpRef.current;
          if (!cur || cur.key !== jumpKey) return; // superseded
          const container = containerRef.current;
          if (!container) {
            chapterJumpRef.current.key = null;
            return;
          }
          if (Date.now() > cur.deadline) {
            chapterJumpRef.current.key = null;
            return;
          }
          const el =
            container.querySelector(`#chap-${chapIdx}`) ||
            container.querySelector(`[data-chapter="${chapIdx}"]`);
          if (!el) {
            chapterJumpRef.current.key = null;
            return;
          }
          // Bottom-clamped targets can never reach top-60 — stand down.
          if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
            chapterJumpRef.current.key = null;
            return;
          }
          const areaSettled = areaTranslationSettled(el, { includeHost: false });
          const cRect = container.getBoundingClientRect();
          const rRect = el.getBoundingClientRect();
          if (Math.abs(rRect.top - cRect.top - 60) > TOL) {
            cur.stableCount = 0;
            // User scrolled meanwhile (or a smooth animation is still running):
            // never yank — just stand down.
            if (Math.abs(container.scrollTop - cur.lastOffset) > 8) {
              chapterJumpRef.current.key = null;
              return;
            }
            const fresh = Math.max(0, rRect.top - cRect.top + container.scrollTop - 60);
            smartScrollTo(container, fresh, { scrollMotion: settings?.scrollMotion || 'fast' });
            saveTabScroll(activeTab.bookCode, fresh);
            cur.lastOffset = fresh;
            cur.lastScrollHeight = container.scrollHeight;
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          // In tolerance, but content may still be growing above the anchor
          // (payloads in flight, chapters inserting) — hold, don't settle yet.
          const layoutChanged =
            cur.lastScrollHeight !== null && container.scrollHeight !== cur.lastScrollHeight;
          cur.lastScrollHeight = container.scrollHeight;
          if (!areaSettled || layoutChanged) {
            cur.stableCount = 0;
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          cur.stableCount += 1;
          if (cur.stableCount >= 2) chapterJumpRef.current.key = null;
          else cur.timer = setTimeout(tick, GAP);
        };
        // First check after any in-flight smooth animation has finished (max ~450ms).
        state.timer = setTimeout(tick, 900);
      };

      // 1. Target paragraph by index (Highest Priority for Translation FTS, Pāḷi FTS, TOC, and para_index targets)
      if (paraIndex !== undefined && paraIndex !== null && paraIndex !== '') {
        const chapterEl = (chapterIdx !== undefined && chapterIdx !== null)
          ? containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`)
          : null;

        // If target chapter element is still a placeholder or not in DOM yet, wait and retry
        if (chapterIdx !== undefined && chapterIdx !== null && (!chapterEl || chapterEl.classList.contains('chapter-placeholder'))) {
          // Chapter HTML still loading/rendering, will retry on next tick
        } else {
          const scope = chapterEl || containerRef.current;
          const el =
            scope.querySelector(`.reader-para-row[data-pindex="${paraIndex}"]`) ||
            scope.querySelector(`[data-pindex="${paraIndex}"]`) ||
            scope.querySelector(`p[data-pindex="${paraIndex}"]`) ||
            scope.querySelector(`[id="pindex-${paraIndex}"]`) ||
            findElement(`pindex-${paraIndex}`);

          if (el) {
            let targetEl = null;
            if (isTransTarget) {
              const row = el.closest('.reader-para-row') || el;
              const transEl =
                row?.querySelector(`.reader-trans-block[data-trans-lang="${targetTransLang}"]`) ||
                row?.querySelector(`[data-trans-lang="${targetTransLang}"]`);

              if (transEl) {
                targetEl = transEl;
              } else {
                // Check if translations for this chapter have already arrived into the DOM
                const chapterHasTranslations = Boolean(
                  (chapterEl || containerRef.current)?.querySelector(`.reader-trans-block[data-trans-lang="${targetTransLang}"]`)
                );
                if (chapterHasTranslations) {
                  // Translation loaded for this chapter, but this specific paragraph has no translation: fall back to Pali
                  targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
                } else if (retries < maxRetries - 5) {
                  // Wait for translation block to finish loading and rendering before jumping
                  targetEl = null;
                } else {
                  targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
                }
              }
            } else {
              targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
            }

            if (targetEl) {
              const containerRect = containerRef.current.getBoundingClientRect();
              const rect = targetEl.getBoundingClientRect();
              const currentScroll = containerRef.current.scrollTop;
              const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
              smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

              if (settings.pulseAnimation) {
                targetEl.classList.remove('pulse-highlight');
                void targetEl.offsetWidth;
                targetEl.classList.add('pulse-highlight');
              }
              const foundPNum = targetEl.getAttribute?.('data-para') || el.getAttribute?.('data-para');
              if (foundPNum) setActiveParaNum(foundPNum);
              saveTabScroll(activeTab.bookCode, offset);
              armParaJumpWatcher(
                `${activeTab.bookCode}:ch${chapterIdx}:pi${paraIndex}:${Date.now()}`,
                offset
              );
              clearTargetScrollIntent();
              return;
            }
          }
        }
      }

      // 2. Target paragraph by number (Bookmarks, History, MAT, and GoTo)
      if (paraNum && (paraIndex === undefined || paraIndex === null || paraIndex === '')) {
        const cleanPara = String(paraNum).replace(/^(?:para-?|p)/i, '').trim();
        const targetInt = parseInt(cleanPara, 10);

        // Ensure the target chapter containing this paragraph is loaded
        const activeSub = subBook || activeTab.sub_book || activeTab.chapter_to_sub_book?.[chapterIdx ?? activeTab.currentChapterIdx ?? 0];
        const targetChap = (chapterIdx !== undefined && chapterIdx !== null)
          ? chapterIdx
          : (activeTab.sub_books_para_to_chapter && activeSub
              ? activeTab.sub_books_para_to_chapter[activeSub]?.[cleanPara]
              : activeTab.para_to_chapter?.[cleanPara]);

        if (targetChap !== undefined && targetChap !== null) {
          if (!activeTab.loadedChapters?.[targetChap] && !activeTab.loadingChapters?.[targetChap]) {
            loadChapter(activeTab.bookCode, targetChap);
            bufferAdjacentChapters(activeTab.bookCode, targetChap);
          }
        }

        let el = null;
        if (activeSub) {
          el =
            findElement(`para${cleanPara}`, `[data-sub-book="${activeSub}"][data-para="${cleanPara}"]`) ||
            findElement(`para-${cleanPara}`, `[data-sub-book="${activeSub}"][data-para="${cleanPara}"]`) ||
            findElement(cleanPara, `[data-sub-book="${activeSub}"][data-para="${cleanPara}"]`);
        }
        if (!el) {
          el =
            findElement(`para${cleanPara}`) ||
            findElement(`para-${cleanPara}`) ||
            findElement(cleanPara) ||
            findElement(null, `p[data-para="${cleanPara}"]`) ||
            findElement(null, `[data-para="${cleanPara}"]`);
        }

        // Check ranged paragraph elements (data-para-first <= targetInt <= data-para-last)
        if (!el && !isNaN(targetInt)) {
          const scope = (chapterIdx !== undefined && chapterIdx !== null)
            ? containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`)
            : containerRef.current;
          if (scope && !scope.classList.contains('chapter-placeholder')) {
            const rangedParas = scope.querySelectorAll('[data-para-first]');
            for (const p of rangedParas) {
              if (activeSub && p.getAttribute('data-sub-book') && p.getAttribute('data-sub-book') !== activeSub) {
                continue;
              }
              const first = parseInt(p.getAttribute('data-para-first'), 10);
              const last = parseInt(p.getAttribute('data-para-last'), 10);
              if (!isNaN(first) && !isNaN(last) && targetInt >= first && targetInt <= last) {
                el = p;
                break;
              }
            }
          }
        }

        // Fallback: nearest paragraph <= targetInt
        if (!el && !isNaN(targetInt)) {
          const scope = (chapterIdx !== undefined && chapterIdx !== null)
            ? containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`)
            : containerRef.current;
          if (scope && !scope.classList.contains('chapter-placeholder')) {
            const allParas = scope.querySelectorAll('[data-para]');
            let bestEl = null;
            let bestDiff = Infinity;
            for (const p of allParas) {
              if (activeSub && p.getAttribute('data-sub-book') && p.getAttribute('data-sub-book') !== activeSub) {
                continue;
              }
              const pNum = parseInt(p.getAttribute('data-para'), 10);
              if (!isNaN(pNum) && pNum <= targetInt) {
                const diff = targetInt - pNum;
                if (diff < bestDiff) {
                  bestDiff = diff;
                  bestEl = p;
                }
              }
            }
            if (bestEl) el = bestEl;
          }
        }

        if (el) {
          let targetEl = null;
          if (isTransTarget) {
            const row = el.closest('.reader-para-row') || el;
            const transEl = row?.querySelector(`.reader-trans-block[data-trans-lang="${targetTransLang}"]`);
            if (transEl) {
              targetEl = transEl;
            } else if (retries < maxRetries - 2) {
              // Translation block still loading/rendering, wait and retry
            } else {
              targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
            }
          } else {
            targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
          }

          if (targetEl) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const rect = targetEl.getBoundingClientRect();
            const currentScroll = containerRef.current.scrollTop;
            const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
            smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

            if (settings.pulseAnimation) {
              targetEl.classList.remove('pulse-highlight');
              void targetEl.offsetWidth;
              targetEl.classList.add('pulse-highlight');
            }
              const foundPNum = targetEl.getAttribute?.('data-para') || el.getAttribute?.('data-para') || cleanPara;
              if (foundPNum) setActiveParaNum(foundPNum);
              saveTabScroll(activeTab.bookCode, offset);
              armParaJumpWatcher(
                `${activeTab.bookCode}:ch${chapterIdx}:pn${cleanPara}:${Date.now()}`,
                offset
              );
              clearTargetScrollIntent();
              return;
          }
        }
      }

      // 2. Target page break
      if (page && pageSystem) {
        const cleanP = String(page).trim();
        const ed = String(pageSystem).toUpperCase();
        let pbEl = null;

        // Direct ID lookup (e.g. V0.0023, P3.0045, V3.0440, V1.0023)
        if (cleanP.includes('.')) {
          const parts = cleanP.split('.');
          const vol = parseInt(parts[0], 10);
          const num = parseInt(parts[1], 10);
          if (!isNaN(vol) && !isNaN(num)) {
            const padded = `${vol}.${String(num).padStart(4, '0')}`;
            pbEl =
              findElement(`${ed}${padded}`) ||
              findElement(`${ed}${cleanP}`) ||
              findElement(null, `[data-ed="${ed}"][data-page="${padded}"]`) ||
              findElement(null, `[data-ed="${ed}"][data-page="${cleanP}"]`);
          }
        } else {
          const num = parseInt(cleanP, 10);
          if (!isNaN(num)) {
            const paddedNum = String(num).padStart(4, '0');
            const knownAnchor =
              activeTab?.page_anchors?.[ed]?.[cleanP] || activeTab?.page_anchors?.[ed]?.[String(num)];
            if (knownAnchor) {
              pbEl = findElement(knownAnchor);
            }
            if (!pbEl) {
              pbEl =
                findElement(null, `[data-ed="${ed}"][data-page$=".${paddedNum}"]`) ||
                findElement(null, `[data-ed="${ed}"][data-page="${paddedNum}"]`) ||
                findElement(null, `[data-ed="${ed}"][data-page="${cleanP}"]`);
            }
          }
        }

        // Robust fallback: resolve page to target paragraph number via targetParaNum or page_to_para
        if (!pbEl) {
          const targetPara = paraNum || activeTab?.page_to_para?.[ed]?.[cleanP];
          if (targetPara !== undefined && targetPara !== null && targetPara !== '') {
            const pClean = String(targetPara).trim();
            pbEl =
              findElement(`para-${pClean}`) ||
              findElement(`para${pClean}`) ||
              findElement(null, `[data-para="${CSS.escape(pClean)}"]`) ||
              findElement(null, `[data-pindex="${CSS.escape(pClean)}"]`);
          }
        }

        if (pbEl) {
          // If pbEl is hidden by CSS (e.g. showPageBreaks is false), resolve to its enclosing paragraph or sentence card
          const targetEl =
            pbEl.getClientRects().length > 0
              ? pbEl
              : pbEl.closest('.reader-para-row, [data-pindex], .sent-pair, p') || pbEl.parentElement || pbEl;

          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = targetEl.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

          if (settings.pulseAnimation) {
            targetEl.classList.remove('pulse-highlight');
            void targetEl.offsetWidth;
            targetEl.classList.add('pulse-highlight');
          }
          const foundPNum =
            targetEl.getAttribute?.('data-para') ||
            targetEl.closest?.('[data-para]')?.getAttribute?.('data-para') ||
            pbEl.getAttribute?.('data-para');
          if (foundPNum) setActiveParaNum(foundPNum);
          saveTabScroll(activeTab.bookCode, offset);
          armParaJumpWatcher(
            `${activeTab.bookCode}:page:${ed}:${cleanP}:${Date.now()}`,
            offset
          );
          clearTargetScrollIntent();
          return;
        }
      }

      // 4. Target chapter header
      if (chapterIdx !== undefined && chapterIdx !== null && !paraNum && (paraIndex === undefined || paraIndex === null || paraIndex === '') && !page) {
        if (chapterIdx === 0) {
          smartScrollTo(containerRef.current, 0, { scrollMotion: settings?.scrollMotion || 'fast' });
          saveTabScroll(activeTab.bookCode, 0);
          const firstP = containerRef.current.querySelector('[data-para]');
          if (firstP) {
            const pNum = firstP.getAttribute('data-para');
            if (pNum) setActiveParaNum(pNum);
          }
          clearTargetScrollIntent();
          return;
        }

        const target =
          containerRef.current.querySelector(`#chap-${chapterIdx}`) ||
          containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`);

        if (target) {
          const containerRect = containerRef.current.getBoundingClientRect();
          const rect = target.getBoundingClientRect();
          const currentScroll = containerRef.current.scrollTop;
          const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
          smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

          // NOTE (Fix 1): no pulse-highlight on whole-chapter jumps — with translation
          // layers enabled the entire chapter flashes and repaints expensively.
          // Pulse is kept for precise targets (search/MAT/bookmark/GoTo/page jumps).

          // Detect first paragraph in the chapter
          const inP = target.querySelector ? target.querySelector('[data-para]') : null;
          if (inP) {
            const pNum = inP.getAttribute('data-para');
            if (pNum) {
              setActiveParaNum(pNum);
            }
          } else {
            let nextEl = target.nextElementSibling;
            while (nextEl) {
              if (nextEl.hasAttribute && nextEl.hasAttribute('data-para')) {
                const pNum = nextEl.getAttribute('data-para');
                if (pNum) {
                  setActiveParaNum(pNum);
                  break;
                }
              }
              const innerP = nextEl.querySelector ? nextEl.querySelector('[data-para]') : null;
              if (innerP) {
                const pNum = innerP.getAttribute('data-para');
                if (pNum) {
                  setActiveParaNum(pNum);
                  break;
                }
              }
              nextEl = nextEl.nextElementSibling;
            }
          }

          saveTabScroll(activeTab.bookCode, offset);

          // Drift correction: lazy translations streaming into chapters above this
          // one can shift it after we measured (the scroll journey itself triggers
          // those loads via the 800px observer margin). A guarded settle watcher
          // re-verifies the landing until the surrounding content has stopped
          // streaming; manual scrolling cancels it via the mount listener above.
          const jumpKey = `${activeTab.bookCode}:ch${chapterIdx}`;
          armChapterJumpWatcher(jumpKey, offset, chapterIdx);

          clearTargetScrollIntent();
          return;
        }
      }

      retries++;
      if (retries < maxRetries) {
        timerId = setTimeout(attemptScroll, 50);
      } else {
        clearTargetScrollIntent();
      }
    };

    timerId = setTimeout(attemptScroll, 40);
    return () => clearTimeout(timerId);
  }, [
    targetScrollIntent,
    activeTab,
    pulseAnimation,
    loadChapter,
    bufferAdjacentChapters,
    saveTabScroll,
    clearTargetScrollIntent,
    setActiveParaNum,
    searchHighlight,
    orderedLayers,
    settings?.scrollMotion,
  ]);


  // Detect active edition page numbers across loaded chapters
  const detectActiveEditionPages = useCallback(() => {
    if (!containerRef.current || !activeTab) return;
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const targetY = containerRect.top + 80;

    const pbElements = container.querySelectorAll('span.pb[data-ed][data-page]');
    if (pbElements.length === 0) return;

    const pages = {};
    const firstSeen = {};

    for (const pb of pbElements) {
      const ed = pb.getAttribute('data-ed');
      const page = pb.getAttribute('data-page');
      if (!ed || !page) continue;

      if (!firstSeen[ed]) {
        firstSeen[ed] = page;
      }

      // If span.pb is hidden with display:none (hide-pb setting), getBoundingClientRect() on pb returns 0.
      // Measuring the host row element gives the exact viewport position in both visible and hidden modes,
      // and in both paragraph mode and sentence mode!
      const hostEl = pb.closest('[data-pindex], .reader-para-row, .sent-pair, p, .chapter-divider') || pb.parentElement || pb;
      const rect = hostEl.getBoundingClientRect();
      if (rect.top <= targetY) {
        pages[ed] = page;
      }
    }

    for (const [ed, firstPage] of Object.entries(firstSeen)) {
      if (!pages[ed]) {
        pages[ed] = firstPage;
      }
    }

    if (Object.keys(pages).length > 0) {
      setActiveEditionPages((prev) => {
        const isDiff =
          Object.keys(pages).some((k) => prev[k] !== pages[k]) ||
          Object.keys(prev).some((k) => prev[k] !== pages[k]);
        return isDiff ? pages : prev;
      });
    }
  }, [activeTab, setActiveEditionPages]);

  // Initial and chapter content change detection
  useEffect(() => {
    const timer = setTimeout(() => {
      detectActiveEditionPages();
    }, 120);
    return () => clearTimeout(timer);
  }, [activeTab?.bookCode, activeTab?.loadedChapters, detectActiveEditionPages]);

  // Direct fast scroll listener — preserves tab scroll & detects active paragraph
  const handleScroll = useCallback(
    (e) => {
      const top = e.target.scrollTop;

      // Immediately update memory scroll on every scroll event (no lag, no lost scroll)
      if (activeTab?.bookCode && activeTab.bookCode !== 'ai_chat') {
        saveTabScroll(activeTab.bookCode, top);
      }

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        if (activeTab && containerRef.current) {

          // Detect active paragraph in reading viewport
          const container = containerRef.current;
          const containerRect = container.getBoundingClientRect();
          const targetY = containerRect.top + 80;


          const paraElements = container.querySelectorAll('p[data-pindex]');
          let foundParaNum = null;
          let foundPIndex = null;
          let foundSnippet = '';
          let foundChapterIdx = activeTab.currentChapterIdx || 0;

          for (const p of paraElements) {
            const rect = p.getBoundingClientRect();
            if (rect.bottom >= targetY) {
              foundPIndex = p.getAttribute('data-pindex');
              foundParaNum = p.getAttribute('data-para');
              if (!foundParaNum) {
                let prev = p.previousElementSibling;
                while (prev) {
                  const prevNum = prev.getAttribute('data-para');
                  if (prevNum) {
                    foundParaNum = prevNum;
                    break;
                  }
                  prev = prev.previousElementSibling;
                }
              }

              // Extract text snippet
              const text = p.textContent?.replace(/\s+/g, ' ').trim() || '';
              if (text) {
                foundSnippet = text.length > 130 ? text.slice(0, 130) + '...' : text;
              }

              // Detect chapter directly from enclosing chapter DOM block first
              const chapBlock = p.closest('[data-chapter]');
              if (chapBlock) {
                const cIdx = parseInt(chapBlock.getAttribute('data-chapter'), 10);
                if (!isNaN(cIdx)) foundChapterIdx = cIdx;
              } else if (foundParaNum && activeTab.sub_books_para_to_chapter && activeTab.sub_book) {
                const subChap = activeTab.sub_books_para_to_chapter[activeTab.sub_book]?.[foundParaNum];
                if (subChap !== undefined) foundChapterIdx = subChap;
              } else if (foundParaNum && activeTab.para_to_chapter?.[foundParaNum] !== undefined) {
                foundChapterIdx = activeTab.para_to_chapter[foundParaNum];
              }
              break;
            }
          }

          // Also scan chapter blocks directly to handle chapter boundaries & headings
          const chapBlocks = container.querySelectorAll('[data-chapter]');
          for (const cb of chapBlocks) {
            const r = cb.getBoundingClientRect();
            if (r.top <= targetY && r.bottom > targetY) {
              const cIdx = parseInt(cb.getAttribute('data-chapter'), 10);
              if (!isNaN(cIdx)) {
                foundChapterIdx = cIdx;
                break;
              }
            }
          }

          if (foundParaNum) {
            setActiveParaNum(foundParaNum);
          }

          // Continuously save tab reading position (chapter, paragraph, scroll offset)
          saveTabPosition(activeTab.bookCode, foundChapterIdx, foundParaNum, top);

          // Automatically record user's exact reading position into History
          addToHistory({
            bookCode: activeTab.bookCode,
            bookTitle: activeTab.title,
            nikaya: activeTab.nikaya,
            chapterIdx: foundChapterIdx,
            chapterTitle: activeTab.chapters?.[foundChapterIdx]?.title || '',
            paraNum: foundParaNum || undefined,
            paraIndex: foundPIndex ? parseInt(foundPIndex, 10) : undefined,
            snippet:
              foundSnippet ||
              `${activeTab.title} — ${activeTab.chapters?.[foundChapterIdx]?.title || `Chapter ${foundChapterIdx + 1}`}${
                foundParaNum ? ` (Para ${foundParaNum})` : ''
              }`,
          });

          detectActiveEditionPages();
        }
      }, 120);
    },
    [activeTab, saveTabScroll, saveTabPosition, setActiveParaNum, detectActiveEditionPages, isSidebarOpen, setIsHeaderVisible, addToHistory]
  );

  const handleReaderClick = useCallback((e) => {
    // 0. Ignore ghost clicks from backdrop/modal dismiss on mobile devices
    if (typeof window !== 'undefined' && window.__tipitaka_dict_just_closed) {
      if (Date.now() - window.__tipitaka_dict_just_closed < 500) {
        return;
      }
    }

    // 1. Ignore clicks on interactive controls (buttons, links, go-to markers)
    if (e.target.closest('button, a, input, select, textarea, [data-goto-type]')) {
      return;
    }

    // 2. Track reading position and active paragraph (supports Pali <p> or translation row when Pali is disabled)
    const pEl = e.target.closest('p[data-pindex], .reader-para-row[data-pindex]');
    if (pEl && activeTab) {
      let pNum = pEl.getAttribute('data-para');
      if (!pNum) {
        let row = pEl.closest('.reader-para-row') || pEl;
        let prev = row.previousElementSibling;
        while (prev) {
          const foundP = prev.matches?.('p[data-para], [data-para]') ? prev : prev.querySelector?.('p[data-para], [data-para]');
          if (foundP) {
            pNum = foundP.getAttribute('data-para');
            if (pNum) break;
          }
          prev = prev.previousElementSibling;
        }
      }
      if (pNum) {
        setActiveParaNum(pNum);
      }
      const pIdx = pEl.getAttribute('data-pindex');
      const chapterBlock = pEl.closest('[data-chapter]');
      let chapIdx = chapterBlock
        ? parseInt(chapterBlock.getAttribute('data-chapter'), 10)
        : (activeTab.currentChapterIdx || 0);
      if (isNaN(chapIdx)) chapIdx = activeTab.currentChapterIdx || 0;
      const text = pEl.textContent?.replace(/\s+/g, ' ').trim() || '';
      const snip = text.length > 130 ? text.slice(0, 130) + '...' : text;

      saveTabPosition(activeTab.bookCode, chapIdx, pNum, containerRef.current?.scrollTop);

      addToHistory({
        bookCode: activeTab.bookCode,
        bookTitle: activeTab.title,
        nikaya: activeTab.nikaya,
        chapterIdx: chapIdx,
        chapterTitle: activeTab.chapters?.[chapIdx]?.title || '',
        paraNum: pNum || undefined,
        paraIndex: pIdx ? parseInt(pIdx, 10) : undefined,
        snippet: snip || `${activeTab.title} — ${activeTab.chapters?.[chapIdx]?.title || `Chapter ${chapIdx + 1}`}`,
      });
    }

    // 3. Single-Click Dictionary Word Lookup
    const isLookupActive = clickToLookupEnabled !== false && settings?.dictLookupTrigger !== 'off';
    const mode = (settings?.dictLookupTrigger && settings.dictLookupTrigger !== 'off')
      ? settings.dictLookupTrigger
      : (clickLookupMode || 'single');

    if (isLookupActive && mode === 'single') {
      const selection = window.getSelection()?.toString()?.trim();
      // Only trigger if not dragging/selecting multiple words
      if (!selection || selection.length <= 1) {
        clearClickedWordHighlight();

        let range = null;
        if (document.caretRangeFromPoint) {
          range = document.caretRangeFromPoint(e.clientX, e.clientY);
        } else if (document.caretPositionFromPoint) {
          const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
          if (pos && pos.offsetNode) {
            range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
          }
        }

        let node = range?.startContainer;
        let offset = range?.startOffset || 0;
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          const child = node.childNodes[offset] || node.lastChild;
          if (child) {
            if (child.nodeType === Node.TEXT_NODE) {
              node = child;
              offset = 0;
            } else {
              const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null, false);
              const textChild = walker.nextNode();
              if (textChild) {
                node = textChild;
                offset = 0;
              }
            }
          }
        }

        if (node && node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent || '';
          const transBlock = node.parentElement?.closest('[data-trans-lang]') || e.target.closest('[data-trans-lang]');
          const transLang = transBlock?.getAttribute('data-trans-lang') || (node.parentElement?.closest('p[data-pindex]') ? 'pali' : 'pali');

          const extracted = extractWordAtOffset(text, offset, transLang);
          if (extracted) {
            const { word: rawWord, start, end } = extracted;
            const wordToLookup = cleanDictionaryQuery(rawWord);
            if (wordToLookup && (wordToLookup.length >= 2 || /\p{L}/u.test(wordToLookup))) {
              const pEl = node.parentElement?.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]') || e.target.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]');
              const blockEl = transBlock || pEl;
              const pIndex = pEl?.getAttribute('data-pindex') || null;
              const pNum = pEl?.getAttribute('data-para') || null;
              const chapEl = pEl?.closest('[data-chapter]');
              const chapIdx = chapEl ? parseInt(chapEl.getAttribute('data-chapter'), 10) : 0;
              const charOffset = blockEl ? getCharOffsetInElement(blockEl, node, start) : start;
              const length = end - start;

              const wordRange = document.createRange();
              wordRange.setStart(node, start);
              wordRange.setEnd(node, end);
              highlightRangeInReader(wordRange);

              // Multi-frame clear to suppress mobile OS asynchronous selection handles / pins
              if (typeof window !== 'undefined') {
                const clearSel = () => {
                  const sel = window.getSelection();
                  if (sel) sel.removeAllRanges();
                };
                clearSel();
                setTimeout(clearSel, 0);
                setTimeout(clearSel, 60);
                setTimeout(clearSel, 160);
              }

              if (activeTab?.bookCode) {
                recordClickedWord(activeTab.bookCode, {
                  chapIdx,
                  pIndex,
                  paraNum: pNum,
                  word: wordToLookup,
                  rawWord,
                  charOffset,
                  length,
                  transLang,
                });
              }

              openDictionary(wordToLookup);
            }
          }
        }
      }
    }
  }, [activeTab, setActiveParaNum, saveTabPosition, addToHistory, clickToLookupEnabled, clickLookupMode, settings?.dictLookupTrigger, openDictionary, recordClickedWord]);

  const handleReaderDoubleClick = useCallback((e) => {
    // 0. Ignore ghost clicks from backdrop/modal dismiss on mobile devices
    if (typeof window !== 'undefined' && window.__tipitaka_dict_just_closed) {
      if (Date.now() - window.__tipitaka_dict_just_closed < 500) {
        return;
      }
    }

    const isLookupActive = clickToLookupEnabled !== false && settings?.dictLookupTrigger !== 'off';
    const mode = (settings?.dictLookupTrigger && settings.dictLookupTrigger !== 'off')
      ? settings.dictLookupTrigger
      : (clickLookupMode || 'single');

    if (!isLookupActive || mode !== 'double') {
      return;
    }

    // 1. Check window selection first
    const selection = window.getSelection()?.toString()?.trim();
    let wordToLookup = '';

    if (selection && selection.length > 0 && selection.length < 50) {
      wordToLookup = cleanDictionaryQuery(selection);
      const sel = window.getSelection();
      let node = null;
      let startOffset = 0;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        node = range.startContainer;
        startOffset = range.startOffset;
        clearClickedWordHighlight();
        const clonedRange = range.cloneRange();
        highlightRangeInReader(clonedRange);
        sel.removeAllRanges();
      }

      if (node && activeTab?.bookCode) {
        const transBlock = node.parentElement?.closest?.('[data-trans-lang]') || e.target.closest('[data-trans-lang]');
        const transLang = transBlock?.getAttribute('data-trans-lang') || (node.parentElement?.closest?.('p[data-pindex]') ? 'pali' : 'pali');
        const pEl = node.parentElement?.closest?.('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]') || e.target.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]');
        const blockEl = transBlock || pEl;
        const pIndex = pEl?.getAttribute('data-pindex') || null;
        const pNum = pEl?.getAttribute('data-para') || null;
        const chapEl = pEl?.closest('[data-chapter]');
        const chapIdx = chapEl ? parseInt(chapEl.getAttribute('data-chapter'), 10) : 0;
        const charOffset = blockEl ? getCharOffsetInElement(blockEl, node, startOffset) : startOffset;
        const length = selection.length;

        recordClickedWord(activeTab.bookCode, {
          chapIdx,
          pIndex,
          paraNum: pNum,
          word: wordToLookup,
          rawWord: selection,
          charOffset,
          length,
          transLang,
        });
      }
    } else {
      // 2. Extract word at click point
      clearClickedWordHighlight();

      let range = null;
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(e.clientX, e.clientY);
      } else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
        if (pos && pos.offsetNode) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      }

      let node = range?.startContainer;
      let offset = range?.startOffset || 0;
      if (node && node.nodeType === Node.ELEMENT_NODE) {
        const child = node.childNodes[offset] || node.lastChild;
        if (child) {
          if (child.nodeType === Node.TEXT_NODE) {
            node = child;
            offset = 0;
          } else {
            const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null, false);
            const textChild = walker.nextNode();
            if (textChild) {
              node = textChild;
              offset = 0;
            }
          }
        }
      }

      if (node && node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const transBlock = node.parentElement?.closest('[data-trans-lang]') || e.target.closest('[data-trans-lang]');
        const transLang = transBlock?.getAttribute('data-trans-lang') || (node.parentElement?.closest('p[data-pindex]') ? 'pali' : 'pali');

        const extracted = extractWordAtOffset(text, offset, transLang);
        if (extracted) {
          const { word: rawWord, start, end } = extracted;
          wordToLookup = cleanDictionaryQuery(rawWord);
          if (wordToLookup && (wordToLookup.length >= 2 || /\p{L}/u.test(wordToLookup))) {
            const pEl = node.parentElement?.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]') || e.target.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]');
            const blockEl = transBlock || pEl;
            const pIndex = pEl?.getAttribute('data-pindex') || null;
            const pNum = pEl?.getAttribute('data-para') || null;
            const chapEl = pEl?.closest('[data-chapter]');
            const chapIdx = chapEl ? parseInt(chapEl.getAttribute('data-chapter'), 10) : 0;
            const charOffset = blockEl ? getCharOffsetInElement(blockEl, node, start) : start;
            const length = end - start;

            const wordRange = document.createRange();
            wordRange.setStart(node, start);
            wordRange.setEnd(node, end);
            highlightRangeInReader(wordRange);

            if (activeTab?.bookCode) {
              recordClickedWord(activeTab.bookCode, {
                chapIdx,
                pIndex,
                paraNum: pNum,
                word: wordToLookup,
                rawWord,
                charOffset,
                length,
                transLang,
              });
            }
          }
        }
      }
    }

    if (wordToLookup && (wordToLookup.length >= 2 || /\p{L}/u.test(wordToLookup))) {
      openDictionary(wordToLookup);
    }
  }, [clickToLookupEnabled, clickLookupMode, settings?.dictLookupTrigger, openDictionary, activeTab, recordClickedWord]);

  const handleBreadcrumbClick = () => {
    document.body.classList.remove('zen-mode');
    setIsSidebarOpen(true);
    setIsHeaderVisible(true);
  };

  const handleNikayaClick = (e) => {
    e.stopPropagation();
    if (containerRef.current) {
      smartScrollTo(containerRef.current, 0, { scrollMotion: settings?.scrollMotion || 'fast' });
    }
  };

  const handleBookClick = (e) => {
    e.stopPropagation();
    if (activeTab?.bookCode) {
      openBook(activeTab.bookCode, {});
    }
  };

  const handleChapterBreadcrumbClick = (e) => {
    e.stopPropagation();
    if (!containerRef.current || activeTab?.currentChapterIdx == null) return;
    const target =
      containerRef.current.querySelector(`#chap-${activeTab.currentChapterIdx}`) ||
      containerRef.current.querySelector(`[data-chapter="${activeTab.currentChapterIdx}"]`);
    if (target) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const currentScroll = containerRef.current.scrollTop;
      const offset = Math.max(0, rect.top - containerRect.top + currentScroll - 60);
      smartScrollTo(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });
      // No pulse-highlight on whole-chapter jumps (see section 4 above).
    }
  };

  const handleChapterVisible = useCallback(
    (chapIdx) => {
      if (!activeTab) return;
      loadChapter(activeTab.bookCode, chapIdx);
      bufferAdjacentChapters(activeTab.bookCode, chapIdx);
    },
    [activeTab, loadChapter, bufferAdjacentChapters]
  );

  const editionStatsList = React.useMemo(() => {
    if (!activeEditionPages || Object.keys(activeEditionPages).length === 0) return [];
    const EDITION_LABELS = {
      M: 'Myanmar',
      V: 'VRI',
      P: 'PTS',
      T: 'Thai',
      O: 'Other',
    };
    const allEditions = ['M', 'V', 'P', 'T', 'O']
      .filter((ed) => activeEditionPages[ed])
      .map((ed) => {
        const rawPage = String(activeEditionPages[ed]);
        let formatted = rawPage;
        if (rawPage.includes('.')) {
          const parts = rawPage.split('.');
          const vol = parseInt(parts[0], 10);
          const pNum = parseInt(parts[1], 10);
          if (!isNaN(vol) && !isNaN(pNum)) {
            formatted = vol === 0 ? String(pNum) : `${vol}.${pNum}`;
          }
        }
        return {
          ed,
          page: formatted,
          label: EDITION_LABELS[ed] || ed,
        };
      });

    if (allEditions.length === 0) return [];

    const defaultEd = settings?.defaultEditionPage || 'M';
    if (defaultEd === 'all') return allEditions;

    const preferred = allEditions.find((item) => item.ed === defaultEd);
    if (preferred) return [preferred];
    return [allEditions[0]];
  }, [activeEditionPages, settings?.defaultEditionPage]);

  const handleQuickBookmark = () => {
    if (!activeTab) return;
    
    // Find current paragraph & snippet robustly
    let currentPara = activeParaNum;
    let currentChapIdx = activeTab.currentChapterIdx || 0;
    let paraSnippet = '';

    if (!currentPara && typeof document !== 'undefined' && containerRef.current) {
      const targetY = containerRef.current.getBoundingClientRect().top + 80;
      const paraElements = containerRef.current.querySelectorAll('p[data-pindex]');
      for (const p of paraElements) {
        const rect = p.getBoundingClientRect();
        if (rect.bottom >= targetY) {
          let pNum = p.getAttribute('data-para');
          if (!pNum) {
            let prev = p.previousElementSibling;
            while (prev) {
              pNum = prev.getAttribute('data-para');
              if (pNum) break;
              prev = prev.previousElementSibling;
            }
          }
          if (pNum) {
            currentPara = pNum;
            break;
          }
        }
      }
    }

    if (typeof document !== 'undefined' && currentPara) {
      const pEl =
        containerRef.current?.querySelector(`[data-para="${currentPara}"]`) ||
        document.querySelector(`[data-para="${currentPara}"]`);
      const chapBlock = pEl?.closest('[data-chapter]');
      if (chapBlock) {
        const cIdx = parseInt(chapBlock.getAttribute('data-chapter'), 10);
        if (!isNaN(cIdx)) currentChapIdx = cIdx;
      }
    }

    const currentChap = activeTab.chapters?.[currentChapIdx];

    if (typeof document !== 'undefined' && currentPara) {
      const pEl =
        containerRef.current?.querySelector(`[data-para="${currentPara}"]`) ||
        document.querySelector(`[data-para="${currentPara}"]`);
      if (pEl) {
        paraSnippet = pEl.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (paraSnippet.length > 130) paraSnippet = paraSnippet.slice(0, 130) + '...';
      }
    }

    const isAlreadyBookmarked = bookmarks.some(
      (b) =>
        b.bookCode === activeTab.bookCode &&
        b.chapterIdx === currentChapIdx &&
        (currentPara ? String(b.paraNum) === String(currentPara) : true)
    );

    if (isAlreadyBookmarked) {
      const existing = bookmarks.find(
        (b) =>
          b.bookCode === activeTab.bookCode &&
          b.chapterIdx === currentChapIdx &&
          (currentPara ? String(b.paraNum) === String(currentPara) : true)
      );
      if (existing) removeBookmark(existing.id);
    } else {
      addBookmark({
        id: `${activeTab.bookCode}_${currentChapIdx}_${currentPara || '0'}`,
        bookCode: activeTab.bookCode,
        bookTitle: activeTab.title,
        nikaya: activeTab.nikaya,
        chapterIdx: currentChapIdx,
        chapterTitle: currentChap?.title || '',
        paraNum: currentPara || undefined,
        snippet:
          paraSnippet ||
          `${activeTab.title} — ${currentChap?.title || `Chapter ${currentChapIdx + 1}`}${
            currentPara ? ` (Para ${currentPara})` : ''
          }`,
      });
    }
  };

  if (!activeTab) {
    return (
      <main className="content-area flex-1 min-h-0 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]">
        <WelcomeView />
      </main>
    );
  }

  // AI Chat tab view
  if (activeTab.type === 'ai_chat' || activeTab.bookCode === 'ai_chat' || activeTab.viewMode === 'ai_chat') {
    return (
      <main className="content-area flex-1 min-h-0 overflow-hidden relative flex flex-col bg-[var(--bg-primary)]">
        <AiChatView initialQuery={activeTab.initialQuery} />
      </main>
    );
  }

  // TOC view — when book opened without specific section
  if (activeTab.viewMode === 'toc' || activeTab.isTocView) {
    return (
      <main className="content-area flex-1 min-h-0 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]">
        <BookTocView />
      </main>
    );
  }

  if (activeTab.isLoading || (!activeTab.chapters?.length && !activeTab.html)) {
    return (
      <main className="content-area flex-1 min-h-0 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]">
        <MeditationLoader
          bookTitle={activeTab.title}
          bookCode={activeTab.bookCode}
          chapterIdx={activeTab.currentChapterIdx}
          paraNum={activeParaNum}
          paliScript={settings?.paliScript}
        />
      </main>
    );
  }

  const currentChap = activeTab.chapters?.[activeTab.currentChapterIdx || 0];
  const isCurrentBookmarked = bookmarks.some(
    (b) =>
      b.bookCode === activeTab.bookCode &&
      b.chapterIdx === (activeTab.currentChapterIdx || 0) &&
      (activeParaNum ? String(b.paraNum) === String(activeParaNum) : true)
  );

  const isContentHeaderHidden = !isHeaderVisible && !isSidebarOpen;

  return (
    <div className="reader-view-panel flex-1 min-h-0 flex flex-col relative overflow-hidden bg-[var(--bg-primary)]">
      {/* Dynamic Auto-Hiding Breadcrumbs Bar (Outside of main scroll area to prevent jitter/shaking) */}
      <div
        ref={contentHeaderRef}
        className={`content-header z-30 transition-all duration-200 flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] text-xs select-none shrink-0 ${
          isContentHeaderHidden ? 'hidden-scroll' : ''
        }`}
      >
        <div
          className="breadcrumbs truncate text-xs flex-1 flex items-center gap-1.5 cursor-pointer"
          onClick={handleBreadcrumbClick}
          title="Click to reveal full navigation and sidebar"
        >
          {(activeTab.nikaya || activeTab.category) && (
            <>
              <span
                onClick={handleNikayaClick}
                className="truncate opacity-75 hover:opacity-100 hover:text-[var(--accent)] cursor-pointer hover:underline transition-colors"
                title="Scroll to top"
              >
                {convertPaliScript(capitalizePali(activeTab.nikaya || activeTab.category), settings?.paliScript)}
              </span>
              <span className="opacity-40 select-none">›</span>
            </>
          )}
          <span
            onClick={handleBookClick}
            className="current truncate font-semibold text-[var(--accent)] hover:underline cursor-pointer transition-colors"
            title="Open book outline"
          >
            {convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript)}
          </span>
          {currentChap && capitalizePali(currentChap.title) !== capitalizePali(activeTab.title) && (
            <>
              <span className="opacity-40 select-none">›</span>
              <span
                onClick={handleChapterBreadcrumbClick}
                className="truncate text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer hover:underline transition-colors"
                title="Scroll to chapter"
              >
                {convertPaliScript(capitalizePali(currentChap.title), settings?.paliScript)}
              </span>
            </>
          )}
        </div>

        {/* Right Controls: Live Edition Page Stats + Quick Bookmark */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Subtle Live Page Statistics for all editions */}
          {editionStatsList.length > 0 && (
            <div
              onClick={() => openGoToModal('page', null)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-[var(--border-color)]/60 hover:border-[var(--border-color)] transition cursor-pointer shrink-0 select-none font-mono"
              title="Current Reading Page across Editions • Click to Go to Page"
            >
              <span className="text-[9px] sm:text-[9.5px] font-sans font-semibold uppercase tracking-wider text-[var(--text-secondary)] opacity-70">
                P:
              </span>
              <div className="flex items-center gap-1">
                {editionStatsList.map(({ ed, page, label }, idx) => (
                  <React.Fragment key={ed}>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        openGoToModal('page', ed);
                      }}
                      className="inline-flex items-center gap-0.5 hover:text-[var(--accent)] hover:underline transition"
                      title={`${label}: Page ${page}`}
                    >
                      <strong className="font-semibold text-[var(--text-secondary)]">{ed}</strong>
                      <span className="opacity-90">{page}</span>
                    </span>
                    {idx < editionStatsList.length - 1 && (
                      <span className="opacity-30 text-[8px]">•</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}


          {/* Quick Bookmark Button in Breadcrumb Header */}
          <button
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition shrink-0 cursor-pointer"
            onClick={handleQuickBookmark}
            title={
              isCurrentBookmarked
                ? `Bookmarked${activeParaNum ? ` (Para ${activeParaNum})` : ''} — Click to remove`
                : `Bookmark this place${activeParaNum ? ` (Para ${activeParaNum})` : ''}`
            }
          >
            {isCurrentBookmarked ? (
              <BookmarkCheck size={14} className="text-[var(--accent)]" />
            ) : (
              <Bookmark size={14} />
            )}
          </button>

          {/* Recent Opened Books Button in Breadcrumb Header */}
          <button
            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition shrink-0 cursor-pointer"
            onClick={() => setIsHistoryOpen(true)}
            title="Recent opened books"
            aria-label="Recent opened books"
          >
            <History size={14} />
          </button>
        </div>
      </div>

      {/* Main Scrollable Reading Container */}
      <main
        className="content-area flex-1 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]"
        ref={containerRef}
        onScroll={handleScroll}
      >
        {/* Dynamic Translation Colors CSS Rules */}
        {settings?.translationColors && Object.keys(settings.translationColors).length > 0 && (
          <style
            dangerouslySetInnerHTML={{
              __html: Object.entries(settings.translationColors)
                .map(([langKey, colors]) => {
                  if (!colors) return '';
                  const code = LANG_KEY_TO_CODE[langKey] || langKey;
                  const bg = formatCssColor(colors.bg);
                  const border = formatCssColor(colors.border);
                  const text = formatCssColor(colors.text);
                  const cssRules = [];
                  if (bg) {
                    cssRules.push(`background-color: ${bg} !important;`);
                  }
                  if (border) {
                    cssRules.push(`border-left-color: ${border} !important;`);
                  }
                  const blockCss =
                    cssRules.length > 0
                      ? `
                    .reader-trans-block[data-trans-lang="${langKey}"],
                    .reader-trans-block[data-trans-lang="${code}"] {
                      ${cssRules.join('\n')}
                    }
                  `
                      : '';
                  const textCss = text
                    ? `
                    .reader-trans-block[data-trans-lang="${langKey}"] .reader-trans-content,
                    .reader-trans-block[data-trans-lang="${code}"] .reader-trans-content,
                    .reader-trans-block[data-trans-lang="${langKey}"] .reader-nissaya-meaning,
                    .reader-trans-block[data-trans-lang="${code}"] .reader-nissaya-meaning,
                    .reader-trans-block[data-trans-lang="${langKey}"] p,
                    .reader-trans-block[data-trans-lang="${code}"] p {
                      color: ${text} !important;
                    }
                  `
                    : '';
                  return blockCss + textCss;
                })
                .join('\n'),
            }}
          />
        )}

        {/* Lazy-Loaded Chapter Content Stream */}
        <div
          className="reader-wrapper flex-1 flex justify-center px-3 sm:px-6"
          onClick={handleReaderClick}
          onDoubleClick={handleReaderDoubleClick}
        >
          <div
            className="reader-container w-full"
            style={{
              maxWidth:
                (settings?.translationDisplayMode === 'side' || settings?.translationDisplayMode === 'side_rev') &&
                ((isPaliEnabled && activeLangs.length > 0) || (!isPaliEnabled && activeLangs.length >= 2))
                  ? '1400px'
                  : 'var(--reader-max-width, 880px)',
            }}
          >
            {activeTab.chapters && activeTab.chapters.length > 0 ? (
              activeTab.chapters.map((chap) => (
                <ChapterBlock
                  key={`${activeTab.bookCode}_${chap.chapter_index}`}
                  chapter={chap}
                  bookCode={activeTab.bookCode}
                  html={activeTab.loadedChapters?.[chap.chapter_index]}
                  isLoading={Boolean(activeTab.loadingChapters?.[chap.chapter_index])}
                  onVisible={handleChapterVisible}
                  isCurrentOrTarget={
                    activeTab.currentChapterIdx === chap.chapter_index ||
                    targetScrollIntent?.chapterIdx === chap.chapter_index ||
                    (chap.chapter_index === 0 && (activeTab.currentChapterIdx === null || activeTab.currentChapterIdx === undefined) && !targetScrollIntent?.chapterIdx)
                  }
                  paliScript={settings?.paliScript}
                  searchHighlight={searchHighlight}
                  highlightSearchTerms={settings?.highlightSearchTerms ?? true}
                  activeLangs={activeLangs}
                  orderedLayers={orderedLayers}
                  isPaliEnabled={isPaliEnabled}
                  translationDisplayMode={settings?.translationDisplayMode || 'stack'}
                  translationColors={settings?.translationColors}
                  sentenceMode={settings?.translationGranularity === 'sentence'}
                />
              ))
            ) : (
              <div
                dangerouslySetInnerHTML={{
                  __html: (function () {
                    if (!activeTab.html) return '';
                    let processed = activeTab.html;
                    if (settings?.paliScript && settings.paliScript !== 'roman') {
                      processed = transliterateHtml(processed, settings.paliScript);
                    }
                    const isPali = isSearchPali(searchHighlight);
                    if ((settings?.highlightSearchTerms ?? true) && searchHighlight?.query && searchHighlight.query.trim() && isPali) {
                      processed = highlightHtmlText(
                        processed,
                        searchHighlight.query.trim(),
                        settings?.paliScript,
                        searchHighlight.paraIndex,
                        searchHighlight.paraNum
                      );
                    }
                    return processed;
                  })(),
                }}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
