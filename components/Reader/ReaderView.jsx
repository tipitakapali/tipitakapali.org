'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo } from 'react';
import { Bookmark, BookmarkCheck, History, X, Columns } from 'lucide-react';
import WelcomeView from './WelcomeView';
import MeditationLoader from './MeditationLoader';
import BookTocView from './BookTocView';
import LinkedDefinitionModal from './LinkedDefinitionModal';
import AiChatView from '../AiChat/AiChatView';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings, getDefaultTranslationColorsForTheme } from '../../context/ThemeSettingsContext';
import { useDictionary } from '../../context/DictionaryContext';

import { transliterateHtml, convertPaliScript, highlightHtmlText, highlightTranslationText, capitalizePali, convertAnyToRoman, cleanDictionaryQuery } from '../../services/transliterate';
import { smartScrollTo, cancelSmartScroll } from '../../services/scroll';
import {
  fetchChapterTranslations,
  fetchPaliSentences,
  fetchChapterLinks,
  fetchChapterBundle,
  isLocalDynamicHost,
  getCachedChapterTranslations,
  getCachedPaliSentences,
  getCachedChapterLinks,
  prefetchLinkedPreview,
  prefetchLinkedPreviewsBatch,
} from '../../services/api';

export function computeAnchorScrollTarget({
  elementTopViewport = 0,
  viewportTop = 0,
  currentScroll = 0,
  stickyInset = 56,
}) {
  return Math.max(0, elementTopViewport - viewportTop + currentScroll - stickyInset);
}

export function computeBlockCompensationDelta({
  rectTopAfter = 0,
  rectHeightAfter = 0,
  subRatio = 0,
  anchorViewportYBefore = 0,
}) {
  const safeRatio = Math.max(0, Math.min(1, Number.isFinite(subRatio) ? subRatio : 0));
  const currentAnchorY = rectTopAfter + safeRatio * Math.max(0, rectHeightAfter);
  return currentAnchorY - anchorViewportYBefore;
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Compensate scrollTop synchronously when a chunk strictly above the viewport
// changes height (e.g. placeholder -> mounted HTML or async link chips) because
// iOS WKWebView has no native scroll anchoring and main.content-area sets
// overflow-anchor: none.
export function computeAboveViewportScrollDelta({
  rectTop = 0,
  rectBottom = 0,
  prevHeight = 0,
  nextHeight = 0,
  viewportTop = 0,
}) {
  if (!(prevHeight > 0) || !(nextHeight > 0)) return 0;
  const delta = nextHeight - prevHeight;
  if (Math.abs(delta) < 2) return 0;
  const oldBottom = rectBottom - delta;
  if (rectTop < viewportTop && oldBottom <= viewportTop + 4) {
    return delta;
  }
  return 0;
}

export function pickBestSearchHitAnchor(
  row,
  { isTransTarget = false, targetTransLang = null, vpHeight = 700 } = {}
) {
  if (!row || !row.querySelector) return null;
  const isMeasurable = (el) =>
    Boolean(el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);

  let hitEl = null;
  if (isTransTarget && targetTransLang) {
    const cand =
      row.querySelector(`.reader-trans-block[data-trans-lang="${targetTransLang}"] mark.search-hit`) ||
      row.querySelector(`.reader-trans-block[data-trans-lang="${targetTransLang}"] .search-hit`);
    if (isMeasurable(cand)) hitEl = cand;
  } else {
    const hits = row.querySelectorAll('mark.search-hit, .search-hit');
    for (const h of hits) {
      if (h.closest?.('.sent-pair-trans, .reader-trans-block:not(.reader-pali-trans-block):not(.sent-pair-pali)')) continue;
      if (isMeasurable(h)) {
        hitEl = h;
        break;
      }
    }
  }
  if (!hitEl) {
    const anyHit = row.querySelector('mark.search-hit, .search-hit');
    if (isMeasurable(anyHit)) hitEl = anyHit;
  }
  if (!hitEl) return null;

  const lineBlock =
    hitEl.closest?.('.sent-pair') ||
    hitEl.closest?.('.pali-sent') ||
    hitEl.closest?.('.reader-trans-block') ||
    hitEl;
  if (!isMeasurable(lineBlock) || lineBlock === hitEl) {
    return hitEl;
  }

  const maxComfortSpan = Math.max(180, (Number.isFinite(vpHeight) && vpHeight > 0 ? vpHeight : 700) * 0.45);
  const blockRect = lineBlock.getBoundingClientRect();
  const hitRect = hitEl.getBoundingClientRect();
  if (hitRect.bottom - blockRect.top > maxComfortSpan) {
    return hitEl;
  }
  return lineBlock;
}

function normalizePassageProbe(raw, paliScript = 'roman') {
  if (!raw) return '';
  let text = String(raw)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (paliScript && paliScript !== 'roman') {
    try {
      text = convertPaliScript(text, paliScript);
    } catch (_) {}
  }
  return text.replace(/\s+/g, ' ').trim();
}

function stripPassageEdgePunct(str) {
  return String(str || '')
    .replace(/^[\s.,;:!?…—–\-_'"‘’“”«»()\[\]{}၊။]+|[\s.,;:!?…—–\-_'"‘’“”«»()\[\]{}၊။]+$/g, '')
    .trim();
}

function buildPaliTextNodeMap(rootEl, { targetTransLang = null } = {}) {
  const charMap = [];
  let normText = '';
  let prevWasSpace = true;

  const isIgnoredElement = (node) => {
    if (!node || node.nodeType !== 1) return false;
    if (typeof node.matches === 'function') {
      if (targetTransLang) {
        if (node.matches('.note, .paranum, .dot, .pb, .linked-def-row, .sent-pair-pali, .reader-pali-trans-block')) {
          return true;
        }
        const transLangAttr = node.getAttribute?.('data-trans-lang');
        if (transLangAttr && transLangAttr !== targetTransLang) return true;
        return false;
      }
      return node.matches(
        '.note, .paranum, .dot, .pb, .linked-def-row, .sent-pair-trans, .reader-trans-block:not(.reader-pali-trans-block):not(.sent-pair-pali)'
      );
    }
    const cls = String(node.className || '');
    return /\b(?:note|paranum|dot|pb|linked-def-row)\b/.test(cls);
  };

  const isBlockOrSentBoundary = (node) => {
    if (!node || node.nodeType !== 1) return false;
    const tag = String(node.tagName || '').toUpperCase();
    if (tag === 'P' || tag === 'DIV' || tag === 'BR') return true;
    const cls = String(node.className || '');
    return /\b(?:pali-sent|trans-sent|sent-pair)\b/.test(cls);
  };

  const walk = (node) => {
    if (!node) return;
    if (node.nodeType === 3) {
      const txt = node.textContent || '';
      for (let i = 0; i < txt.length; i++) {
        const ch = txt[i];
        if (/\s/.test(ch)) {
          if (!prevWasSpace) {
            normText += ' ';
            charMap.push({ node, offset: i });
            prevWasSpace = true;
          }
        } else {
          normText += ch;
          charMap.push({ node, offset: i });
          prevWasSpace = false;
        }
      }
      return;
    }
    if (node.nodeType !== 1 || isIgnoredElement(node)) return;
    const isBoundary = isBlockOrSentBoundary(node);
    const children = node.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i++) {
        walk(children[i]);
      }
    }
    if (isBoundary && !prevWasSpace && charMap.length > 0) {
      const last = charMap[charMap.length - 1];
      normText += ' ';
      charMap.push(last);
      prevWasSpace = true;
    }
  };

  walk(rootEl);
  if (normText.endsWith(' ')) {
    normText = normText.slice(0, -1);
    charMap.pop();
  }
  return { normText, charMap };
}

export function findPassageSubTarget(
  row,
  { word = null, bold = null, snippet = null, paliScript = 'roman', isTransTarget = false, targetTransLang = null } = {}
) {
  if (!row) return null;
  const isMeasurable = (el) =>
    Boolean(el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);

  if (isTransTarget) {
    if (!snippet || !targetTransLang) return null;
    const cleanTransSnip = stripPassageEdgePunct(
      String(snippet)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\.\.\.|…/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    ).toLowerCase();
    if (!cleanTransSnip || cleanTransSnip.length < 4) return null;
    const { normText, charMap } = buildPaliTextNodeMap(row, { targetTransLang });
    if (!normText || charMap.length === 0) return null;
    const lowerTrans = normText.toLowerCase();
    const transProbes = [];
    for (const seg of String(snippet)
      .replace(/<[^>]+>/g, ' ')
      .split(/\.\.\.|…/)
      .map((s) => stripPassageEdgePunct(s.replace(/\s+/g, ' ').trim()).toLowerCase())
      .filter((s) => s.length >= 6)) {
      if (seg.length > 64) transProbes.push(seg.slice(0, 64));
      transProbes.push(seg);
    }
    if (cleanTransSnip.length >= 6) transProbes.push(cleanTransSnip.slice(0, 48));
    for (const probe of transProbes) {
      const idx = lowerTrans.indexOf(probe);
      if (idx !== -1 && typeof document !== 'undefined' && typeof document.createRange === 'function') {
        const startRef = charMap[idx];
        const endRef = charMap[Math.min(charMap.length - 1, idx + probe.length - 1)];
        if (startRef?.node && endRef?.node) {
          const sentPair = startRef.node.parentElement?.closest?.('.sent-pair');
          if (sentPair && isMeasurable(sentPair)) {
            return { element: sentPair, range: null, anchor: sentPair };
          }
          try {
            const range = document.createRange();
            range.setStart(startRef.node, startRef.offset);
            range.setEnd(endRef.node, endRef.offset + 1);
            if (typeof range.getClientRects === 'function' && range.getClientRects().length > 0) {
              return {
                element: null,
                range: null,
                anchor: {
                  getBoundingClientRect: () => range.getBoundingClientRect(),
                  getClientRects: () => range.getClientRects(),
                  closest: (sel) => (startRef.node.parentElement || row)?.closest?.(sel) || null,
                  classList: null,
                  getAttribute: () => null,
                  hostRow: row,
                },
              };
            }
          } catch (_) {}
        }
      }
    }
    return null;
  }

  const normBold = stripPassageEdgePunct(normalizePassageProbe(bold, paliScript)).toLowerCase();
  const normWord = stripPassageEdgePunct(normalizePassageProbe(word, paliScript)).toLowerCase();
  const normSnippet = normalizePassageProbe(snippet, paliScript).toLowerCase();
  if (!normBold && !normWord && !normSnippet) return null;

  // 1. Match <strong class="bld"> / bold term spans directly inside Pāḷi paragraph
  if ((normBold || normWord) && typeof row.querySelectorAll === 'function') {
    const boldNodes = row.querySelectorAll('strong.bld, .bld, strong, b');
    const matchedBoldEls = [];
    const stripTi = (s) => s.replace(/(?:nti|ti)$/i, '').replace(/ṃ$/i, 'm');

    for (const bEl of boldNodes) {
      if (
        bEl.closest?.(
          '.paranum, .sent-paranum, .linked-def-row, .sent-pair-trans, .reader-trans-block:not(.reader-pali-trans-block):not(.sent-pair-pali)'
        )
      ) {
        continue;
      }
      if (!isMeasurable(bEl)) continue;
      const bTxt = stripPassageEdgePunct((bEl.textContent || '').replace(/\s+/g, ' ')).toLowerCase();
      if (!bTxt) continue;
      const bStem = stripTi(bTxt);
      let score = 0;
      if (normBold && bTxt === normBold) score = 100;
      else if (normWord && bTxt === normWord) score = 95;
      else if (normBold && bStem && bStem === stripTi(normBold)) score = 90;
      else if (normWord && bStem && bStem === stripTi(normWord)) score = 85;
      else if (normBold && normBold.length >= 2 && (bTxt.includes(normBold) || normBold.includes(bTxt))) score = 75;
      else if (normWord && normWord.length >= 2 && (bTxt.includes(normWord) || normWord.includes(bTxt))) score = 70;
      if (score > 0) {
        matchedBoldEls.push({ el: bEl, score });
      }
    }

    if (matchedBoldEls.length === 1) {
      return { element: matchedBoldEls[0].el, range: null, anchor: matchedBoldEls[0].el };
    }
    if (matchedBoldEls.length > 1) {
      if (normSnippet) {
        const boldIdxInSnip = normBold ? normSnippet.indexOf(normBold) : -1;
        const tailProbe = (boldIdxInSnip >= 0 ? normSnippet.slice(boldIdxInSnip) : normSnippet).slice(0, 48);
        const leadProbe = boldIdxInSnip > 2 ? normSnippet.slice(Math.max(0, boldIdxInSnip - 24), boldIdxInSnip).trim() : '';
        for (const item of matchedBoldEls) {
          let afterText = item.el.textContent || '';
          let sib = item.el.nextSibling;
          while (sib && afterText.length < 140) {
            if (sib.nodeType === 3 || (sib.nodeType === 1 && !sib.classList?.contains('pb'))) {
              afterText += sib.textContent || '';
            }
            sib = sib.nextSibling;
          }
          const nextTxt = normalizePassageProbe(afterText, 'roman').toLowerCase();
          const nextInScript =
            paliScript && paliScript !== 'roman'
              ? normalizePassageProbe(afterText, paliScript).toLowerCase()
              : nextTxt;
          const prefixCheck = tailProbe.slice(0, Math.min(28, tailProbe.length));
          if (prefixCheck && (nextInScript.startsWith(prefixCheck) || nextTxt.startsWith(prefixCheck))) {
            item.score += 60;
          } else if (prefixCheck && (nextInScript.includes(prefixCheck) || nextTxt.includes(prefixCheck))) {
            item.score += 15;
          }
          if (leadProbe) {
            let beforeText = '';
            let prev = item.el.previousSibling;
            while (prev && beforeText.length < 60) {
              if (prev.nodeType === 3 || (prev.nodeType === 1 && !prev.classList?.contains('pb'))) {
                beforeText = (prev.textContent || '') + beforeText;
              }
              prev = prev.previousSibling;
            }
            const prevNorm = normalizePassageProbe(beforeText, paliScript).toLowerCase();
            if (prevNorm.endsWith(leadProbe)) {
              item.score += 25;
            }
          }
        }
      }
      matchedBoldEls.sort((a, b) => b.score - a.score);
      return { element: matchedBoldEls[0].el, range: null, anchor: matchedBoldEls[0].el };
    }
  }

  // 2. Match Pāḷi sentence snippet or bold/word phrase in text nodes via DOM Range
  const paliRoot =
    typeof row.matches === 'function' && row.matches('p')
      ? row
      : row.querySelector?.('.reader-sent-pairs')
        ? row
        : row.querySelector?.('.reader-pali-trans-block p, p[data-pindex]') || row;
  const { normText, charMap } = buildPaliTextNodeMap(paliRoot);
  if (!normText || charMap.length === 0) return null;

  const lowerText = normText.toLowerCase();
  const probes = [];
  if (normSnippet) {
    const cleanSnip = stripPassageEdgePunct(normSnippet);
    if (cleanSnip.length >= 4) probes.push(cleanSnip.slice(0, 96));
    if (cleanSnip.length > 48) probes.push(cleanSnip.slice(0, 48));
    if (cleanSnip.length > 24) probes.push(cleanSnip.slice(0, 24));
  }
  if (normBold && normBold.length >= 2) probes.push(normBold);
  if (normWord && normWord.length >= 2) probes.push(normWord);

  let matchStart = -1;
  let matchLen = 0;
  for (const p of probes) {
    if (!p) continue;
    const idx = lowerText.indexOf(p);
    if (idx !== -1) {
      matchStart = idx;
      matchLen = p.length;
      break;
    }
  }

  if (
    matchStart >= 0 &&
    matchLen > 0 &&
    typeof document !== 'undefined' &&
    typeof document.createRange === 'function'
  ) {
    const startRef = charMap[matchStart];
    const endRef = charMap[Math.min(charMap.length - 1, matchStart + matchLen - 1)];
    if (startRef?.node && endRef?.node) {
      try {
        const range = document.createRange();
        range.setStart(startRef.node, startRef.offset);
        range.setEnd(endRef.node, endRef.offset + 1);
        if (typeof range.getClientRects === 'function' && range.getClientRects().length > 0) {
          const anchor = {
            getBoundingClientRect: () => range.getBoundingClientRect(),
            getClientRects: () => range.getClientRects(),
            closest: (sel) => (startRef.node.parentElement || paliRoot || row)?.closest?.(sel) || null,
            classList: null,
            getAttribute: () => null,
            range,
            hostRow: row,
          };
          return { element: null, range, anchor };
        }
      } catch (_) {}
    }
  }

  return null;
}

export function resolveMeasurablePbAnchor(pbEl, sentenceMode = false) {
  if (!pbEl) return null;
  const hasRects = (el) => Boolean(el && typeof el.getClientRects === 'function' && el.getClientRects().length > 0);
  if (sentenceMode) {
    const sentPair = pbEl.closest?.('.sent-pair');
    if (hasRects(sentPair)) return sentPair;
  }
  if (hasRects(pbEl)) return pbEl;

  // When page breaks are hidden via CSS (e.g. body.hide-pb), locate the exact adjacent text
  // node inside the enclosing paragraph so multi-screen paragraphs still land at the exact line.
  if (typeof document !== 'undefined' && typeof document.createRange === 'function' && pbEl.parentNode) {
    const hostRow = pbEl.closest?.('.reader-para-row, [data-pindex], .sent-pair, p') || pbEl.parentElement || pbEl;
    const findFirstVisibleChar = (startNode, forward = true) => {
      let cur = startNode;
      let steps = 0;
      while (cur && steps < 24) {
        steps++;
        if (cur.nodeType === 3) {
          const txt = cur.textContent || '';
          const idx = forward ? txt.search(/\S/) : txt.trimEnd().length - 1;
          if (idx >= 0 && idx < txt.length) {
            try {
              const r = document.createRange();
              r.setStart(cur, idx);
              r.setEnd(cur, idx + 1);
              if (r.getClientRects?.().length > 0) return r;
            } catch (_) {}
          }
        } else if (cur.nodeType === 1 && !cur.classList?.contains('pb') && hasRects(cur)) {
          if (cur.firstChild) {
            const inner = findFirstVisibleChar(forward ? cur.firstChild : cur.lastChild, forward);
            if (inner) return inner;
          }
          return cur;
        }
        cur = forward ? cur.nextSibling : cur.previousSibling;
      }
      return null;
    };

    const hit =
      findFirstVisibleChar(pbEl.nextSibling, true) || findFirstVisibleChar(pbEl.previousSibling, false);
    if (hit) {
      if (hit.nodeType === 1) return hit;
      return {
        getBoundingClientRect: () => hit.getBoundingClientRect(),
        getClientRects: () => hit.getClientRects(),
        closest: (sel) => hostRow?.closest?.(sel) || null,
        classList: null,
        getAttribute: () => null,
        hostRow,
      };
    }
  }

  return pbEl.closest?.('.reader-para-row, [data-pindex], .sent-pair, p') || pbEl.parentElement || pbEl;
}

// Batch-evaluate multiple chunk height changes (in ascending DOM order) from a
// single commit so we perform all DOM reads before a single scrollTop write
// without interleaved read->write layout thrashing, adjusting subsequent chunk
// rects for cumulative height shifts across all earlier items in the commit.
export function computeBatchedAboveViewportScrollDelta(items, viewportTop = 0) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  let totalDelta = 0;
  let cumulativeShift = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const itemDelta =
      item.prevHeight > 0 && item.nextHeight > 0 ? item.nextHeight - item.prevHeight : 0;
    const delta = computeAboveViewportScrollDelta({
      rectTop: item.rectTop - cumulativeShift,
      rectBottom: item.rectBottom - cumulativeShift,
      prevHeight: item.prevHeight,
      nextHeight: item.nextHeight,
      viewportTop,
    });
    if (delta !== 0) {
      totalDelta += delta;
    }
    cumulativeShift += itemDelta;
  }
  return totalDelta;
}

// Peak/trough scroll-direction state machine for header/footer auto-hide.
// Tolerates mobile sub-pixel touch jitter and iOS bottom rubber-band overscroll
// while guaranteeing reliable hide on downward scroll and reveal on upward scroll.
export function computeNextHeaderVisibility({
  top = 0,
  isHeaderVisible = true,
  upPeakY = 0,
  downPeakY = 0,
  viewportHeight = 0,
  scrollHeight = 0,
  isJumping = false,
}) {
  const safeTop = Number.isFinite(top) ? top : 0;
  const hasRange = scrollHeight > viewportHeight && viewportHeight > 0;
  const maxScroll = hasRange ? Math.max(0, scrollHeight - viewportHeight) : Math.max(0, safeTop);
  const clampedTop = Math.max(0, Math.min(safeTop, maxScroll));
  const isBottomOverscroll = hasRange && safeTop > maxScroll + 1;

  if (viewportHeight > 0 && scrollHeight > 0 && maxScroll <= 80) {
    return { nextVisible: true, upPeakY: clampedTop, downPeakY: clampedTop };
  }

  if (isJumping) {
    const nextVisible = clampedTop <= 24 ? true : isHeaderVisible;
    return { nextVisible, upPeakY: clampedTop, downPeakY: clampedTop };
  }

  if (clampedTop <= 24) {
    return { nextVisible: true, upPeakY: clampedTop, downPeakY: clampedTop };
  }

  if (isHeaderVisible) {
    const baseUp = Number.isFinite(upPeakY) ? Math.min(upPeakY, clampedTop) : clampedTop;
    if (clampedTop > 64 && clampedTop - baseUp >= 36) {
      return { nextVisible: false, upPeakY: clampedTop, downPeakY: clampedTop };
    }
    return { nextVisible: true, upPeakY: baseUp, downPeakY: clampedTop };
  }

  if (isBottomOverscroll) {
    const baseDown = Number.isFinite(downPeakY) ? Math.max(downPeakY, maxScroll) : maxScroll;
    return { nextVisible: false, upPeakY: clampedTop, downPeakY: baseDown };
  }

  const baseDown = Number.isFinite(downPeakY) ? Math.max(downPeakY, clampedTop) : clampedTop;
  if (baseDown - clampedTop >= 24) {
    return { nextVisible: true, upPeakY: clampedTop, downPeakY: clampedTop };
  }
  return { nextVisible: false, upPeakY: clampedTop, downPeakY: baseDown };
}

const READER_CLICKED_WORD_HIGHLIGHT = 'reader-clicked-word';
let activeClickedWordRange = null;

export function selectClickedWordAnchor(container, bandTop = 0, bandBottom = Infinity) {
  if (!container) return null;
  const clickedEl = container.querySelector?.('.reader-clicked-word, [data-clicked-word="true"]');
  if (clickedEl && clickedEl.getBoundingClientRect) {
    const cr = clickedEl.getBoundingClientRect();
    if (cr.height > 0 && cr.bottom > bandTop && cr.top < bandBottom) {
      return {
        anchorEl: clickedEl,
        subRatio: 0.5,
        viewportY: cr.top + 0.5 * cr.height,
      };
    }
  }
  if (
    activeClickedWordRange &&
    activeClickedWordRange.startContainer?.isConnected &&
    activeClickedWordRange.endContainer?.isConnected &&
    typeof container.contains === 'function' &&
    container.contains(activeClickedWordRange.commonAncestorContainer) &&
    typeof activeClickedWordRange.getBoundingClientRect === 'function'
  ) {
    const range = activeClickedWordRange;
    const cr = range.getBoundingClientRect();
    if (cr.height > 0 && cr.bottom > bandTop && cr.top < bandBottom) {
      return {
        anchorEl: {
          get isConnected() {
            return Boolean(range.startContainer?.isConnected && range.endContainer?.isConnected);
          },
          getBoundingClientRect: () => range.getBoundingClientRect(),
        },
        subRatio: 0.5,
        viewportY: cr.top + 0.5 * cr.height,
      };
    }
  }
  return null;
}

export function isPointInsideRangeRects(range, clientX, clientY, tolerance = 4) {
  if (!range || typeof range.getClientRects !== 'function') return true;
  const rects = range.getClientRects();
  if (!rects || rects.length === 0) return true;
  const nonZeroRects = Array.from(rects).filter((r) => r.width > 0 || r.height > 0);
  if (nonZeroRects.length === 0) return true;
  return nonZeroRects.some(
    (r) =>
      clientX >= r.left - tolerance &&
      clientX <= r.right + tolerance &&
      clientY >= r.top - tolerance &&
      clientY <= r.bottom + tolerance
  );
}

function resolveReaderTextNodeAndOffset(container, rawOffset, clientX, clientY) {
  if (!container) return null;
  if (container.nodeType === 3 /* Node.TEXT_NODE */) {
    return { node: container, offset: rawOffset || 0 };
  }
  if (container.nodeType !== 1 /* Node.ELEMENT_NODE */ || typeof document === 'undefined') {
    return null;
  }

  const children = container.childNodes || [];
  const candidates = [];
  if (children[rawOffset]) candidates.push(children[rawOffset]);
  if (rawOffset > 0 && children[rawOffset - 1]) candidates.push(children[rawOffset - 1]);

  const seen = new Set();
  const textNodes = [];
  const collectText = (root) => {
    if (!root) return;
    if (root.nodeType === 3) {
      if (!seen.has(root) && (root.textContent || '').trim()) {
        seen.add(root);
        textNodes.push(root);
      }
      return;
    }
    if (typeof document.createTreeWalker === 'function') {
      const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null, false);
      let n;
      while ((n = walker.nextNode())) {
        if (!seen.has(n) && (n.textContent || '').trim()) {
          seen.add(n);
          textNodes.push(n);
        }
      }
    }
  };

  for (const cand of candidates) collectText(cand);
  collectText(container);
  if (textNodes.length === 0) return null;

  if (typeof document.createRange === 'function' && typeof clientX === 'number' && typeof clientY === 'number') {
    const probe = document.createRange();
    for (const tol of [0, 4]) {
      let fallbackHit = null;
      for (const tn of textNodes) {
        const r = document.createRange();
        r.selectNodeContents(tn);
        if (isPointInsideRangeRects(r, clientX, clientY, tol)) {
          const rawText = tn.textContent || '';
          const len = rawText.length;
          let bestIdx = 0;
          let bestDist = Infinity;
          let matchedChar = false;
          for (let i = 0; i < len; i++) {
            probe.setStart(tn, i);
            probe.setEnd(tn, i + 1);
            const rects = probe.getClientRects?.();
            if (!rects) continue;
            for (let j = 0; j < rects.length; j++) {
              const rect = rects[j];
              if (rect.width === 0 && rect.height === 0) continue;
              if (
                clientX >= rect.left - tol &&
                clientX <= rect.right + tol &&
                clientY >= rect.top - tol &&
                clientY <= rect.bottom + tol
              ) {
                if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                  bestIdx = i;
                  matchedChar = true;
                  bestDist = 0;
                  break;
                }
                const d = Math.hypot(clientX - (rect.left + rect.right) / 2, clientY - (rect.top + rect.bottom) / 2);
                if (d < bestDist) {
                  bestDist = d;
                  bestIdx = i;
                  matchedChar = true;
                }
              }
            }
            if (bestDist === 0 && matchedChar) break;
          }
          const ch = rawText[bestIdx] || '';
          const prevCh = bestIdx > 0 ? rawText[bestIdx - 1] || '' : '';
          if (/[\p{L}\p{M}]/u.test(ch) || /[\p{L}\p{M}]/u.test(prevCh)) {
            return { node: tn, offset: bestIdx };
          }
          if (!fallbackHit) {
            fallbackHit = { node: tn, offset: bestIdx };
          }
        }
      }
      if (fallbackHit && tol === 4) {
        return fallbackHit;
      }
    }
  }

  return { node: textNodes[0], offset: 0 };
}

export function detectLiveSectionTitleFromElements(headings, thresholdY = 120) {
  if (!headings || typeof headings[Symbol.iterator] !== 'function') return null;
  const extractCleanHeadingText = (el) => {
    const carried = el.getAttribute?.('data-chunk-last-heading');
    if (carried) return carried.replace(/\s+/g, ' ').trim();
    if (el.querySelector && el.cloneNode) {
      const hasNoise = el.querySelector('.note, .pb, .linked-def-row');
      if (hasNoise) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('.note, .pb, .linked-def-row').forEach((n) => n.remove());
        return (clone.textContent || '').replace(/\s+/g, ' ').trim();
      }
    }
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  };
  let lastAbove = null;
  let firstNear = null;
  for (const el of headings) {
    if (!el || typeof el.getBoundingClientRect !== 'function') continue;
    const rect = el.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) continue;
    const rawText = extractCleanHeadingText(el);
    if (!rawText) continue;
    if (rect.top <= thresholdY + 48) {
      lastAbove = rawText;
    } else if (!firstNear && rect.top <= thresholdY + 260) {
      firstNear = rawText;
    } else if (rect.top > thresholdY + 260) {
      break;
    }
  }
  return lastAbove || firstNear || null;
}

export function findFirstElementWithBottomAtOrBelow(elements, targetY) {
  if (!elements || elements.length === 0) return null;
  const len = elements.length;
  if (len <= 16) {
    for (let i = 0; i < len; i++) {
      const el = elements[i];
      if (!el || typeof el.getBoundingClientRect !== 'function') continue;
      const rect = el.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) continue;
      if (rect.bottom >= targetY) return el;
    }
    return null;
  }

  let lo = 0;
  let hi = len - 1;
  let ansIdx = -1;
  while (lo <= hi) {
    let mid = (lo + hi) >> 1;
    let rect = elements[mid]?.getBoundingClientRect?.();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      let probe = -1;
      for (let step = 1; mid - step >= lo || mid + step <= hi; step++) {
        if (mid + step <= hi) {
          const r = elements[mid + step]?.getBoundingClientRect?.();
          if (r && (r.width !== 0 || r.height !== 0)) {
            probe = mid + step;
            rect = r;
            break;
          }
        }
        if (mid - step >= lo) {
          const r = elements[mid - step]?.getBoundingClientRect?.();
          if (r && (r.width !== 0 || r.height !== 0)) {
            probe = mid - step;
            rect = r;
            break;
          }
        }
      }
      if (probe === -1) break;
      mid = probe;
    }
    if (rect.bottom >= targetY) {
      ansIdx = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ansIdx >= 0 ? elements[ansIdx] : null;
}

export function findActiveEditionPagesFromElements(pbElements, targetY) {
  const pages = {};
  if (!pbElements || pbElements.length === 0) return pages;

  const len = pbElements.length;
  const hostTopCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const getPbHostTop = (pb) => {
    if (!pb) return Infinity;
    const hostEl =
      pb.closest?.('[data-pindex], .reader-para-row, .sent-pair, p, .chapter-divider') ||
      pb.parentElement ||
      pb;
    if (hostTopCache && hostTopCache.has(hostEl)) {
      return hostTopCache.get(hostEl);
    }
    const rect = hostEl?.getBoundingClientRect?.();
    const top = rect ? rect.top : Infinity;
    if (hostTopCache && hostEl && typeof hostEl === 'object') {
      hostTopCache.set(hostEl, top);
    }
    return top;
  };

  let lo = 0;
  let hi = len - 1;
  let cutoffIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const top = getPbHostTop(pbElements[mid]);
    if (top <= targetY) {
      cutoffIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  for (let i = cutoffIdx; i >= 0; i--) {
    const pb = pbElements[i];
    const ed = pb?.getAttribute?.('data-ed');
    const page = pb?.getAttribute?.('data-page');
    if (ed && page && !pages[ed]) {
      pages[ed] = page;
    }
  }

  for (let i = cutoffIdx + 1; i < len; i++) {
    const pb = pbElements[i];
    const ed = pb?.getAttribute?.('data-ed');
    const page = pb?.getAttribute?.('data-page');
    if (ed && page && !pages[ed]) {
      pages[ed] = page;
    }
  }

  return pages;
}

function extractPaliChapMap(data, chapterIndex) {
  if (!data || typeof data !== 'object') return null;
  if (data.chapters && typeof data.chapters === 'object') {
    return data.chapters[String(chapterIndex)] || null;
  }
  if (data.paragraphs && typeof data.paragraphs === 'object') {
    return data.paragraphs;
  }
  return data;
}

export function getMaxColumnsForWidth(viewportWidth = 1280) {
  if (viewportWidth >= 1440) return 4;
  if (viewportWidth >= 1100) return 3;
  return 2;
}

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
  id: { label: 'Bahasa Indonesia', flag: '🇮🇩' },
  es: { label: 'Español', flag: '🇪🇸' },
  fr: { label: 'Français', flag: '🇫🇷' },
  de: { label: 'Deutsch', flag: '🇩🇪' },
  ja: { label: '日本語', flag: '🇯🇵' },
  ko: { label: '한국어', flag: '🇰🇷' },
  ne: { label: 'नेपाली', flag: '🇳🇵' },
  be: { label: 'বাংলা', flag: '🇧🇩' },
  pt: { label: 'Português', flag: '🇵🇹' },
  ru: { label: 'Русский', flag: '🇷🇺' },
  cs: { label: 'Čeština', flag: '🇨🇿' },
  mr: { label: 'मराठी', flag: '🇮🇳' },
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
  indonesian: 'id',
  nepali: 'ne',
  bengali: 'be',
  spanish: 'es',
  french: 'fr',
  portuguese: 'pt',
  russian: 'ru',
  czech: 'cs',
  marathi: 'mr',
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
  id: 'indonesian',
  ne: 'nepali',
  be: 'bengali',
  es: 'spanish',
  fr: 'french',
  pt: 'portuguese',
  ru: 'russian',
  cs: 'czech',
  mr: 'marathi',
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
          return `<span class="reader-nissaya-pair"><strong class="reader-nissaya-pali">${formatInlineTags(pali)}</strong><span class="reader-nissaya-sep">:</span> <span class="reader-nissaya-meaning">${formatInlineTags(meaning)}</span></span>`;
        }
        return `<span class="reader-nissaya-meaning">${formatInlineTags(trimmed)}</span>`;
      })
      .filter(Boolean)
      .join('<span class="reader-nissaya-divider"> | </span>');

    return partsHtml;
  }

  return formatInlineTags(text);
}

export function getSentenceDisplayFlags({
  sentenceMode = false,
  hasActiveTrans = false,
  isPaliEnabled = true,
  orderedLayers = [],
  translationDisplayMode = 'stack',
}) {
  const effectiveSentenceMode = Boolean(sentenceMode && hasActiveTrans);
  const isSideMode = translationDisplayMode === 'side' || translationDisplayMode === 'side_rev';
  const transCount = orderedLayers.filter((l) => l.type === 'trans').length;
  const isSideActive =
    isSideMode && ((isPaliEnabled && hasActiveTrans) || (!isPaliEnabled && transCount >= 2));
  return {
    effectiveSentenceMode,
    showSentenceNumbers: Boolean(effectiveSentenceMode && isSideActive),
    isSideActive,
  };
}

// Pāḷi sentence lines for sentence display mode. Replaces the inside of
// prose <p data-para data-pindex> elements with sentence spans from the
// precomputed pali_sentences map (epitaka.db segmentation, shared line
// numbers with translation line_ids), keeping the leading
// paragraph-number element and preserving all page break (<span class="pb">)
// elements so that edition pagination, page jumps, and indicators work.
export function injectPaliSentencesIntoHtml(html, paliSentMap, { showSentenceNumbers = true } = {}) {
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
        const numBadge = showSentenceNumbers ? `<span class="pali-sent-num">${lid}</span>` : '';
        return `<span class="pali-sent" data-line="${lid}">${numBadge}<span class="pali-sent-text">${t}</span></span>`;
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

// Strip the muted line-number badge from a sentence cell (Stacked layout
// never displays sentence number badges).
function stripSentNumBadge(html) {
  return String(html || '').replace(/<span class="(?:pali|trans)-sent-num"[^>]*>[\s\S]*?<\/span>/g, '');
}

export function injectTranslationsIntoHtml(
  html,
  translations,
  orderedLayers = [],
  isPaliEnabled = true,
  displayMode = 'stack',
  translationColors = {},
  searchHighlight = null,
  sentenceMode = false,
  transSentences = null,
  theme = 'classic',
  linkOptions = null
) {
  if (!html) return html;

  const transLayers = orderedLayers.filter((l) => l.type === 'trans');
  const transSlotByKey = new Map();
  transLayers.forEach((l, idx) => {
    transSlotByKey.set(l.id, idx);
    transSlotByKey.set(l.lang, idx);
  });

  const hasTranslations = transLayers.length > 0;
  const paliColors = translationColors?.pali || {};
  const hasCustomPaliColors = Boolean(
    formatCssColor(paliColors.border) ||
    formatCssColor(paliColors.bg) ||
    formatCssColor(paliColors.text)
  );

  const chapterLinks =
    linkOptions?.showBookLinks && isPaliEnabled && linkOptions?.chapterLinks && typeof linkOptions.chapterLinks === 'object'
      ? linkOptions.chapterLinks
      : null;
  const linkBookCode = linkOptions?.bookCode || null;
  const linkChapterIndex = linkOptions?.chapterIndex;
  const linkScript = linkOptions?.paliScript || 'roman';
  if (chapterLinks && linkBookCode && linkChapterIndex !== undefined && linkChapterIndex !== null) {
    registerChapterLinks(linkBookCode, linkChapterIndex, chapterLinks);
  }
  const hasLinkRefBase = Boolean(linkBookCode && linkChapterIndex !== undefined && linkChapterIndex !== null);

  if (isPaliEnabled && !hasTranslations && !hasCustomPaliColors && !chapterLinks) {
    return html;
  }

  const isSide = displayMode === 'side' || displayMode === 'side_rev';
  const isSwapped = displayMode === 'side_rev';
  const {
    effectiveSentenceMode,
    showSentenceNumbers,
    isSideActive,
  } = getSentenceDisplayFlags({
    sentenceMode,
    hasActiveTrans: hasTranslations,
    isPaliEnabled,
    orderedLayers,
    translationDisplayMode: displayMode,
  });

  return html.replace(/(<p\b[^>]*\bdata-pindex="(\d+)"[^>]*>[\s\S]*?<\/p>)/gi, (fullMatch, pTag, pIndex) => {
    const pLinks = chapterLinks ? chapterLinks[pIndex] : null;
    const makeRef = (lineKey, idx) =>
      hasLinkRefBase ? `${linkBookCode}|${linkChapterIndex}|${pIndex}|${lineKey}|${idx}` : null;
    const makeMoreRef = (lineKey) =>
      hasLinkRefBase ? `${linkBookCode}|${linkChapterIndex}|${pIndex}|${lineKey}|${linkScript}` : null;
    const allLinksStrip =
      pLinks && Array.isArray(pLinks.all) && pLinks.all.length > 0
        ? renderBookLinksStrip(pLinks.all, linkScript, {
            inline: false,
            getRef: hasLinkRefBase ? (_, idx) => makeRef('_all', idx) : null,
            moreRef: makeMoreRef('_all'),
          })
        : '';

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
          const safePTag = showSentenceNumbers ? pTag : stripSentNumBadge(pTag);
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
        ${safePTag}
      </div>`,
              });
            } else {
              renderedItems.push({
                type: 'pali',
                lang: 'pali',
                html: safePTag,
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
        ${safePTag}
      </div>`,
            });
          }
        }
      } else if (layer.type === 'trans') {
        const trans = translations[layer.lang]?.[pIndex];
        // Sentence mode may carry splits without the full paragraph text
        // (sentence files only) — splits alone are enough to render.
        const sentArr =
          effectiveSentenceMode && transSentences ? transSentences[layer.lang]?.[pIndex] : null;
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
              .map((it) => {
                const numBadge = showSentenceNumbers ? `<span class="trans-sent-num">${it.line}</span>` : '';
                return `<span class="trans-sent" data-line="${it.line}">${numBadge}<span class="trans-sent-text">${it.html}</span></span>`;
              })
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

          // Task 3: Dynamically apply custom colors or theme default slot palette for translation language
          const slotIdx = transSlotByKey.has(layer.id)
            ? transSlotByKey.get(layer.id)
            : transSlotByKey.get(layer.lang) ?? Math.max(0, transCount - 1);
          const slotDefaults = getDefaultTranslationColorsForTheme(theme, slotIdx);
          const customColors = translationColors?.[layer.id] || translationColors?.[layer.lang] || {};
          const transBorder = formatCssColor(customColors.border) || slotDefaults.border;
          const transBg = formatCssColor(customColors.bg);
          const transText = formatCssColor(customColors.text) || slotDefaults.text;
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

    const preservedPbs = !isPaliEnabled
      ? (pTag.match(/<span\b[^>]*\bclass="[^"]*\bpb\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi) || [])
          .map((pbHtml) =>
            pbHtml.replace(
              /\bclass="([^"]*)"/i,
              (_, cls) => `class="${cls.includes('hidden') ? cls : `${cls} hidden`}"`
            )
          )
          .join('')
      : '';

    if (renderedItems.length === 0) {
      if (!isPaliEnabled) {
        // Keep section headings/titles/colophons so chapter hierarchy remains visible
        if (isHeading) return pTag;
        return `<div class="reader-para-row reader-trans-empty" ${rowAttrs}>${preservedPbs}</div>`;
      }
      return fullMatch;
    }

    // Heading row styling when Pāḷi is disabled
    if (!isPaliEnabled && isHeading) {
      const headingItemsHtml = renderedItems.map((item) => item.html).join('');
      return `<div class="reader-para-row reader-trans-heading-row ${headingClass}" ${rowAttrs}>${preservedPbs}${headingItemsHtml}</div>`;
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
        return `<div class="reader-para-row reader-trans-side-row" ${rowAttrs}><div class="reader-side-col reader-side-col-left reader-trans-col"><div class="reader-translation-container reader-side-container" data-pindex="${pIndex}">${leftHtml}</div></div><div class="reader-side-col reader-side-col-right reader-pali-col">${paliItem.html}${allLinksStrip}</div></div>`;
      }
      const col1 = renderedItems[0];
      const col2Items = renderedItems.slice(1);
      const col1Html = col1.type === 'pali' ? `${col1.html}${allLinksStrip}` : col1.html;
      const col2Html = col2Items.map((item) => (item.type === 'pali' ? `${item.html}${allLinksStrip}` : item.html)).join('');
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
          const col1Body = singleItem.type === 'pali' ? `${singleItem.html}${allLinksStrip}` : singleItem.html;
          return `<div class="reader-para-row reader-trans-side-row reader-side-empty" ${rowAttrs}><div class="reader-side-col reader-side-col-left ${col1Class}">${col1Body}</div><div class="reader-side-col reader-side-col-right reader-trans-col reader-trans-col-empty"><div class="reader-translation-container reader-side-container" data-pindex="${pIndex}"></div></div></div>`;
        } else {
          const col2Class = singleItem.type === 'pali' ? 'reader-pali-col' : 'reader-trans-col';
          const col2Body = singleItem.type === 'pali' ? `${singleItem.html}${allLinksStrip}` : singleItem.html;
          const col2Wrapped = col2Class === 'reader-trans-col'
            ? `<div class="reader-translation-container reader-side-container" data-pindex="${pIndex}">${col2Body}</div>`
            : col2Body;
          return `<div class="reader-para-row reader-trans-side-row reader-side-empty" ${rowAttrs}><div class="reader-side-col reader-side-col-left reader-trans-col reader-trans-col-empty"></div><div class="reader-side-col reader-side-col-right ${col2Class}">${col2Wrapped}</div></div>`;
        }
      }
    }

    // Paired sentence rows (epitaka-style 1 Pāḷi vs 1 translation per line).
    // Stack mode only, Pāḷi enabled, prose paragraphs where every layer has
    // sentence splits. Missing lines render an empty cell so alignment holds.
    if (!isSideActive && effectiveSentenceMode && isPaliEnabled && !isHeading) {
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

          const injectedLines = new Set();
          for (const ln of lineOrder) {
            if (Array.isArray(pLinks?.by_line?.[ln]) && pLinks.by_line[ln].length > 0) {
              injectedLines.add(ln);
            }
          }
          const leftoverEntries = [];
          if (pLinks?.by_line && typeof pLinks.by_line === 'object') {
            for (const [ln, list] of Object.entries(pLinks.by_line)) {
              if (!injectedLines.has(ln) && Array.isArray(list)) {
                list.forEach((lnk, idx) => {
                  leftoverEntries.push({
                    link: lnk,
                    ref: hasLinkRefBase ? `${linkBookCode}|${linkChapterIndex}|${pIndex}|${ln}|${idx}` : null,
                  });
                });
              }
            }
          }
          const leftoverStripHtml =
            leftoverEntries.length > 0
              ? renderBookLinksStrip(
                  leftoverEntries.map((e) => e.link),
                  linkScript,
                  {
                    inline: false,
                    getRef: hasLinkRefBase ? (_, idx) => leftoverEntries[idx]?.ref || null : null,
                  }
                )
              : '';

          let placedLeftover = false;
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
              const lineLinks = injectedLines.has(ln) ? pLinks?.by_line?.[ln] : null;
              const lineStrip =
                lineLinks && lineLinks.length > 0
                  ? renderBookLinksStrip(lineLinks, linkScript, {
                      inline: false,
                      getRef: hasLinkRefBase ? (_, idx) => makeRef(ln, idx) : null,
                      moreRef: makeMoreRef(ln),
                    })
                  : '';
              const extraLeftover =
                !placedLeftover && leftoverStripHtml && pHtml !== undefined
                  ? ((placedLeftover = true), leftoverStripHtml)
                  : '';
              return `<div class="sent-pair" data-line="${ln}">` +
                `<div class="sent-pair-body">` +
                (pHtml !== undefined
                  ? `<div class="sent-pair-pali reader-trans-block reader-pali-trans-block"${hasPaliCustom ? ` style="${paliSentStyle}"` : ''} data-trans-lang="pali" data-line="${ln}">${stripSentNumBadge(pHtml)}</div>${lineStrip}${extraLeftover}`
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
              (!placedLeftover && leftoverStripHtml ? leftoverStripHtml : '') +
              `</div>`;
          }
        }
      }
    }

    // Stack mode or single-layer side mode
    const itemsHtml = renderedItems
      .map((item) => (item.type === 'pali' && allLinksStrip ? `${item.html}${allLinksStrip}` : item.html))
      .join('');
    return `<div class="reader-para-row reader-trans-stack-row" ${rowAttrs}>${preservedPbs}${itemsHtml}</div>`;
  });
}

const _chapterLinksRegistry = new Map();
const MAX_REGISTERED_CHAPTER_LINKS = 40;

function registerChapterLinks(bookCode, chapterIndex, paragraphs) {
  if (!bookCode || chapterIndex === undefined || chapterIndex === null || !paragraphs || typeof paragraphs !== 'object') {
    return;
  }
  const key = `${bookCode}:${chapterIndex}`;
  _chapterLinksRegistry.delete(key);
  while (_chapterLinksRegistry.size >= MAX_REGISTERED_CHAPTER_LINKS) {
    const oldest = _chapterLinksRegistry.keys().next().value;
    if (oldest === undefined) break;
    _chapterLinksRegistry.delete(oldest);
  }
  _chapterLinksRegistry.set(key, paragraphs);
}

export function resolveChipLinkElement(chip) {
  if (!chip) return null;
  if (chip.__parsedLink !== undefined) return chip.__parsedLink;
  const ref = chip.getAttribute?.('data-link-ref');
  if (ref) {
    const parts = ref.split('|');
    if (parts.length === 5) {
      const [bookCode, chapIdx, pIdx, lineId, itemIdxStr] = parts;
      const itemIdx = parseInt(itemIdxStr, 10);
      const paras = _chapterLinksRegistry.get(`${bookCode}:${chapIdx}`);
      const pLinks = paras?.[pIdx];
      const link = pLinks
        ? lineId !== '_all'
          ? pLinks.by_line?.[lineId]?.[itemIdx] || null
          : pLinks.all?.[itemIdx] || null
        : null;
      chip.__parsedLink = link;
      return link;
    }
  }
  const raw = chip.getAttribute?.('data-link');
  if (!raw) {
    chip.__parsedLink = null;
    return null;
  }
  try {
    chip.__parsedLink = JSON.parse(decodeURIComponent(raw));
  } catch (_) {
    chip.__parsedLink = null;
  }
  return chip.__parsedLink;
}

function escapeLinkText(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeLinkAttr(str) {
  return escapeLinkText(str).replace(/"/g, '&quot;');
}

const LINK_STRIP_MAX_INITIAL = 3;

function renderLinkChipHtml(link, idx, paliScript = 'roman', getRef = null) {
  const isSource = Boolean(link.is_source);
  const arrow = isSource ? '←' : '→';
  const rawWord = link.word || '';
  const displayWord =
    paliScript && paliScript !== 'roman'
      ? convertPaliScript(rawWord, paliScript) || rawWord
      : rawWord;
  const cat = (link.target_category || '').toLowerCase();
  const shortCat =
    cat === 'mūla'
      ? 'M'
      : cat === 'aṭṭhakathā'
      ? 'A'
      : cat === 'ṭīkā'
      ? 'Ṭ'
      : '';
  const catClass =
    cat.includes('mūla') || cat === 'mula'
      ? 'linked-def-chip-mula'
      : cat.includes('aṭṭha') || cat.includes('attha')
      ? 'linked-def-chip-attha'
      : cat.includes('ṭīkā') || cat.includes('tika')
      ? 'linked-def-chip-tika'
      : '';
  const refVal = typeof getRef === 'function' ? getRef(link, idx) : null;
  const dataAttr = refVal
    ? `data-link-ref="${escapeLinkAttr(refVal)}"`
    : `data-link="${escapeLinkAttr(encodeURIComponent(JSON.stringify(link)))}"`;
  const title = escapeLinkAttr(
    `${isSource ? 'Source' : 'Commentary'}: ${link.target_book_title || link.target_book}${link.target_para_num ? ` (§ ${link.target_para_num})` : ''}`
  );
  return (
    `<button type="button" class="linked-def-chip ${isSource ? 'linked-def-chip-source' : 'linked-def-chip-forward'}${catClass ? ` ${catClass}` : ''}" ${dataAttr} title="${title}">` +
    `<span class="linked-def-arrow">${arrow}</span>` +
    `<span class="linked-def-word">${escapeLinkText(displayWord)}</span>` +
    (shortCat ? `<span class="linked-def-cat">${shortCat}</span>` : '') +
    `</button>`
  );
}

export function renderMoreLinkChipsFromRef(moreRef) {
  if (!moreRef || typeof moreRef !== 'string') return '';
  const parts = moreRef.split('|');
  if (parts.length !== 5) return '';
  const [bookCode, chapIdx, pIdx, lineId, paliScript] = parts;
  const paras = _chapterLinksRegistry.get(`${bookCode}:${chapIdx}`);
  const pLinks = paras?.[pIdx];
  const list = pLinks
    ? lineId !== '_all'
      ? pLinks.by_line?.[lineId]
      : pLinks.all
    : null;
  if (!Array.isArray(list) || list.length <= LINK_STRIP_MAX_INITIAL) return '';
  const getRef = (_, idx) => `${bookCode}|${chapIdx}|${pIdx}|${lineId}|${idx}`;
  return list
    .slice(LINK_STRIP_MAX_INITIAL)
    .map((lnk, i) => renderLinkChipHtml(lnk, i + LINK_STRIP_MAX_INITIAL, paliScript || 'roman', getRef))
    .join('');
}

function renderBookLinksStrip(links, paliScript = 'roman', { inline = false, getRef = null, moreRef = null } = {}) {
  if (!Array.isArray(links) || links.length === 0) return '';
  const MAX_INITIAL = LINK_STRIP_MAX_INITIAL;

  const primaryHtml = links
    .slice(0, MAX_INITIAL)
    .map((lnk, i) => renderLinkChipHtml(lnk, i, paliScript, getRef))
    .join('');
  const extraCount = links.length - MAX_INITIAL;
  const extraHtml =
    extraCount > 0
      ? moreRef
        ? `<span class="linked-def-more-group hidden" data-links-more-ref="${escapeLinkAttr(moreRef)}"></span>` +
          `<button type="button" class="linked-def-more-btn" data-more-count="${extraCount}">+${extraCount} more</button>`
        : `<span class="linked-def-more-group hidden">${links
            .slice(MAX_INITIAL)
            .map((lnk, i) => renderLinkChipHtml(lnk, i + MAX_INITIAL, paliScript, getRef))
            .join('')}</span>` +
          `<button type="button" class="linked-def-more-btn" data-more-count="${extraCount}">+${extraCount} more</button>`
      : '';

  const tag = inline ? 'span' : 'div';
  const cls = inline ? 'linked-def-row linked-def-row-inline' : 'linked-def-row';
  return `<${tag} class="${cls}">${primaryHtml}${extraHtml}</${tag}>`;
}

function injectBookLinksIntoHtml(htmlStr, chapterLinks, paliScript = 'roman', sentenceMode = false, linkMeta = null) {
  if (!htmlStr || !chapterLinks || typeof chapterLinks !== 'object') {
    return htmlStr;
  }
  const keys = Object.keys(chapterLinks);
  if (keys.length === 0) return htmlStr;

  const bookCode = linkMeta?.bookCode || null;
  const chapterIndex = linkMeta?.chapterIndex;
  const hasRefBase = Boolean(bookCode && chapterIndex !== undefined && chapterIndex !== null);
  if (hasRefBase) {
    registerChapterLinks(bookCode, chapterIndex, chapterLinks);
  }

  // Fast single-pass string injection for Pāḷi-only paragraphs without detached DOM parsing.
  if (!htmlStr.includes('reader-para-row') && !(sentenceMode && htmlStr.includes('pali-sent'))) {
    return htmlStr.replace(/(<p\b[^>]*\bdata-pindex="(\d+)"[^>]*>[\s\S]*?<\/p>)/gi, (fullP, _p, pIdx) => {
      const pLinks = chapterLinks[pIdx];
      if (!pLinks || !Array.isArray(pLinks.all) || pLinks.all.length === 0) {
        return fullP;
      }
      const stripHtml = renderBookLinksStrip(pLinks.all, paliScript, {
        inline: false,
        getRef: hasRefBase ? (_, idx) => `${bookCode}|${chapterIndex}|${pIdx}|_all|${idx}` : null,
        moreRef: hasRefBase ? `${bookCode}|${chapterIndex}|${pIdx}|_all|${paliScript}` : null,
      });
      return `${fullP}${stripHtml}`;
    });
  }

  if (typeof document === 'undefined') {
    return htmlStr;
  }

  const root = document.createElement('div');
  root.innerHTML = htmlStr;

  const makeChipOpts = (pIdx, lineKey, inline) => ({
    inline,
    getRef: hasRefBase ? (_, idx) => `${bookCode}|${chapterIndex}|${pIdx}|${lineKey}|${idx}` : null,
    moreRef: hasRefBase ? `${bookCode}|${chapterIndex}|${pIdx}|${lineKey}|${paliScript}` : null,
  });

  const paraRows = root.querySelectorAll('.reader-para-row[data-pindex]');
  if (paraRows.length > 0) {
    paraRows.forEach((row) => {
      const pIdx = row.getAttribute('data-pindex');
      const pLinks = pIdx !== null ? chapterLinks[pIdx] : null;
      if (!pLinks) return;

      const sentPairs = row.querySelectorAll('.sent-pair[data-line]');
      if (sentenceMode && sentPairs.length > 0) {
        const injectedLines = new Set();
        sentPairs.forEach((pair) => {
          const ln = pair.getAttribute('data-line');
          const lineLinks = ln ? pLinks.by_line?.[ln] : null;
          if (Array.isArray(lineLinks) && lineLinks.length > 0) {
            injectedLines.add(ln);
            const stripHtml = renderBookLinksStrip(lineLinks, paliScript, makeChipOpts(pIdx, ln, false));
            const paliCell = pair.querySelector('.sent-pair-pali');
            if (paliCell) {
              paliCell.insertAdjacentHTML('afterend', stripHtml);
            } else {
              const target = pair.querySelector('.sent-pair-body') || pair;
              target.insertAdjacentHTML('afterbegin', stripHtml);
            }
          }
        });
        const leftovers = [];
        if (pLinks.by_line && typeof pLinks.by_line === 'object') {
          for (const [ln, list] of Object.entries(pLinks.by_line)) {
            if (!injectedLines.has(ln) && Array.isArray(list)) {
              leftovers.push(...list);
            }
          }
        }
        if (leftovers.length > 0) {
          const stripHtml = renderBookLinksStrip(leftovers, paliScript, { inline: false });
          const firstPali = row.querySelector('.sent-pair-pali');
          const paraNumEl = row.querySelector('.sent-paranum');
          if (firstPali) {
            firstPali.insertAdjacentHTML('afterend', stripHtml);
          } else if (paraNumEl) {
            paraNumEl.insertAdjacentHTML('afterend', stripHtml);
          } else {
            row.insertAdjacentHTML('afterbegin', stripHtml);
          }
        }
        return;
      }

      if (Array.isArray(pLinks.all) && pLinks.all.length > 0) {
        const stripHtml = renderBookLinksStrip(pLinks.all, paliScript, makeChipOpts(pIdx, '_all', false));
        if (row.classList.contains('reader-trans-side-row')) {
          const paliCol = row.querySelector('.reader-pali-col');
          if (paliCol) {
            paliCol.insertAdjacentHTML('beforeend', stripHtml);
          } else {
            row.insertAdjacentHTML(
              'afterend',
              `<div class="reader-para-links-footer">${stripHtml}</div>`
            );
          }
        } else {
          const paliEl =
            row.querySelector('.reader-pali-trans-block') ||
            Array.from(row.children).find((el) => el.tagName === 'P');
          if (paliEl) {
            paliEl.insertAdjacentHTML('afterend', stripHtml);
          } else {
            row.insertAdjacentHTML('afterbegin', stripHtml);
          }
        }
      }
    });
    return root.innerHTML;
  }

  const pEls = root.querySelectorAll('p[data-pindex]');
  pEls.forEach((pEl) => {
    const pIdx = pEl.getAttribute('data-pindex');
    const pLinks = pIdx !== null ? chapterLinks[pIdx] : null;
    if (!pLinks) return;

    if (sentenceMode) {
      const paliSents = pEl.querySelectorAll('.pali-sent[data-line]');
      if (paliSents.length > 0) {
        const injectedLines = new Set();
        paliSents.forEach((sentEl) => {
          const ln = sentEl.getAttribute('data-line');
          const lineLinks = ln ? pLinks.by_line?.[ln] : null;
          if (Array.isArray(lineLinks) && lineLinks.length > 0) {
            injectedLines.add(ln);
            sentEl.insertAdjacentHTML(
              'afterend',
              renderBookLinksStrip(lineLinks, paliScript, makeChipOpts(pIdx, ln, true))
            );
          }
        });
        const leftovers = [];
        if (pLinks.by_line && typeof pLinks.by_line === 'object') {
          for (const [ln, list] of Object.entries(pLinks.by_line)) {
            if (!injectedLines.has(ln) && Array.isArray(list)) {
              leftovers.push(...list);
            }
          }
        }
        if (leftovers.length > 0) {
          pEl.insertAdjacentHTML('afterend', renderBookLinksStrip(leftovers, paliScript, { inline: false }));
        }
        return;
      }
    }

    if (Array.isArray(pLinks.all) && pLinks.all.length > 0) {
      pEl.insertAdjacentHTML(
        'afterend',
        renderBookLinksStrip(pLinks.all, paliScript, makeChipOpts(pIdx, '_all', false))
      );
    }
  });

  return root.innerHTML;
}

export const CHAPTER_CHUNK_THRESHOLD = 50;
export const CHAPTER_CHUNK_SIZE = 30;

function extractChunkMeta(rawHtml, index, spans, prevParaNum) {
  const pIndices = new Set();
  const paraNums = new Set();
  const paraInts = [];
  const paraRanges = [];
  const edPages = [];
  const lastPbByEd = {};
  let lastParaNum = prevParaNum || null;
  let lastHeading = null;

  const pbRe = /<span\b[^>]*\bclass="[^"]*\bpb\b[^"]*"[^>]*>/gi;
  for (let i = 0; i < spans.length; i++) {
    const pTag = spans[i].tag;
    const gtIdx = pTag.indexOf('>');
    const open = gtIdx !== -1 ? pTag.slice(0, gtIdx + 1) : pTag;

    const pidxM = open.match(/\bdata-pindex="(\d+)"/i);
    if (pidxM) pIndices.add(pidxM[1]);

    const paraM = open.match(/\bdata-para="([^"]+)"/i);
    if (paraM) {
      const cleanP = paraM[1].trim();
      if (cleanP) {
        paraNums.add(cleanP);
        lastParaNum = cleanP;
        const pInt = parseInt(cleanP, 10);
        if (!Number.isNaN(pInt)) paraInts.push(pInt);
      }
    }

    const firstM = open.match(/\bdata-para-first="(\d+)"/i);
    const lastM = open.match(/\bdata-para-last="(\d+)"/i);
    if (firstM && lastM) {
      const f = parseInt(firstM[1], 10);
      const l = parseInt(lastM[1], 10);
      if (!Number.isNaN(f) && !Number.isNaN(l)) {
        paraRanges.push([f, l]);
        paraInts.push(f, l);
      }
    }

    const clsM = open.match(/\bclass="([^"]*)"/i);
    if (clsM && /\b(?:book|chapter|title|subhead)\b/i.test(clsM[1])) {
      const inner = pTag
        .slice(gtIdx + 1, pTag.lastIndexOf('<'))
        .replace(/<span\b[^>]*\bclass="[^"]*\b(?:note|pb)\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (inner) lastHeading = inner;
    }

    if (pTag.includes('class="pb"') || pTag.includes('data-ed=')) {
      pbRe.lastIndex = 0;
      let pm;
      while ((pm = pbRe.exec(pTag)) !== null) {
        const tagStr = pm[0];
        const edM = tagStr.match(/\bdata-ed="([^"]+)"/i);
        const pageM = tagStr.match(/\bdata-page="([^"]+)"/i);
        if (edM && pageM) {
          edPages.push({ ed: edM[1], page: pageM[1] });
          lastPbByEd[edM[1]] = pageM[1];
        }
      }
    }
  }

  return {
    index,
    rawHtml,
    paraCount: spans.length,
    charLength: rawHtml.length,
    pIndices,
    paraNums,
    paraInts,
    paraRanges,
    edPages,
    lastPbByEd,
    lastHeading,
    prevParaNum: prevParaNum || null,
    lastParaNum,
  };
}

export function splitChapterHtmlIntoChunks(html, chunkSize = CHAPTER_CHUNK_SIZE) {
  if (!html || typeof html !== 'string') return [];

  const pRe = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
  const spans = [];
  let m;
  while ((m = pRe.exec(html)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, tag: m[0] });
  }

  if (spans.length <= CHAPTER_CHUNK_THRESHOLD) {
    return [extractChunkMeta(html, 0, spans, null)];
  }

  const chunks = [];
  let cursor = 0;
  let lastParaAcrossChunks = null;
  const step = Math.max(1, chunkSize);

  for (let i = 0; i < spans.length; i += step) {
    const sliceEndIdx = Math.min(i + step, spans.length);
    const isLast = sliceEndIdx >= spans.length;
    const rawEnd = isLast ? html.length : spans[sliceEndIdx - 1].end;
    const rawHtml = html.slice(cursor, rawEnd);
    cursor = rawEnd;

    const sliceSpans = spans.slice(i, sliceEndIdx);
    const meta = extractChunkMeta(rawHtml, chunks.length, sliceSpans, lastParaAcrossChunks);
    if (meta.lastParaNum) {
      lastParaAcrossChunks = meta.lastParaNum;
    }
    chunks.push(meta);
  }
  return chunks;
}

export function findTargetChunkIndex(
  chunks,
  { paraIndex = null, paraNum = null, page = null, pageSystem = null, searchQuery = null, translations = null } = {}
) {
  if (!Array.isArray(chunks) || chunks.length <= 1) return 0;

  if (paraIndex !== undefined && paraIndex !== null && paraIndex !== '') {
    const key = String(paraIndex).trim();
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].pIndices?.has(key)) return i;
    }
  }

  // Check edition page BEFORE paraNum so GoTo Page jumps never latch onto a chapter-start fallback paraNum
  if (page !== undefined && page !== null && String(page).trim() !== '') {
    const cleanP = String(page).trim();
    const targetEd = pageSystem ? String(pageSystem).trim().toUpperCase() : null;
    const hasDot = cleanP.includes('.');
    let explicitVol = null;
    let targetPageInt = NaN;
    let paddedExact = null;
    let paddedSuffix = null;
    if (hasDot) {
      const parts = cleanP.split('.');
      const vol = parseInt(parts[0], 10);
      const num = parseInt(parts[1], 10);
      if (!Number.isNaN(vol) && !Number.isNaN(num)) {
        explicitVol = vol;
        targetPageInt = num;
        paddedExact = `${vol}.${String(num).padStart(4, '0')}`;
      }
    } else if (/^\d+$/.test(cleanP)) {
      const num = parseInt(cleanP, 10);
      if (!Number.isNaN(num)) {
        targetPageInt = num;
        paddedSuffix = `.${String(num).padStart(4, '0')}`;
        paddedExact = String(num).padStart(4, '0');
      }
    }

    for (let i = 0; i < chunks.length; i++) {
      const edPages = chunks[i].edPages;
      if (!edPages || edPages.length === 0) continue;
      for (let j = 0; j < edPages.length; j++) {
        const item = edPages[j];
        if (targetEd && String(item.ed || '').toUpperCase() !== targetEd) continue;
        const pVal = String(item.page || '');
        if (
          pVal === cleanP ||
          (paddedExact && pVal === paddedExact) ||
          (paddedSuffix && pVal.endsWith(paddedSuffix))
        ) {
          return i;
        }
      }
    }

    // Nearest-page chunk fallback when an edition skipped an intermediate print page number
    if (!Number.isNaN(targetPageInt)) {
      let bestBeforeIdx = -1;
      let bestBeforeDiff = Infinity;
      let bestAfterIdx = -1;
      let bestAfterDiff = Infinity;
      for (let i = 0; i < chunks.length; i++) {
        const edPages = chunks[i].edPages;
        if (!edPages || edPages.length === 0) continue;
        for (let j = 0; j < edPages.length; j++) {
          const item = edPages[j];
          if (targetEd && String(item.ed || '').toUpperCase() !== targetEd) continue;
          const pVal = String(item.page || '');
          let itemVol = null;
          let itemNum = NaN;
          if (pVal.includes('.')) {
            const [vs, ps] = pVal.split('.');
            itemVol = parseInt(vs, 10);
            itemNum = parseInt(ps, 10);
            if (explicitVol !== null && itemVol !== explicitVol) continue;
          } else {
            if (explicitVol !== null && explicitVol > 0) continue;
            itemNum = parseInt(pVal, 10);
          }
          if (Number.isNaN(itemNum)) continue;
          if (itemNum <= targetPageInt) {
            const diff = targetPageInt - itemNum;
            if (diff < bestBeforeDiff) {
              bestBeforeDiff = diff;
              bestBeforeIdx = i;
            }
          } else {
            const diff = itemNum - targetPageInt;
            if (diff < bestAfterDiff) {
              bestAfterDiff = diff;
              bestAfterIdx = i;
            }
          }
        }
      }
      if (bestBeforeIdx >= 0) return bestBeforeIdx;
      if (bestAfterIdx >= 0) return bestAfterIdx;
    }
  }

  if (paraNum !== undefined && paraNum !== null && String(paraNum).trim() !== '') {
    const cleanPara = String(paraNum).replace(/^(?:para-?|p)/i, '').trim();
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].paraNums?.has(cleanPara)) return i;
    }
    const targetInt = parseInt(cleanPara, 10);
    if (!Number.isNaN(targetInt)) {
      for (let i = 0; i < chunks.length; i++) {
        const ranges = chunks[i].paraRanges;
        if (ranges && ranges.some(([f, l]) => targetInt >= f && targetInt <= l)) {
          return i;
        }
      }
      // Nearest paragraph fallback matching scrollToTarget: closest <= targetInt, else closest > targetInt
      let bestBeforeIdx = -1;
      let bestBeforeDiff = Infinity;
      let bestAfterIdx = -1;
      let bestAfterDiff = Infinity;
      for (let i = 0; i < chunks.length; i++) {
        const ints = chunks[i].paraInts;
        if (!ints || ints.length === 0) continue;
        for (let j = 0; j < ints.length; j++) {
          const pInt = ints[j];
          if (pInt <= targetInt) {
            const diff = targetInt - pInt;
            if (diff < bestBeforeDiff) {
              bestBeforeDiff = diff;
              bestBeforeIdx = i;
            }
          } else {
            const diff = pInt - targetInt;
            if (diff < bestAfterDiff) {
              bestAfterDiff = diff;
              bestAfterIdx = i;
            }
          }
        }
      }
      if (bestBeforeIdx >= 0) return bestBeforeIdx;
      if (bestAfterIdx >= 0) return bestAfterIdx;
    }
  }

  if (searchQuery && String(searchQuery).trim()) {
    const needle = String(searchQuery).trim().toLowerCase();
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].rawHtml && chunks[i].rawHtml.toLowerCase().includes(needle)) {
        return i;
      }
    }
    if (translations && typeof translations === 'object') {
      for (const langMap of Object.values(translations)) {
        if (!langMap || typeof langMap !== 'object') continue;
        for (const [pIdx, txt] of Object.entries(langMap)) {
          if (typeof txt === 'string' && txt.toLowerCase().includes(needle)) {
            for (let i = 0; i < chunks.length; i++) {
              if (chunks[i].pIndices?.has(String(pIdx))) return i;
            }
          }
        }
      }
    }
  }

  return 0;
}

export function estimateChunkHeight(
  chunk,
  {
    isPaliEnabled = true,
    activeLangCount = 0,
    effectiveSentenceMode = false,
    translationDisplayMode = 'stack',
    showBookLinks = true,
    isMobile = false,
  } = {}
) {
  if (!chunk) return 600;
  const isSide =
    (translationDisplayMode === 'side' || translationDisplayMode === 'side_rev') && !isMobile;
  const charsPerLine = isMobile ? 42 : isSide ? 52 : 82;
  const rawTextChars = Math.round((chunk.charLength || 0) * 0.62);
  const paliLines = Math.max(chunk.paraCount || 1, Math.ceil(rawTextChars / charsPerLine));
  const layerFactor = isSide
    ? 1.15
    : (isPaliEnabled ? 1 : 0) + activeLangCount * (effectiveSentenceMode ? 1.55 : 1.15);
  const lineHeightPx = isMobile ? 27 : 29;
  const paraGapPx = (chunk.paraCount || 1) * (effectiveSentenceMode ? 36 : 22);
  const linkPx = showBookLinks && isPaliEnabled ? (chunk.paraCount || 1) * 14 : 0;
  return Math.max(240, Math.round(paliLines * lineHeightPx * Math.max(0.9, layerFactor) + paraGapPx + linkPx));
}

const ChapterChunk = memo(function ChapterChunk({
  chunk,
  isMounted,
  estimatedHeight,
  measuredHeight,
  registerChunkEl,
  bookCode,
  chapterIndex,
  effectiveSentenceMode,
  isPaliEnabled,
  paliSentMap,
  showSentenceNumbers,
  paliScript,
  highlightSearchTerms,
  searchHighlight,
  hasActiveTrans,
  translations,
  orderedLayers,
  translationDisplayMode,
  translationColors,
  transSentences,
  showBookLinks,
  chapterLinks,
  theme,
}) {
  const nodeRef = useRef(null);

  const paliBaseHtml = React.useMemo(() => {
    if (!isMounted || !chunk?.rawHtml) return null;
    let processed = chunk.rawHtml;
    if (effectiveSentenceMode && isPaliEnabled && paliSentMap) {
      processed = injectPaliSentencesIntoHtml(processed, paliSentMap, {
        showSentenceNumbers,
      });
    }
    if (paliScript && paliScript !== 'roman') {
      processed = transliterateHtml(processed, paliScript);
    }
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
    return processed;
  }, [
    isMounted,
    chunk?.rawHtml,
    effectiveSentenceMode,
    isPaliEnabled,
    paliSentMap,
    showSentenceNumbers,
    paliScript,
    highlightSearchTerms,
    searchHighlight,
  ]);

  const chunkDisplayHtml = React.useMemo(() => {
    if (!isMounted || !paliBaseHtml) return null;
    const currentPaliColors = translationColors?.pali || {};
    const hasCustomPaliColors = Boolean(
      formatCssColor(currentPaliColors.border) ||
      formatCssColor(currentPaliColors.bg) ||
      formatCssColor(currentPaliColors.text)
    );
    if (hasActiveTrans || !isPaliEnabled || hasCustomPaliColors) {
      return injectTranslationsIntoHtml(
        paliBaseHtml,
        translations,
        orderedLayers,
        isPaliEnabled,
        translationDisplayMode,
        translationColors,
        highlightSearchTerms ? searchHighlight : null,
        effectiveSentenceMode,
        transSentences,
        theme,
        {
          showBookLinks,
          chapterLinks,
          paliScript,
          bookCode,
          chapterIndex,
        }
      );
    }
    if (showBookLinks && isPaliEnabled && chapterLinks) {
      return injectBookLinksIntoHtml(paliBaseHtml, chapterLinks, paliScript, effectiveSentenceMode, {
        bookCode,
        chapterIndex,
      });
    }
    return paliBaseHtml;
  }, [
    isMounted,
    paliBaseHtml,
    paliScript,
    searchHighlight,
    highlightSearchTerms,
    hasActiveTrans,
    translations,
    orderedLayers,
    isPaliEnabled,
    translationDisplayMode,
    translationColors,
    effectiveSentenceMode,
    transSentences,
    showBookLinks,
    chapterLinks,
    theme,
    bookCode,
    chapterIndex,
  ]);

  const setNodeRef = useCallback(
    (node) => {
      nodeRef.current = node;
      registerChunkEl?.(chunk.index, node);
    },
    [registerChunkEl, chunk.index]
  );

  if (!isMounted) {
    const pbEntries = chunk.lastPbByEd ? Object.entries(chunk.lastPbByEd) : [];
    const carriedHeading = chunk.lastHeading
      ? paliScript && paliScript !== 'roman'
        ? convertPaliScript(chunk.lastHeading, paliScript) || chunk.lastHeading
        : chunk.lastHeading
      : undefined;
    return (
      <div
        ref={setNodeRef}
        data-chunk-index={chunk.index}
        data-chunk-virtualized="1"
        data-chunk-last-heading={carriedHeading}
        data-chunk-prev-para={chunk.prevParaNum || undefined}
        className="chapter-chunk chapter-chunk-placeholder"
        style={{ minHeight: measuredHeight || estimatedHeight }}
      >
        {pbEntries.map(([ed, page]) => (
          <span
            key={ed}
            className="pb hidden"
            data-ed={ed}
            data-page={page}
            data-chunk-pb="1"
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      data-chunk-index={chunk.index}
      data-chunk-prev-para={chunk.prevParaNum || undefined}
      className="chapter-chunk"
      dangerouslySetInnerHTML={{ __html: chunkDisplayHtml || '' }}
    />
  );
});

// Memoized Chapter Block with Pre-Buffering Intersection Observer, Paragraph-Chunk Windowing,
// Lazy Translation Loading, and Non-Blocking Linked Definitions
export const ChapterBlock = memo(function ChapterBlock({
  chapter,
  bookCode,
  html,
  isLoading,
  onVisible,
  isCurrentOrTarget = false,
  anchorEnd = false,
  scrollCtxRef = null,
  targetParaIndex = null,
  targetParaNum = null,
  targetPage = null,
  targetPageSystem = null,
  paliScript = 'roman',
  searchHighlight = null,
  highlightSearchTerms = true,
  activeLangs = [],
  orderedLayers = [],
  isPaliEnabled = true,
  translationDisplayMode = 'stack',
  translationColors = {},
  sentenceMode = false,
  showBookLinks = true,
  isParallelSyncActive = false,
  onLinksLoaded = null,
  theme = 'classic',
}) {
  const blockRef = useRef(null);
  const activeLangsKey = activeLangs.join(',');
  const hasActiveTrans = activeLangs.length > 0;
  const { effectiveSentenceMode, showSentenceNumbers } = getSentenceDisplayFlags({
    sentenceMode,
    hasActiveTrans,
    isPaliEnabled,
    orderedLayers,
    translationDisplayMode,
  });
  const activeLangsKeyWithMode = activeLangsKey ? `${activeLangsKey}:${effectiveSentenceMode ? 'sent' : 'para'}` : '';

  const initialLangsToFetch = activeLangsKey ? activeLangsKey.split(',').filter(Boolean) : [];
  const initialCachedTrans =
    html && bookCode && initialLangsToFetch.length > 0 && typeof getCachedChapterTranslations === 'function'
      ? getCachedChapterTranslations(bookCode, chapter.chapter_index, initialLangsToFetch, {
          sentences: effectiveSentenceMode,
        })
      : null;
  const canUseBundle =
    typeof isLocalDynamicHost === 'function' &&
    isLocalDynamicHost() &&
    typeof fetchChapterBundle === 'function';

  const initialCachedPaliSent =
    effectiveSentenceMode && isPaliEnabled && html && bookCode && typeof getCachedPaliSentences === 'function'
      ? getCachedPaliSentences(bookCode, chapter.chapter_index)
      : null;
  const initialCachedLinks =
    (showBookLinks || isParallelSyncActive) && html && bookCode && typeof getCachedChapterLinks === 'function'
      ? getCachedChapterLinks(bookCode, chapter.chapter_index)
      : null;

  const [translations, setTranslations] = React.useState(() => initialCachedTrans?.translations || {});
  const [transSentences, setTransSentences] = React.useState(() =>
    effectiveSentenceMode ? initialCachedTrans?.sentences || {} : {}
  );
  const [paliSentMap, setPaliSentMap] = React.useState(() =>
    extractPaliChapMap(initialCachedPaliSent, chapter.chapter_index)
  );
  const [chapterLinks, setChapterLinks] = React.useState(() => initialCachedLinks || null);
  const [isTransLoading, setIsTransLoading] = React.useState(false);
  const [isPaliSentLoading, setIsPaliSentLoading] = React.useState(false);
  const [transFetchedKey, setTransFetchedKey] = React.useState(() =>
    initialCachedTrans ? activeLangsKeyWithMode : null
  );
  const [paliSentFetched, setPaliSentFetched] = React.useState(() => Boolean(initialCachedPaliSent));
  const [isNearViewport, setIsNearViewport] = React.useState(isCurrentOrTarget);
  const [isWithinDomWindow, setIsWithinDomWindow] = React.useState(true);
  const measuredHeightRef = useRef(0);

  const transFetchedKeyRef = useRef(transFetchedKey);
  transFetchedKeyRef.current = transFetchedKey;
  const paliSentFetchedRef = useRef(paliSentFetched);
  paliSentFetchedRef.current = paliSentFetched;
  const linksNotifiedKeyRef = useRef('');

  // Synchronously resolve prefetched/cached translations & Pāḷi sentences during
  // render when a chapter enters the viewport (or receives HTML from loadChapter)
  // so prefetched chapters render on Frame 1 without flashing "Loading happiness...".
  const renderSyncTrans =
    hasActiveTrans &&
    html &&
    bookCode &&
    (isNearViewport || isCurrentOrTarget) &&
    transFetchedKey !== activeLangsKeyWithMode &&
    typeof getCachedChapterTranslations === 'function'
      ? getCachedChapterTranslations(bookCode, chapter.chapter_index, activeLangs, {
          sentences: effectiveSentenceMode,
        })
      : null;

  const renderSyncPaliSent =
    effectiveSentenceMode &&
    isPaliEnabled &&
    html &&
    bookCode &&
    (isNearViewport || isCurrentOrTarget) &&
    !paliSentFetched &&
    typeof getCachedPaliSentences === 'function'
      ? getCachedPaliSentences(bookCode, chapter.chapter_index)
      : null;

  const effectiveTranslations = renderSyncTrans
    ? renderSyncTrans.translations || translations
    : translations;
  const effectiveTransSentences = renderSyncTrans
    ? effectiveSentenceMode
      ? renderSyncTrans.sentences || transSentences
      : transSentences
    : transSentences;
  const effectivePaliSentMap = renderSyncPaliSent
    ? extractPaliChapMap(renderSyncPaliSent, chapter.chapter_index)
    : paliSentMap;

  // Split huge chapters (>50 paragraphs) into 30-paragraph chunks so opening a
  // giant commentary like vin01a.att only transforms & mounts nearby chunks.
  const chunks = React.useMemo(() => splitChapterHtmlIntoChunks(html), [html]);
  const isChunked = chunks.length > 1;
  const isChunkedRef = useRef(isChunked);
  isChunkedRef.current = isChunked;

  const chunkElsRef = useRef(new Map());
  const chunkHeightsRef = useRef(new Map());
  const chunkPrevHeightsRef = useRef(new Map());
  const chunkPrevMountedRef = useRef(new Map());
  const chunkMountHintRef = useRef(new Map());
  const prevChapterIdentityRef = useRef('');
  const prevLayoutSettingsRef = useRef('');
  const prevContentSigRef = useRef(null);
  const [observerMountedChunks, setObserverMountedChunks] = React.useState(() => new Set());

  const contentSignature = React.useMemo(
    () => ({
      html,
      translations: effectiveTranslations,
      transSentences: effectiveTransSentences,
      paliSentMap: effectivePaliSentMap,
      chapterLinks,
      showBookLinks,
      paliScript,
      isPaliEnabled,
      effectiveSentenceMode,
      showSentenceNumbers,
      translationDisplayMode,
      orderedLayers,
      highlightSearchTerms,
      searchHighlight,
    }),
    [
      html,
      effectiveTranslations,
      effectiveTransSentences,
      effectivePaliSentMap,
      chapterLinks,
      showBookLinks,
      paliScript,
      isPaliEnabled,
      effectiveSentenceMode,
      showSentenceNumbers,
      translationDisplayMode,
      orderedLayers,
      highlightSearchTerms,
      searchHighlight,
    ]
  );

  const registerChunkEl = useCallback((idx, node) => {
    if (node) {
      chunkElsRef.current.set(idx, node);
    } else {
      chunkElsRef.current.delete(idx);
    }
  }, []);

  // Reset observer-mounted chunk set when switching chapter HTML identity
  useEffect(() => {
    setObserverMountedChunks(new Set());
  }, [bookCode, chapter.chapter_index]);

  const targetChunkIdx = React.useMemo(() => {
    if (!isChunked) return 0;
    return findTargetChunkIndex(chunks, {
      paraIndex: targetParaIndex,
      paraNum: targetParaNum,
      page: targetPage,
      pageSystem: targetPageSystem,
      searchQuery: isCurrentOrTarget ? searchHighlight?.query : null,
      translations: isCurrentOrTarget && searchHighlight?.query ? effectiveTranslations : null,
    });
  }, [
    isChunked,
    chunks,
    targetParaIndex,
    targetParaNum,
    targetPage,
    targetPageSystem,
    isCurrentOrTarget,
    searchHighlight?.query,
    effectiveTranslations,
  ]);

  const forcedMountedChunks = React.useMemo(() => {
    const set = new Set();
    if (!isChunked || typeof IntersectionObserver === 'undefined') {
      for (let i = 0; i < chunks.length; i++) set.add(i);
      return set;
    }
    if (isCurrentOrTarget) {
      const hasExplicitTarget = Boolean(
        (targetParaIndex !== undefined && targetParaIndex !== null && targetParaIndex !== '') ||
        (targetParaNum !== undefined && targetParaNum !== null && String(targetParaNum).trim() !== '') ||
        (targetPage !== undefined && targetPage !== null && String(targetPage).trim() !== '') ||
        (searchHighlight?.query && String(searchHighlight.query).trim() !== '')
      );
      if (anchorEnd && !hasExplicitTarget) {
        const start = Math.max(0, chunks.length - 3);
        for (let i = start; i < chunks.length; i++) set.add(i);
      } else {
        const start = Math.max(0, targetChunkIdx - 1);
        const end = Math.min(chunks.length - 1, targetChunkIdx + 3);
        for (let i = start; i <= end; i++) set.add(i);
      }
    } else {
      set.add(0);
      if (chunks.length > 1) set.add(1);
    }
    return set;
  }, [
    isChunked,
    chunks.length,
    isCurrentOrTarget,
    anchorEnd,
    targetChunkIdx,
    targetParaIndex,
    targetParaNum,
    targetPage,
    searchHighlight?.query,
  ]);

  useEffect(() => {
    if (isCurrentOrTarget) {
      setIsNearViewport(true);
      setIsWithinDomWindow(true);
    }
  }, [isCurrentOrTarget]);

  // IntersectionObserver for lazy loading chapter HTML & translations with generous
  // margins so fast mobile scrolling never outruns chapter loading, plus a wide
  // DOM virtualization window to shed far-off-screen chapter DOM nodes.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      setIsWithinDomWindow(true);
      return;
    }
    if (!blockRef.current) return;

    const loadRootMargin =
      typeof window !== 'undefined' && window.innerWidth < 768 ? '2200px 0px' : '2400px 0px';
    const loadObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          if (!html) {
            onVisible(chapter.chapter_index);
          }
          setIsNearViewport(true);
        }
      },
      { rootMargin: loadRootMargin }
    );

    const domObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const el = blockRef.current;
        if (entry.isIntersecting) {
          if (
            !isChunkedRef.current &&
            el &&
            el.getAttribute('data-trans-loading') !== '1' &&
            el.getAttribute('data-virtualized') !== '1'
          ) {
            const h = Math.round(entry.boundingClientRect?.height || 0);
            if (h > 0) chunkPrevHeightsRef.current.set(0, h);
          }
          setIsWithinDomWindow(true);
        } else {
          if (
            el &&
            el.getAttribute('data-trans-loading') !== '1' &&
            el.getAttribute('data-virtualized') !== '1'
          ) {
            const h = Math.round(entry.boundingClientRect?.height || 0) || el.offsetHeight || 0;
            if (h > 0) measuredHeightRef.current = h;
          }
          setIsWithinDomWindow(false);
        }
      },
      { rootMargin: '4500px 0px' }
    );

    loadObserver.observe(blockRef.current);
    domObserver.observe(blockRef.current);
    return () => {
      loadObserver.disconnect();
      domObserver.disconnect();
    };
  }, [html, chapter.chapter_index, onVisible]);

  // Fast single-roundtrip chapter bundle for local offline / VPS dynamic hosts.
  // Intentionally excludes heavy linked-definitions JSON (up to 2-3 MB on commentaries)
  // so text + translations settle in a few ms while links load non-blockingly in parallel.
  useEffect(() => {
    if (!canUseBundle) return;

    const langsToFetch = activeLangsKey ? activeLangsKey.split(',').filter(Boolean) : [];
    const needTrans = Boolean(html && bookCode && activeLangsKey && langsToFetch.length > 0);
    const needPaliSent = Boolean(html && bookCode && effectiveSentenceMode && isPaliEnabled);

    if (!activeLangsKey) {
      setTranslations({});
      setTransSentences({});
      setTransFetchedKey('');
      transFetchedKeyRef.current = '';
      setIsTransLoading(false);
    }
    if (!effectiveSentenceMode || !isPaliEnabled) {
      if (!effectiveSentenceMode) {
        setPaliSentMap(null);
        setPaliSentFetched(false);
        paliSentFetchedRef.current = false;
      } else if (!isPaliEnabled && !paliSentMap) {
        setPaliSentFetched(false);
        paliSentFetchedRef.current = false;
      }
      setIsPaliSentLoading(false);
    }
    if (!html || !bookCode) return;

    const near = Boolean(isNearViewport || isCurrentOrTarget);
    const syncTrans =
      needTrans && near && typeof getCachedChapterTranslations === 'function'
        ? getCachedChapterTranslations(bookCode, chapter.chapter_index, langsToFetch, {
            sentences: effectiveSentenceMode,
          })
        : null;
    if (syncTrans && transFetchedKeyRef.current !== activeLangsKeyWithMode) {
      setTranslations(syncTrans.translations || {});
      setTransSentences(effectiveSentenceMode ? syncTrans.sentences || {} : {});
      setTransFetchedKey(activeLangsKeyWithMode);
      transFetchedKeyRef.current = activeLangsKeyWithMode;
      setIsTransLoading(false);
      blockRef.current?.removeAttribute('data-trans-loading');
      blockRef.current?.setAttribute('data-trans-settled', '1');
    }

    const syncPaliSent =
      needPaliSent && typeof getCachedPaliSentences === 'function'
        ? getCachedPaliSentences(bookCode, chapter.chapter_index)
        : null;
    if (syncPaliSent && !paliSentFetchedRef.current) {
      setPaliSentMap(extractPaliChapMap(syncPaliSent, chapter.chapter_index));
      setPaliSentFetched(true);
      paliSentFetchedRef.current = true;
      setIsPaliSentLoading(false);
    }

    if (!near) return;

    const missingTrans = Boolean(needTrans && !syncTrans && transFetchedKeyRef.current !== activeLangsKeyWithMode);
    const missingPaliSent = Boolean(needPaliSent && !syncPaliSent && !paliSentFetchedRef.current);
    if (!missingTrans && !missingPaliSent) return;

    let cancelled = false;
    if (missingTrans) {
      blockRef.current?.removeAttribute('data-trans-settled');
      blockRef.current?.setAttribute('data-trans-loading', '1');
      setIsTransLoading(true);
    }
    if (missingPaliSent) {
      setIsPaliSentLoading(true);
    }

    const runFallbackIndividual = () => {
      if (missingTrans) {
        fetchChapterTranslations(bookCode, chapter.chapter_index, langsToFetch, {
          sentences: effectiveSentenceMode,
        })
          .then((data) => {
            if (cancelled) return;
            setTranslations(data?.translations || {});
            setTransSentences(effectiveSentenceMode ? data?.sentences || {} : {});
            setTransFetchedKey(activeLangsKeyWithMode);
            transFetchedKeyRef.current = activeLangsKeyWithMode;
            setIsTransLoading(false);
          })
          .catch((err) => {
            console.warn(`[ChapterBlock] Error loading translations for ch ${chapter.chapter_index}:`, err);
            if (!cancelled) {
              setTransFetchedKey(activeLangsKeyWithMode);
              transFetchedKeyRef.current = activeLangsKeyWithMode;
              setIsTransLoading(false);
            }
          });
      }
      if (missingPaliSent) {
        fetchPaliSentences(bookCode, chapter.chapter_index)
          .then((data) => {
            if (cancelled) return;
            setPaliSentMap(extractPaliChapMap(data, chapter.chapter_index));
            setPaliSentFetched(true);
            paliSentFetchedRef.current = true;
            setIsPaliSentLoading(false);
          })
          .catch(() => {
            if (!cancelled) {
              setPaliSentFetched(true);
              paliSentFetchedRef.current = true;
              setIsPaliSentLoading(false);
            }
          });
      }
    };

    fetchChapterBundle(bookCode, chapter.chapter_index, {
      includeHtml: false,
      langs: missingTrans ? langsToFetch : [],
      sentences: missingTrans && effectiveSentenceMode,
      paliSentences: missingPaliSent,
      links: false,
    })
      .then((bundle) => {
        if (cancelled) return;
        if (!bundle) {
          runFallbackIndividual();
          return;
        }
        if (missingTrans) {
          setTranslations(bundle.translations || {});
          setTransSentences(effectiveSentenceMode ? bundle.sentences || {} : {});
          setTransFetchedKey(activeLangsKeyWithMode);
          transFetchedKeyRef.current = activeLangsKeyWithMode;
          setIsTransLoading(false);
        }
        if (missingPaliSent) {
          setPaliSentMap(extractPaliChapMap(bundle.pali_sentences, chapter.chapter_index));
          setPaliSentFetched(true);
          paliSentFetchedRef.current = true;
          setIsPaliSentLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) runFallbackIndividual();
      });

    return () => {
      cancelled = true;
    };
  }, [
    canUseBundle,
    html,
    bookCode,
    chapter.chapter_index,
    activeLangsKey,
    activeLangsKeyWithMode,
    effectiveSentenceMode,
    isPaliEnabled,
    isNearViewport,
    isCurrentOrTarget,
  ]);

  // Task 3: Lazy load translations ONLY when chapter is near viewport (or current/target) and active translation languages exist
  useEffect(() => {
    if (canUseBundle) return;
    if (!html || !bookCode || !activeLangsKey || (!isNearViewport && !isCurrentOrTarget)) {
      if (!activeLangsKey) {
        setTranslations({});
        setTransSentences({});
        setTransFetchedKey('');
        transFetchedKeyRef.current = '';
        setIsTransLoading(false);
      }
      return;
    }

    let isMounted = true;
    const langsToFetch = activeLangsKey.split(',').filter(Boolean);
    if (langsToFetch.length === 0) {
      setTranslations({});
      setTransSentences({});
      setTransFetchedKey(activeLangsKeyWithMode);
      transFetchedKeyRef.current = activeLangsKeyWithMode;
      setIsTransLoading(false);
      return;
    }

    const syncCached =
      typeof getCachedChapterTranslations === 'function'
        ? getCachedChapterTranslations(bookCode, chapter.chapter_index, langsToFetch, {
            sentences: effectiveSentenceMode,
          })
        : null;
    if (syncCached) {
      setTranslations(syncCached.translations || {});
      setTransSentences(effectiveSentenceMode ? syncCached.sentences || {} : {});
      setTransFetchedKey(activeLangsKeyWithMode);
      transFetchedKeyRef.current = activeLangsKeyWithMode;
      setIsTransLoading(false);
      blockRef.current?.removeAttribute('data-trans-loading');
      blockRef.current?.setAttribute('data-trans-settled', '1');
      return;
    }

    blockRef.current?.removeAttribute('data-trans-settled');
    blockRef.current?.setAttribute('data-trans-loading', '1');
    setIsTransLoading(true);

    fetchChapterTranslations(bookCode, chapter.chapter_index, langsToFetch, { sentences: effectiveSentenceMode })
      .then((data) => {
        if (!isMounted) return;
        setTranslations(data?.translations || {});
        setTransSentences(effectiveSentenceMode ? (data?.sentences || {}) : {});
        setTransFetchedKey(activeLangsKeyWithMode);
        transFetchedKeyRef.current = activeLangsKeyWithMode;
        setIsTransLoading(false);
      })
      .catch((err) => {
        console.warn(`[ChapterBlock] Error loading translations for ch ${chapter.chapter_index}:`, err);
        if (isMounted) {
          setTransFetchedKey(activeLangsKeyWithMode);
          transFetchedKeyRef.current = activeLangsKeyWithMode;
          setIsTransLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canUseBundle, html, bookCode, chapter.chapter_index, activeLangsKey, isNearViewport, isCurrentOrTarget, effectiveSentenceMode, activeLangsKeyWithMode]);

  // Pāḷi sentence map for sentence display mode (per-chapter on dynamic hosts, book-level static fallback).
  // Only needed when at least one translation is enabled; Pāḷi alone renders as paragraphs.
  useEffect(() => {
    if (canUseBundle) return;
    if (!effectiveSentenceMode || !isPaliEnabled || !html || !bookCode) {
      if (!effectiveSentenceMode) {
        setPaliSentMap(null);
        setPaliSentFetched(false);
        paliSentFetchedRef.current = false;
      } else if (!isPaliEnabled && !paliSentMap) {
        setPaliSentFetched(false);
        paliSentFetchedRef.current = false;
      }
      setIsPaliSentLoading(false);
      return;
    }
    const syncCached =
      typeof getCachedPaliSentences === 'function'
        ? getCachedPaliSentences(bookCode, chapter.chapter_index)
        : null;
    if (syncCached) {
      setPaliSentMap(extractPaliChapMap(syncCached, chapter.chapter_index));
      setPaliSentFetched(true);
      paliSentFetchedRef.current = true;
      setIsPaliSentLoading(false);
      return;
    }
    let cancelled = false;
    setIsPaliSentLoading(true);
    fetchPaliSentences(bookCode, chapter.chapter_index)
      .then((data) => {
        if (cancelled) return;
        setPaliSentMap(extractPaliChapMap(data, chapter.chapter_index));
        setPaliSentFetched(true);
        paliSentFetchedRef.current = true;
        setIsPaliSentLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setPaliSentFetched(true);
          paliSentFetchedRef.current = true;
          setIsPaliSentLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canUseBundle, effectiveSentenceMode, isPaliEnabled, html, bookCode, chapter.chapter_index]);

  const transFetchPending =
    !renderSyncTrans && (isTransLoading || transFetchedKey !== activeLangsKeyWithMode);
  const paliSentFetchPending =
    effectiveSentenceMode &&
    isPaliEnabled &&
    !renderSyncPaliSent &&
    (isPaliSentLoading || !paliSentFetched);
  const isTransPending =
    hasActiveTrans &&
    (isNearViewport || isCurrentOrTarget) &&
    (transFetchPending || paliSentFetchPending);
  const isTransSettledNow =
    hasActiveTrans &&
    !isTransPending &&
    (transFetchedKey === activeLangsKeyWithMode || Boolean(renderSyncTrans));

  // Non-blocking inline Linked Definitions loader (runs independently after text +
  // translations have settled so multi-MB commentary links never compete with initial render).
  useEffect(() => {
    const needLinks = (showBookLinks && isPaliEnabled) || isParallelSyncActive;
    if (
      !needLinks ||
      !html ||
      !bookCode ||
      (!isNearViewport && !isCurrentOrTarget) ||
      (!isWithinDomWindow && !isCurrentOrTarget)
    ) {
      if (!showBookLinks || !isPaliEnabled) setChapterLinks(null);
      return;
    }
    if (isTransPending) return;
    const notifyKey = `${bookCode}:${chapter.chapter_index}`;
    const syncCached =
      typeof getCachedChapterLinks === 'function'
        ? getCachedChapterLinks(bookCode, chapter.chapter_index)
        : null;
    if (syncCached) {
      blockRef.current?.removeAttribute('data-links-loading');
      setChapterLinks((prev) => (prev === syncCached ? prev : syncCached));
      if (linksNotifiedKeyRef.current !== notifyKey) {
        linksNotifiedKeyRef.current = notifyKey;
        onLinksLoaded?.(chapter.chapter_index, syncCached);
      }
      return;
    }
    let cancelled = false;
    blockRef.current?.setAttribute('data-links-loading', '1');
    fetchChapterLinks(bookCode, chapter.chapter_index)
      .then((data) => {
        if (cancelled) return;
        blockRef.current?.removeAttribute('data-links-loading');
        const paras = data?.paragraphs || null;
        setChapterLinks(paras);
        linksNotifiedKeyRef.current = notifyKey;
        onLinksLoaded?.(chapter.chapter_index, paras);
      })
      .catch(() => {
        if (!cancelled) {
          blockRef.current?.removeAttribute('data-links-loading');
          setChapterLinks(null);
        }
      });
    return () => {
      cancelled = true;
      blockRef.current?.removeAttribute('data-links-loading');
    };
  }, [
    showBookLinks,
    isParallelSyncActive,
    isPaliEnabled,
    html,
    bookCode,
    chapter.chapter_index,
    isNearViewport,
    isCurrentOrTarget,
    isWithinDomWindow,
    isTransPending,
    onLinksLoaded,
  ]);

  // Keep data-trans-loading and data-trans-settled DOM attributes strictly in sync with isTransPending
  useEffect(() => {
    if (!blockRef.current) return;
    if (hasActiveTrans) {
      if (isTransPending) {
        blockRef.current.setAttribute('data-trans-loading', '1');
        blockRef.current.removeAttribute('data-trans-settled');
      } else if (isTransSettledNow) {
        blockRef.current.removeAttribute('data-trans-loading');
        blockRef.current.setAttribute('data-trans-settled', '1');
      } else {
        blockRef.current.removeAttribute('data-trans-loading');
        blockRef.current.removeAttribute('data-trans-settled');
      }
    } else {
      blockRef.current.removeAttribute('data-trans-loading');
      blockRef.current.removeAttribute('data-trans-settled');
    }
  }, [isTransPending, hasActiveTrans, isTransSettledNow]);

  // Passively capture mounted chunk heights via ResizeObserver (runs after natural
  // layout without forcing synchronous reflow) so chunks mounted on initial paint
  // or strictly below the viewport during fast downward scrolling always have an
  // accurate pre-update height for above-viewport scroll compensation when async
  // chapterLinks arrive later.
  useEffect(() => {
    if (
      !html ||
      chunks.length === 0 ||
      (!isCurrentOrTarget && !isWithinDomWindow) ||
      (hasActiveTrans && isTransPending) ||
      typeof ResizeObserver === 'undefined'
    ) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const el = entry.target;
        if (!el || el.getAttribute('data-chunk-virtualized') === '1') continue;
        const idx = Number(el.getAttribute('data-chunk-index'));
        if (Number.isNaN(idx)) continue;
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize;
        const h = Math.round(borderBox?.blockSize || entry.contentRect?.height || 0);
        if (h > 0) {
          chunkHeightsRef.current.set(idx, h);
          chunkPrevHeightsRef.current.set(idx, h);
        }
      }
    });

    chunkElsRef.current.forEach((node) => {
      resizeObserver.observe(node);
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [html, chunks, isCurrentOrTarget, isWithinDomWindow, hasActiveTrans, isTransPending]);

  // Shared 2-observer hysteresis window for chunked chapters (>50 paragraphs):
  // mount chunks 3600px ahead so fast iOS momentum flicks always hit eagerly
  // painted text, and unmount chunks >6500px away after recording height from
  // entry.boundingClientRect (avoiding forced synchronous offsetHeight reflows).
  useEffect(() => {
    if (
      !isChunked ||
      !html ||
      (!isCurrentOrTarget && !isWithinDomWindow) ||
      (hasActiveTrans && isTransPending) ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }

    const mountObserver = new IntersectionObserver(
      (entries) => {
        const toMount = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const el = entry.target;
          const idx = Number(el.getAttribute('data-chunk-index'));
          if (Number.isNaN(idx)) continue;
          const isPlaceholder = el.getAttribute('data-chunk-virtualized') === '1';
          if (!isPlaceholder) {
            const h = Math.round(entry.boundingClientRect?.height || 0);
            if (h > 0) {
              chunkHeightsRef.current.set(idx, h);
              chunkPrevHeightsRef.current.set(idx, h);
            }
          }
          if (!entry.isIntersecting) continue;
          if (isPlaceholder && entry.boundingClientRect) {
            chunkMountHintRef.current.set(idx, {
              top: entry.boundingClientRect.top,
              bottom: entry.boundingClientRect.bottom,
              rootTop: entry.rootBounds?.top ?? 0,
            });
          }
          toMount.push(idx);
        }
        if (toMount.length === 0) return;
        setObserverMountedChunks((prev) => {
          let changed = false;
          for (let i = 0; i < toMount.length; i++) {
            if (!prev.has(toMount[i])) {
              changed = true;
              break;
            }
          }
          if (!changed) return prev;
          const next = new Set(prev);
          for (let i = 0; i < toMount.length; i++) {
            next.add(toMount[i]);
          }
          return next;
        });
      },
      { rootMargin: '3600px 0px' }
    );

    const unmountObserver = new IntersectionObserver(
      (entries) => {
        const toUnmount = [];
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          if (entry.isIntersecting) continue;
          const el = entry.target;
          const idx = Number(el.getAttribute('data-chunk-index'));
          if (Number.isNaN(idx)) continue;
          if (el.getAttribute('data-chunk-virtualized') !== '1') {
            const h = Math.round(entry.boundingClientRect?.height || 0) || el.offsetHeight || 0;
            if (h > 0) chunkHeightsRef.current.set(idx, h);
          }
          toUnmount.push(idx);
        }
        if (toUnmount.length === 0) return;
        setObserverMountedChunks((prev) => {
          let changed = false;
          for (let i = 0; i < toUnmount.length; i++) {
            if (prev.has(toUnmount[i])) {
              changed = true;
              break;
            }
          }
          if (!changed) return prev;
          const next = new Set(prev);
          for (let i = 0; i < toUnmount.length; i++) {
            next.delete(toUnmount[i]);
          }
          return next;
        });
      },
      { rootMargin: '6500px 0px' }
    );

    chunkElsRef.current.forEach((node) => {
      mountObserver.observe(node);
      unmountObserver.observe(node);
    });

    return () => {
      mountObserver.disconnect();
      unmountObserver.disconnect();
    };
  }, [isChunked, html, chunks, isCurrentOrTarget, isWithinDomWindow, hasActiveTrans, isTransPending]);

  // Batched height measurement & above-viewport scroll compensation across all
  // chunks in a single commit: performs all getBoundingClientRect() reads first,
  // then applies at most ONE scroll write (preventing interleaved read->write
  // layout thrashing across chunks). Skips forced layout on initial mount (no
  // previous height) and on chunks mounting strictly below the viewport during
  // fast downward scrolling.
  useIsomorphicLayoutEffect(() => {
    const chapterIdentityKey = `${bookCode}:${chapter.chapter_index}:${html ? html.length : 0}`;
    const isNewChapterIdentity = prevChapterIdentityRef.current !== chapterIdentityKey;
    if (isNewChapterIdentity) {
      prevChapterIdentityRef.current = chapterIdentityKey;
      chunkHeightsRef.current.clear();
      chunkPrevHeightsRef.current.clear();
      chunkPrevMountedRef.current.clear();
      chunkMountHintRef.current.clear();
      prevContentSigRef.current = contentSignature;
    }

    const layoutSettingsKey = `${activeLangsKeyWithMode}|${translationDisplayMode}|${isPaliEnabled}|${paliScript}|${showBookLinks}`;
    if (prevLayoutSettingsRef.current !== layoutSettingsKey) {
      prevLayoutSettingsRef.current = layoutSettingsKey;
      chunkHeightsRef.current.clear();
    }

    const chunksRendered = Boolean(
      html &&
        chunks.length > 0 &&
        (isCurrentOrTarget || isWithinDomWindow) &&
        !(hasActiveTrans && isTransPending)
    );
    if (!chunksRendered) {
      chunkPrevHeightsRef.current.clear();
      chunkPrevMountedRef.current.clear();
      chunkMountHintRef.current.clear();
      prevContentSigRef.current = contentSignature;
      return;
    }

    const contentChanged =
      !isNewChapterIdentity &&
      prevContentSigRef.current !== null &&
      prevContentSigRef.current !== contentSignature;
    prevContentSigRef.current = contentSignature;

    const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 768;
    const candidates = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const idx = chunk.index;
      const isMounted =
        !isChunked || forcedMountedChunks.has(idx) || observerMountedChunks.has(idx);
      const wasMounted = chunkPrevMountedRef.current.get(idx) === true;
      chunkPrevMountedRef.current.set(idx, isMounted);

      if (!isMounted) {
        const knownH =
          chunkHeightsRef.current.get(idx) ||
          estimateChunkHeight(chunk, {
            isPaliEnabled,
            activeLangCount: activeLangs.length,
            effectiveSentenceMode,
            translationDisplayMode,
            showBookLinks,
            isMobile: isMobileViewport,
          });
        chunkPrevHeightsRef.current.set(idx, knownH);
        chunkMountHintRef.current.delete(idx);
        continue;
      }

      const mountHint = chunkMountHintRef.current.get(idx);
      chunkMountHintRef.current.delete(idx);

      const oldH = chunkPrevHeightsRef.current.get(idx) || 0;
      if (!(oldH > 0)) continue;

      if (!wasMounted && mountHint && mountHint.top > (mountHint.rootTop ?? 0) + 250) {
        chunkPrevHeightsRef.current.delete(idx);
        continue;
      }

      if (!wasMounted || contentChanged) {
        const el = chunkElsRef.current.get(idx);
        if (el && typeof el.getBoundingClientRect === 'function') {
          candidates.push({ idx, el, oldH });
        }
      }
    }

    if (candidates.length === 0) return;

    // Phase 1: Batched DOM reads (single getBoundingClientRect() per candidate; no offsetHeight)
    const ctx = scrollCtxRef?.current;
    const canCompensate = Boolean(ctx && !ctx.isJumping?.());
    const scrollEl =
      canCompensate && !ctx.useWindowScroll ? ctx.getScrollContainer?.() : null;
    const vpTop =
      canCompensate && scrollEl && typeof scrollEl.getBoundingClientRect === 'function'
        ? scrollEl.getBoundingClientRect().top
        : 0;

    const measurements = [];
    for (let i = 0; i < candidates.length; i++) {
      const { idx, el, oldH } = candidates[i];
      const rect = el.getBoundingClientRect();
      const newH = Math.round(rect.height || 0);
      if (newH > 0) {
        chunkHeightsRef.current.set(idx, newH);
        chunkPrevHeightsRef.current.set(idx, newH);
      }
      if (canCompensate && newH > 0 && Math.abs(newH - oldH) >= 2) {
        measurements.push({
          rectTop: rect.top,
          rectBottom: rect.bottom,
          prevHeight: oldH,
          nextHeight: newH,
        });
      }
    }

    if (measurements.length === 0) return;

    // Phase 2: Single scroll adjustment write
    const totalDelta = computeBatchedAboveViewportScrollDelta(measurements, vpTop);
    if (totalDelta !== 0) {
      if (typeof ctx.adjustScrollBy === 'function') {
        ctx.adjustScrollBy(totalDelta);
      } else if (ctx.useWindowScroll) {
        if (typeof window !== 'undefined' && typeof window.scrollBy === 'function') {
          window.scrollBy(0, totalDelta);
        }
      } else if (scrollEl) {
        scrollEl.scrollTop += totalDelta;
      }
    }
  }, [
    bookCode,
    chapter.chapter_index,
    html,
    chunks,
    isChunked,
    forcedMountedChunks,
    observerMountedChunks,
    isCurrentOrTarget,
    isWithinDomWindow,
    hasActiveTrans,
    isTransPending,
    contentSignature,
    activeLangsKeyWithMode,
    activeLangs.length,
    isPaliEnabled,
    effectiveSentenceMode,
    translationDisplayMode,
    paliScript,
    showBookLinks,
    scrollCtxRef,
  ]);

  if (html && chunks.length > 0) {
    const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 768;

    if (!isCurrentOrTarget && !isWithinDomWindow) {
      let estVirtualizedHeight = measuredHeightRef.current;
      if (!(estVirtualizedHeight > 220)) {
        estVirtualizedHeight = 0;
        for (let i = 0; i < chunks.length; i++) {
          estVirtualizedHeight += estimateChunkHeight(chunks[i], {
            isPaliEnabled,
            activeLangCount: activeLangs.length,
            effectiveSentenceMode,
            translationDisplayMode,
            showBookLinks,
            isMobile: isMobileViewport,
          });
        }
      }
      return (
        <div
          ref={blockRef}
          id={`chap-${chapter.chapter_index}`}
          data-chapter={chapter.chapter_index}
          data-virtualized="1"
          className="chapter-content-block chapter-virtualized-placeholder"
          style={{ minHeight: estVirtualizedHeight || 600 }}
        />
      );
    }

    if (hasActiveTrans && isTransPending) {
      let estLoadingHeight = 0;
      if (measuredHeightRef.current <= 220) {
        for (let i = 0; i < chunks.length; i++) {
          estLoadingHeight += estimateChunkHeight(chunks[i], {
            isPaliEnabled,
            activeLangCount: activeLangs.length,
            effectiveSentenceMode,
            translationDisplayMode,
            showBookLinks,
            isMobile: isMobileViewport,
          });
        }
      }
      const loadingStyle =
        (measuredHeightRef.current > 220 ? { minHeight: measuredHeightRef.current } : undefined) ||
        (estLoadingHeight > 480 ? { minHeight: estLoadingHeight } : undefined);
      const isTallLoading = (loadingStyle?.minHeight || 0) > 1100;
      return (
        <div
          ref={blockRef}
          id={`chap-${chapter.chapter_index}`}
          data-chapter={chapter.chapter_index}
          data-trans-loading="1"
          style={loadingStyle}
          className={`chapter-content-block reader-chapter-trans-loading px-6 my-6 border border-dashed border-[var(--border-color)] rounded-2xl flex flex-col items-center ${isTallLoading ? 'justify-start pt-20 pb-14' : 'justify-center py-14'} gap-3 bg-[var(--bg-secondary)]/30 text-center select-none animate-in fade-in duration-300 min-h-[65vh]`}
        >
          <div className="flex items-center gap-2.5 text-sm sm:text-base font-semibold text-[var(--text-primary)]">
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin shrink-0" />
            <span>Loading happiness...</span>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-md">
            Preparing {activeLangs.map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join(', ')} translations for{' '}
            <span className="font-medium text-[var(--text-secondary)]">
              {convertPaliScript(capitalizePali(chapter.title), paliScript)}
            </span>
          </p>
          <div className="text-[11px] text-[var(--text-muted)]/70 italic">
            {effectiveSentenceMode ? 'Sentence-by-sentence alignment in progress…' : 'Everything will appear together once ready'}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={blockRef}
        id={`chap-${chapter.chapter_index}`}
        data-chapter={chapter.chapter_index}
        data-trans-loading={hasActiveTrans && isTransPending ? '1' : undefined}
        data-trans-settled={isTransSettledNow ? '1' : undefined}
        className="chapter-content-block"
      >
        {chunks.map((chunk) => {
          const isMounted = !isChunked || forcedMountedChunks.has(chunk.index) || observerMountedChunks.has(chunk.index);
          const measuredH = chunkHeightsRef.current.get(chunk.index) || 0;
          const estH = isMounted
            ? 0
            : estimateChunkHeight(chunk, {
                isPaliEnabled,
                activeLangCount: activeLangs.length,
                effectiveSentenceMode,
                translationDisplayMode,
                showBookLinks,
                isMobile: isMobileViewport,
              });
          return (
            <ChapterChunk
              key={chunk.index}
              chunk={chunk}
              isMounted={isMounted}
              estimatedHeight={estH}
              measuredHeight={measuredH}
              registerChunkEl={registerChunkEl}
              bookCode={bookCode}
              chapterIndex={chapter.chapter_index}
              effectiveSentenceMode={effectiveSentenceMode}
              isPaliEnabled={isPaliEnabled}
              paliSentMap={effectivePaliSentMap}
              showSentenceNumbers={showSentenceNumbers}
              paliScript={paliScript}
              highlightSearchTerms={highlightSearchTerms}
              searchHighlight={searchHighlight}
              hasActiveTrans={hasActiveTrans}
              translations={effectiveTranslations}
              orderedLayers={orderedLayers}
              translationDisplayMode={translationDisplayMode}
              translationColors={translationColors}
              transSentences={effectiveTransSentences}
              showBookLinks={showBookLinks}
              chapterLinks={chapterLinks}
              theme={theme}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={blockRef}
      id={`chap-${chapter.chapter_index}`}
      data-chapter={chapter.chapter_index}
      className="chapter-placeholder py-8 px-4 my-6 border border-dashed border-[var(--border-color)] rounded-xl flex flex-col items-center justify-center gap-2 bg-[var(--bg-secondary)]/40 select-none"
      style={{ minHeight: 480 }}
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

const STORAGE_KEY_CLICKED_WORDS = 'tipitaka_last_clicked_words_v2';

function collectTextSlicesForRange(range) {
  if (!range || range.collapsed) return [];

  if (range.startContainer === range.endContainer && range.startContainer?.nodeType === 3) {
    const textLen = range.startContainer.textContent?.length || 0;
    const start = Math.max(0, Math.min(range.startOffset, textLen));
    const end = Math.max(start, Math.min(range.endOffset, textLen));
    return end > start ? [{ node: range.startContainer, start, end }] : [];
  }

  const root = range.commonAncestorContainer;
  if (!root || typeof document === 'undefined' || typeof document.createTreeWalker !== 'function') {
    return [];
  }

  const slices = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const len = textNode.textContent?.length || 0;
    if (len === 0) continue;

    if (typeof range.intersectsNode === 'function' && !range.intersectsNode(textNode)) {
      continue;
    }

    let start = 0;
    if (textNode === range.startContainer) {
      start = range.startOffset;
    } else if (typeof range.comparePoint === 'function') {
      const cmpStart = range.comparePoint(textNode, 0);
      if (cmpStart !== 0) continue;
    }

    let end = len;
    if (textNode === range.endContainer) {
      end = range.endOffset;
    } else if (typeof range.comparePoint === 'function') {
      const cmpEnd = range.comparePoint(textNode, len);
      if (cmpEnd > 0) continue;
    }

    const safeStart = Math.max(0, Math.min(start, len));
    const safeEnd = Math.max(safeStart, Math.min(end, len));
    if (safeEnd > safeStart) {
      slices.push({ node: textNode, start: safeStart, end: safeEnd });
    }
  }
  return slices;
}

// Helper to clear any clicked word highlight in Reader (CSS Custom Highlight API + DOM fallback)
export function clearClickedWordHighlight(root = typeof document !== 'undefined' ? document : null) {
  const isFullDocClear = !root || (typeof document !== 'undefined' && root === document);
  if (
    isFullDocClear ||
    !activeClickedWordRange ||
    !activeClickedWordRange.startContainer?.isConnected ||
    (typeof root?.contains === 'function' && root.contains(activeClickedWordRange.commonAncestorContainer))
  ) {
    activeClickedWordRange = null;
    if (typeof CSS !== 'undefined' && CSS.highlights) {
      try {
        CSS.highlights.delete(READER_CLICKED_WORD_HIGHLIGHT);
      } catch (_) {}
    }
  }

  if (!root || typeof root.querySelectorAll !== 'function') return;
  const elements = root.querySelectorAll('.reader-clicked-word');
  elements.forEach((el) => {
    const parent = el.parentNode;
    if (parent) {
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
      if (typeof parent.normalize === 'function') {
        parent.normalize();
      }
    }
  });
}

// Helper to highlight a DOM range without mutating block layout.
// Uses CSS Custom Highlight API when available (zero DOM mutation), with a safe
// per-text-node <span> fallback that never extracts or splits surrounding elements.
export function highlightRangeInReader(range) {
  if (!range || range.collapsed) return;
  clearClickedWordHighlight();

  const slices = collectTextSlicesForRange(range);
  if (slices.length === 0) return;

  try {
    if (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined') {
      const textRanges = slices.map(({ node, start, end }) => {
        const r = document.createRange();
        r.setStart(node, start);
        r.setEnd(node, end);
        return r;
      });
      CSS.highlights.set(READER_CLICKED_WORD_HIGHLIGHT, new Highlight(...textRanges));
      activeClickedWordRange = textRanges[0];
      return;
    }

    // Fallback for browsers without CSS Custom Highlight API:
    // wrap ONLY individual text-node slices (never cross-element extractContents()).
    for (const { node, start, end } of slices) {
      const text = node.textContent || '';
      const frag = document.createDocumentFragment();
      if (start > 0) {
        frag.appendChild(document.createTextNode(text.slice(0, start)));
      }
      const span = document.createElement('span');
      span.className = 'reader-clicked-word';
      span.setAttribute('data-clicked-word', 'true');
      span.textContent = text.slice(start, end);
      frag.appendChild(span);
      if (end < text.length) {
        frag.appendChild(document.createTextNode(text.slice(end)));
      }
      if (node.parentNode) {
        node.parentNode.replaceChild(frag, node);
      }
    }
  } catch (err) {
    console.warn('Could not highlight clicked word range:', err);
  }
}

// Helper to compute exact character offset inside a parent element
export function getCharOffsetInElement(parentEl, targetNode, targetOffset) {
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
export function createRangeFromCharOffset(parentEl, targetOffset, length) {
  if (!parentEl || !Number.isFinite(targetOffset) || targetOffset < 0 || !Number.isFinite(length) || length <= 0) {
    return null;
  }
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
    if (nodeLen === 0) continue;
    // Strictly > targetOffset so a boundary at start===0 of a sentence/span never
    // latches onto the trailing end of the previous text node and crosses blocks.
    if (!startNode && offset + nodeLen > targetOffset) {
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
    indonesian: 'id',
    id: 'id',
    nepali: 'ne',
    ne: 'ne',
    bengali: 'bn',
    be: 'bn',
    spanish: 'es',
    es: 'es',
    french: 'fr',
    fr: 'fr',
    portuguese: 'pt',
    pt: 'pt',
    russian: 'ru',
    ru: 'ru',
    czech: 'cs',
    cs: 'cs',
    marathi: 'mr',
    mr: 'mr',
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
  const { pIndex, paraNum, chapIdx, lineId, word, rawWord, charOffset, length, transLang } = record;

  let targetEl = null;

  // 0. Scoped sentence-pair cell resolution (sentence alignment mode)
  if (lineId) {
    const safeLine = String(lineId).replace(/"/g, '\\"');
    if (transLang && transLang !== 'pali') {
      if (pIndex) {
        targetEl = container.querySelector(
          `[data-pindex="${pIndex}"] .sent-pair-trans[data-trans-lang="${transLang}"][data-line="${safeLine}"]`
        );
      }
      if (!targetEl && paraNum) {
        targetEl = container.querySelector(
          `[data-para="${paraNum}"] .sent-pair-trans[data-trans-lang="${transLang}"][data-line="${safeLine}"]`
        );
      }
    } else {
      if (pIndex) {
        targetEl = container.querySelector(
          `[data-pindex="${pIndex}"] .sent-pair-pali[data-line="${safeLine}"]`
        );
      }
      if (!targetEl && paraNum) {
        targetEl = container.querySelector(
          `[data-para="${paraNum}"] .sent-pair-pali[data-line="${safeLine}"]`
        );
      }
    }
  }

  // 1. Scoped language block resolution
  if (!targetEl && transLang && transLang !== 'pali') {
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

// Determine Mūla / Aṭṭhakathā / Ṭīkā layer and sibling layers for quick "Open Alongside" controls
function collectAvailableMatLayers(tabOrMat, ownLayer, bookCode) {
  if (!tabOrMat || typeof tabOrMat !== 'object') return null;

  const codeRaw = String(bookCode || tabOrMat.bookCode || '').trim();
  const mat =
    tabOrMat.mat !== undefined
      ? tabOrMat.mat
      : (tabOrMat.mula_code !== undefined ||
          tabOrMat.attha_code !== undefined ||
          tabOrMat.tika_code !== undefined)
      ? tabOrMat
      : null;

  const splitTargets = tabOrMat.split_targets || mat?.split_targets || null;
  const subBooks = tabOrMat.sub_books || mat?.sub_books || null;
  const chapterToMat = tabOrMat.chapter_to_mat || null;
  const paraToMat = tabOrMat.para_to_mat || null;

  const hasExplicitMetadata =
    (tabOrMat.mat !== undefined && (tabOrMat.mat !== null || Boolean(tabOrMat.matResolved))) ||
    Boolean(splitTargets) ||
    Boolean(subBooks) ||
    Boolean(chapterToMat) ||
    Boolean(paraToMat);

  if (!hasExplicitMetadata) return null;

  const available = new Set();
  const addIfTarget = (layerName, targetCode) => {
    const cleanTarget = String(targetCode || '').trim();
    if (!cleanTarget || (codeRaw && cleanTarget === codeRaw)) return;
    available.add(layerName);
  };

  if (mat) {
    addIfTarget('mula', mat.mula_code);
    addIfTarget('attha', mat.attha_code);
    addIfTarget('tika', mat.tika_code);
  }

  if (splitTargets && typeof splitTargets === 'object') {
    for (const l of ['mula', 'attha', 'tika']) {
      if (Array.isArray(splitTargets[l]) && splitTargets[l].some((r) => r?.code && r.code !== codeRaw)) {
        available.add(l);
      }
    }
  }

  if (subBooks && typeof subBooks === 'object') {
    for (const sub of Object.values(subBooks)) {
      if (!sub || typeof sub !== 'object') continue;
      addIfTarget('mula', sub.mula_code);
      addIfTarget('attha', sub.attha_code);
      addIfTarget('tika', sub.tika_code);
    }
  }

  if (chapterToMat && typeof chapterToMat === 'object') {
    for (const chEntry of Object.values(chapterToMat)) {
      if (!chEntry || typeof chEntry !== 'object') continue;
      addIfTarget('mula', chEntry.mula?.book);
      addIfTarget('attha', chEntry.attha?.book);
      addIfTarget('tika', chEntry.tika?.book);
    }
  }

  if (paraToMat && typeof paraToMat === 'object') {
    for (const pEntry of Object.values(paraToMat)) {
      if (!pEntry || typeof pEntry !== 'object') continue;
      addIfTarget('mula', pEntry.mula?.book);
      addIfTarget('attha', pEntry.attha?.book);
      addIfTarget('tika', pEntry.tika?.book);
    }
  }

  available.delete(ownLayer);
  return available;
}

export function getBookLayerInfo(bookCode = '', category = '', tabOrMat = null) {
  const code = String(bookCode || '').toLowerCase();
  const cat = String(category || '').toLowerCase();
  let layer = 'other';
  let label = '';
  let shortLabel = '';

  if (code.endsWith('.mul') || code.includes('m.mul') || cat.includes('mūla') || cat.includes('mula')) {
    layer = 'mula';
    label = 'Mūla';
    shortLabel = 'M';
  } else if (code.endsWith('.att') || code.includes('a.att') || cat.includes('aṭṭha') || cat.includes('attha')) {
    layer = 'attha';
    label = 'Aṭṭha';
    shortLabel = 'A';
  } else if (
    code.endsWith('.tik') ||
    code.includes('t.tik') ||
    code.endsWith('t.nrf') ||
    cat.includes('ṭīkā') ||
    cat.includes('tika')
  ) {
    layer = 'tika';
    label = 'Ṭīkā';
    shortLabel = 'Ṭ';
  }

  const allMatLayers = [
    { layer: 'mula', label: 'Mūla', short: 'M' },
    { layer: 'attha', label: 'Aṭṭha', short: 'A' },
    { layer: 'tika', label: 'Ṭīkā', short: 'Ṭ' },
  ];

  const availableSet = collectAvailableMatLayers(tabOrMat, layer, bookCode);
  let siblingLayers;
  if (availableSet !== null) {
    siblingLayers = allMatLayers.filter((item) => item.layer !== layer && availableSet.has(item.layer));
  } else {
    siblingLayers =
      layer === 'mula' || layer === 'attha' || layer === 'tika'
        ? allMatLayers.filter((item) => item.layer !== layer)
        : [];
  }

  return { layer, label, shortLabel, siblingLayers };
}

// Compute Longest Non-Decreasing Subsequence (LNDS) of [srcY, dstY] pairs in O(N log N).
// Filters out cross-reference outliers so parallel column scrolling stays strictly monotonic.
export function increasingChain(pairs) {
  if (!Array.isArray(pairs) || pairs.length === 0) return [];
  const valid = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (!Array.isArray(p) || p.length < 2) continue;
    const s = Number(p[0]);
    const d = Number(p[1]);
    if (Number.isFinite(s) && Number.isFinite(d)) {
      valid.push([s, d]);
    }
  }
  if (valid.length === 0) return [];

  valid.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));

  const deduped = [valid[0]];
  for (let i = 1; i < valid.length; i++) {
    const prev = deduped[deduped.length - 1];
    const cur = valid[i];
    if (Math.abs(cur[0] - prev[0]) < 1 && Math.abs(cur[1] - prev[1]) < 1) {
      continue;
    }
    deduped.push(cur);
  }

  const n = deduped.length;
  const tailIndices = [];
  const prevIndices = new Int32Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const dstVal = deduped[i][1];
    let lo = 0;
    let hi = tailIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (deduped[tailIndices[mid]][1] <= dstVal) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    if (lo > 0) {
      prevIndices[i] = tailIndices[lo - 1];
    }
    if (lo === tailIndices.length) {
      tailIndices.push(i);
    } else {
      tailIndices[lo] = i;
    }
  }

  const result = new Array(tailIndices.length);
  let k = tailIndices[tailIndices.length - 1];
  for (let i = tailIndices.length - 1; i >= 0; i--) {
    result[i] = deduped[k];
    k = prevIndices[k];
  }
  return result;
}

// Piece-wise linear interpolation along a monotonic anchor chain [[srcY, dstY], ...]
export function interpolateMonotonicY(chain, srcY) {
  if (!Array.isArray(chain) || chain.length === 0 || !Number.isFinite(srcY)) {
    return null;
  }
  if (chain.length === 1) {
    return chain[0][1] + (srcY - chain[0][0]);
  }
  if (srcY <= chain[0][0]) {
    return chain[0][1] + (srcY - chain[0][0]);
  }
  const last = chain[chain.length - 1];
  if (srcY >= last[0]) {
    return last[1] + (srcY - last[0]);
  }

  let lo = 0;
  let hi = chain.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const s0 = chain[mid][0];
    const s1 = chain[mid + 1][0];
    if (srcY < s0) {
      hi = mid - 1;
    } else if (srcY > s1) {
      lo = mid + 1;
    } else {
      const span = s1 - s0;
      if (span <= 0) return chain[mid][1];
      const ratio = (srcY - s0) / span;
      return chain[mid][1] + ratio * (chain[mid + 1][1] - chain[mid][1]);
    }
  }

  const idx = Math.max(0, Math.min(chain.length - 2, lo));
  const [s0, d0] = chain[idx];
  const [s1, d1] = chain[idx + 1];
  const span = s1 - s0;
  if (span <= 0) return d0;
  return d0 + ((srcY - s0) / span) * (d1 - d0);
}

// Collect parallel anchor pairs [srcY, dstY] between two visible reader column containers
export function buildParallelAnchors(
  srcContainer,
  dstContainer,
  srcTab,
  dstTab,
  srcLinksByChap = null,
  dstLinksByChap = null
) {
  if (!srcContainer || !dstContainer || !srcTab || !dstTab) return [];
  const srcRect = srcContainer.getBoundingClientRect();
  const dstRect = dstContainer.getBoundingClientRect();
  const srcScroll = srcContainer.scrollTop;
  const dstScroll = dstContainer.scrollTop;

  const docY = (el, cRect, cScroll) => {
    const r = el.getBoundingClientRect();
    return r.top - cRect.top + cScroll;
  };
  const isMeasurable = (el) => Boolean(el && el.getClientRects && el.getClientRects().length > 0);

  const pairs = [];

  const resolveLinkTargetEl = (container, link) => {
    if (!link) return null;
    const chapScope =
      link.target_chapter !== undefined && link.target_chapter !== null
        ? container.querySelector(`.chapter-content-block[data-chapter="${link.target_chapter}"]`)
        : container;
    if (!chapScope) return null;
    const targetLine = link.target_line_id ?? link.target_line;
    if (link.target_para_index !== undefined && link.target_para_index !== null) {
      const row =
        chapScope.querySelector(`.reader-para-row[data-pindex="${link.target_para_index}"]`) ||
        chapScope.querySelector(`p[data-pindex="${link.target_para_index}"]`) ||
        chapScope.querySelector(`[data-pindex="${link.target_para_index}"]`);
      if (row) {
        if (targetLine) {
          const lineEl =
            row.querySelector(`[data-line="${targetLine}"]`) ||
            row.querySelector(`.sent-pair[data-line="${targetLine}"]`) ||
            row.querySelector(`.pali-sent[data-line="${targetLine}"]`);
          if (isMeasurable(lineEl)) return lineEl;
        }
        if (isMeasurable(row)) return row;
      }
    }
    const targetPara = link.target_para_num ?? link.target_para;
    if (targetPara) {
      const pEl = chapScope.querySelector(`[data-para="${targetPara}"]`);
      if (isMeasurable(pEl)) return (pEl.closest && pEl.closest('.reader-para-row')) || pEl;
    }
    return null;
  };

  const parseChipLink = (chip) => resolveChipLinkElement(chip);

  const legacySrcChips = Array.from(srcContainer.querySelectorAll('.linked-def-chip[data-link]') || []);
  const refSrcChips = Array.from(srcContainer.querySelectorAll('.linked-def-chip[data-link-ref]') || []);
  const srcChips =
    refSrcChips.length > 0
      ? legacySrcChips.length > 0
        ? [...legacySrcChips, ...refSrcChips]
        : refSrcChips
      : legacySrcChips;
  for (const chip of srcChips) {
    const link = parseChipLink(chip);
    if (!link || link.target_book !== dstTab.bookCode) continue;
    const srcEl = chip.closest('.sent-pair, .pali-sent, .reader-para-row, p[data-pindex]') || chip;
    if (!isMeasurable(srcEl)) continue;
    const dstEl = resolveLinkTargetEl(dstContainer, link);
    if (!dstEl) continue;
    pairs.push([docY(srcEl, srcRect, srcScroll), docY(dstEl, dstRect, dstScroll)]);
  }

  const legacyDstChips = Array.from(dstContainer.querySelectorAll('.linked-def-chip[data-link]') || []);
  const refDstChips = Array.from(dstContainer.querySelectorAll('.linked-def-chip[data-link-ref]') || []);
  const dstChips =
    refDstChips.length > 0
      ? legacyDstChips.length > 0
        ? [...legacyDstChips, ...refDstChips]
        : refDstChips
      : legacyDstChips;
  for (const chip of dstChips) {
    const link = parseChipLink(chip);
    if (!link || link.target_book !== srcTab.bookCode) continue;
    const dstEl = chip.closest('.sent-pair, .pali-sent, .reader-para-row, p[data-pindex]') || chip;
    if (!isMeasurable(dstEl)) continue;
    const srcEl = resolveLinkTargetEl(srcContainer, link);
    if (!srcEl) continue;
    pairs.push([docY(srcEl, srcRect, srcScroll), docY(dstEl, dstRect, dstScroll)]);
  }

  const addLinksFromMap = (linksByChap, fromContainer, toContainer, toBookCode, isForward) => {
    if (!linksByChap) return;
    for (const [chapIdx, paraMap] of Object.entries(linksByChap)) {
      if (!paraMap) continue;
      const fromChapEl = fromContainer.querySelector(`.chapter-content-block[data-chapter="${chapIdx}"]`);
      if (!fromChapEl) continue;
      for (const [pIdx, pEntry] of Object.entries(paraMap)) {
        if (!pEntry) continue;
        const fromRow =
          fromChapEl.querySelector(`.reader-para-row[data-pindex="${pIdx}"]`) ||
          fromChapEl.querySelector(`p[data-pindex="${pIdx}"]`) ||
          fromChapEl.querySelector(`[data-pindex="${pIdx}"]`);
        if (!fromRow) continue;

        const pushLinkPair = (link, explicitLineId = null) => {
          if (!link || link.target_book !== toBookCode) return;
          const srcLine = explicitLineId ?? link.source_line_id ?? link.source_line;
          const fromEl = (srcLine && fromRow.querySelector(`[data-line="${srcLine}"]`)) || fromRow;
          if (!isMeasurable(fromEl)) return;
          const toEl = resolveLinkTargetEl(toContainer, link);
          if (!toEl) return;
          if (isForward) {
            pairs.push([docY(fromEl, srcRect, srcScroll), docY(toEl, dstRect, dstScroll)]);
          } else {
            pairs.push([docY(toEl, srcRect, srcScroll), docY(fromEl, dstRect, dstScroll)]);
          }
        };

        if (Array.isArray(pEntry)) {
          for (const link of pEntry) pushLinkPair(link, null);
        } else if (typeof pEntry === 'object') {
          let addedByLine = false;
          if (pEntry.by_line && typeof pEntry.by_line === 'object') {
            for (const [lineId, list] of Object.entries(pEntry.by_line)) {
              if (!Array.isArray(list)) continue;
              for (const link of list) {
                pushLinkPair(link, lineId);
                addedByLine = true;
              }
            }
          }
          if (!addedByLine && Array.isArray(pEntry.all)) {
            for (const link of pEntry.all) pushLinkPair(link, null);
          }
        }
      }
    }
  };

  if (srcChips.length === 0 && srcLinksByChap) {
    addLinksFromMap(srcLinksByChap, srcContainer, dstContainer, dstTab.bookCode, true);
  }
  if (dstChips.length === 0 && dstLinksByChap) {
    addLinksFromMap(dstLinksByChap, dstContainer, srcContainer, srcTab.bookCode, false);
  }

  const dstParaMap = new Map();
  const dstRangedParas = [];
  const dstParaNodes = dstContainer.querySelectorAll('.chapter-content-block [data-para]');
  for (const node of dstParaNodes) {
    const pNum = node.getAttribute('data-para');
    if (!pNum) continue;
    const row = (node.closest && node.closest('.reader-para-row')) || node;
    if (!isMeasurable(row)) continue;
    if (!dstParaMap.has(pNum)) {
      dstParaMap.set(pNum, row);
    }
    const first = parseInt(node.getAttribute('data-para-first'), 10);
    const last = parseInt(node.getAttribute('data-para-last'), 10);
    if (!isNaN(first) && !isNaN(last)) {
      dstRangedParas.push({ first, last, row });
    }
  }

  const findDstParaRow = (targetParaStr) => {
    if (!targetParaStr) return null;
    const clean = String(targetParaStr).trim();
    if (dstParaMap.has(clean)) return dstParaMap.get(clean);
    const num = parseInt(clean, 10);
    if (!isNaN(num)) {
      for (let i = 0; i < dstRangedParas.length; i++) {
        const rp = dstRangedParas[i];
        if (num >= rp.first && num <= rp.last) return rp.row;
      }
    }
    return null;
  };

  const dstLayer = getBookLayerInfo(dstTab.bookCode, dstTab.category).layer;
  const srcParaNodes = srcContainer.querySelectorAll('.chapter-content-block [data-para]');
  const seenSrcPara = new Set();

  for (const srcNode of srcParaNodes) {
    const pNum = srcNode.getAttribute('data-para');
    if (!pNum || seenSrcPara.has(pNum)) continue;
    seenSrcPara.add(pNum);
    const srcRow = (srcNode.closest && srcNode.closest('.reader-para-row')) || srcNode;
    if (!isMeasurable(srcRow)) continue;

    let dstRow = null;
    const matEntry =
      (srcTab.sub_books_para_to_mat &&
        srcTab.sub_book &&
        srcTab.sub_books_para_to_mat[srcTab.sub_book]?.[pNum]?.[dstLayer]) ||
      srcTab.para_to_mat?.[pNum]?.[dstLayer];

    const matBook = matEntry?.book || matEntry?.book_code;
    if (matEntry && (!matBook || matBook === dstTab.bookCode)) {
      dstRow = findDstParaRow(matEntry.para || pNum);
    }
    if (!dstRow) {
      dstRow = findDstParaRow(pNum);
    }
    if (!dstRow) continue;

    const sRect = srcRow.getBoundingClientRect();
    const dRect = dstRow.getBoundingClientRect();
    const sTop = sRect.top - srcRect.top + srcScroll;
    const dTop = dRect.top - dstRect.top + dstScroll;
    pairs.push([sTop, dTop]);

    if (sRect.height > 120 && dRect.height > 120) {
      pairs.push([sTop + sRect.height, dTop + dRect.height]);
    }
  }

  return increasingChain(pairs);
}

// Persistent per-tab ReaderPane component: keeps each open book's DOM alive across tab switches
// and supports side-by-side parallel column rendering with zero-bounce scroll preservation.
const ReaderPane = memo(function ReaderPane({
  tab,
  isVisible,
  isActive,
  isColumnsMode,
  useWindowScroll = false,
  isParallelSyncActive,
  paneScrollIntent,
  clearTargetScrollIntent,
  loadChapter,
  bufferAdjacentChapters,
  saveTabScroll,
  getSavedScroll,
  saveTabPosition,
  activatePane,
  closeTab,
  jumpToMat,
  openBook,
  openGoToModal,
  addBookmark,
  removeBookmark,
  bookmarks,
  activeParaNum,
  setActiveParaNum,
  setActiveEditionPages,
  addToHistory,
  setIsHistoryOpen,
  isSidebarOpen,
  setIsSidebarOpen,
  isHeaderVisible,
  setIsHeaderVisible,
  searchHighlight,
  settings,
  orderedLayers,
  activeLangs,
  isPaliEnabled,
  sentenceMode,
  hasTransLayers,
  pulseAnimation,
  openDictionary,
  clickToLookupEnabled,
  clickLookupMode,
  recordClickedWord,
  clickedWordsByBookRef,
  setActiveLinkedItem,
  registerPaneRef,
  onColumnUserInteract,
  onColumnScrollSync,
  onPaneLinksLoaded,
  isDictOpen = false,
  dictDockMode = 'side',
  isDictPinned = false,
}) {
  const containerRef = useRef(null);
  const contentHeaderRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const vpBoundsCacheRef = useRef({ top: 0, height: 0, scrollHeight: 0, scrollY: -1, ts: 0 });
  const lastHistoryKeyRef = useRef('');
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef(null);
  const programmaticSafetyTimerRef = useRef(null);
  const [isTargetScrollWaiting, setIsTargetScrollWaiting] = useState(false);
  const targetWaitTimeoutRef = useRef(null);
  const attemptScrollTimerRef = useRef(null);
  const activeTabRef = useRef(tab);
  activeTabRef.current = tab;
  const activeLangsRef = useRef(activeLangs);
  activeLangsRef.current = activeLangs;
  const useWindowScrollRef = useRef(useWindowScroll);
  useWindowScrollRef.current = useWindowScroll;
  const prevUseWindowScrollRef = useRef(useWindowScroll);
  const isHeaderVisibleRef = useRef(isHeaderVisible);
  isHeaderVisibleRef.current = isHeaderVisible;
  const lastScrollYRef = useRef(0);
  const scrollUpPeakYRef = useRef(0);
  const scrollDownPeakYRef = useRef(0);
  const touchPullStartYRef = useRef(null);
  const [jumpPin, setJumpPin] = useState(null);
  const jumpPinRef = useRef(null);
  const pinJumpTarget = useCallback((nextPin) => {
    jumpPinRef.current = nextPin;
    setJumpPin(nextPin);
  }, []);
  const jumpResizeObserverRef = useRef(null);
  const anchorPinRef = useRef({
    active: false,
    anchorEl: null,
    subRatio: 0,
    viewportY: 0,
    deadline: 0,
    resizing: false,
  });
  const [paneSectionTitle, setPaneSectionTitle] = useState(null);

  const getScrollTop = useCallback(() => {
    if (useWindowScroll && typeof window !== 'undefined') {
      return (
        window.scrollY ||
        document.scrollingElement?.scrollTop ||
        document.documentElement?.scrollTop ||
        document.body?.scrollTop ||
        0
      );
    }
    return containerRef.current?.scrollTop || 0;
  }, [useWindowScroll]);

  const setScrollTop = useCallback(
    (top, behavior = 'auto') => {
      const clamped = Math.max(0, top);
      if (useWindowScroll && typeof window !== 'undefined') {
        window.scrollTo({ top: clamped, behavior });
        return;
      }
      const c = containerRef.current;
      if (!c) return;
      if (behavior === 'auto' || behavior === 'instant') {
        c.scrollTop = clamped;
      } else {
        c.scrollTo({ top: clamped, behavior });
      }
    },
    [useWindowScroll]
  );

  const getViewportBounds = useCallback(() => {
    if (useWindowScroll && typeof window !== 'undefined') {
      const docHeight = document.documentElement?.clientHeight || window.innerHeight;
      const visualHeight = window.visualViewport?.height || window.innerHeight;
      const effectiveHeight = Math.min(window.innerHeight, docHeight, visualHeight);
      const scrollHeight = Math.max(
        document.scrollingElement?.scrollHeight || 0,
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0
      );
      return {
        top: 0,
        height: effectiveHeight,
        scrollHeight,
      };
    }
    const c = containerRef.current;
    if (!c) return { top: 0, height: 0, scrollHeight: 0 };
    return {
      top: c.getBoundingClientRect().top,
      height: c.clientHeight,
      scrollHeight: c.scrollHeight,
    };
  }, [useWindowScroll]);

  const getCachedViewportBounds = useCallback(
    (scrollTop = 0) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const cached = vpBoundsCacheRef.current;
      if (cached.height > 0 && now - cached.ts < 300) {
        return cached;
      }
      const fresh = getViewportBounds();
      vpBoundsCacheRef.current = {
        top: fresh.top,
        height: fresh.height,
        scrollHeight: fresh.scrollHeight,
        scrollY: scrollTop || 0,
        ts: now,
      };
      return vpBoundsCacheRef.current;
    },
    [getViewportBounds]
  );

  const getTopReadingInset = useCallback(() => {
    if (!useWindowScroll || typeof window === 'undefined' || typeof document === 'undefined') {
      return 16;
    }
    let coveredBottom = 0;
    const stickyEls = [
      document.querySelector('.app-header'),
      document.querySelector('.book-tabs-bar'),
      contentHeaderRef.current || document.querySelector('.content-header'),
    ];
    for (const el of stickyEls) {
      if (!el) continue;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') continue;
      if (st.position !== 'sticky' && st.position !== 'fixed') continue;
      const rect = el.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > 0 && rect.top < 200) {
        coveredBottom = Math.max(coveredBottom, rect.bottom);
      }
    }
    return Math.max(56, Math.round(coveredBottom) + 14);
  }, [useWindowScroll]);
  const activeTab = tab;

  // Tracks whether this tab pane has completed its initial load/hydration scroll restoration.
  // Once true, switching away and back to this tab restores scrollTop directly with zero drift timers!
  const hasInitialRestoredRef = useRef(false);
  const wasVisibleReaderRef = useRef(false);
  const isTabSwitchingRef = useRef(false);
  const tabSwitchRetryTimerRef = useRef(null);

  const [paneParaNum, setPaneParaNum] = useState(tab?.lastParaNum || null);
  const [paneEditionPages, setPaneEditionPages] = useState({});

  const chapterJumpRef = useRef({ key: null, lastOffset: 0, timer: null });
  const paraJumpRef = useRef({ key: null, lastOffset: 0, timer: null, deadline: 0 });
  const paneScrollIntentRef = useRef(paneScrollIntent);
  paneScrollIntentRef.current = paneScrollIntent;

  const setMainRef = useCallback(
    (node) => {
      containerRef.current = node;
      registerPaneRef?.(tab.bookCode, node);
    },
    [registerPaneRef, tab.bookCode]
  );

  useEffect(() => {
    if (tab?.lastParaNum && !paneParaNum) {
      setPaneParaNum(tab.lastParaNum);
    }
  }, [tab?.lastParaNum, paneParaNum]);

  const performProgrammaticScroll = useCallback((container, offset, options = {}) => {
    if (!container) return;
    isProgrammaticScrollRef.current = true;
    if (typeof window !== 'undefined') {
      window.__tpoProgrammaticScroll = true;
    }
    const safeOffset = Math.max(0, offset);
    lastScrollYRef.current = safeOffset;
    scrollUpPeakYRef.current = safeOffset;
    scrollDownPeakYRef.current = safeOffset;
    clearTimeout(programmaticScrollTimerRef.current);
    clearTimeout(programmaticSafetyTimerRef.current);
    // Safety fallback: guarantee isProgrammaticScrollRef never remains stuck true if a scroll animation is superseded
    programmaticSafetyTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      if (typeof window !== 'undefined') {
        window.__tpoProgrammaticScroll = false;
      }
    }, 1200);
    smartScrollTo(container, offset, {
      scrollMotion: options.scrollMotion || 'fast',
      onComplete: () => {
        clearTimeout(programmaticSafetyTimerRef.current);
        lastScrollYRef.current = safeOffset;
        scrollUpPeakYRef.current = safeOffset;
        scrollDownPeakYRef.current = safeOffset;
        programmaticScrollTimerRef.current = setTimeout(() => {
          isProgrammaticScrollRef.current = false;
          if (typeof window !== 'undefined') {
            window.__tpoProgrammaticScroll = false;
          }
        }, 150);
        if (options.onComplete) options.onComplete();
      },
    });
  }, []);

  const cancelJump = useCallback(() => {
    isTabSwitchingRef.current = false;
    isProgrammaticScrollRef.current = false;
    if (typeof window !== 'undefined') {
      window.__tpoProgrammaticScroll = false;
    }
    clearTimeout(programmaticScrollTimerRef.current);
    clearTimeout(programmaticSafetyTimerRef.current);
    cancelSmartScroll?.(containerRef.current);
    anchorPinRef.current.active = false;
    if (jumpResizeObserverRef.current) {
      jumpResizeObserverRef.current.disconnect();
      jumpResizeObserverRef.current = null;
    }
    if (tabSwitchRetryTimerRef.current) {
      clearInterval(tabSwitchRetryTimerRef.current);
      tabSwitchRetryTimerRef.current = null;
    }
    if (attemptScrollTimerRef.current) {
      clearTimeout(attemptScrollTimerRef.current);
      attemptScrollTimerRef.current = null;
    }
    if (paneScrollIntentRef.current) {
      clearTargetScrollIntent(tab.bookCode);
    }
    setIsTargetScrollWaiting(false);

    const st = chapterJumpRef.current;
    if (st.key) {
      clearTimeout(st.timer);
      chapterJumpRef.current = { key: null, lastOffset: 0, timer: null };
    }
    const ps = paraJumpRef.current;
    if (ps.key) {
      clearTimeout(ps.timer);
      paraJumpRef.current = { key: null, lastOffset: 0, timer: null, deadline: 0 };
    }
  }, [clearTargetScrollIntent, tab.bookCode]);

  useEffect(() => {
    return () => {
      if (jumpResizeObserverRef.current) {
        jumpResizeObserverRef.current.disconnect();
        jumpResizeObserverRef.current = null;
      }
      clearTimeout(chapterJumpRef.current.timer);
      clearTimeout(paraJumpRef.current.timer);
      clearTimeout(programmaticScrollTimerRef.current);
      clearTimeout(programmaticSafetyTimerRef.current);
      if (tabSwitchRetryTimerRef.current) {
        clearInterval(tabSwitchRetryTimerRef.current);
        tabSwitchRetryTimerRef.current = null;
      }
    };
  }, [tab.bookCode, isVisible]);

  const hasRenderableChapters = Boolean(tab.chapters?.length || tab.html);
  const isTocMode = Boolean(tab.viewMode === 'toc' || tab.isTocView);

  // Expire pinned jump window once user switches into TOC view or reads 2+ chapters away
  useEffect(() => {
    if (!jumpPin) return;
    if (isTocMode || jumpPin.bookCode !== tab.bookCode) {
      pinJumpTarget(null);
      return;
    }
    if (
      !paneScrollIntent &&
      !paraJumpRef.current.key &&
      !chapterJumpRef.current.key &&
      !isProgrammaticScrollRef.current &&
      jumpPin.chapterIdx !== undefined &&
      jumpPin.chapterIdx !== null &&
      tab.currentChapterIdx !== undefined &&
      tab.currentChapterIdx !== null &&
      Math.abs(tab.currentChapterIdx - jumpPin.chapterIdx) >= 2
    ) {
      pinJumpTarget(null);
    }
  }, [jumpPin, isTocMode, tab.bookCode, tab.currentChapterIdx, paneScrollIntent, pinJumpTarget]);

  // Guarantee bars stay visible when active chapter content is shorter than scrollable threshold
  useEffect(() => {
    if (!isVisible || isTocMode || !hasRenderableChapters) return;
    const timer = setTimeout(() => {
      if (!isVisible || isHeaderVisibleRef.current) return;
      const { height: vpH, scrollHeight: sH } = getViewportBounds();
      if (vpH > 0 && sH > 0 && sH - vpH <= 80) {
        isHeaderVisibleRef.current = true;
        setIsHeaderVisible?.(true);
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [isVisible, isTocMode, hasRenderableChapters, tab.currentChapterIdx, tab.loadedChapters, setIsHeaderVisible, getViewportBounds]);

  useEffect(() => {
    const container = containerRef.current;
    const MODAL_GUARD_SELECTOR =
      '.modal-overlay, .modal-backdrop, .search-modal, .dict-dock-panel, .dict-overlay, .dict-panel-modal, .linked-def-modal-backdrop, [role="dialog"], [aria-modal="true"]';
    const onUserInput = (e) => {
      if (e?.target?.closest?.(MODAL_GUARD_SELECTOR)) return;
      if (
        e?.type === 'wheel' &&
        typeof window !== 'undefined' &&
        window.__tpoModalClosedAt &&
        Date.now() - window.__tpoModalClosedAt < 650
      ) {
        return;
      }
      if (e?.type === 'mousedown') {
        const intentTs = paneScrollIntentRef.current?.timestamp;
        const isScrollbarClick =
          container &&
          typeof e.clientX === 'number' &&
          e.clientX >= container.getBoundingClientRect().right - 20;
        if (intentTs && Date.now() - intentTs < 350 && !isScrollbarClick) {
          return;
        }
      }
      if (e?.type === 'touchstart' && e.touches?.length === 1) {
        touchPullStartYRef.current = e.touches[0].clientY;
      } else if (e?.type === 'touchmove' && e.touches?.length === 1 && touchPullStartYRef.current !== null) {
        const pullDeltaY = e.touches[0].clientY - touchPullStartYRef.current;
        // Reveal hidden bars on downward pull near top even when WebView clamps scrollTop at 0 (no scroll event)
        if (pullDeltaY >= 28 && !isHeaderVisibleRef.current && getScrollTop() <= 24) {
          isHeaderVisibleRef.current = true;
          setIsHeaderVisible?.(true);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tipitaka:show-bars'));
          }
          touchPullStartYRef.current = e.touches[0].clientY;
        }
      }
      if (!anchorPinRef.current.resizing) {
        anchorPinRef.current.active = false;
      }
      onColumnUserInteract?.(tab.bookCode);
      cancelJump();
    };
    const onKeyDown = (e) => {
      if (!useWindowScroll || !isVisible) return;
      if (e?.target?.closest?.(`input, textarea, select, [contenteditable="true"], ${MODAL_GUARD_SELECTOR}`)) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        if (!anchorPinRef.current.resizing) {
          anchorPinRef.current.active = false;
        }
        cancelJump();
      }
    };
    if (container) {
      container.addEventListener('wheel', onUserInput, { passive: true });
      container.addEventListener('touchstart', onUserInput, { passive: true });
      container.addEventListener('touchmove', onUserInput, { passive: true });
      container.addEventListener('mousedown', onUserInput, { passive: true });
    }
    if (useWindowScroll && isVisible && typeof window !== 'undefined') {
      window.addEventListener('wheel', onUserInput, { passive: true });
      window.addEventListener('touchstart', onUserInput, { passive: true });
      window.addEventListener('touchmove', onUserInput, { passive: true });
      window.addEventListener('keydown', onKeyDown, { passive: true });
    }
    return () => {
      if (container) {
        container.removeEventListener('wheel', onUserInput);
        container.removeEventListener('touchstart', onUserInput);
        container.removeEventListener('touchmove', onUserInput);
        container.removeEventListener('mousedown', onUserInput);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('wheel', onUserInput);
        window.removeEventListener('touchstart', onUserInput);
        window.removeEventListener('touchmove', onUserInput);
        window.removeEventListener('keydown', onKeyDown);
      }
    };
  }, [cancelJump, onColumnUserInteract, tab.bookCode, tab.isLoading, tab.viewMode, isTocMode, hasRenderableChapters, useWindowScroll, isVisible]);

  // Task 3: Reading-position anchor preservation across Left/Right dock open, close, resize, and sidebar toggles
  const captureReadingAnchor = useCallback(
    (source = '') => {
      anchorPinRef.current.active = false;
      anchorPinRef.current.resizing = false;
      const container = containerRef.current;
      if (!isVisible || !container || tab.viewMode === 'toc' || tab.isTocView || tab.isLoading || tab.bookCode === 'ai_chat') {
        return;
      }
      if (isProgrammaticScrollRef.current || paneScrollIntent) return;

      const { top: vpTop, height: vpHeight } = getViewportBounds();
      const stickyInset = getTopReadingInset();
      const bandTop = vpTop + stickyInset;
      const bandBottom = vpTop + vpHeight - 16;

      let anchorEl = null;
      let subRatio = 0;
      let viewportY = bandTop;

      const clickedAnchor = selectClickedWordAnchor(container, bandTop, bandBottom);
      if (clickedAnchor) {
        anchorEl = clickedAnchor.anchorEl;
        subRatio = clickedAnchor.subRatio;
        viewportY = clickedAnchor.viewportY;
      }

      if (!anchorEl) {
        if (getScrollTop() < 8) return;
        const fineCandidates = container.querySelectorAll(
          '.sent-pair, .reader-trans-block, p[data-pindex], .chapter-content-block h2, .chapter-content-block p'
        );
        const pickFromList = (list) => {
          for (const el of list) {
            const rect = el.getBoundingClientRect();
            if (rect.height <= 0 && rect.width <= 0) continue;
            if (rect.bottom > bandTop + 4 && rect.top < bandBottom) {
              anchorEl = el;
              const refY = Math.max(rect.top, Math.min(rect.bottom, bandTop + 20));
              subRatio = rect.height > 0 ? Math.max(0, Math.min(1, (refY - rect.top) / rect.height)) : 0;
              viewportY = refY;
              return true;
            }
          }
          return false;
        };
        if (!pickFromList(fineCandidates)) {
          pickFromList(container.querySelectorAll('.reader-para-row'));
        }
      }

      if (!anchorEl) return;
      anchorPinRef.current = {
        active: true,
        anchorEl,
        subRatio,
        viewportY,
        deadline: Date.now() + 1400,
        resizing: source === 'dictionary-resize',
      };
    },
    [isVisible, tab.viewMode, tab.isTocView, tab.isLoading, tab.bookCode, paneScrollIntent, getScrollTop, getViewportBounds, getTopReadingInset]
  );

  const applyAnchorCompensation = useCallback(() => {
    const pin = anchorPinRef.current;
    if (!pin.active || !pin.anchorEl || !pin.anchorEl.isConnected) {
      pin.active = false;
      return;
    }
    if (!pin.resizing && Date.now() > pin.deadline) {
      pin.active = false;
      return;
    }
    const rect = pin.anchorEl.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    const delta = computeBlockCompensationDelta({
      rectTopAfter: rect.top,
      rectHeightAfter: rect.height,
      subRatio: pin.subRatio,
      anchorViewportYBefore: pin.viewportY,
    });
    if (Math.abs(delta) >= 0.75) {
      const nextTop = Math.max(0, getScrollTop() + delta);
      isProgrammaticScrollRef.current = true;
      if (typeof window !== 'undefined') {
        window.__tpoProgrammaticScroll = true;
      }
      lastScrollYRef.current = nextTop;
      scrollUpPeakYRef.current = nextTop;
      scrollDownPeakYRef.current = nextTop;
      setScrollTop(nextTop, 'auto');
      if (activeTabRef.current?.bookCode && activeTabRef.current.bookCode !== 'ai_chat') {
        saveTabScroll(activeTabRef.current.bookCode, nextTop);
      }
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        if (typeof window !== 'undefined') {
          window.__tpoProgrammaticScroll = false;
        }
      }, 120);
    }
  }, [getScrollTop, setScrollTop, saveTabScroll]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onBeforeShift = (e) => {
      if (e?.detail?.shiftsLayout === false) {
        anchorPinRef.current.active = false;
        anchorPinRef.current.resizing = false;
        return;
      }
      captureReadingAnchor(e?.detail?.source || '');
    };
    const onResizeShift = (e) => {
      if (e?.detail?.shiftsLayout === false) {
        anchorPinRef.current.active = false;
        anchorPinRef.current.resizing = false;
        return;
      }
      const phase = e?.detail?.phase;
      if (phase === 'move') {
        if (!anchorPinRef.current.active) {
          captureReadingAnchor('dictionary-resize');
        } else {
          anchorPinRef.current.resizing = true;
          anchorPinRef.current.deadline = Date.now() + 1400;
        }
        requestAnimationFrame(applyAnchorCompensation);
      } else if (phase === 'end') {
        anchorPinRef.current.resizing = false;
        anchorPinRef.current.deadline = Date.now() + 300;
        requestAnimationFrame(applyAnchorCompensation);
      }
    };
    window.addEventListener('tipitaka:before-layout-shift', onBeforeShift);
    window.addEventListener('tipitaka:layout-shift-resize', onResizeShift);
    return () => {
      window.removeEventListener('tipitaka:before-layout-shift', onBeforeShift);
      window.removeEventListener('tipitaka:layout-shift-resize', onResizeShift);
    };
  }, [captureReadingAnchor, applyAnchorCompensation]);

  // Transfer scroll position cleanly when switching between window-scroll (single pane)
  // and independent column scroll (<main overflow-y-auto>) so opening/closing columns
  // never resets an already-scrolled pane back to the top.
  useLayoutEffect(() => {
    if (prevUseWindowScrollRef.current === useWindowScroll) return;
    prevUseWindowScrollRef.current = useWindowScroll;

    const container = containerRef.current;
    const isReaderReady =
      Boolean(isVisible && container && tab?.bookCode && tab.bookCode !== 'ai_chat') &&
      tab.viewMode !== 'toc' &&
      !tab.isTocView &&
      !tab.isLoading;
    if (!isReaderReady) return;

    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('window-scroll', useWindowScroll);
      document.body.classList.toggle('window-scroll', useWindowScroll);
    }

    if (paneScrollIntent) return;

    const savedScroll = getSavedScroll(tab.bookCode);
    const targetScroll = savedScroll > 0 ? savedScroll : (lastScrollYRef.current > 0 ? lastScrollYRef.current : 0);
    if (targetScroll > 0 || Math.abs(getScrollTop() - targetScroll) > 1) {
      isProgrammaticScrollRef.current = true;
      if (typeof window !== 'undefined') {
        window.__tpoProgrammaticScroll = true;
      }
      lastScrollYRef.current = targetScroll;
      scrollUpPeakYRef.current = targetScroll;
      scrollDownPeakYRef.current = targetScroll;
      setScrollTop(targetScroll, 'auto');
      if (targetScroll !== savedScroll && tab?.bookCode && tab.bookCode !== 'ai_chat') {
        saveTabScroll(tab.bookCode, targetScroll);
      }
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        if (typeof window !== 'undefined') {
          window.__tpoProgrammaticScroll = false;
        }
      }, 150);
    }
  }, [
    useWindowScroll,
    isVisible,
    tab?.bookCode,
    tab?.viewMode,
    tab?.isTocView,
    tab?.isLoading,
    paneScrollIntent,
    getSavedScroll,
    getScrollTop,
    setScrollTop,
    saveTabScroll,
  ]);

  useLayoutEffect(() => {
    if (!anchorPinRef.current.active) return;
    applyAnchorCompensation();
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      applyAnchorCompensation();
      raf2 = requestAnimationFrame(applyAnchorCompensation);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [isDictOpen, dictDockMode, isDictPinned, isSidebarOpen, isColumnsMode, useWindowScroll, applyAnchorCompensation]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !containerRef.current || !isVisible) return;
    const inner = containerRef.current.querySelector('.reader-container') || containerRef.current;
    let prevWidth = inner.getBoundingClientRect().width;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = entry?.contentRect?.width ?? inner.getBoundingClientRect().width;
      if (Math.abs(nextWidth - prevWidth) > 0.5) {
        prevWidth = nextWidth;
        if (anchorPinRef.current.active) {
          applyAnchorCompensation();
        }
      }
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [isVisible, applyAnchorCompensation]);

  // Restore clicked word highlight when pane becomes visible or chapters render
  useEffect(() => {
    if (!isVisible || !tab?.bookCode || !containerRef.current) return;
    const record = clickedWordsByBookRef.current?.[tab.bookCode];
    clearClickedWordHighlight(containerRef.current);
    if (record) {
      const timer = setTimeout(() => {
        if (containerRef.current) {
          restoreClickedWordHighlight(tab.bookCode, record, containerRef.current);
        }
      }, 70);
      return () => clearTimeout(timer);
    }
  }, [isVisible, tab?.bookCode, tab?.currentChapterIdx, settings?.paliScript, clickedWordsByBookRef]);

  // Zero-bounce scroll restoration before paint when switching tabs or hydrating a tab
  useLayoutEffect(() => {
    const container = containerRef.current;
    const isReaderReady =
      Boolean(isVisible && container && tab?.bookCode && tab.bookCode !== 'ai_chat') &&
      tab.viewMode !== 'toc' &&
      !tab.isTocView &&
      !tab.isLoading;

    if (!isReaderReady) {
      wasVisibleReaderRef.current = false;
      return;
    }

    if (paneScrollIntent) {
      if (tabSwitchRetryTimerRef.current) {
        clearInterval(tabSwitchRetryTimerRef.current);
        tabSwitchRetryTimerRef.current = null;
      }
      isTabSwitchingRef.current = false;
      wasVisibleReaderRef.current = true;
      return;
    }

    // If this pane was ALREADY visible in reader mode (e.g. paneScrollIntent just cleared
    // after completing a jump, or props re-rendered while visible), do NOT re-apply savedScroll!
    if (wasVisibleReaderRef.current && hasInitialRestoredRef.current) {
      return;
    }
    wasVisibleReaderRef.current = true;

    const savedScroll = getSavedScroll(tab.bookCode);

    const syncRestoredScrollPos = (pos) => {
      const safePos = Math.max(0, pos);
      lastScrollYRef.current = safePos;
      scrollUpPeakYRef.current = safePos;
      scrollDownPeakYRef.current = safePos;
      isProgrammaticScrollRef.current = true;
      if (typeof window !== 'undefined') {
        window.__tpoProgrammaticScroll = true;
      }
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        if (typeof window !== 'undefined') {
          window.__tpoProgrammaticScroll = false;
        }
      }, 160);
      setScrollTop(safePos, 'auto');
    };

    // FAST PATH: Pane was already mounted & restored previously.
    // Because the pane's DOM stayed mounted while hidden, its layout height is already exact.
    // Restore exact pixel scrollTop synchronously before paint with ZERO drift timers or anchor snapping!
    if (hasInitialRestoredRef.current) {
      isTabSwitchingRef.current = true;
      lastScrollYRef.current = savedScroll;
      scrollUpPeakYRef.current = Math.max(0, savedScroll);
      scrollDownPeakYRef.current = Math.max(0, savedScroll);
      if (Math.abs(getScrollTop() - savedScroll) > 1) {
        syncRestoredScrollPos(savedScroll);
      }
      const rafId = requestAnimationFrame(() => {
        if (containerRef.current && !paneScrollIntent) {
          if (Math.abs(getScrollTop() - savedScroll) > 2) {
            syncRestoredScrollPos(savedScroll);
          }
        }
        isTabSwitchingRef.current = false;
      });
      return () => {
        cancelAnimationFrame(rafId);
        isTabSwitchingRef.current = false;
      };
    }

    // INITIAL HYDRATION PATH: First time this tab is rendered without an explicit scroll intent.
    const targetPara = tab?.lastParaNum;
    const currentChap = tab?.currentChapterIdx;
    const cleanPara = targetPara ? String(targetPara).replace(/^(?:para-?|p)/i, '').trim() : null;

    const getTargetChap = () => {
      if (currentChap !== undefined && currentChap !== null) {
        return currentChap;
      }
      const curTab = activeTabRef.current;
      const subKey = curTab?.sub_book;
      if (cleanPara && subKey && curTab?.sub_books_para_to_chapter?.[subKey]?.[cleanPara] !== undefined) {
        return curTab.sub_books_para_to_chapter[subKey][cleanPara];
      }
      if (cleanPara && curTab?.para_to_chapter?.[cleanPara] !== undefined) {
        return curTab.para_to_chapter[cleanPara];
      }
      return 0;
    };

    const targetChap = getTargetChap();
    if (targetChap !== undefined && targetChap !== null) {
      if (!tab.loadedChapters?.[targetChap] && !tab.loadingChapters?.[targetChap]) {
        loadChapter(tab.bookCode, targetChap);
      }
      bufferAdjacentChapters(tab.bookCode, targetChap);
    }

    const tryInitialRestore = (allowStaleFallback = false) => {
      const c = containerRef.current;
      if (!c) return false;
      const effChap = getTargetChap();
      const TOP_PAD = getTopReadingInset();

      const chapEl = c.querySelector(`[data-chapter="${effChap}"]`);
      const chapReady = Boolean(chapEl && !chapEl.classList.contains('chapter-placeholder'));
      const prevChapEl = effChap > 0 ? c.querySelector(`[data-chapter="${effChap - 1}"]`) : null;
      const prevChapLoading =
        Boolean(tab.loadingChapters?.[effChap - 1]) ||
        Boolean(hasTransLayers && prevChapEl && !prevChapEl.classList.contains('chapter-placeholder') && prevChapEl.getAttribute('data-trans-loading') === '1');
      const hostTransReady =
        !hasTransLayers ||
        (chapReady && chapEl.getAttribute('data-trans-settled') === '1' && !prevChapLoading);

      if (savedScroll > 0) {
        const { top: vpTop, height, scrollHeight } = getViewportBounds();
        const maxScroll = Math.max(0, scrollHeight - height);
        const curTop = getScrollTop();
        let savedMatchesTargetChapter = true;
        if (tab?.fromSavedSession && effChap > 1 && chapReady && hostTransReady) {
          const chRect = chapEl.getBoundingClientRect();
          const chTopAbs = chRect.top - vpTop + curTop;
          const chBottomAbs = chRect.bottom - vpTop + curTop;
          if (savedScroll < chTopAbs - 220 || savedScroll > chBottomAbs + 220) {
            savedMatchesTargetChapter = false;
          }
        }
        if (maxScroll >= savedScroll - 20 && savedMatchesTargetChapter) {
          if (tab?.fromSavedSession && !hostTransReady && !allowStaleFallback) {
            return false;
          }
          syncRestoredScrollPos(savedScroll);
          hasInitialRestoredRef.current = true;
          return true;
        }
        if (!allowStaleFallback && (!chapReady || !hostTransReady)) {
          return false;
        }
      }

      if (!chapReady) {
        return false;
      }
      if (!allowStaleFallback && !hostTransReady) {
        return false;
      }

      const savedPIdx = tab?.lastParaIndex !== undefined && tab?.lastParaIndex !== null ? String(tab.lastParaIndex) : null;
      const pEl =
        (savedPIdx &&
          (chapEl.querySelector(`.reader-para-row[data-pindex="${savedPIdx}"]`) ||
            chapEl.querySelector(`[data-pindex="${savedPIdx}"]`) ||
            c.querySelector(`[data-pindex="${savedPIdx}"]`))) ||
        (cleanPara &&
          (chapEl.querySelector(`[data-para="${cleanPara}"]`) ||
            chapEl.querySelector(`[data-pindex="${cleanPara}"]`) ||
            c.querySelector(`[data-para="${cleanPara}"]`))) ||
        null;

      if (pEl) {
        const { top: vpTop } = getViewportBounds();
        const curTop = getScrollTop();
        const pRect = pEl.getBoundingClientRect();
        const offset = Math.max(0, pRect.top - vpTop + curTop - TOP_PAD);
        syncRestoredScrollPos(offset);
        saveTabScroll(tab.bookCode, offset);
        hasInitialRestoredRef.current = true;
        return true;
      }
      if (cleanPara && chapEl.querySelectorAll('[data-para], [data-pindex]').length === 0 && !allowStaleFallback) {
        return false;
      }

      if (effChap > 0) {
        const { top: vpTop } = getViewportBounds();
        const curTop = getScrollTop();
        const chRect = chapEl.getBoundingClientRect();
        const offset = Math.max(0, chRect.top - vpTop + curTop - TOP_PAD);
        syncRestoredScrollPos(offset);
        saveTabScroll(tab.bookCode, offset);
      }
      hasInitialRestoredRef.current = true;
      return true;
    };

    isTabSwitchingRef.current = true;
    if (tryInitialRestore(false)) {
      isTabSwitchingRef.current = false;
      return;
    }

    let attempts = 0;
    const maxAttempts = 50;
    if (tabSwitchRetryTimerRef.current) {
      clearInterval(tabSwitchRetryTimerRef.current);
    }
    tabSwitchRetryTimerRef.current = setInterval(() => {
      attempts++;
      if (tryInitialRestore(attempts >= maxAttempts) || attempts >= maxAttempts) {
        hasInitialRestoredRef.current = true;
        isTabSwitchingRef.current = false;
        if (tabSwitchRetryTimerRef.current) {
          clearInterval(tabSwitchRetryTimerRef.current);
          tabSwitchRetryTimerRef.current = null;
        }
      }
    }, 50);

    return () => {
      if (tabSwitchRetryTimerRef.current) {
        clearInterval(tabSwitchRetryTimerRef.current);
        tabSwitchRetryTimerRef.current = null;
      }
      isTabSwitchingRef.current = false;
    };
  }, [
    isVisible,
    tab?.bookCode,
    tab?.isLoading,
    tab?.viewMode,
    tab?.isTocView,
    paneScrollIntent,
    getSavedScroll,
    loadChapter,
    bufferAdjacentChapters,
    saveTabScroll,
  ]);

  // Handle Target Scroll Intent (Chapter jumping, Search jumping, Book TOC jumping, MAT jumping, Bookmarks, History)
  useEffect(() => {
    const currentTab = activeTabRef.current;
    if (
      !paneScrollIntent ||
      !isVisible ||
      !containerRef.current ||
      !currentTab ||
      currentTab.viewMode === 'toc' ||
      currentTab.isTocView
    ) {
      clearTimeout(targetWaitTimeoutRef.current);
      targetWaitTimeoutRef.current = null;
      setIsTargetScrollWaiting(false);
      return;
    }

    const {
      chapterIdx,
      paraIndex,
      paraNum,
      page,
      pageSystem,
      subBook,
      lang,
      db,
      lineId,
      word: targetWord,
      bold: targetBold,
      snippet: targetSnippet,
    } = paneScrollIntent;
    const targetTransLang = normalizeLangCode(lang || db || searchHighlight?.lang || searchHighlight?.db);
    const isTransTarget = Boolean(targetTransLang && targetTransLang !== 'pali');

    if (chapterIdx !== undefined && chapterIdx !== null) {
      if (!currentTab.loadedChapters?.[chapterIdx]) {
        loadChapter(currentTab.bookCode, chapterIdx);
      }
      bufferAdjacentChapters(currentTab.bookCode, chapterIdx);
    }

    let retries = 0;
    const maxRetries = 80; // Check every 50ms for up to 4.0 seconds (sufficient time for chapter & translation loading)

    let timerId = null;
    const scheduleAttemptScroll = (delay = 50) => {
      clearTimeout(timerId);
      clearTimeout(attemptScrollTimerRef.current);
      timerId = setTimeout(attemptScroll, delay);
      attemptScrollTimerRef.current = timerId;
    };

    // Safe DOM element finder by ID or data attributes (prevents selector SyntaxError on IDs with dots e.g. V3.0440)
    const findElement = (id, fallbackSelector = '', specificChapter = undefined) => {
      if (!containerRef.current) return null;
      const effectiveChap = specificChapter !== undefined && specificChapter !== null
        ? specificChapter
        : (chapterIdx !== undefined && chapterIdx !== null ? chapterIdx : null);
      const hasSpecificChapter = effectiveChap !== null;
      const chapterEl = hasSpecificChapter
        ? containerRef.current.querySelector(`[data-chapter="${effectiveChap}"]`)
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
      const activeTab = activeTabRef.current;
      if (!containerRef.current || !activeTab) return;
      retries++;

      // ── Translation-settle gate ────────────────────────────────────────
      // Returns true only once the content above the jump anchor can no longer
      // grow on its own. With translation layers enabled, each chapter streams
      // its payload lazily (`data-trans-loading` while a fetch is in flight,
      // `data-trans-settled` once it has landed/errored). While the target
      // chapter's own payload is pending, its rows above the target paragraph
      // expand when it lands; while any content chapter above the anchor is
      // still loading, the anchor itself can be pushed down. The settle watcher
      // must not declare stability until those conditions clear.
      const areaTranslationSettled = (hostChapterEl, { includeHost = true } = {}) => {
        if (!hasTransLayers) return true;
        const container = containerRef.current;
        if (!container) return true;
        let hostEl = hostChapterEl;
        if (hostEl) {
          hostEl = hostEl.closest('.chapter-content-block, .chapter-placeholder') || hostEl;
        } else if (chapterIdx !== undefined && chapterIdx !== null) {
          hostEl = container.querySelector(`.chapter-content-block[data-chapter="${chapterIdx}"], .chapter-placeholder[data-chapter="${chapterIdx}"]`);
        }
        if (includeHost) {
          if (!hostEl) return false;
          if (hostEl.classList.contains('chapter-placeholder')) return false;
          if (hostEl.getAttribute('data-trans-settled') !== '1') return false;
        }
        const targetIdx = hostEl ? Number(hostEl.getAttribute('data-chapter')) : null;
        if (targetIdx === null || Number.isNaN(targetIdx)) return true;
        const chapterEls = container.querySelectorAll('.chapter-content-block[data-chapter], .chapter-placeholder[data-chapter]');
        const curLoadingChaps = activeTabRef.current?.loadingChapters || {};
        for (const chEl of chapterEls) {
          const idx = Number(chEl.getAttribute('data-chapter'));
          if (Number.isNaN(idx) || idx >= targetIdx) continue; // only chapters above the anchor
          if (curLoadingChaps[idx]) return false;
          if (chEl.classList.contains('chapter-placeholder')) {
            if (idx === targetIdx - 1 && targetIdx > 0 && (paneScrollIntentRef.current || jumpPinRef.current)) return false;
            continue;
          }
          if (chEl.getAttribute('data-trans-loading') === '1') return false;
        }
        return true;
      };

      const targetChapEl = (chapterIdx !== undefined && chapterIdx !== null)
        ? containerRef.current?.querySelector(`.chapter-content-block[data-chapter="${chapterIdx}"], .chapter-placeholder[data-chapter="${chapterIdx}"]`)
        : null;
      const prevChapLoading = Boolean(hasTransLayers && chapterIdx > 0 && activeTab.loadingChapters?.[chapterIdx - 1]);
      const isWaitingForContent =
        Boolean(activeTab.loadingChapters?.[chapterIdx]) ||
        prevChapLoading ||
        (isTransTarget && !activeLangsRef.current?.includes(targetTransLang)) ||
        (targetChapEl && targetChapEl.classList.contains('chapter-placeholder')) ||
        (hasTransLayers &&
          (!targetChapEl ||
            targetChapEl.getAttribute('data-trans-settled') !== '1' ||
            !areaTranslationSettled(targetChapEl)));
      const effectiveMaxRetries = isWaitingForContent ? 300 : maxRetries;

      // Wait for newly-enabled translation language state to propagate into ReaderView/ChapterBlock
      if (isTransTarget && !activeLangsRef.current?.includes(targetTransLang) && retries < effectiveMaxRetries - 5) {
        scheduleAttemptScroll(50);
        return;
      }

      const resolveNearestPbInScope = (scopeEl, edCode, rawPage) => {
        if (!scopeEl || !scopeEl.querySelectorAll) return null;
        const cleanStr = String(rawPage || '').trim();
        let expVol = null;
        let pInt = NaN;
        if (cleanStr.includes('.')) {
          const [vs, ps] = cleanStr.split('.');
          expVol = parseInt(vs, 10);
          pInt = parseInt(ps, 10);
        } else {
          pInt = parseInt(cleanStr, 10);
        }
        if (Number.isNaN(pInt)) return null;
        const pbs = scopeEl.querySelectorAll(`span.pb[data-ed="${edCode}"][data-page], [data-ed="${edCode}"][data-page]`);
        let bestBefore = null;
        let bestBeforeDiff = Infinity;
        let bestAfter = null;
        let bestAfterDiff = Infinity;
        for (const pb of pbs) {
          if (pb.hasAttribute?.('data-chunk-pb')) continue;
          const pv = pb.getAttribute('data-page') || '';
          let kVol = null;
          let kNum = NaN;
          if (pv.includes('.')) {
            const [vs, ps] = pv.split('.');
            kVol = parseInt(vs, 10);
            kNum = parseInt(ps, 10);
            if (expVol !== null && kVol !== expVol) continue;
          } else {
            if (expVol !== null && expVol > 0) continue;
            kNum = parseInt(pv, 10);
          }
          if (Number.isNaN(kNum)) continue;
          if (kNum <= pInt) {
            const diff = pInt - kNum;
            if (diff < bestBeforeDiff) {
              bestBeforeDiff = diff;
              bestBefore = pb;
            }
          } else {
            const diff = kNum - pInt;
            if (diff < bestAfterDiff) {
              bestAfterDiff = diff;
              bestAfter = pb;
            }
          }
        }
        return bestBefore || bestAfter;
      };

      // ── Paragraph-jump settle watcher ──────────────────────────────────
      // Re-resolve the paragraph target the jump scrolled to (same flavour:
      // translation block for translation-targeted jumps, row otherwise).
      // Returns null when the target is not (yet) measurably in the DOM.
      const resolveParaTarget = () => {
        const container = containerRef.current;
        if (!container) return null;
        const visible = (el) =>
          el && el.getClientRects && el.getClientRects().length > 0 ? el : null;
        const hasSearchQuery = Boolean((searchHighlight?.query || paneScrollIntent?.highlightQuery || '').trim());
        const vpHNow = getViewportBounds().height || 700;
        const pickSearchHitInRow = (row) => {
          if (!hasSearchQuery || !row || !row.querySelector) return null;
          return pickBestSearchHitAnchor(row, {
            isTransTarget,
            targetTransLang,
            vpHeight: vpHNow,
          });
        };
        const pickPassageSubInRow = (row) => {
          if (isTransTarget && !targetSnippet) return null;
          if (!isTransTarget && !targetWord && !targetBold && !targetSnippet) return null;
          const sub = findPassageSubTarget(row, {
            word: targetWord,
            bold: targetBold,
            snippet: targetSnippet,
            paliScript: settings?.paliScript || 'roman',
            isTransTarget,
            targetTransLang,
          });
          return sub?.anchor && visible(sub.anchor) ? sub.anchor : null;
        };
        const pickTransOrRow = (row, scopeForChapter) => {
          const hitTarget = pickSearchHitInRow(row);
          if (hitTarget) return hitTarget;
          const passageSub = pickPassageSubInRow(row);
          if (passageSub) return passageSub;
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
          if (lineId) {
            const sentLineEl =
              row?.querySelector?.(`[data-line="${lineId}"]`) ||
              row?.querySelector?.(`.sent-pair[data-line="${lineId}"]`) ||
              row?.querySelector?.(`.pali-sent[data-line="${lineId}"]`);
            if (visible(sentLineEl)) {
              const subInLine = pickPassageSubInRow(sentLineEl);
              return subInLine || sentLineEl;
            }
          }
          return pickTransOrRow(row, chapterEl || container);
        }

        if (page && pageSystem) {
          const cleanP = String(page).trim();
          const ed = String(pageSystem).toUpperCase();
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
          let pbEl = null;

          if (cleanP.includes('.')) {
            const parts = cleanP.split('.');
            const vol = parseInt(parts[0], 10);
            const num = parseInt(parts[1], 10);
            if (!isNaN(vol) && !isNaN(num)) {
              const padded = `${vol}.${String(num).padStart(4, '0')}`;
              pbEl =
                scope.querySelector(`[id="${ed}${padded}"]:not([data-chunk-pb])`) ||
                scope.querySelector(`[id="${ed}${cleanP}"]:not([data-chunk-pb])`) ||
                scope.querySelector(`span.pb[data-ed="${ed}"][data-page="${padded}"]:not([data-chunk-pb])`) ||
                scope.querySelector(`span.pb[data-ed="${ed}"][data-page="${cleanP}"]:not([data-chunk-pb])`);
            }
          } else {
            const num = parseInt(cleanP, 10);
            if (!isNaN(num)) {
              const paddedNum = String(num).padStart(4, '0');
              const knownAnchor =
                activeTab?.page_anchors?.[ed]?.[cleanP] || activeTab?.page_anchors?.[ed]?.[String(num)];
              if (knownAnchor) {
                pbEl = scope.querySelector(`[id="${knownAnchor}"]:not([data-chunk-pb])`);
              }
              if (!pbEl) {
                pbEl =
                  scope.querySelector(`span.pb[data-ed="${ed}"][data-page$=".${paddedNum}"]:not([data-chunk-pb])`) ||
                  scope.querySelector(`span.pb[data-ed="${ed}"][data-page="${paddedNum}"]:not([data-chunk-pb])`) ||
                  scope.querySelector(`span.pb[data-ed="${ed}"][data-page="${cleanP}"]:not([data-chunk-pb])`);
              }
            }
          }

          if (!pbEl) {
            pbEl = resolveNearestPbInScope(scope, ed, cleanP);
          }

          if (!pbEl) {
            const targetPara = paraNum || activeTab?.page_to_para?.[ed]?.[cleanP];
            if (targetPara !== undefined && targetPara !== null && targetPara !== '') {
              const pClean = String(targetPara).trim();
              pbEl =
                scope.querySelector(`[id="para-${pClean}"]`) ||
                scope.querySelector(`[id="para${pClean}"]`) ||
                scope.querySelector(`[data-para="${pClean}"]`) ||
                scope.querySelector(`[data-pindex="${pClean}"]`);
            }
          }

          if (!pbEl) return null;

          const hostChapter = pbEl.closest ? pbEl.closest('[data-chapter]') : null;
          if (sentenceMode && hasTransLayers) {
            const sentPair = pbEl.closest('.sent-pair');
            if (sentPair) {
              return visible(sentPair);
            }
            // Hold off fallback while host chapter translations are actively loading
            if (hostChapter?.getAttribute('data-trans-loading') === '1') {
              return null;
            }
          }

          const targetEl = resolveMeasurablePbAnchor(pbEl, sentenceMode);

          return visible(targetEl);
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



      // Arm a guarded settle watcher after a paragraph jump. Translation batches
      // streaming in later can shift the target; re-verify until stable (two
      // consecutive in-tolerance reads once the surrounding content has finished
      // streaming, so a wave landing between ticks can't fake a settle). Stands
      // down on manual scroll, stability, bottom-clamp, timeout, or a newer jump
      // superseding it.
      const armParaJumpWatcher = (jumpKey, jumpOffset) => {
        clearTimeout(paraJumpRef.current.timer);
        if (jumpResizeObserverRef.current) {
          jumpResizeObserverRef.current.disconnect();
          jumpResizeObserverRef.current = null;
        }
        const state = {
          key: jumpKey,
          lastOffset: jumpOffset,
          timer: null,
          deadline: Date.now() + 8000,
          stableCount: 0,
          lastScrollHeight: null,
        };
        paraJumpRef.current = state;
        const TOL = 16;
        const GAP = 350;
        let rafScheduleId = 0;

        const stopWatcher = () => {
          paraJumpRef.current.key = null;
          clearTimeout(state.timer);
          if (rafScheduleId) cancelAnimationFrame(rafScheduleId);
          if (jumpResizeObserverRef.current) {
            jumpResizeObserverRef.current.disconnect();
            jumpResizeObserverRef.current = null;
          }
        };

        const tick = () => {
          const cur = paraJumpRef.current;
          if (!cur || cur.key !== jumpKey) return; // superseded
          const container = containerRef.current;
          if (!container) {
            stopWatcher();
            return;
          }
          if (Date.now() > cur.deadline) {
            stopWatcher();
            return;
          }
          const curTop = getScrollTop();
          const { top: vpTop, height: vpHeight, scrollHeight: vpScrollHeight } = getViewportBounds();
          const topInset = getTopReadingInset();
          const target = resolveParaTarget();
          if (!target) {
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          const hostChapter = target.closest ? target.closest('[data-chapter]') : null;
          const areaSettled = areaTranslationSettled(hostChapter);
          const linksLoading = hostChapter?.getAttribute?.('data-links-loading') === '1';
          const rRect = target.getBoundingClientRect();
          const diff = Math.abs(rRect.top - vpTop - topInset);
          if (diff > TOL) {
            cur.stableCount = 0;
            const fresh = computeAnchorScrollTarget({
              elementTopViewport: rRect.top,
              viewportTop: vpTop,
              currentScroll: curTop,
              stickyInset: topInset,
            });
            if (curTop + vpHeight >= vpScrollHeight - 4 && fresh >= vpScrollHeight - vpHeight - 2 && rRect.top >= vpTop + topInset - 8) {
              if (areaSettled && !linksLoading) {
                stopWatcher();
                return;
              }
            } else {
              performProgrammaticScroll(container, fresh, { scrollMotion: 'instant' });
              if (target.range) {
                highlightRangeInReader(target.range);
              }
              if (settings.pulseAnimation) {
                const pulseEl = target.classList ? target : target.hostRow;
                if (pulseEl?.classList) {
                  pulseEl.classList.remove('pulse-highlight');
                  void pulseEl.offsetWidth;
                  pulseEl.classList.add('pulse-highlight');
                }
              }
              saveTabScroll(activeTab.bookCode, fresh);
              cur.lastOffset = fresh;
            }
            cur.lastScrollHeight = vpScrollHeight;
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          // In tolerance, but the layout may still be growing above the anchor
          // (payloads in flight, chapters inserting) — hold, don't settle yet.
          const layoutChanged =
            cur.lastScrollHeight !== null && vpScrollHeight !== cur.lastScrollHeight;
          cur.lastScrollHeight = vpScrollHeight;
          if (!areaSettled || linksLoading || layoutChanged) {
            cur.stableCount = 0;
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          cur.stableCount += 1;
          if (cur.stableCount >= 2) {
            stopWatcher();
          } else {
            cur.timer = setTimeout(tick, GAP);
          }
        };

        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          const inner = containerRef.current.querySelector('.reader-container') || containerRef.current;
          const ro = new ResizeObserver(() => {
            const cur = paraJumpRef.current;
            if (!cur || cur.key !== jumpKey) return;
            cur.stableCount = 0;
            if (rafScheduleId) cancelAnimationFrame(rafScheduleId);
            rafScheduleId = requestAnimationFrame(() => {
              rafScheduleId = 0;
              if (paraJumpRef.current?.key === jumpKey) {
                clearTimeout(paraJumpRef.current.timer);
                tick();
              }
            });
          });
          ro.observe(inner);
          jumpResizeObserverRef.current = ro;
        }

        // First check after any in-flight smooth animation has finished.
        state.timer = setTimeout(tick, 450);
      };

      // Chapter-jump settle watcher (sidebar chapter clicks / chapter-only
      // intents). Shares the same guarded settle behaviour as paragraph jumps so
      // both scroll the same way: re-verify the anchor while translation batches
      // stream in above/below it, correct once the content has settled, and only
      // stand down after two consecutive stable reads. Manual scroll, timeout,
      // bottom-clamp or a newer jump supersede it.
      const armChapterJumpWatcher = (jumpKey, jumpOffset, chapIdx) => {
        clearTimeout(chapterJumpRef.current.timer);
        if (jumpResizeObserverRef.current) {
          jumpResizeObserverRef.current.disconnect();
          jumpResizeObserverRef.current = null;
        }
        const state = {
          key: jumpKey,
          lastOffset: jumpOffset,
          timer: null,
          deadline: Date.now() + 8000,
          stableCount: 0,
          lastScrollHeight: null,
        };
        chapterJumpRef.current = state;
        const TOL = 16;
        const GAP = 350;
        let rafScheduleId = 0;

        const stopWatcher = () => {
          chapterJumpRef.current.key = null;
          clearTimeout(state.timer);
          if (rafScheduleId) cancelAnimationFrame(rafScheduleId);
          if (jumpResizeObserverRef.current) {
            jumpResizeObserverRef.current.disconnect();
            jumpResizeObserverRef.current = null;
          }
        };

        const tick = () => {
          const cur = chapterJumpRef.current;
          if (!cur || cur.key !== jumpKey) return; // superseded
          const container = containerRef.current;
          if (!container) {
            stopWatcher();
            return;
          }
          if (Date.now() > cur.deadline) {
            stopWatcher();
            return;
          }
          const curTop = getScrollTop();
          const { top: vpTop, height: vpHeight, scrollHeight: vpScrollHeight } = getViewportBounds();
          const topInset = getTopReadingInset();
          const el =
            container.querySelector(`#chap-${chapIdx}`) ||
            container.querySelector(`[data-chapter="${chapIdx}"]`);
          if (!el) {
            stopWatcher();
            return;
          }
          const areaSettled = areaTranslationSettled(el, { includeHost: false });
          const hostChapEl = el.closest?.('[data-chapter]') || el;
          const linksLoading = hostChapEl?.getAttribute?.('data-links-loading') === '1';
          const rRect = el.getBoundingClientRect();
          if (Math.abs(rRect.top - vpTop - topInset) > TOL) {
            cur.stableCount = 0;
            const fresh = computeAnchorScrollTarget({
              elementTopViewport: rRect.top,
              viewportTop: vpTop,
              currentScroll: curTop,
              stickyInset: topInset,
            });
            if (curTop + vpHeight >= vpScrollHeight - 4 && fresh >= vpScrollHeight - vpHeight - 2 && rRect.top >= vpTop + topInset - 8) {
              if (areaSettled && !linksLoading) {
                stopWatcher();
                return;
              }
            } else {
              performProgrammaticScroll(container, fresh, { scrollMotion: 'instant' });
              saveTabScroll(activeTab.bookCode, fresh);
              cur.lastOffset = fresh;
            }
            cur.lastScrollHeight = vpScrollHeight;
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          const layoutChanged =
            cur.lastScrollHeight !== null && vpScrollHeight !== cur.lastScrollHeight;
          cur.lastScrollHeight = vpScrollHeight;
          if (!areaSettled || linksLoading || layoutChanged) {
            cur.stableCount = 0;
            cur.timer = setTimeout(tick, GAP);
            return;
          }
          cur.stableCount += 1;
          if (cur.stableCount >= 2) stopWatcher();
          else cur.timer = setTimeout(tick, GAP);
        };

        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          const inner = containerRef.current.querySelector('.reader-container') || containerRef.current;
          const ro = new ResizeObserver(() => {
            const cur = chapterJumpRef.current;
            if (!cur || cur.key !== jumpKey) return;
            cur.stableCount = 0;
            if (rafScheduleId) cancelAnimationFrame(rafScheduleId);
            rafScheduleId = requestAnimationFrame(() => {
              rafScheduleId = 0;
              if (chapterJumpRef.current?.key === jumpKey) {
                clearTimeout(chapterJumpRef.current.timer);
                tick();
              }
            });
          });
          ro.observe(inner);
          jumpResizeObserverRef.current = ro;
        }

        state.timer = setTimeout(tick, 450);
      };

      // 1. Target paragraph by index (Highest Priority for Translation FTS, Pāḷi FTS, TOC, and para_index targets)
      if (paraIndex !== undefined && paraIndex !== null && paraIndex !== '') {
        const chapterEl = (chapterIdx !== undefined && chapterIdx !== null)
          ? containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`)
          : null;

        // If target chapter element is still a placeholder or not in DOM yet, or still loading translations, wait and retry
        if (chapterIdx !== undefined && chapterIdx !== null && (!chapterEl || chapterEl.classList.contains('chapter-placeholder') || (hasTransLayers && chapterEl.getAttribute('data-trans-settled') !== '1'))) {
          // Chapter HTML or translations still loading/rendering, will retry on next tick
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
                } else if (retries < effectiveMaxRetries - 5) {
                  // Wait for translation block to finish loading and rendering before jumping
                  targetEl = null;
                } else {
                  targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
                }
              }
            } else {
              targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
            }

            // Target specific sentence line if lineId is specified, else sub-paragraph bold/linked passage or search-hit line
            const row = el.closest('.reader-para-row') || el;
            let matchedSubRange = null;
            let resolvedSubLine = false;
            if (lineId) {
              const sentLineEl =
                row?.querySelector?.(`[data-line="${lineId}"]`) ||
                row?.querySelector?.(`.sent-pair[data-line="${lineId}"]`) ||
                row?.querySelector?.(`.pali-sent[data-line="${lineId}"]`);
              if (sentLineEl && sentLineEl.getClientRects().length > 0) {
                targetEl = sentLineEl;
                resolvedSubLine = true;
                if (!isTransTarget && (targetWord || targetBold || targetSnippet)) {
                  const subInLine = findPassageSubTarget(sentLineEl, {
                    word: targetWord,
                    bold: targetBold,
                    snippet: targetSnippet,
                    paliScript: settings?.paliScript || 'roman',
                  });
                  if (subInLine?.anchor) {
                    targetEl = subInLine.anchor;
                    matchedSubRange = subInLine.range || null;
                  }
                }
              }
            }
            if (!resolvedSubLine) {
              const hasSearchQuery = Boolean((searchHighlight?.query || paneScrollIntent?.highlightQuery || '').trim());
              if (hasSearchQuery && row?.querySelector) {
                const hitAnchor = pickBestSearchHitAnchor(row, {
                  isTransTarget,
                  targetTransLang,
                  vpHeight: getViewportBounds().height || 700,
                });
                if (hitAnchor) {
                  targetEl = hitAnchor;
                  resolvedSubLine = true;
                }
              }
            }
            if (
              !resolvedSubLine &&
              ((isTransTarget && targetSnippet) || (!isTransTarget && (targetWord || targetBold || targetSnippet)))
            ) {
              const subHit = findPassageSubTarget(row, {
                word: targetWord,
                bold: targetBold,
                snippet: targetSnippet,
                paliScript: settings?.paliScript || 'roman',
                isTransTarget,
                targetTransLang,
              });
              if (subHit?.anchor) {
                targetEl = subHit.anchor;
                matchedSubRange = subHit.range || null;
              }
            }

            if (targetEl) {
              const hostChapter = targetEl.closest ? targetEl.closest('[data-chapter]') : chapterEl;
              if (hasTransLayers && !areaTranslationSettled(hostChapter) && retries < effectiveMaxRetries - 5) {
                scheduleAttemptScroll(50);
                return;
              }

              const { top: vpTop } = getViewportBounds();
              const rect = targetEl.getBoundingClientRect();
              const currentScroll = getScrollTop();
              const topInset = getTopReadingInset();
              const offset = computeAnchorScrollTarget({
                elementTopViewport: rect.top,
                viewportTop: vpTop,
                currentScroll,
                stickyInset: topInset,
              });
              performProgrammaticScroll(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

              if (matchedSubRange) {
                highlightRangeInReader(matchedSubRange);
              }
              if (settings.pulseAnimation) {
                const pulseEl = targetEl.classList ? targetEl : targetEl.hostRow || row;
                if (pulseEl?.classList) {
                  pulseEl.classList.remove('pulse-highlight');
                  void pulseEl.offsetWidth;
                  pulseEl.classList.add('pulse-highlight');
                }
              }
              const foundPNum = targetEl.getAttribute?.('data-para') || el.getAttribute?.('data-para');
              if (foundPNum) {
                setPaneParaNum(foundPNum);
                if (isActive) setActiveParaNum(foundPNum);
              }
              const resolvedChapPin = hostChapter
                ? parseInt(hostChapter.getAttribute('data-chapter'), 10)
                : chapterIdx;
              hasInitialRestoredRef.current = true;
              saveTabScroll(activeTab.bookCode, offset);
              armParaJumpWatcher(
                `${activeTab.bookCode}:ch${chapterIdx}:pi${paraIndex}:${Date.now()}`,
                offset
              );
              pinJumpTarget({
                bookCode: activeTab.bookCode,
                chapterIdx: !Number.isNaN(resolvedChapPin) ? resolvedChapPin : chapterIdx,
                paraIndex,
                paraNum: foundPNum || paraNum || null,
              });
              clearTargetScrollIntent(activeTab.bookCode);
              setIsTargetScrollWaiting(false);
              return;
            }
          }
        }
      }

      // 1.5. Target search query highlight (for direct URLs like /book/s0103m.mul/3?q=metteyyabuddhuppādo)
      if ((paraIndex === undefined || paraIndex === null || paraIndex === '') && !paraNum && !page && (searchHighlight?.query || paneScrollIntent?.highlightQuery)) {
        const queryTerm = (searchHighlight?.query || paneScrollIntent?.highlightQuery || '').trim();
        if (queryTerm) {
          const chapterEl = (chapterIdx !== undefined && chapterIdx !== null)
            ? containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`)
            : null;

          if (
            chapterIdx !== undefined &&
            chapterIdx !== null &&
            (!chapterEl ||
              chapterEl.classList.contains('chapter-placeholder') ||
              (hasTransLayers && chapterEl.getAttribute('data-trans-settled') !== '1'))
          ) {
            // Wait for chapter HTML and translations to settle
            scheduleAttemptScroll(50);
            return;
          } else {
            const scope = chapterEl || containerRef.current;
            const hitEl = scope.querySelector('mark.search-hit, mark, .search-hit');
            if (hitEl) {
              const hostChapter = hitEl.closest ? hitEl.closest('[data-chapter]') : chapterEl;
              if (hasTransLayers && !areaTranslationSettled(hostChapter) && retries < effectiveMaxRetries - 5) {
                scheduleAttemptScroll(50);
                return;
              }

              const row = hitEl.closest('.reader-para-row') || hitEl.closest('p') || hitEl;
              const bestHit =
                pickBestSearchHitAnchor(row, {
                  isTransTarget,
                  targetTransLang,
                  vpHeight: getViewportBounds().height || 700,
                }) || (hitEl.getClientRects().length > 0 ? hitEl : row);
              const targetEl = bestHit;
              const { top: vpTop } = getViewportBounds();
              const rect = targetEl.getBoundingClientRect();
              const currentScroll = getScrollTop();
              const topInset = getTopReadingInset();
              const offset = computeAnchorScrollTarget({
                elementTopViewport: rect.top,
                viewportTop: vpTop,
                currentScroll,
                stickyInset: topInset,
              });
              performProgrammaticScroll(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

              if (settings.pulseAnimation && row?.classList) {
                row.classList.remove('pulse-highlight');
                void row.offsetWidth;
                row.classList.add('pulse-highlight');
              }
              const foundPNum = row.getAttribute?.('data-para') || targetEl.getAttribute?.('data-para');
              if (foundPNum) {
                setPaneParaNum(foundPNum);
                if (isActive) setActiveParaNum(foundPNum);
              }
              const resolvedChapPin = hostChapter
                ? parseInt(hostChapter.getAttribute('data-chapter'), 10)
                : chapterIdx;
              hasInitialRestoredRef.current = true;
              saveTabScroll(activeTab.bookCode, offset);
              armParaJumpWatcher(
                `${activeTab.bookCode}:ch${chapterIdx}:q:${queryTerm}:${Date.now()}`,
                offset
              );
              pinJumpTarget({
                bookCode: activeTab.bookCode,
                chapterIdx: !Number.isNaN(resolvedChapPin) ? resolvedChapPin : chapterIdx,
                paraIndex: row?.getAttribute?.('data-pindex') || null,
                paraNum: foundPNum || null,
              });
              clearTargetScrollIntent(activeTab.bookCode);
              setIsTargetScrollWaiting(false);
              return;
            } else if (retries < effectiveMaxRetries - 5) {
              scheduleAttemptScroll(50);
              return;
            }
          }
        }
      }

      // 2. Target page break (GoTo Page)
      if (page && pageSystem) {
        const cleanP = String(page).trim();
        const ed = String(pageSystem).toUpperCase();

        // Ensure the target chapter containing this page is loaded
        const targetChap = (chapterIdx !== undefined && chapterIdx !== null)
          ? chapterIdx
          : activeTab?.page_to_chapter?.[ed]?.[cleanP];
        if (targetChap !== undefined && targetChap !== null) {
          if (!activeTab.loadedChapters?.[targetChap] && !activeTab.loadingChapters?.[targetChap]) {
            loadChapter(activeTab.bookCode, targetChap);
            bufferAdjacentChapters(activeTab.bookCode, targetChap);
          }
        }

        let pbEl = null;

        // Direct ID lookup (e.g. V0.0023, P3.0045, V3.0440, V1.0023)
        if (cleanP.includes('.')) {
          const parts = cleanP.split('.');
          const vol = parseInt(parts[0], 10);
          const num = parseInt(parts[1], 10);
          if (!isNaN(vol) && !isNaN(num)) {
            const padded = `${vol}.${String(num).padStart(4, '0')}`;
            pbEl =
              findElement(`${ed}${padded}`, '', targetChap) ||
              findElement(`${ed}${cleanP}`, '', targetChap) ||
              findElement(null, `[data-ed="${ed}"][data-page="${padded}"]:not([data-chunk-pb])`, targetChap) ||
              findElement(null, `[data-ed="${ed}"][data-page="${cleanP}"]:not([data-chunk-pb])`, targetChap);
          }
        } else {
          const num = parseInt(cleanP, 10);
          if (!isNaN(num)) {
            const paddedNum = String(num).padStart(4, '0');
            const knownAnchor =
              activeTab?.page_anchors?.[ed]?.[cleanP] || activeTab?.page_anchors?.[ed]?.[String(num)];
            if (knownAnchor) {
              pbEl = findElement(knownAnchor, '', targetChap);
            }
            if (!pbEl) {
              pbEl =
                findElement(null, `[data-ed="${ed}"][data-page$=".${paddedNum}"]:not([data-chunk-pb])`, targetChap) ||
                findElement(null, `[data-ed="${ed}"][data-page="${paddedNum}"]:not([data-chunk-pb])`, targetChap) ||
                findElement(null, `[data-ed="${ed}"][data-page="${cleanP}"]:not([data-chunk-pb])`, targetChap);
            }
          }
        }

        if (pbEl?.hasAttribute?.('data-chunk-pb')) {
          pbEl = null;
        }

        if (!pbEl) {
          const scopeForChap =
            targetChap !== undefined && targetChap !== null
              ? containerRef.current.querySelector(`[data-chapter="${targetChap}"]`)
              : containerRef.current;
          if (scopeForChap && !scopeForChap.classList?.contains('chapter-placeholder')) {
            pbEl = resolveNearestPbInScope(scopeForChap, ed, cleanP);
          }
        }

        // Robust fallback: resolve page to target paragraph number via targetParaNum or page_to_para
        if (!pbEl) {
          const targetPara = paraNum || activeTab?.page_to_para?.[ed]?.[cleanP];
          if (targetPara !== undefined && targetPara !== null && targetPara !== '') {
            const pClean = String(targetPara).trim();
            pbEl =
              findElement(`para-${pClean}`, '', targetChap) ||
              findElement(`para${pClean}`, '', targetChap) ||
              findElement(null, `[data-para="${CSS.escape(pClean)}"]`, targetChap) ||
              findElement(null, `[data-pindex="${CSS.escape(pClean)}"]`, targetChap);
          }
        }

        if (pbEl) {
          const hostChapter = pbEl.closest ? pbEl.closest('[data-chapter]') : null;
          const hostTransLoading = hostChapter?.getAttribute('data-trans-loading') === '1';
          const hasSentPair = Boolean(sentenceMode && pbEl.closest('.sent-pair'));

          // In sentence mode with translations active, wait until the target .sent-pair is rendered
          // in the host chapter before executing the jump, unless timeout is reached.
          const isSentenceWaiting = sentenceMode && hasTransLayers && !hasSentPair && hostTransLoading;

          if (!isSentenceWaiting || retries >= maxRetries) {
            // If pbEl is hidden by CSS (e.g. showPageBreaks is false), resolve to its exact adjacent text line or enclosing block
            const targetEl = resolveMeasurablePbAnchor(pbEl, sentenceMode);

            if (hasTransLayers && !areaTranslationSettled(hostChapter) && retries < effectiveMaxRetries - 5) {
              scheduleAttemptScroll(50);
              return;
            }

            const { top: vpTop } = getViewportBounds();
            const rect = targetEl.getBoundingClientRect();
            const currentScroll = getScrollTop();
            const topInset = getTopReadingInset();
            const offset = computeAnchorScrollTarget({
              elementTopViewport: rect.top,
              viewportTop: vpTop,
              currentScroll,
              stickyInset: topInset,
            });
            performProgrammaticScroll(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

            if (settings.pulseAnimation) {
              const pulseEl =
                targetEl.classList
                  ? targetEl
                  : targetEl.hostRow || pbEl.closest?.('.reader-para-row, .sent-pair, p');
              if (pulseEl?.classList) {
                pulseEl.classList.remove('pulse-highlight');
                void pulseEl.offsetWidth;
                pulseEl.classList.add('pulse-highlight');
              }
            }
            const foundPNum =
              targetEl.getAttribute?.('data-para') ||
              targetEl.closest?.('[data-para]')?.getAttribute?.('data-para') ||
              pbEl.getAttribute?.('data-para') ||
              pbEl.closest?.('[data-para]')?.getAttribute?.('data-para');
            if (foundPNum) {
              setPaneParaNum(foundPNum);
              if (isActive) setActiveParaNum(foundPNum);
            }
            const resolvedChapPin = hostChapter
              ? parseInt(hostChapter.getAttribute('data-chapter'), 10)
              : targetChap;
            hasInitialRestoredRef.current = true;
            saveTabScroll(activeTab.bookCode, offset);
            if (resolvedChapPin !== undefined && resolvedChapPin !== null && !Number.isNaN(resolvedChapPin)) {
              saveTabPosition(activeTab.bookCode, resolvedChapPin, foundPNum || null, offset);
            }
            armParaJumpWatcher(
              `${activeTab.bookCode}:page:${ed}:${cleanP}:${Date.now()}`,
              offset
            );
            pinJumpTarget({
              bookCode: activeTab.bookCode,
              chapterIdx: !Number.isNaN(resolvedChapPin) ? resolvedChapPin : targetChap,
              page: cleanP,
              pageSystem: ed,
              paraNum: foundPNum || paraNum || null,
            });
            clearTargetScrollIntent(activeTab.bookCode);
            setIsTargetScrollWaiting(false);
            return;
          }
        }
      }

      // 3. Target paragraph by number (Bookmarks, History, MAT, and GoTo)
      if (paraNum && (paraIndex === undefined || paraIndex === null || paraIndex === '') && !(page && pageSystem)) {
        const cleanPara = String(paraNum).replace(/^(?:para-?|p)/i, '').trim();
        const targetInt = parseInt(cleanPara, 10);

        // Ensure the target chapter containing this paragraph is loaded
        const activeSub = subBook || activeTab.sub_book || activeTab.chapter_to_sub_book?.[chapterIdx ?? activeTab.currentChapterIdx ?? 0];
        let targetChap = (chapterIdx !== undefined && chapterIdx !== null)
          ? chapterIdx
          : (activeTab.sub_books_para_to_chapter && activeSub
              ? activeTab.sub_books_para_to_chapter[activeSub]?.[cleanPara]
              : activeTab.para_to_chapter?.[cleanPara]);

        if (cleanPara && activeTab.para_to_chapter?.[cleanPara] !== undefined) {
          targetChap = activeTab.para_to_chapter[cleanPara];
        } else if (cleanPara && activeTab.sub_books_para_to_chapter && activeSub && activeTab.sub_books_para_to_chapter[activeSub]?.[cleanPara] !== undefined) {
          targetChap = activeTab.sub_books_para_to_chapter[activeSub][cleanPara];
        }

        if (targetChap !== undefined && targetChap !== null) {
          if (!activeTab.loadedChapters?.[targetChap] && !activeTab.loadingChapters?.[targetChap]) {
            loadChapter(activeTab.bookCode, targetChap);
            bufferAdjacentChapters(activeTab.bookCode, targetChap);
          }
        }

        const effectiveScopeChap = targetChap !== undefined && targetChap !== null ? targetChap : chapterIdx;
        let el = null;
        if (activeSub) {
          el =
            findElement(`para${cleanPara}`, `[data-sub-book="${activeSub}"][data-para="${cleanPara}"]`, effectiveScopeChap) ||
            findElement(`para-${cleanPara}`, `[data-sub-book="${activeSub}"][data-para="${cleanPara}"]`, effectiveScopeChap) ||
            findElement(cleanPara, `[data-sub-book="${activeSub}"][data-para="${cleanPara}"]`, effectiveScopeChap);
        }
        if (!el) {
          el =
            findElement(`para${cleanPara}`, null, effectiveScopeChap) ||
            findElement(`para-${cleanPara}`, null, effectiveScopeChap) ||
            findElement(cleanPara, null, effectiveScopeChap) ||
            findElement(null, `p[data-para="${cleanPara}"]`, effectiveScopeChap) ||
            findElement(null, `[data-para="${cleanPara}"]`, effectiveScopeChap);
        }
        // If not found in effectiveScopeChap, check globally across loaded chapters before falling back
        if (!el) {
          el =
            findElement(`para${cleanPara}`, null, null) ||
            findElement(`para-${cleanPara}`, null, null) ||
            findElement(cleanPara, null, null) ||
            findElement(null, `[data-para="${cleanPara}"]`, null);
        }

        // Check ranged paragraph elements (data-para-first <= targetInt <= data-para-last)
        if (!el && !isNaN(targetInt)) {
          const scope = (effectiveScopeChap !== undefined && effectiveScopeChap !== null)
            ? containerRef.current.querySelector(`[data-chapter="${effectiveScopeChap}"]`)
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

        // Fallback: nearest paragraph <= targetInt, else nearest paragraph > targetInt, else chapter start
        if (!el) {
          const scope = (effectiveScopeChap !== undefined && effectiveScopeChap !== null)
            ? containerRef.current.querySelector(`[data-chapter="${effectiveScopeChap}"]`)
            : containerRef.current;
          if (scope && !scope.classList.contains('chapter-placeholder')) {
            const allParas = scope.querySelectorAll('[data-para]');
            let bestEl = null;
            let bestDiff = Infinity;
            let bestAfterEl = null;
            let bestAfterDiff = Infinity;
            if (!isNaN(targetInt)) {
              for (const p of allParas) {
                if (activeSub && p.getAttribute('data-sub-book') && p.getAttribute('data-sub-book') !== activeSub) {
                  continue;
                }
                const pNum = parseInt(p.getAttribute('data-para'), 10);
                if (!isNaN(pNum)) {
                  if (pNum <= targetInt) {
                    const diff = targetInt - pNum;
                    if (diff < bestDiff) {
                      bestDiff = diff;
                      bestEl = p;
                    }
                  } else {
                    const afterDiff = pNum - targetInt;
                    if (afterDiff < bestAfterDiff) {
                      bestAfterDiff = afterDiff;
                      bestAfterEl = p;
                    }
                  }
                }
              }
            }
            if (bestEl) {
              el = bestEl;
            } else if (bestAfterEl) {
              el = bestAfterEl;
            } else if (effectiveScopeChap !== undefined && effectiveScopeChap !== null) {
              el =
                scope.querySelector('.reader-para-row[data-pindex], p[data-pindex]') ||
                scope;
            }
          }
        }

        if (el) {
          const row = el.closest?.('.reader-para-row') || el;
          let targetEl = null;
          let matchedSubRange = null;
          if (isTransTarget) {
            const transEl = row?.querySelector(`.reader-trans-block[data-trans-lang="${targetTransLang}"]`);
            if (transEl) {
              targetEl = transEl;
            } else if (retries < effectiveMaxRetries - 5) {
              // Translation block still loading/rendering, wait and retry
            } else {
              targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
            }
          } else {
            targetEl = el.getClientRects().length > 0 ? el : el.closest('p') || el.parentElement || el;
          }

          if (targetEl && !isTransTarget && (targetWord || targetBold || targetSnippet)) {
            const subHit = findPassageSubTarget(row, {
              word: targetWord,
              bold: targetBold,
              snippet: targetSnippet,
              paliScript: settings?.paliScript || 'roman',
            });
            if (subHit?.anchor) {
              targetEl = subHit.anchor;
              matchedSubRange = subHit.range || null;
            }
          }

          if (targetEl) {
            const hostChapter = targetEl.closest ? targetEl.closest('[data-chapter]') : null;
            if (hasTransLayers && !areaTranslationSettled(hostChapter) && retries < effectiveMaxRetries - 5) {
              scheduleAttemptScroll(50);
              return;
            }

            const { top: vpTop } = getViewportBounds();
            const rect = targetEl.getBoundingClientRect();
            const currentScroll = getScrollTop();
            const topInset = getTopReadingInset();
            const offset = computeAnchorScrollTarget({
              elementTopViewport: rect.top,
              viewportTop: vpTop,
              currentScroll,
              stickyInset: topInset,
            });
            performProgrammaticScroll(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

            if (matchedSubRange) {
              highlightRangeInReader(matchedSubRange);
            }
            if (settings.pulseAnimation) {
              const pulseEl = targetEl.classList ? targetEl : targetEl.hostRow || row;
              if (pulseEl?.classList) {
                pulseEl.classList.remove('pulse-highlight');
                void pulseEl.offsetWidth;
                pulseEl.classList.add('pulse-highlight');
              }
            }
            const hostChapIdx = hostChapter ? parseInt(hostChapter.getAttribute('data-chapter'), 10) : targetChap;
            const foundPNum = targetEl.getAttribute?.('data-para') || el.getAttribute?.('data-para') || cleanPara;
            if (foundPNum) {
              setPaneParaNum(foundPNum);
              if (isActive) setActiveParaNum(foundPNum);
            }
            hasInitialRestoredRef.current = true;
            saveTabScroll(activeTab.bookCode, offset);
            if (hostChapIdx !== undefined && !isNaN(hostChapIdx)) {
              saveTabPosition(activeTab.bookCode, hostChapIdx, foundPNum, offset);
            }
            armParaJumpWatcher(
              `${activeTab.bookCode}:ch${chapterIdx}:pn${cleanPara}:${Date.now()}`,
              offset
            );
            pinJumpTarget({
              bookCode: activeTab.bookCode,
              chapterIdx: hostChapIdx !== undefined && !Number.isNaN(hostChapIdx) ? hostChapIdx : effectiveScopeChap,
              paraIndex: row?.getAttribute?.('data-pindex') || null,
              paraNum: foundPNum || cleanPara,
            });
            clearTargetScrollIntent(activeTab.bookCode);
            setIsTargetScrollWaiting(false);
            return;
          }
        }
      }

      // 4. Target chapter header
      if (
        chapterIdx !== undefined &&
        chapterIdx !== null &&
        !paraNum &&
        (paraIndex === undefined || paraIndex === null || paraIndex === '') &&
        !page &&
        !searchHighlight?.query &&
        !paneScrollIntent?.highlightQuery
      ) {
        if (chapterIdx === 0) {
          performProgrammaticScroll(containerRef.current, 0, { scrollMotion: settings?.scrollMotion || 'fast' });
          hasInitialRestoredRef.current = true;
          saveTabScroll(activeTab.bookCode, 0);
          const firstP = containerRef.current.querySelector('[data-para]');
          if (firstP) {
            const pNum = firstP.getAttribute('data-para');
            if (pNum) {
              setPaneParaNum(pNum);
              if (isActive) setActiveParaNum(pNum);
            }
          }
          pinJumpTarget({ bookCode: activeTab.bookCode, chapterIdx: 0 });
          clearTargetScrollIntent(activeTab.bookCode);
          setIsTargetScrollWaiting(false);
          return;
        }

        const target =
          containerRef.current.querySelector(`#chap-${chapterIdx}`) ||
          containerRef.current.querySelector(`[data-chapter="${chapterIdx}"]`);

        if (target) {
          if (hasTransLayers && !areaTranslationSettled(target, { includeHost: true }) && retries < effectiveMaxRetries - 5) {
            scheduleAttemptScroll(50);
            return;
          }

          const { top: vpTop } = getViewportBounds();
          const rect = target.getBoundingClientRect();
          const currentScroll = getScrollTop();
          const topInset = getTopReadingInset();
          const offset = computeAnchorScrollTarget({
            elementTopViewport: rect.top,
            viewportTop: vpTop,
            currentScroll,
            stickyInset: topInset,
          });
          performProgrammaticScroll(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });

          // Detect first paragraph in the chapter
          const inP = target.querySelector ? target.querySelector('[data-para]') : null;
          if (inP) {
            const pNum = inP.getAttribute('data-para');
            if (pNum) {
              setPaneParaNum(pNum);
              if (isActive) setActiveParaNum(pNum);
            }
          } else {
            let nextEl = target.nextElementSibling;
            while (nextEl) {
              if (nextEl.hasAttribute && nextEl.hasAttribute('data-para')) {
                const pNum = nextEl.getAttribute('data-para');
                if (pNum) {
                  setPaneParaNum(pNum);
                  if (isActive) setActiveParaNum(pNum);
                  break;
                }
              }
              const innerP = nextEl.querySelector ? nextEl.querySelector('[data-para]') : null;
              if (innerP) {
                const pNum = innerP.getAttribute('data-para');
                if (pNum) {
                  setPaneParaNum(pNum);
                  if (isActive) setActiveParaNum(pNum);
                  break;
                }
              }
              nextEl = nextEl.nextElementSibling;
            }
          }

          hasInitialRestoredRef.current = true;
          saveTabScroll(activeTab.bookCode, offset);
          saveTabPosition(activeTab.bookCode, chapterIdx, null, offset);

          const jumpKey = `${activeTab.bookCode}:ch${chapterIdx}`;
          armChapterJumpWatcher(jumpKey, offset, chapterIdx);
          pinJumpTarget({ bookCode: activeTab.bookCode, chapterIdx });

          clearTargetScrollIntent(activeTab.bookCode);
          setIsTargetScrollWaiting(false);
          return;
        }
      }

      if (retries < effectiveMaxRetries) {
        scheduleAttemptScroll(50);
      } else {
        clearTargetScrollIntent(activeTab.bookCode);
        setIsTargetScrollWaiting(false);
      }
    };

    // Try an immediate scroll synchronously before showing the waiting overlay so
    // already-rendered Pāḷi-only targets jump without flashing or stalling.
    clearTimeout(attemptScrollTimerRef.current);
    attemptScrollTimerRef.current = null;
    attemptScroll();
    if (attemptScrollTimerRef.current !== null) {
      setIsTargetScrollWaiting(true);
      clearTimeout(targetWaitTimeoutRef.current);
      targetWaitTimeoutRef.current = setTimeout(() => {
        setIsTargetScrollWaiting(false);
      }, 12000);
    } else {
      clearTimeout(targetWaitTimeoutRef.current);
      targetWaitTimeoutRef.current = null;
    }

    return () => {
      clearTimeout(timerId);
      clearTimeout(attemptScrollTimerRef.current);
      attemptScrollTimerRef.current = null;
      clearTimeout(targetWaitTimeoutRef.current);
      targetWaitTimeoutRef.current = null;
      setIsTargetScrollWaiting(false);
    };
  }, [
    paneScrollIntent,
    isVisible,
    isActive,
    activeTab?.bookCode,
    activeTab?.viewMode,
    activeTab?.isTocView,
    pulseAnimation,
    loadChapter,
    bufferAdjacentChapters,
    saveTabScroll,
    saveTabPosition,
    clearTargetScrollIntent,
    setActiveParaNum,
    searchHighlight,
    orderedLayers,
    sentenceMode,
    settings?.scrollMotion,
    hasTransLayers,
    useWindowScroll,
    getScrollTop,
    getViewportBounds,
    getTopReadingInset,
    performProgrammaticScroll,
  ]);


  // Detect active edition page numbers across loaded chapters in this pane
  const detectActiveEditionPages = useCallback(() => {
    if (!containerRef.current || !activeTab || !isVisible) return;
    const container = containerRef.current;
    const { top: vpTop } = getViewportBounds();
    const targetY = vpTop + 80;

    const pbElements = container.querySelectorAll('span.pb[data-ed][data-page]');
    if (pbElements.length === 0) return;

    const pages = findActiveEditionPagesFromElements(pbElements, targetY);

    if (Object.keys(pages).length > 0) {
      setPaneEditionPages((prev) => {
        const isDiff =
          Object.keys(pages).some((k) => prev[k] !== pages[k]) ||
          Object.keys(prev).some((k) => prev[k] !== pages[k]);
        return isDiff ? pages : prev;
      });
      if (isActive) {
        setActiveEditionPages((prev) => {
          const isDiff =
            Object.keys(pages).some((k) => prev[k] !== pages[k]) ||
            Object.keys(prev).some((k) => prev[k] !== pages[k]);
          return isDiff ? pages : prev;
        });
      }
    }
  }, [activeTab, isVisible, isActive, setActiveEditionPages, getViewportBounds]);

  // Initial and chapter content change detection (including async translation DOM hydration)
  useEffect(() => {
    if (!isVisible) return;
    const runDetect = () => {
      detectActiveEditionPages();
      if (containerRef.current) {
        const { top: vpTop } = getViewportBounds();
        const headings = containerRef.current.querySelectorAll('p.book, p.chapter, p.title, p.subhead, [data-chunk-last-heading]');
        const detected = detectLiveSectionTitleFromElements(headings, vpTop + getTopReadingInset());
        setPaneSectionTitle(detected);
      }
    };
    const timer = setTimeout(runDetect, 120);
    let moTimer = null;
    let moChild = null;
    let moAttr = null;
    if (typeof MutationObserver !== 'undefined' && containerRef.current) {
      const inner = containerRef.current.querySelector('.reader-container') || containerRef.current;
      const scheduleDetect = () => {
        clearTimeout(moTimer);
        moTimer = setTimeout(runDetect, 80);
      };
      // Observe direct chapter mounts and settled attributes instead of subtree-wide DOM node churn
      moChild = new MutationObserver(scheduleDetect);
      moChild.observe(inner, { childList: true, subtree: false });
      moAttr = new MutationObserver(scheduleDetect);
      moAttr.observe(inner, { attributes: true, attributeFilter: ['data-trans-settled'], subtree: true });
    }
    return () => {
      clearTimeout(timer);
      clearTimeout(moTimer);
      moChild?.disconnect();
      moAttr?.disconnect();
    };
  }, [isVisible, isActive, activeTab?.bookCode, activeTab?.currentChapterIdx, activeTab?.loadedChapters, paneScrollIntent, settings?.paliScript, detectActiveEditionPages, getViewportBounds, getTopReadingInset]);

  // Keep activeParaNum in sync when this pane becomes the active tab/column
  useEffect(() => {
    if (isActive && paneParaNum) {
      setActiveParaNum(paneParaNum);
    }
  }, [isActive, paneParaNum, setActiveParaNum]);

  // Keep scroll peak anchors synchronized when header visibility changes externally (e.g. breadcrumb / sidebar / tab switch)
  useEffect(() => {
    if (!isVisible) return;
    const curTop = Math.max(0, getScrollTop());
    scrollUpPeakYRef.current = curTop;
    scrollDownPeakYRef.current = curTop;
  }, [isHeaderVisible, isVisible, getScrollTop]);

  const runPostScrollWork = useCallback(
    (top) => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
      if (!isVisible || isTabSwitchingRef.current) return;
      vpBoundsCacheRef.current.ts = 0;

      const curTab = activeTabRef.current;
      if (!curTab || !containerRef.current) return;

      const container = containerRef.current;
      const { top: vpTop } = getViewportBounds();
      const targetY = vpTop + getTopReadingInset();

      const headings = container.querySelectorAll('p.book, p.chapter, p.title, p.subhead, [data-chunk-last-heading]');
      const detectedTitle = detectLiveSectionTitleFromElements(headings, targetY);
      setPaneSectionTitle(detectedTitle);

      let foundParaNum = null;
      let foundPIndex = null;
      let foundSnippet = '';
      let foundChapterIdx = curTab.currentChapterIdx || 0;

      const chapBlocks = container.querySelectorAll('[data-chapter]');
      const activeChapEl = findFirstElementWithBottomAtOrBelow(chapBlocks, targetY);
      if (activeChapEl) {
        const activeRect = activeChapEl.getBoundingClientRect();
        if (activeRect.top <= targetY && activeRect.bottom > targetY) {
          const cIdx = parseInt(activeChapEl.getAttribute('data-chapter'), 10);
          if (!isNaN(cIdx)) foundChapterIdx = cIdx;
        }
      }

      let targetPara = null;
      if (activeChapEl) {
        const scopedParas = activeChapEl.querySelectorAll('p[data-pindex], .reader-para-row[data-pindex]');
        targetPara = findFirstElementWithBottomAtOrBelow(scopedParas, targetY);
      }
      if (!targetPara) {
        const allParas = container.querySelectorAll('p[data-pindex], .reader-para-row[data-pindex]');
        targetPara = findFirstElementWithBottomAtOrBelow(allParas, targetY);
      }

      if (targetPara) {
        foundPIndex = targetPara.getAttribute('data-pindex');
        foundParaNum = targetPara.getAttribute('data-para');
        if (!foundParaNum) {
          let prev = targetPara.previousElementSibling;
          while (prev) {
            const prevNum = prev.getAttribute?.('data-para');
            if (prevNum) {
              foundParaNum = prevNum;
              break;
            }
            prev = prev.previousElementSibling;
          }
          if (!foundParaNum) {
            foundParaNum =
              targetPara.closest?.('[data-chunk-prev-para]')?.getAttribute?.('data-chunk-prev-para') || null;
          }
        }

        const text = targetPara.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (text) {
          foundSnippet = text.length > 130 ? text.slice(0, 130) + '...' : text;
        }

        const chapBlock = targetPara.closest('[data-chapter]');
        if (chapBlock) {
          const cIdx = parseInt(chapBlock.getAttribute('data-chapter'), 10);
          if (!isNaN(cIdx)) foundChapterIdx = cIdx;
        } else if (foundParaNum && curTab.sub_books_para_to_chapter && curTab.sub_book) {
          const subChap = curTab.sub_books_para_to_chapter[curTab.sub_book]?.[foundParaNum];
          if (subChap !== undefined) foundChapterIdx = subChap;
        } else if (foundParaNum && curTab.para_to_chapter?.[foundParaNum] !== undefined) {
          foundChapterIdx = curTab.para_to_chapter[foundParaNum];
        }
      }

      if (activeChapEl) {
        const activeRect = activeChapEl.getBoundingClientRect();
        if (activeRect.top <= targetY && activeRect.bottom > targetY) {
          const cIdx = parseInt(activeChapEl.getAttribute('data-chapter'), 10);
          if (!isNaN(cIdx)) foundChapterIdx = cIdx;
        }
      }

      if (foundParaNum) {
        setPaneParaNum(foundParaNum);
        if (isActive) {
          setActiveParaNum(foundParaNum);
        }
      }

      saveTabPosition(curTab.bookCode, foundChapterIdx, foundParaNum, top, foundPIndex);

      const historyKey = `${curTab.bookCode}|${foundChapterIdx}|${foundParaNum || ''}|${foundPIndex || ''}`;
      if (lastHistoryKeyRef.current !== historyKey) {
        lastHistoryKeyRef.current = historyKey;
        addToHistory({
          bookCode: curTab.bookCode,
          bookTitle: curTab.title,
          nikaya: curTab.nikaya,
          chapterIdx: foundChapterIdx,
          chapterTitle: curTab.chapters?.[foundChapterIdx]?.title || '',
          paraNum: foundParaNum || undefined,
          paraIndex: foundPIndex ? parseInt(foundPIndex, 10) : undefined,
          snippet:
            foundSnippet ||
            `${curTab.title} — ${curTab.chapters?.[foundChapterIdx]?.title || `Chapter ${foundChapterIdx + 1}`}${
              foundParaNum ? ` (Para ${foundParaNum})` : ''
            }`,
        });
      }

      detectActiveEditionPages();
    },
    [
      isVisible,
      isActive,
      saveTabPosition,
      setActiveParaNum,
      detectActiveEditionPages,
      addToHistory,
      getViewportBounds,
      getTopReadingInset,
    ]
  );

  const runPostScrollWorkRef = useRef(runPostScrollWork);
  runPostScrollWorkRef.current = runPostScrollWork;

  // Direct fast scroll listener — auto-toggles header/footer, preserves tab scroll, drives parallel sync & defers heavy DOM work until scroll settles
  const processScrollTop = useCallback(
    (top) => {
      if (!isVisible || isTabSwitchingRef.current) return;

      lastScrollYRef.current = top;

      const isJumping = Boolean(isProgrammaticScrollRef.current || paraJumpRef.current.key || chapterJumpRef.current.key);
      const { height: vpHeight, scrollHeight: vpScrollHeight } = getCachedViewportBounds(top);
      const { nextVisible, upPeakY, downPeakY } = computeNextHeaderVisibility({
        top,
        isHeaderVisible: isHeaderVisibleRef.current,
        upPeakY: scrollUpPeakYRef.current,
        downPeakY: scrollDownPeakYRef.current,
        viewportHeight: vpHeight,
        scrollHeight: vpScrollHeight,
        isJumping,
      });
      scrollUpPeakYRef.current = upPeakY;
      scrollDownPeakYRef.current = downPeakY;
      if (nextVisible !== isHeaderVisibleRef.current) {
        isHeaderVisibleRef.current = nextVisible;
        setIsHeaderVisible?.(nextVisible);
      }

      const curTabNow = activeTabRef.current;
      if (curTabNow?.bookCode && curTabNow.bookCode !== 'ai_chat') {
        saveTabScroll(curTabNow.bookCode, top);
      }

      if (isColumnsMode && isParallelSyncActive && !isProgrammaticScrollRef.current && curTabNow?.bookCode) {
        onColumnScrollSync?.(curTabNow.bookCode, top);
      }

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      const fallbackMs =
        typeof window !== 'undefined' && 'onscrollend' in window ? 350 : 180;
      scrollTimeoutRef.current = setTimeout(() => {
        runPostScrollWorkRef.current(top);
      }, fallbackMs);
    },
    [
      isVisible,
      isColumnsMode,
      isParallelSyncActive,
      saveTabScroll,
      onColumnScrollSync,
      getCachedViewportBounds,
      setIsHeaderVisible,
    ]
  );

  const processScrollTopRef = useRef(processScrollTop);
  processScrollTopRef.current = processScrollTop;

  const handleScroll = useCallback((e) => {
    if (useWindowScrollRef.current) return;
    processScrollTopRef.current(e.target.scrollTop);
  }, []);

  useEffect(() => {
    if (useWindowScroll || !isVisible || typeof window === 'undefined' || !('onscrollend' in window)) return;
    const node = containerRef.current;
    if (!node) return;
    const onContainerScrollEnd = () => {
      if (useWindowScrollRef.current) return;
      runPostScrollWorkRef.current(node.scrollTop);
    };
    node.addEventListener('scrollend', onContainerScrollEnd, { passive: true });
    return () => node.removeEventListener('scrollend', onContainerScrollEnd);
  }, [useWindowScroll, isVisible, activeTab?.bookCode, activeTab?.viewMode]);

  useEffect(() => {
    if (!useWindowScroll || !isVisible || typeof window === 'undefined') return;
    const readWinTop = () =>
      window.scrollY ||
      document.scrollingElement?.scrollTop ||
      document.documentElement?.scrollTop ||
      document.body?.scrollTop ||
      0;
    const initTop = readWinTop();
    lastScrollYRef.current = initTop;
    scrollUpPeakYRef.current = initTop;
    scrollDownPeakYRef.current = initTop;
    if (initTop <= 24 && !isHeaderVisibleRef.current) {
      setIsHeaderVisible?.(true);
    }
    const onWinScroll = () => {
      if (!useWindowScrollRef.current) return;
      processScrollTopRef.current(readWinTop());
    };
    const onWinScrollEnd = () => {
      if (!useWindowScrollRef.current) return;
      runPostScrollWorkRef.current(readWinTop());
    };
    window.addEventListener('scroll', onWinScroll, { passive: true });
    const hasNativeScrollEnd = 'onscrollend' in window;
    if (hasNativeScrollEnd) {
      window.addEventListener('scrollend', onWinScrollEnd, { passive: true });
    }
    return () => {
      window.removeEventListener('scroll', onWinScroll);
      if (hasNativeScrollEnd) {
        window.removeEventListener('scrollend', onWinScrollEnd);
      }
    };
  }, [useWindowScroll, isVisible, setIsHeaderVisible]);

  const handleReaderClick = useCallback((e) => {
    if (isColumnsMode && !isActive) {
      activatePane(activeTab.bookCode);
    }

    // 0. Ignore ghost clicks from backdrop/modal dismiss on mobile devices
    if (typeof window !== 'undefined' && window.__tipitaka_dict_just_closed) {
      if (Date.now() - window.__tipitaka_dict_just_closed < 500) {
        return;
      }
    }

    // 0.5 Handle Linked Definition "+N more" expand/collapse and chip preview modal
    const moreBtn = e.target.closest('.linked-def-more-btn');
    if (moreBtn) {
      e.preventDefault();
      e.stopPropagation();
      const row = moreBtn.closest('.linked-def-row');
      const moreGroup = row?.querySelector('.linked-def-more-group');
      if (moreGroup) {
        const isHidden = moreGroup.classList.contains('hidden');
        if (isHidden && moreGroup.childElementCount === 0) {
          const moreRef = moreGroup.getAttribute('data-links-more-ref');
          if (moreRef) {
            const hydrated = renderMoreLinkChipsFromRef(moreRef);
            if (hydrated) {
              moreGroup.innerHTML = hydrated;
            }
          }
        }
        moreGroup.classList.toggle('hidden', !isHidden);
        const count = moreBtn.getAttribute('data-more-count') || '';
        moreBtn.textContent = isHidden ? 'Less' : `+${count} more`;
      }
      return;
    }

    const linkChip = e.target.closest('.linked-def-chip');
    if (linkChip) {
      e.preventDefault();
      e.stopPropagation();
      const parsed = resolveChipLinkElement(linkChip);
      if (parsed) {
        setActiveLinkedItem({ ...parsed, sourceBookCode: activeTab.bookCode });
      }
      return;
    }

    // 1. Ignore clicks on interactive controls (buttons, links, go-to markers, linked-def strips)
    if (e.target.closest('.linked-def-row, button, a, input, select, textarea, [data-goto-type]')) {
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
        if (!pNum) {
          pNum = pEl.closest?.('[data-chunk-prev-para]')?.getAttribute?.('data-chunk-prev-para') || null;
        }
      }
      if (pNum) {
        setPaneParaNum(pNum);
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

      saveTabPosition(activeTab.bookCode, chapIdx, pNum, getScrollTop(), pIdx);

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

    // 3. Dictionary Word Hit-Test & Single-Click Word Lookup
    const isLookupActive = clickToLookupEnabled !== false && settings?.dictLookupTrigger !== 'off';
    const mode = (settings?.dictLookupTrigger && settings.dictLookupTrigger !== 'off')
      ? settings.dictLookupTrigger
      : (clickLookupMode || 'single');

    const selection = window.getSelection()?.toString()?.trim();
    // Only treat as a click (not drag-selection) when <= 1 char selected
    if (!selection || selection.length <= 1) {
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

      const resolvedSingle = resolveReaderTextNodeAndOffset(range?.startContainer, range?.startOffset || 0, e.clientX, e.clientY);
      let node = resolvedSingle?.node;
      let offset = resolvedSingle?.offset || 0;

      if (node && node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const transBlock = node.parentElement?.closest('[data-trans-lang]') || e.target.closest('[data-trans-lang]');
        const transLang = transBlock?.getAttribute('data-trans-lang') || (node.parentElement?.closest('p[data-pindex]') ? 'pali' : 'pali');

        const extracted = extractWordAtOffset(text, offset, transLang);
        if (extracted) {
          const { word: rawWord, start, end } = extracted;
          const wordToLookup = cleanDictionaryQuery(rawWord);
          if (wordToLookup && (wordToLookup.length >= 2 || /\p{L}/u.test(wordToLookup))) {
            const wordRange = document.createRange();
            wordRange.setStart(node, start);
            wordRange.setEnd(node, end);

            // Verify pointer is actually on the word glyphs rather than snapped from empty margin/blank space
            if (isPointInsideRangeRects(wordRange, e.clientX, e.clientY, 4)) {
              if (e.nativeEvent) e.nativeEvent.__tpoWordClicked = true;
              e.__tpoWordClicked = true;

              if (isLookupActive && mode === 'single') {
                const pEl = node.parentElement?.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]') || e.target.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]');
                const sentCell = node.parentElement?.closest('.sent-pair-pali, .sent-pair-trans') || e.target.closest?.('.sent-pair-pali, .sent-pair-trans');
                const blockEl = sentCell || transBlock || pEl;
                const pIndex = pEl?.getAttribute('data-pindex') || null;
                const pNum = pEl?.getAttribute('data-para') || null;
                const lineId = sentCell?.getAttribute('data-line') || node.parentElement?.closest?.('[data-line]')?.getAttribute('data-line') || null;
                const chapEl = pEl?.closest('[data-chapter]');
                const chapIdx = chapEl ? parseInt(chapEl.getAttribute('data-chapter'), 10) : 0;
                const charOffset = blockEl ? getCharOffsetInElement(blockEl, node, start) : start;
                const length = end - start;

                clearClickedWordHighlight(containerRef.current || document);
                const freshRange = (blockEl && createRangeFromCharOffset(blockEl, charOffset, length)) || wordRange;
                highlightRangeInReader(freshRange);

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
                    lineId,
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
    }
  }, [isColumnsMode, isActive, activatePane, activeTab, setActiveParaNum, saveTabPosition, getScrollTop, addToHistory, clickToLookupEnabled, clickLookupMode, settings?.dictLookupTrigger, openDictionary, recordClickedWord, setActiveLinkedItem]);

  const handleReaderMouseOver = useCallback(
    (e) => {
      const linkChip = e.target.closest?.('.linked-def-chip');
      if (!linkChip) return;
      const parsed = resolveChipLinkElement(linkChip);
      if (parsed?.target_book) {
        prefetchLinkedPreview({
          book: parsed.target_book,
          chapter: parsed.target_chapter,
          paraIndex: parsed.target_para_index,
          paraNum: parsed.target_para_num,
          lineId: parsed.target_line_id,
          word: parsed.word,
          langs: activeLangs,
        });
      }
    },
    [activeLangs]
  );

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

    if (e.target.closest('.linked-def-row, button, a, input, select, textarea, [data-goto-type]')) {
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
        clearClickedWordHighlight(containerRef.current || document);
        const clonedRange = range.cloneRange();
        highlightRangeInReader(clonedRange);
        sel.removeAllRanges();
      }

      if (node && activeTab?.bookCode) {
        const transBlock = node.parentElement?.closest?.('[data-trans-lang]') || e.target.closest('[data-trans-lang]');
        const transLang = transBlock?.getAttribute('data-trans-lang') || (node.parentElement?.closest?.('p[data-pindex]') ? 'pali' : 'pali');
        const pEl = node.parentElement?.closest?.('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]') || e.target.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]');
        const sentCell = node.parentElement?.closest?.('.sent-pair-pali, .sent-pair-trans') || e.target.closest?.('.sent-pair-pali, .sent-pair-trans');
        const blockEl = sentCell || transBlock || pEl;
        const pIndex = pEl?.getAttribute('data-pindex') || null;
        const pNum = pEl?.getAttribute('data-para') || null;
        const lineId = sentCell?.getAttribute('data-line') || node.parentElement?.closest?.('[data-line]')?.getAttribute('data-line') || null;
        const chapEl = pEl?.closest('[data-chapter]');
        const chapIdx = chapEl ? parseInt(chapEl.getAttribute('data-chapter'), 10) : 0;
        const charOffset = blockEl ? getCharOffsetInElement(blockEl, node, startOffset) : startOffset;
        const length = selection.length;

        recordClickedWord(activeTab.bookCode, {
          chapIdx,
          pIndex,
          paraNum: pNum,
          lineId,
          word: wordToLookup,
          rawWord: selection,
          charOffset,
          length,
          transLang,
        });
      }
    } else {
      // 2. Extract word at click point
      clearClickedWordHighlight(containerRef.current || document);

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

      const resolvedSingle = resolveReaderTextNodeAndOffset(range?.startContainer, range?.startOffset || 0, e.clientX, e.clientY);
      let node = resolvedSingle?.node;
      let offset = resolvedSingle?.offset || 0;

      if (node && node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        const transBlock = node.parentElement?.closest('[data-trans-lang]') || e.target.closest('[data-trans-lang]');
        const transLang = transBlock?.getAttribute('data-trans-lang') || (node.parentElement?.closest('p[data-pindex]') ? 'pali' : 'pali');

        const extracted = extractWordAtOffset(text, offset, transLang);
        if (extracted) {
          const { word: rawWord, start, end } = extracted;
          const candidateWord = cleanDictionaryQuery(rawWord);
          if (candidateWord && (candidateWord.length >= 2 || /\p{L}/u.test(candidateWord))) {
            const wordRange = document.createRange();
            wordRange.setStart(node, start);
            wordRange.setEnd(node, end);

            if (isPointInsideRangeRects(wordRange, e.clientX, e.clientY, 4)) {
              wordToLookup = candidateWord;
              const pEl = node.parentElement?.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]') || e.target.closest('p[data-pindex], .reader-para-row[data-pindex], [data-pindex], [data-para]');
              const sentCell = node.parentElement?.closest('.sent-pair-pali, .sent-pair-trans') || e.target.closest?.('.sent-pair-pali, .sent-pair-trans');
              const blockEl = sentCell || transBlock || pEl;
              const pIndex = pEl?.getAttribute('data-pindex') || null;
              const pNum = pEl?.getAttribute('data-para') || null;
              const lineId = sentCell?.getAttribute('data-line') || node.parentElement?.closest?.('[data-line]')?.getAttribute('data-line') || null;
              const chapEl = pEl?.closest('[data-chapter]');
              const chapIdx = chapEl ? parseInt(chapEl.getAttribute('data-chapter'), 10) : 0;
              const charOffset = blockEl ? getCharOffsetInElement(blockEl, node, start) : start;
              const length = end - start;

              const freshRange = (blockEl && createRangeFromCharOffset(blockEl, charOffset, length)) || wordRange;
              highlightRangeInReader(freshRange);

              if (activeTab?.bookCode) {
                recordClickedWord(activeTab.bookCode, {
                  chapIdx,
                  pIndex,
                  paraNum: pNum,
                  lineId,
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
    }

    if (wordToLookup && (wordToLookup.length >= 2 || /\p{L}/u.test(wordToLookup))) {
      openDictionary(wordToLookup);
    }
  }, [clickToLookupEnabled, clickLookupMode, settings?.dictLookupTrigger, openDictionary, activeTab, recordClickedWord]);

  const handleBreadcrumbClick = () => {
    if (isColumnsMode && !isActive) {
      activatePane(activeTab.bookCode);
    }
    setIsSidebarOpen(true);
    setIsHeaderVisible(true);
  };

  const handleNikayaClick = (e) => {
    e.stopPropagation();
    if (containerRef.current) {
      performProgrammaticScroll(containerRef.current, 0, { scrollMotion: settings?.scrollMotion || 'fast' });
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
      const { top: vpTop } = getViewportBounds();
      const rect = target.getBoundingClientRect();
      const currentScroll = getScrollTop();
      const offset = computeAnchorScrollTarget({
        elementTopViewport: rect.top,
        viewportTop: vpTop,
        currentScroll,
        stickyInset: getTopReadingInset(),
      });
      performProgrammaticScroll(containerRef.current, offset, { scrollMotion: settings?.scrollMotion || 'fast' });
      // No pulse-highlight on whole-chapter jumps (see section 4 above).
    }
  };

  const activeBookCodeForPane = activeTab?.bookCode || null;
  const handleChapterVisible = useCallback(
    (chapIdx) => {
      if (!activeBookCodeForPane) return;
      loadChapter(activeBookCodeForPane, chapIdx);
      bufferAdjacentChapters(activeBookCodeForPane, chapIdx);
    },
    [activeBookCodeForPane, loadChapter, bufferAdjacentChapters]
  );

  const chunkScrollCtxRef = useRef(null);
  chunkScrollCtxRef.current = {
    useWindowScroll,
    getScrollContainer: () => containerRef.current,
    isJumping: () =>
      Boolean(
        isProgrammaticScrollRef.current ||
          isTabSwitchingRef.current ||
          paraJumpRef.current?.key ||
          chapterJumpRef.current?.key ||
          paneScrollIntentRef.current
      ),
    adjustScrollBy: (delta) => {
      if (!delta || !Number.isFinite(delta)) return;
      const nextTop = Math.max(0, getScrollTop() + delta);
      isProgrammaticScrollRef.current = true;
      if (typeof window !== 'undefined') {
        window.__tpoProgrammaticScroll = true;
      }
      lastScrollYRef.current = nextTop;
      scrollUpPeakYRef.current = nextTop;
      scrollDownPeakYRef.current = nextTop;
      setScrollTop(nextTop, 'auto');
      if (activeTabRef.current?.bookCode && activeTabRef.current.bookCode !== 'ai_chat') {
        saveTabScroll(activeTabRef.current.bookCode, nextTop);
      }
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        if (typeof window !== 'undefined') {
          window.__tpoProgrammaticScroll = false;
        }
      }, 120);
    },
  };

  const handleLinksLoaded = useCallback(
    (chapIdx, paragraphs) => {
      onPaneLinksLoaded?.(activeTab.bookCode, chapIdx, paragraphs);
      if (isActive && paragraphs && Object.keys(paragraphs).length > 0) {
        prefetchLinkedPreviewsBatch?.(paragraphs, activeLangs);
      }
    },
    [onPaneLinksLoaded, activeTab?.bookCode, isActive, activeLangs]
  );

  const editionStatsList = React.useMemo(() => {
    if (!paneEditionPages || Object.keys(paneEditionPages).length === 0) return [];
    const EDITION_LABELS = {
      M: 'Myanmar',
      V: 'VRI',
      P: 'PTS',
      T: 'Thai',
      O: 'Other',
    };
    const allEditions = ['M', 'V', 'P', 'T', 'O']
      .filter((ed) => paneEditionPages[ed])
      .map((ed) => {
        const rawPage = String(paneEditionPages[ed]);
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
  }, [paneEditionPages, settings?.defaultEditionPage]);

  const effectiveParaNum = paneParaNum || activeTab?.lastParaNum || (isActive ? activeParaNum : null);

  const handleQuickBookmark = () => {
    if (!activeTab) return;

    let currentPara = effectiveParaNum;
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
              pNum = prev.getAttribute?.('data-para');
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
      const pEl = containerRef.current?.querySelector(`[data-para="${currentPara}"]`);
      const chapBlock = pEl?.closest('[data-chapter]');
      if (chapBlock) {
        const cIdx = parseInt(chapBlock.getAttribute('data-chapter'), 10);
        if (!isNaN(cIdx)) currentChapIdx = cIdx;
      }
      if (pEl) {
        paraSnippet = pEl.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (paraSnippet.length > 130) paraSnippet = paraSnippet.slice(0, 130) + '...';
      }
    }

    const currentChap = activeTab.chapters?.[currentChapIdx];

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

  const layerInfo = useMemo(
    () => getBookLayerInfo(activeTab?.bookCode, activeTab?.category, activeTab),
    [
      activeTab?.bookCode,
      activeTab?.category,
      activeTab?.mat,
      activeTab?.split_targets,
      activeTab?.sub_books,
      activeTab?.chapter_to_mat,
      activeTab?.para_to_mat,
      activeTab?.chapters?.length,
    ]
  );

  const wrapperClass = isVisible
    ? `reader-pane flex-1 min-w-0 min-h-0 flex flex-col relative ${
        useWindowScroll ? '' : 'overflow-hidden '
      }bg-[var(--bg-primary)] ${
        isColumnsMode
          ? `border-r border-[var(--border-color)] last:border-r-0 ${
              isActive ? 'reader-pane-active-col' : 'reader-pane-inactive-col'
            }`
          : ''
      }`
    : 'reader-pane hidden';

  // TOC view — when book opened without specific section
  if (activeTab.viewMode === 'toc' || activeTab.isTocView) {
    return (
      <div className={wrapperClass} data-pane-code={activeTab.bookCode}>
        <main
          ref={setMainRef}
          data-book-code={activeTab.bookCode}
          data-toc-view="true"
          data-active-pane={isActive ? 'true' : undefined}
          className="content-area flex-1 min-h-0 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]"
          onClick={() => isColumnsMode && !isActive && activatePane(activeTab.bookCode)}
        >
          <BookTocView
            tab={activeTab}
            isColumnsMode={isColumnsMode}
            onCloseColumn={(e) => closeTab(activeTab.bookCode, e)}
          />
        </main>
      </div>
    );
  }

  if (activeTab.isLoading || (!activeTab.chapters?.length && !activeTab.html)) {
    return (
      <div className={wrapperClass} data-pane-code={activeTab.bookCode}>
        <main
          ref={setMainRef}
          data-book-code={activeTab.bookCode}
          data-active-pane={isActive ? 'true' : undefined}
          className="content-area flex-1 min-h-0 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]"
        >
          <MeditationLoader
            bookTitle={activeTab.title}
            bookCode={activeTab.bookCode}
            chapterIdx={activeTab.currentChapterIdx}
            paraNum={effectiveParaNum}
            paliScript={settings?.paliScript}
          />
        </main>
      </div>
    );
  }

  const targetChapIdx = activeTab.currentChapterIdx || 0;
  const currentChap =
    activeTab.chapters?.find((c) => c.chapter_index === targetChapIdx) ||
    activeTab.chapters?.[targetChapIdx];
  const bookDisplayTitle = convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript);
  const chapDisplayTitle = currentChap ? convertPaliScript(capitalizePali(currentChap.title), settings?.paliScript) : '';
  const columnLiveTitle = paneSectionTitle || chapDisplayTitle || bookDisplayTitle;
  const isCurrentBookmarked = bookmarks.some(
    (b) =>
      b.bookCode === activeTab.bookCode &&
      b.chapterIdx === (activeTab.currentChapterIdx || 0) &&
      (effectiveParaNum ? String(b.paraNum) === String(effectiveParaNum) : true)
  );

  const isContentHeaderHidden = !isHeaderVisible && !isSidebarOpen && !isColumnsMode;

  return (
    <div
      className={wrapperClass}
      data-pane-code={activeTab.bookCode}
      onMouseDown={() => {
        onColumnUserInteract?.(activeTab.bookCode);
        if (isColumnsMode && !isActive) {
          activatePane(activeTab.bookCode);
        }
      }}
    >
      {/* Dynamic Auto-Hiding Breadcrumbs Bar & Quick Alongside (Mūla / Aṭṭha / Ṭīkā) Controls */}
      <div
        ref={contentHeaderRef}
        className={`content-header z-30 transition-all duration-200 flex items-center justify-between gap-2 px-3 sm:px-4 py-1.5 border-b text-xs select-none shrink-0 ${
          isColumnsMode && isActive
            ? 'bg-[var(--bg-secondary)] border-[var(--accent)]/50'
            : 'bg-[var(--bg-secondary)] border-[var(--border-color)]'
        } ${isContentHeaderHidden ? 'hidden-scroll' : ''}`}
      >
        <div
          data-sidebar-trigger="true"
          className="breadcrumbs truncate text-xs flex-1 flex items-center gap-1.5 cursor-pointer min-w-0"
          onClick={handleBreadcrumbClick}
          title={
            isColumnsMode
              ? `${bookDisplayTitle}${columnLiveTitle && columnLiveTitle !== bookDisplayTitle ? ` • ${columnLiveTitle}` : ''}`
              : 'Click to reveal full navigation and sidebar'
          }
        >
          {isColumnsMode && (
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isActive ? 'bg-[var(--accent)]' : 'bg-[var(--text-muted)]/35'
              }`}
              aria-hidden="true"
            />
          )}
          {layerInfo.label && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 border ${
                layerInfo.layer === 'mula'
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                  : layerInfo.layer === 'attha'
                    ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
              }`}
            >
              {isColumnsMode ? layerInfo.label.charAt(0) : layerInfo.label}
            </span>
          )}
          {isColumnsMode ? (
            <>
              <span
                onClick={handleChapterBreadcrumbClick}
                className="column-live-title truncate font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline cursor-pointer transition-colors"
                title={`${bookDisplayTitle}${columnLiveTitle !== bookDisplayTitle ? ` › ${columnLiveTitle}` : ''}`}
              >
                {columnLiveTitle}
              </span>
              {columnLiveTitle !== bookDisplayTitle && (
                <span
                  onClick={handleBookClick}
                  className="hidden 2xl:inline truncate text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline cursor-pointer shrink min-w-0"
                  title={`Open ${bookDisplayTitle} outline`}
                >
                  · {bookDisplayTitle}
                </span>
              )}
            </>
          ) : (
            <>
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
                {bookDisplayTitle}
              </span>
              {currentChap && capitalizePali(currentChap.title) !== capitalizePali(activeTab.title) && (
                <>
                  <span className="opacity-40 select-none">›</span>
                  <span
                    onClick={handleChapterBreadcrumbClick}
                    className="truncate text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer hover:underline transition-colors"
                    title="Scroll to chapter"
                  >
                    {chapDisplayTitle}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        {/* Right Controls: Quick Open Alongside (Mūla / Aṭṭha / Ṭīkā) + Live Edition Page Stats + Quick Bookmark */}
        <div className={`flex items-center shrink-0 ${isColumnsMode ? 'gap-0.5' : 'gap-1 sm:gap-1.5'}`}>
          {layerInfo.siblingLayers.length > 0 && (
            <div
              className={`hidden sm:flex items-center ${isColumnsMode ? 'gap-0.5' : 'gap-1 mr-0.5'}`}
              role="group"
              aria-label="Open commentary alongside"
            >
              {layerInfo.siblingLayers.map((sib) => (
                <button
                  key={sib.layer}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpToMat(sib.layer, {
                      alongside: true,
                      sourceBookCode: activeTab.bookCode,
                      sourceParaNum: effectiveParaNum,
                      sourceChapterIdx: activeTab.currentChapterIdx,
                    });
                  }}
                  className={`inline-flex items-center gap-0.5 rounded text-[10px] font-semibold bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--accent)] border border-[var(--border-color)] hover:border-[var(--accent)] transition cursor-pointer ${
                    isColumnsMode ? 'px-1 py-0.5' : 'px-1.5 py-0.5'
                  }`}
                  title={`Open ${sib.label} alongside at paragraph ${effectiveParaNum || 1}`}
                >
                  <span className="opacity-70">+</span>
                  <span>{sib.label}</span>
                </button>
              ))}
            </div>
          )}

          {editionStatsList.length > 0 && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                if (isColumnsMode && !isActive) activatePane(activeTab.bookCode);
                openGoToModal('page', null);
              }}
              className={`flex items-center rounded-md text-[10px] sm:text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-[var(--border-color)]/60 hover:border-[var(--border-color)] transition cursor-pointer shrink-0 select-none font-mono ${
                isColumnsMode ? 'gap-1 px-1.5 py-0.5' : 'gap-1.5 px-2 py-0.5'
              }`}
              title="Current Reading Page across Editions • Click to Go to Page"
            >
              {!isColumnsMode && (
                <span className="text-[9px] sm:text-[9.5px] font-sans font-semibold uppercase tracking-wider text-[var(--text-secondary)] opacity-70">
                  P:
                </span>
              )}
              <div className="flex items-center gap-1">
                {editionStatsList.map(({ ed, page, label }, idx) => (
                  <React.Fragment key={ed}>
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isColumnsMode && !isActive) activatePane(activeTab.bookCode);
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
            onClick={(e) => {
              e.stopPropagation();
              handleQuickBookmark();
            }}
            title={
              isCurrentBookmarked
                ? `Bookmarked${effectiveParaNum ? ` (Para ${effectiveParaNum})` : ''} — Click to remove`
                : `Bookmark this place${effectiveParaNum ? ` (Para ${effectiveParaNum})` : ''}`
            }
          >
            {isCurrentBookmarked ? (
              <BookmarkCheck size={14} className="text-[var(--accent)]" />
            ) : (
              <Bookmark size={14} />
            )}
          </button>

          {/* Recent Opened Books Button in Breadcrumb Header */}
          {!isColumnsMode && (
            <button
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--bg-card)] transition shrink-0 cursor-pointer"
              onClick={() => setIsHistoryOpen(true)}
              title="Recent opened books"
              aria-label="Recent opened books"
            >
              <History size={14} />
            </button>
          )}

          {isColumnsMode && (
            <button
              className="p-1 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--bg-card)] transition shrink-0 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(activeTab.bookCode, e);
              }}
              title="Close column"
              aria-label="Close column"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Reading Container */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {isTargetScrollWaiting && (
          <div className="reader-jump-loading-overlay absolute inset-0 z-30 flex flex-col items-center justify-center bg-[var(--bg-primary)]/85 backdrop-blur-md select-none transition-opacity duration-300">
            <div className="p-6 sm:p-8 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xl flex flex-col items-center gap-3.5 text-center max-w-sm sm:max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="w-12 h-12 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] flex items-center justify-center shadow-xs">
                <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
              <div className="text-lg sm:text-xl font-bold text-[var(--text-primary)]">
                Loading happiness...
              </div>
              <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
                {hasTransLayers && activeLangs.length > 0
                  ? `Preparing Pāḷi and ${activeLangs.map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join(', ')} translations...`
                  : 'Preparing section...'}
              </p>
              <div className="text-[11px] text-[var(--text-muted)] italic">
                Everything will appear together once ready
              </div>
            </div>
          </div>
        )}
        <main
          className={
            useWindowScroll
              ? 'content-area flex-1 relative flex flex-col bg-[var(--bg-primary)] outline-none focus:outline-hidden'
              : 'content-area flex-1 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)] outline-none focus:outline-hidden'
          }
          tabIndex={0}
          ref={setMainRef}
          data-book-code={activeTab.bookCode}
          data-active-pane={isActive ? 'true' : undefined}
          onScroll={useWindowScroll ? undefined : handleScroll}
        >
          {/* Lazy-Loaded Chapter Content Stream */}
          <div
            className="reader-wrapper flex-1 flex justify-center px-3 sm:px-6"
            onClick={handleReaderClick}
            onMouseOver={handleReaderMouseOver}
            onDoubleClick={handleReaderDoubleClick}
          >
            <div
              className="reader-container w-full"
              style={{
                maxWidth: isColumnsMode
                  ? '100%'
                  : (settings?.translationDisplayMode === 'side' || settings?.translationDisplayMode === 'side_rev') &&
                      ((isPaliEnabled && activeLangs.length > 0) || (!isPaliEnabled && activeLangs.length >= 2))
                    ? '1400px'
                    : 'var(--reader-max-width, 880px)',
              }}
            >
              {activeTab.chapters && activeTab.chapters.length > 0 ? (
                activeTab.chapters.map((chap) => {
                  const intentAppliesToChap = Boolean(
                    paneScrollIntent &&
                      (paneScrollIntent.chapterIdx === undefined ||
                        paneScrollIntent.chapterIdx === null ||
                        paneScrollIntent.chapterIdx === chap.chapter_index)
                  );
                  const activeJumpPin =
                    !paneScrollIntent && jumpPin?.bookCode === activeTab.bookCode ? jumpPin : null;
                  const pinAppliesToChap = Boolean(
                    activeJumpPin &&
                      activeJumpPin.chapterIdx !== undefined &&
                      activeJumpPin.chapterIdx !== null &&
                      activeJumpPin.chapterIdx === chap.chapter_index
                  );
                  const isSavedCurrentChap = activeTab.currentChapterIdx === chap.chapter_index;
                  const anchorTargetChapIdx =
                    paneScrollIntent?.chapterIdx ?? activeJumpPin?.chapterIdx ?? null;
                  const isPrecedingIntentChap = Boolean(
                    hasTransLayers &&
                      anchorTargetChapIdx !== undefined &&
                      anchorTargetChapIdx !== null &&
                      chap.chapter_index === anchorTargetChapIdx - 1
                  );
                  const useSavedParaForInitialRestore = Boolean(
                    isSavedCurrentChap && !hasInitialRestoredRef.current
                  );
                  const targetParaIndex = intentAppliesToChap
                    ? paneScrollIntent.paraIndex ?? null
                    : pinAppliesToChap
                      ? activeJumpPin.paraIndex ?? null
                      : useSavedParaForInitialRestore
                        ? activeTab.lastParaIndex ?? null
                        : null;
                  const targetParaNum = intentAppliesToChap
                    ? paneScrollIntent.paraNum ?? null
                    : pinAppliesToChap
                      ? activeJumpPin.paraNum ?? null
                      : useSavedParaForInitialRestore
                        ? activeTab.lastParaNum ?? null
                        : null;
                  const targetPage = intentAppliesToChap
                    ? paneScrollIntent.page ?? null
                    : pinAppliesToChap
                      ? activeJumpPin.page ?? null
                      : null;
                  const targetPageSystem = intentAppliesToChap
                    ? paneScrollIntent.pageSystem ?? null
                    : pinAppliesToChap
                      ? activeJumpPin.pageSystem ?? null
                      : null;
                  return (
                    <ChapterBlock
                      key={`${activeTab.bookCode}_${chap.chapter_index}`}
                      chapter={chap}
                      bookCode={activeTab.bookCode}
                      html={activeTab.loadedChapters?.[chap.chapter_index]}
                      isLoading={Boolean(activeTab.loadingChapters?.[chap.chapter_index])}
                      onVisible={handleChapterVisible}
                      isCurrentOrTarget={
                        isSavedCurrentChap ||
                        paneScrollIntent?.chapterIdx === chap.chapter_index ||
                        pinAppliesToChap ||
                        isPrecedingIntentChap ||
                        (chap.chapter_index === 0 &&
                          (activeTab.currentChapterIdx === null || activeTab.currentChapterIdx === undefined) &&
                          !paneScrollIntent?.chapterIdx &&
                          !activeJumpPin?.chapterIdx)
                      }
                      anchorEnd={isPrecedingIntentChap && !isSavedCurrentChap}
                      scrollCtxRef={chunkScrollCtxRef}
                      targetParaIndex={targetParaIndex}
                      targetParaNum={targetParaNum}
                      targetPage={targetPage}
                      targetPageSystem={targetPageSystem}
                      paliScript={settings?.paliScript}
                      searchHighlight={searchHighlight}
                      highlightSearchTerms={settings?.highlightSearchTerms ?? true}
                      activeLangs={activeLangs}
                      orderedLayers={orderedLayers}
                      isPaliEnabled={isPaliEnabled}
                      translationDisplayMode={settings?.translationDisplayMode || 'stack'}
                      translationColors={settings?.translationColors}
                      sentenceMode={settings?.translationGranularity === 'sentence'}
                      showBookLinks={settings?.showBookLinks !== false}
                      isParallelSyncActive={isColumnsMode && isParallelSyncActive}
                      onLinksLoaded={handleLinksLoaded}
                      theme={settings?.theme || 'classic'}
                    />
                  );
                })
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
                      if (
                        (settings?.highlightSearchTerms ?? true) &&
                        searchHighlight?.query &&
                        searchHighlight.query.trim() &&
                        isPali
                      ) {
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
    </div>
  );
});

export default function ReaderView({ ssrContent = null } = {}) {
  const {
    openTabs = [],
    activeTab,
    activeBookCode,
    activatePane,
    closeTab,
    jumpToMat,
    loadChapter,
    bufferAdjacentChapters,
    saveTabScroll,
    getSavedScroll,
    targetScrollIntent,
    tabScrollIntents,
    clearTargetScrollIntent,
    setIsSidebarOpen,
    isSidebarOpen,
    isHeaderVisible,
    setIsHeaderVisible,
    addBookmark,
    removeBookmark,
    isBookmarked,
    bookmarks = [],
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

  const { openDictionary, clickToLookupEnabled, clickLookupMode, isOpen: isDictOpen, dockMode: dictDockMode, isPinned: isDictPinned = false } = useDictionary();
  const [activeLinkedItem, setActiveLinkedItem] = useState(null);
  const { settings } = useThemeSettings();
  const pulseAnimation = Boolean(settings?.pulseAnimation);

  const isPaliEnabled = settings?.translations?.pali !== false;

  const orderedLayers = useMemo(() => {
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

  const activeLangs = useMemo(() => {
    const langs = [];
    for (const layer of orderedLayers) {
      if (layer.type === 'trans' && !langs.includes(layer.lang)) {
        langs.push(layer.lang);
      }
    }
    return langs;
  }, [orderedLayers]);

  const sentenceMode = settings?.translationGranularity === 'sentence';
  const hasTransLayers = useMemo(() => orderedLayers.some((l) => l.type === 'trans'), [orderedLayers]);

  const clickedWordsByBookRef = useRef({});
  const paneDomRefs = useRef({});
  const paneLinksByBookRef = useRef({});
  const driverBookCodeRef = useRef(null);
  const syncRafRef = useRef(null);

  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

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

  const registerPaneRef = useCallback((bookCode, node) => {
    if (!bookCode) return;
    if (node) {
      paneDomRefs.current[bookCode] = node;
    } else {
      delete paneDomRefs.current[bookCode];
    }
  }, []);

  const handlePaneLinksLoaded = useCallback((bookCode, chapIdx, paragraphs) => {
    if (!bookCode) return;
    if (!paneLinksByBookRef.current[bookCode]) {
      paneLinksByBookRef.current[bookCode] = {};
    }
    paneLinksByBookRef.current[bookCode][chapIdx] = paragraphs;
  }, []);

  const bookTabs = useMemo(
    () =>
      openTabs.length > 0
        ? openTabs.filter((t) => t.type !== 'ai_chat' && t.bookCode !== 'ai_chat')
        : activeTab && activeTab.type !== 'ai_chat' && activeTab.bookCode !== 'ai_chat'
          ? [activeTab]
          : [],
    [openTabs, activeTab]
  );

  const isWideScreen = viewportWidth >= 900;
  const maxColumns = getMaxColumnsForWidth(viewportWidth);
  const isAiActive =
    activeTab?.type === 'ai_chat' || activeTab?.bookCode === 'ai_chat' || activeTab?.viewMode === 'ai_chat';
  const isColumnsMode =
    settings?.tabView === 'columns' &&
    isWideScreen &&
    bookTabs.length > 1 &&
    !isAiActive;
  const isParallelSyncActive = settings?.syncScroll === true;

  const visibleColumnBookCodes = useMemo(() => {
    if (!activeTab || isAiActive) return new Set();
    if (!isColumnsMode) {
      return new Set([activeTab.bookCode]);
    }
    if (bookTabs.length <= maxColumns) {
      return new Set(bookTabs.map((t) => t.bookCode));
    }
    const activeIdx = Math.max(
      0,
      bookTabs.findIndex((t) => t.bookCode === (activeBookCode || activeTab.bookCode))
    );
    let start = maxColumns === 2 ? activeIdx : Math.max(0, activeIdx - Math.floor((maxColumns - 1) / 2));
    if (start + maxColumns > bookTabs.length) {
      start = Math.max(0, bookTabs.length - maxColumns);
    }
    return new Set(bookTabs.slice(start, start + maxColumns).map((t) => t.bookCode));
  }, [activeTab, activeBookCode, isAiActive, isColumnsMode, bookTabs, maxColumns]);

  // Keep only active/visible panes + up to 2 most-recently-used background tabs
  // mounted in DOM to cap memory usage across multi-tab sessions.
  const [mruBookCodes, setMruBookCodes] = useState([]);
  useEffect(() => {
    const front = [];
    for (const code of visibleColumnBookCodes) front.push(code);
    if (activeTab?.bookCode && !isAiActive && !visibleColumnBookCodes.has(activeTab.bookCode)) {
      front.push(activeTab.bookCode);
    }
    if (front.length === 0) return;
    setMruBookCodes((prev) => {
      const next = [...front, ...prev.filter((c) => !front.includes(c))].slice(0, 6);
      if (next.length === prev.length && next.every((c, i) => c === prev[i])) {
        return prev;
      }
      return next;
    });
  }, [visibleColumnBookCodes, activeTab?.bookCode, isAiActive]);

  const mountedBookCodes = useMemo(() => {
    const set = new Set(visibleColumnBookCodes);
    if (activeTab?.bookCode && !isAiActive) {
      set.add(activeTab.bookCode);
    }
    const maxMounted = Math.max(visibleColumnBookCodes.size + 2, 3);
    for (const code of mruBookCodes) {
      if (set.size >= maxMounted) break;
      set.add(code);
    }
    for (const tab of bookTabs) {
      if (set.size >= maxMounted) break;
      set.add(tab.bookCode);
    }
    return set;
  }, [visibleColumnBookCodes, activeTab?.bookCode, isAiActive, mruBookCodes, bookTabs]);

  const handleColumnUserInteract = useCallback((bookCode) => {
    driverBookCodeRef.current = bookCode;
  }, []);

  // Synchronized column scrolling: map the driver column's reading line (scrollTop + 60)
  // to each follower column using monotonic anchor interpolation.
  const handleColumnScrollSync = useCallback(
    (srcBookCode, srcScrollTop) => {
      if (!isColumnsMode || !isParallelSyncActive) return;
      if (driverBookCodeRef.current && driverBookCodeRef.current !== srcBookCode) return;

      if (syncRafRef.current) {
        cancelAnimationFrame(syncRafRef.current);
      }

      syncRafRef.current = requestAnimationFrame(() => {
        syncRafRef.current = null;
        const srcContainer = paneDomRefs.current[srcBookCode];
        const srcTab = bookTabs.find((t) => t.bookCode === srcBookCode);
        if (!srcContainer || !srcTab) return;

        const TOP_PAD = 60;
        const srcReadingY = srcScrollTop + TOP_PAD;

        for (const dstTab of bookTabs) {
          if (dstTab.bookCode === srcBookCode || !visibleColumnBookCodes.has(dstTab.bookCode)) {
            continue;
          }
          const dstContainer = paneDomRefs.current[dstTab.bookCode];
          if (!dstContainer) continue;

          const chain = buildParallelAnchors(
            srcContainer,
            dstContainer,
            srcTab,
            dstTab,
            paneLinksByBookRef.current[srcBookCode],
            paneLinksByBookRef.current[dstTab.bookCode]
          );

          if (chain.length > 0) {
            const dstReadingY = interpolateMonotonicY(chain, srcReadingY);
            if (dstReadingY !== null && Number.isFinite(dstReadingY)) {
              const maxDstScroll = Math.max(0, dstContainer.scrollHeight - dstContainer.clientHeight);
              const nextDstScroll = Math.max(0, Math.min(maxDstScroll, dstReadingY - TOP_PAD));
              if (Math.abs(dstContainer.scrollTop - nextDstScroll) > 2) {
                dstContainer.scrollTop = nextDstScroll;
                saveTabScroll(dstTab.bookCode, nextDstScroll);
              }
            }
          } else {
            const cRect = srcContainer.getBoundingClientRect();
            const targetViewportY = cRect.top + TOP_PAD;
            const paraEls = srcContainer.querySelectorAll('.chapter-content-block [data-para]');
            let currentPara = null;
            let srcChapIdx = srcTab.currentChapterIdx ?? 0;
            for (const p of paraEls) {
              if (p.getBoundingClientRect().bottom >= targetViewportY) {
                currentPara = p.getAttribute('data-para');
                const chEl = p.closest?.('[data-chapter]');
                if (chEl) {
                  const parsedCh = parseInt(chEl.getAttribute('data-chapter'), 10);
                  if (!isNaN(parsedCh)) srcChapIdx = parsedCh;
                }
                break;
              }
            }
            const dstLayer = getBookLayerInfo(dstTab.bookCode, dstTab.category).layer;
            const srcSub = srcTab.sub_book || srcTab.chapter_to_sub_book?.[srcChapIdx];
            const matInfo =
              (currentPara &&
                srcSub &&
                srcTab.sub_books_para_to_mat?.[srcSub]?.[currentPara]?.[dstLayer]) ||
              (currentPara && srcTab.para_to_mat?.[currentPara]?.[dstLayer]) ||
              srcTab.chapter_to_mat?.[srcChapIdx]?.[dstLayer] ||
              srcTab.chapter_to_mat?.[String(srcChapIdx)]?.[dstLayer];
            const targetPara = matInfo?.para || currentPara;
            const matBook = matInfo?.book || matInfo?.book_code;
            const matChap = matInfo?.chapter ?? matInfo?.chapter_index;
            const dstSub = dstTab.sub_book;
            const dstChapIdx =
              matBook === dstTab.bookCode && matChap !== undefined && matChap !== null
                ? matChap
                : (targetPara &&
                    dstSub &&
                    dstTab.sub_books_para_to_chapter?.[dstSub]?.[targetPara]) ??
                  (targetPara ? dstTab.para_to_chapter?.[targetPara] : undefined);
            if (
              dstChapIdx !== undefined &&
              dstChapIdx !== null &&
              !dstTab.loadedChapters?.[dstChapIdx] &&
              !dstTab.loadingChapters?.[dstChapIdx]
            ) {
              loadChapter(dstTab.bookCode, dstChapIdx);
              bufferAdjacentChapters(dstTab.bookCode, dstChapIdx);
            }
          }
        }
      });
    },
    [
      isColumnsMode,
      isParallelSyncActive,
      bookTabs,
      visibleColumnBookCodes,
      saveTabScroll,
      loadChapter,
      bufferAdjacentChapters,
    ]
  );

  // Keyboard navigation support for the active pane (PageUp, PageDown, ArrowUp, ArrowDown, Home, End, Space)
  useEffect(() => {
    const handleNavigationKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const activeEl = document.activeElement;
      const tag = activeEl?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        activeEl?.isContentEditable ||
        activeEl?.closest?.('[contenteditable="true"]') ||
        activeEl?.closest?.('aside, .app-sidebar, [role="dialog"]')
      ) {
        return;
      }

      if ((tag === 'button' || tag === 'a') && (e.key === ' ' || e.key === 'Enter')) {
        return;
      }
      if (
        (tag === 'button' || tag === 'a') &&
        activeEl?.closest?.('[role="menu"], [role="listbox"], [role="combobox"]')
      ) {
        return;
      }

      const hasModal = document.querySelector(
        '.modal-backdrop, [role="dialog"], .fixed.inset-0.z-50, .fixed.inset-0.z-\\[9999\\]'
      );
      if (hasModal) return;

      const curCode = activeTab?.bookCode;
      const container = (curCode && paneDomRefs.current[curCode]) || null;
      if (!container) return;

      driverBookCodeRef.current = curCode;

      const useWin = !isColumnsMode && !isAiActive && typeof window !== 'undefined';
      const scroller = useWin ? window : container;
      const clientHeight = useWin
        ? window.innerHeight
        : container.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 800);
      const maxScrollHeight = useWin ? document.documentElement.scrollHeight : container.scrollHeight;
      const pageStep = Math.max(120, Math.round(clientHeight * 0.85));
      const lineStep = 80;

      if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        scroller.scrollBy({
          top: pageStep,
          behavior: settings?.scrollMotion === 'instant' ? 'instant' : 'smooth',
        });
      } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        scroller.scrollBy({
          top: -pageStep,
          behavior: settings?.scrollMotion === 'instant' ? 'instant' : 'smooth',
        });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        scroller.scrollBy({ top: lineStep, behavior: 'smooth' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        scroller.scrollBy({ top: -lineStep, behavior: 'smooth' });
      } else if (e.key === 'Home') {
        e.preventDefault();
        scroller.scrollTo({ top: 0, behavior: settings?.scrollMotion === 'instant' ? 'instant' : 'smooth' });
      } else if (e.key === 'End') {
        e.preventDefault();
        scroller.scrollTo({
          top: maxScrollHeight,
          behavior: settings?.scrollMotion === 'instant' ? 'instant' : 'smooth',
        });
      }
    };

    window.addEventListener('keydown', handleNavigationKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleNavigationKeyDown);
  }, [activeTab?.bookCode, settings?.scrollMotion]);

  const translationStyleRules = useMemo(() => {
    if (
      !orderedLayers.some((l) => l.type === 'trans') &&
      !(settings?.translationColors && Object.keys(settings.translationColors).length > 0)
    ) {
      return '';
    }
    const currentTheme = settings?.theme || 'classic';
    const customMap = settings?.translationColors || {};
    const activeTransLayers = orderedLayers.filter((l) => l.type === 'trans');
    const handledKeys = new Set();
    const rules = [];

    activeTransLayers.forEach((layer, slotIdx) => {
      const slotDefaults = getDefaultTranslationColorsForTheme(currentTheme, slotIdx);
      const custom = customMap[layer.id] || customMap[layer.lang] || {};
      const code = LANG_KEY_TO_CODE[layer.id] || layer.lang;
      handledKeys.add(layer.id);
      handledKeys.add(code);
      const bg = formatCssColor(custom.bg);
      const border = formatCssColor(custom.border) || slotDefaults.border;
      const text = formatCssColor(custom.text) || slotDefaults.text;

      if (bg) {
        rules.push(`
        .reader-trans-block[data-trans-lang="${layer.id}"],
        .reader-trans-block[data-trans-lang="${code}"] {
          background-color: ${bg} !important;
        }`);
      }
      if (border) {
        rules.push(`
        body:not(.hide-trans-borders) .reader-trans-block[data-trans-lang="${layer.id}"],
        body:not(.hide-trans-borders) .reader-trans-block[data-trans-lang="${code}"] {
          border-left-color: ${border} !important;
        }`);
      }
      if (text) {
        rules.push(`
        .reader-trans-block[data-trans-lang="${layer.id}"],
        .reader-trans-block[data-trans-lang="${code}"],
        .reader-trans-block[data-trans-lang="${layer.id}"] .reader-trans-content,
        .reader-trans-block[data-trans-lang="${code}"] .reader-trans-content,
        .reader-trans-block[data-trans-lang="${layer.id}"] .reader-nissaya-meaning,
        .reader-trans-block[data-trans-lang="${code}"] .reader-nissaya-meaning,
        .reader-trans-block[data-trans-lang="${layer.id}"] p,
        .reader-trans-block[data-trans-lang="${code}"] p,
        .linked-def-trans-row[data-trans-lang="${layer.id}"] .linked-def-trans-text,
        .linked-def-trans-row[data-trans-lang="${code}"] .linked-def-trans-text {
          color: ${text} !important;
        }`);
      }
    });

    Object.entries(customMap).forEach(([langKey, colors]) => {
      if (!colors || handledKeys.has(langKey)) return;
      const code = LANG_KEY_TO_CODE[langKey] || langKey;
      const bg = formatCssColor(colors.bg);
      const border = formatCssColor(colors.border);
      const text = formatCssColor(colors.text);
      if (bg) {
        rules.push(`
        .reader-trans-block[data-trans-lang="${langKey}"],
        .reader-trans-block[data-trans-lang="${code}"] {
          background-color: ${bg} !important;
        }`);
      }
      if (border) {
        rules.push(`
        body:not(.hide-trans-borders) .reader-trans-block[data-trans-lang="${langKey}"],
        body:not(.hide-trans-borders) .reader-trans-block[data-trans-lang="${code}"] {
          border-left-color: ${border} !important;
        }`);
      }
      if (text) {
        rules.push(`
        .reader-trans-block[data-trans-lang="${langKey}"],
        .reader-trans-block[data-trans-lang="${code}"],
        .reader-trans-block[data-trans-lang="${langKey}"] .reader-trans-content,
        .reader-trans-block[data-trans-lang="${code}"] .reader-trans-content,
        .reader-trans-block[data-trans-lang="${langKey}"] .reader-nissaya-meaning,
        .reader-trans-block[data-trans-lang="${code}"] .reader-nissaya-meaning,
        .reader-trans-block[data-trans-lang="${langKey}"] p,
        .reader-trans-block[data-trans-lang="${code}"] p,
        .linked-def-trans-row[data-trans-lang="${langKey}"] .linked-def-trans-text,
        .linked-def-trans-row[data-trans-lang="${code}"] .linked-def-trans-text {
          color: ${text} !important;
        }`);
      }
    });

    return rules.join('\n');
  }, [orderedLayers, settings?.translationColors, settings?.theme]);

  const activeTabHasRenderableContent = Boolean(
    activeTab &&
      (activeTab.type === 'ai_chat' ||
        activeTab.bookCode === 'ai_chat' ||
        !activeTab.isLoading ||
        Object.keys(activeTab.loadedChapters || {}).length > 0 ||
        (Array.isArray(activeTab.toc) && activeTab.toc.length > 0))
  );

  if (!activeTab || (ssrContent && !activeTabHasRenderableContent)) {
    return (
      <main className="content-area flex-1 min-h-0 overflow-y-auto relative flex flex-col bg-[var(--bg-primary)]">
        {ssrContent || <WelcomeView />}
      </main>
    );
  }

  const isPanelWindowScroll = !isColumnsMode && !isAiActive && Boolean(activeTab?.bookCode);

  return (
    <div
      className={
        isPanelWindowScroll
          ? 'reader-view-panel flex-1 min-h-0 flex flex-col relative bg-[var(--bg-primary)]'
          : 'reader-view-panel flex-1 min-h-0 flex flex-col relative overflow-hidden bg-[var(--bg-primary)]'
      }
    >
      {translationStyleRules && <style dangerouslySetInnerHTML={{ __html: translationStyleRules }} />}

      {/* AI Chat View (rendered when active, while keeping book panes mounted in background) */}
      {isAiActive && (
        <main className="content-area flex-1 min-h-0 overflow-hidden relative flex flex-col bg-[var(--bg-primary)]">
          <AiChatView initialQuery={activeTab.initialQuery} />
        </main>
      )}

      {/* Persistent Per-Tab Book Panes (Single / Tabbed / Parallel Columns) */}
      <div
        className={
          isAiActive
            ? 'hidden'
            : `reader-panes-host flex-1 min-h-0 flex ${isColumnsMode ? 'flex-row reader-columns-grid' : 'flex-col'}`
        }
      >
        {bookTabs.map((tab) => {
          if (!mountedBookCodes.has(tab.bookCode)) return null;
          const isPaneVisible = visibleColumnBookCodes.has(tab.bookCode);
          const isPaneActive = tab.bookCode === activeTab.bookCode;
          const paneIntent =
            tabScrollIntents?.[tab.bookCode] ||
            (targetScrollIntent &&
            (targetScrollIntent.bookCode === tab.bookCode || (!targetScrollIntent.bookCode && isPaneActive))
              ? targetScrollIntent
              : null);

          return (
            <ReaderPane
              key={tab.bookCode}
              tab={tab}
              isVisible={isPaneVisible}
              isActive={isPaneActive}
              isColumnsMode={isColumnsMode}
              useWindowScroll={!isColumnsMode && !isAiActive}
              isParallelSyncActive={isParallelSyncActive}
              paneScrollIntent={paneIntent}
              clearTargetScrollIntent={clearTargetScrollIntent}
              loadChapter={loadChapter}
              bufferAdjacentChapters={bufferAdjacentChapters}
              saveTabScroll={saveTabScroll}
              getSavedScroll={getSavedScroll}
              saveTabPosition={saveTabPosition}
              activatePane={activatePane}
              closeTab={closeTab}
              jumpToMat={jumpToMat}
              openBook={openBook}
              openGoToModal={openGoToModal}
              addBookmark={addBookmark}
              removeBookmark={removeBookmark}
              bookmarks={bookmarks}
              activeParaNum={activeParaNum}
              setActiveParaNum={setActiveParaNum}
              setActiveEditionPages={setActiveEditionPages}
              addToHistory={addToHistory}
              setIsHistoryOpen={setIsHistoryOpen}
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              isHeaderVisible={isHeaderVisible}
              setIsHeaderVisible={setIsHeaderVisible}
              searchHighlight={searchHighlight}
              settings={settings}
              orderedLayers={orderedLayers}
              activeLangs={activeLangs}
              isPaliEnabled={isPaliEnabled}
              sentenceMode={sentenceMode}
              hasTransLayers={hasTransLayers}
              pulseAnimation={pulseAnimation}
              openDictionary={openDictionary}
              clickToLookupEnabled={clickToLookupEnabled}
              clickLookupMode={clickLookupMode}
              recordClickedWord={recordClickedWord}
              clickedWordsByBookRef={clickedWordsByBookRef}
              setActiveLinkedItem={setActiveLinkedItem}
              registerPaneRef={registerPaneRef}
              onColumnUserInteract={handleColumnUserInteract}
              onColumnScrollSync={handleColumnScrollSync}
              onPaneLinksLoaded={handlePaneLinksLoaded}
              isDictOpen={isDictOpen}
              dictDockMode={dictDockMode}
              isDictPinned={isDictPinned}
            />
          );
        })}
      </div>

      {activeLinkedItem && (
        <LinkedDefinitionModal
          link={activeLinkedItem}
          activeLangs={activeLangs}
          currentScript={settings?.paliScript || 'roman'}
          onClose={() => setActiveLinkedItem(null)}
        />
      )}
    </div>
  );
}
