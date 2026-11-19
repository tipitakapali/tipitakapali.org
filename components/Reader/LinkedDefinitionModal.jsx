'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, BookOpen, Check, ExternalLink, X, Layers } from 'lucide-react';
import { fetchLinkedPreview, getCachedLinkedPreview } from '../../services/api';
import { convertPaliScript, cleanDictionaryQuery } from '../../services/transliterate';
import { formatSafeTranslationHtml } from '../../services/translationFormat';
import { useTabs } from '../../context/TabContext';
import { useDictionary } from '../../context/DictionaryContext';
import { useThemeSettings, resolveTranslationTextColor } from '../../context/ThemeSettingsContext';

const CATEGORY_LABELS = {
  mūla: 'Mūla',
  aṭṭhakathā: 'Aṭṭhakathā',
  ṭīkā: 'Ṭīkā',
  anya: 'Anya',
};

function getLinkedCategoryClass(category) {
  const cat = String(category || '').toLowerCase();
  if (cat.includes('mūla') || cat === 'mula') return 'linked-def-cat-mula';
  if (cat.includes('aṭṭha') || cat.includes('attha')) return 'linked-def-cat-attha';
  if (cat.includes('ṭīkā') || cat.includes('tika')) return 'linked-def-cat-tika';
  return '';
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatPaliInlineHtml(html, currentScript) {
  if (!html) return '';
  const parts = String(html).split(/(<\/?b\b[^>]*>)/gi);
  return parts
    .map((part) => {
      if (/^<b\b[^>]*>$/i.test(part)) return '<b class="bold-def-highlight">';
      if (/^<\/b>$/i.test(part)) return '</b>';
      const cleanText = part.replace(/<[^>]+>/g, '');
      const converted =
        currentScript && currentScript !== 'roman'
          ? convertPaliScript(cleanText, currentScript) || cleanText
          : cleanText;
      return escapeHtml(converted);
    })
    .join('');
}

function toDisplayPali(text, currentScript) {
  if (!text) return '';
  return currentScript && currentScript !== 'roman'
    ? convertPaliScript(text, currentScript) || text
    : text;
}

export function getLinkedLineKey(line, idx = 0) {
  if (!line || typeof line !== 'object') return `line-${idx}`;
  return `${line.para_index ?? 'p'}-${line.line_id ?? 'p'}-${idx}`;
}

export function buildLinkedOpenOptions(preview, link, selectedLine = null) {
  const targetBook = preview?.book_code || link?.target_book || null;
  if (!targetBook) return null;

  const baseParaIndex = preview?.target_para_index ?? link?.target_para_index;
  const baseLineId = preview?.target_line_id ?? link?.target_line_id ?? null;
  const baseChapterIdx = preview?.chapter_index ?? link?.target_chapter;

  const activeLine = selectedLine || null;
  const targetParaIndex =
    activeLine && activeLine.para_index !== undefined && activeLine.para_index !== null
      ? activeLine.para_index
      : baseParaIndex;
  const sameParaAsDefault =
    baseParaIndex === undefined ||
    baseParaIndex === null ||
    String(targetParaIndex) === String(baseParaIndex);

  const targetParaNum = activeLine
    ? activeLine.para_num || (sameParaAsDefault ? link?.target_para_num : undefined)
    : link?.target_para_num;
  const targetLineId = activeLine
    ? activeLine.line_id !== undefined && activeLine.line_id !== null
      ? activeLine.line_id
      : null
    : baseLineId;

  return {
    targetBook,
    opts: {
      ...(sameParaAsDefault && baseChapterIdx !== undefined && baseChapterIdx !== null
        ? { targetChapterIdx: baseChapterIdx }
        : {}),
      ...(targetParaIndex !== undefined && targetParaIndex !== null ? { targetParaIndex } : {}),
      ...(targetParaNum ? { targetParaNum } : {}),
      ...(targetLineId !== undefined && targetLineId !== null ? { targetLineId } : {}),
    },
  };
}

function extractClickedWord(e) {
  if (typeof document === 'undefined') return '';
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(e.clientX, e.clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (pos?.offsetNode) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (!range || range.startContainer?.nodeType !== Node.TEXT_NODE) return '';
  const text = range.startContainer.textContent || '';
  const isWordChar = (ch) =>
    /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0900-\u097F\u1000-\u109F\u0D80-\u0DFF\u0E00-\u0E7F]/.test(ch);
  let start = range.startOffset;
  let end = range.startOffset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  return text.slice(start, end).trim();
}

export default function LinkedDefinitionModal({
  link,
  activeLangs = [],
  currentScript = 'roman',
  onClose,
}) {
  const { openBook } = useTabs();
  const { openDictionary } = useDictionary();
  const { settings } = useThemeSettings() || {};

  const langsKey = Array.isArray(activeLangs) ? activeLangs.filter(Boolean).join(',') : '';
  const initialCachedPreview = link?.target_book
    ? getCachedLinkedPreview({
        book: link.target_book,
        chapter: link.target_chapter,
        paraIndex: link.target_para_index,
        paraNum: link.target_para_num,
        lineId: link.target_line_id,
        word: link.word,
        langs: langsKey ? langsKey.split(',') : [],
      })
    : null;

  const [preview, setPreview] = useState(initialCachedPreview);
  const [loading, setLoading] = useState(Boolean(link?.target_book) && !initialCachedPreview);
  const [error, setError] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [selectedLineKey, setSelectedLineKey] = useState(null);
  const bodyRef = useRef(null);
  const targetRef = useRef(null);

  useEffect(() => {
    setSelectedLineKey(null);
  }, [
    link?.target_book,
    link?.target_chapter,
    link?.target_para_index,
    link?.target_para_num,
    link?.target_line_id,
    link?.word,
  ]);

  useEffect(() => {
    if (!link) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [link, onClose]);

  useEffect(() => {
    if (!link?.target_book) {
      setPreview(null);
      setError(null);
      setLoading(false);
      return;
    }

    const previewArgs = {
      book: link.target_book,
      chapter: link.target_chapter,
      paraIndex: link.target_para_index,
      paraNum: link.target_para_num,
      lineId: link.target_line_id,
      word: link.word,
      langs: langsKey ? langsKey.split(',') : [],
    };
    const cachedNow = retryNonce === 0 ? getCachedLinkedPreview(previewArgs) : null;
    if (cachedNow) {
      setPreview(cachedNow);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchLinkedPreview(previewArgs)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || 'Unable to load linked passage preview.');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    link?.target_book,
    link?.target_chapter,
    link?.target_para_index,
    link?.target_para_num,
    link?.target_line_id,
    link?.word,
    langsKey,
    retryNonce,
  ]);

  useLayoutEffect(() => {
    if (loading || !preview || !targetRef.current || !bodyRef.current) return;
    const container = bodyRef.current;
    const target = targetRef.current;
    const cRect = container.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const top = Math.max(0, tRect.top - cRect.top + container.scrollTop - 16);
    container.scrollTop = top;
  }, [loading, preview]);

  if (!link) return null;

  const isSource = Boolean(link.is_source);
  const displayWord = toDisplayPali(link.word, currentScript);
  const displayBookTitle = toDisplayPali(
    preview?.book_title || link.target_book_title || link.target_book,
    currentScript
  );
  const rawCategory = preview?.category || link.target_category || '';
  const categoryLabel =
    CATEGORY_LABELS[rawCategory.toLowerCase()] || rawCategory;
  const catClass = getLinkedCategoryClass(rawCategory);

  const lines = Array.isArray(preview?.lines) ? preview.lines : [];
  const firstTargetIdx = lines.findIndex((l) => Boolean(l?.is_target));
  const defaultTargetLine = firstTargetIdx >= 0 ? lines[firstTargetIdx] : null;
  const selectedLineObj =
    (selectedLineKey && lines.find((l, i) => getLinkedLineKey(l, i) === selectedLineKey)) ||
    defaultTargetLine ||
    null;
  const activeSelectionKey = selectedLineObj
    ? getLinkedLineKey(selectedLineObj, lines.indexOf(selectedLineObj))
    : null;
  const hasCustomLineSelected = Boolean(
    selectedLineKey &&
    defaultTargetLine &&
    activeSelectionKey !== getLinkedLineKey(defaultTargetLine, firstTargetIdx)
  );

  const openPayload = buildLinkedOpenOptions(preview, link, selectedLineObj);

  const openLineInReader = (lineOverride = null) => {
    const payload = buildLinkedOpenOptions(preview, link, lineOverride || selectedLineObj);
    if (!payload) return;
    openBook(payload.targetBook, payload.opts);
    onClose?.();
  };

  const handleOpenInReader = () => openLineInReader(null);

  const handlePaliBodyClick = (e) => {
    if (e.target.closest('button, a')) return;
    const sel = window.getSelection()?.toString()?.trim();
    const raw = sel && sel.length > 0 && sel.length < 50 ? sel : extractClickedWord(e);
    const clean = raw ? cleanDictionaryQuery(raw) : '';
    if (clean && clean.length >= 2) {
      openDictionary(clean);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1150] flex items-end sm:items-center justify-center bg-black/55 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Linked definition for ${link.word}`}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[86vh] sm:max-h-[82vh] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${
                  isSource
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                    : 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent-border)]'
                }`}
              >
                {isSource ? <ArrowLeft size={11} /> : <ArrowRight size={11} />}
                <span>{isSource ? 'Source Text' : 'Commentary'}</span>
              </span>

              {categoryLabel && (
                <span className={`linked-def-modal-cat text-[10.5px] font-semibold px-2 py-0.5 rounded-md border ${catClass || 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
                  {categoryLabel}
                </span>
              )}

              {link.target_para_num && (
                <span className="text-[11px] font-mono text-[var(--text-muted)]">
                  § {link.target_para_num}
                </span>
              )}
            </div>

            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className={`text-base font-bold ${catClass || 'text-[var(--accent)]'}`}>{displayWord}</h3>
              <span className="text-xs text-[var(--text-secondary)] truncate">{displayBookTitle}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer shrink-0"
            aria-label="Close linked definition preview"
          >
            <X size={17} />
          </button>
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          className="linked-def-modal-body scroll-auto flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-[var(--bg-primary)] text-[var(--text-primary)]"
        >
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-[var(--text-muted)]">
              <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-medium">Loading linked passage...</span>
            </div>
          )}

          {!loading && error && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="px-2.5 py-1 rounded-lg font-semibold bg-rose-600 text-white hover:bg-rose-700 transition cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && !error && lines.length === 0 && (
            <div className="py-10 text-center text-xs text-[var(--text-muted)]">
              No preview lines found for this passage. You can still open the target book directly below.
            </div>
          )}

          {!loading && !error && lines.map((line, idx) => {
            const lineKey = getLinkedLineKey(line, idx);
            const isTarget = Boolean(line.is_target);
            const isSelected = activeSelectionKey === lineKey;
            const paliHtml = formatPaliInlineHtml(line.pali_html, currentScript);
            const paliColor = resolveTranslationTextColor('pali', 0, settings);
            const rawTranslations =
              line.translations && typeof line.translations === 'object'
                ? Object.entries(line.translations).filter(([, v]) => v && String(v).trim())
                : [];
            const langRank = new Map(
              (Array.isArray(activeLangs) ? activeLangs : []).map((l, i) => [String(l).toLowerCase(), i])
            );
            const translations = [...rawTranslations].sort(([a], [b]) => {
              const ra = langRank.get(String(a).toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
              const rb = langRank.get(String(b).toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
              return ra - rb;
            });

            const cardClass = isSelected
              ? isTarget
                ? 'linked-def-passage-target linked-def-line-selected'
                : 'linked-def-line-selected'
              : isTarget
                ? 'linked-def-passage-target linked-def-target-inactive'
                : 'border bg-[var(--bg-primary)] border-[var(--border-color)]/60 hover:border-[var(--accent)]/45';

            return (
              <div
                key={lineKey}
                ref={idx === firstTargetIdx ? targetRef : undefined}
                data-target={isTarget ? '1' : undefined}
                data-selected={isSelected ? '1' : undefined}
                onClick={(e) => {
                  if (e.target.closest('button, a, .linked-def-pali-text')) return;
                  const sel = window.getSelection()?.toString()?.trim();
                  if (sel && sel.length > 0) return;
                  setSelectedLineKey(lineKey);
                }}
                className={`rounded-xl p-3 sm:p-4 transition group ${cardClass}`}
              >
                <div
                  className="flex items-center justify-between gap-2 mb-1.5 cursor-pointer"
                  onClick={() => setSelectedLineKey(lineKey)}
                >
                  <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-[var(--text-muted)]">
                    {line.para_num && <span>§ {line.para_num}</span>}
                    {line.line_id && <span>• line {line.line_id}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isTarget && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--accent)]">
                        <Layers size={10} />
                        <span>Linked Passage</span>
                      </span>
                    )}
                    {isSelected && (!isTarget || hasCustomLineSelected) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/35">
                        <Check size={10} />
                        <span>Selected</span>
                      </span>
                    )}
                    {!isSelected && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLineKey(lineKey);
                        }}
                        className="linked-def-line-select-btn inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--accent)] hover:border-[var(--accent)] transition cursor-pointer"
                        title="Select this line for Open in Reader"
                      >
                        <span>Select</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openLineInReader(line);
                      }}
                      className="linked-def-line-open-btn inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition cursor-pointer"
                      title={`Open this line${line.para_num ? ` (§ ${line.para_num})` : ''} in Reader`}
                      aria-label={`Open line ${line.line_id ?? idx + 1} in Reader`}
                    >
                      <BookOpen size={10} />
                      <span>Open</span>
                    </button>
                  </div>
                </div>

                <div
                  onClick={handlePaliBodyClick}
                  className="linked-def-pali-text text-[var(--text-primary)] cursor-pointer"
                  style={paliColor ? { color: paliColor } : undefined}
                  dangerouslySetInnerHTML={{ __html: paliHtml }}
                />

                {translations.length > 0 && (
                  <div className="mt-2.5 pt-2.5 border-t border-[var(--border-color)]/45 space-y-1.5">
                    {translations.map(([langCode, txt], tIdx) => {
                      const slotIdx = langRank.has(String(langCode).toLowerCase())
                        ? langRank.get(String(langCode).toLowerCase())
                        : tIdx;
                      const transColor = resolveTranslationTextColor(langCode, slotIdx, settings);
                      return (
                        <div
                          key={langCode}
                          data-trans-lang={langCode}
                          className="linked-def-trans-row flex items-start gap-2"
                        >
                          <span className="uppercase text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-muted)] shrink-0 mt-1">
                            {langCode}
                          </span>
                          <span
                            className="linked-def-trans-text min-w-0 flex-1"
                            style={transColor ? { color: transColor } : undefined}
                            dangerouslySetInnerHTML={{ __html: formatSafeTranslationHtml(txt, langCode) }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 shrink-0">
          <span className="text-[11px] font-mono text-[var(--text-muted)] truncate">
            {openPayload?.targetBook || preview?.book_code || link.target_book}
            {openPayload?.opts?.targetParaNum ? ` · § ${openPayload.opts.targetParaNum}` : ''}
            {openPayload?.opts?.targetLineId ? ` · line ${openPayload.opts.targetLineId}` : ''}
          </span>

          <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-initial sm:min-w-[140px] inline-flex items-center justify-center px-6 py-2 rounded-lg text-xs font-semibold border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleOpenInReader}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-[var(--accent)] text-white hover:opacity-90 transition cursor-pointer shadow-xs shrink-0"
            >
              <BookOpen size={13} />
              <span>Open in Reader</span>
              <ExternalLink size={11} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
