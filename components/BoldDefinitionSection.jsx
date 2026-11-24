'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, Sparkles, Columns } from 'lucide-react';
import { convertPaliScript } from '../services/transliterate';
import { formatSafeTranslationHtml } from '../services/translationFormat';
import { useThemeSettings, resolveTranslationTextColor } from '../context/ThemeSettingsContext';

const INITIAL_VISIBLE_COUNT = 4;

const CATEGORY_META = {
  aṭṭhakathā: {
    label: 'Aṭṭhakathā',
    pillClass: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  ṭīkā: {
    label: 'Ṭīkā',
    pillClass: 'bg-violet-500/12 text-violet-700 dark:text-violet-300 border-violet-500/30',
  },
  mūla: {
    label: 'Mūla',
    pillClass: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  anya: {
    label: 'Anya',
    pillClass: 'bg-slate-500/12 text-slate-700 dark:text-slate-300 border-slate-500/30',
  },
};

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatInlineBoldHtml(html, currentScript) {
  if (!html) return '';
  const parts = String(html).split(/(<\/?b\b[^>]*>)/gi);
  let insideBold = false;
  return parts
    .map((part) => {
      if (/^<b\b[^>]*>$/i.test(part)) {
        insideBold = true;
        return '<b class="bold-def-highlight">';
      }
      if (/^<\/b>$/i.test(part)) {
        insideBold = false;
        return '</b>';
      }
      const cleanText = part.replace(/<[^>]+>/g, '');
      const converted =
        currentScript && currentScript !== 'roman'
          ? convertPaliScript(cleanText, currentScript) || cleanText
          : cleanText;
      return insideBold ? escapeHtml(converted) : escapeHtml(converted);
    })
    .join('');
}

function toDisplayPali(text, currentScript) {
  if (!text) return '';
  return currentScript && currentScript !== 'roman'
    ? convertPaliScript(text, currentScript) || text
    : text;
}

export default function BoldDefinitionSection({
  results = [],
  queryWord = '',
  searchPrefix = '',
  currentScript = 'roman',
  onOpenPassage,
  onOpenAlongside,
}) {
  const { settings } = useThemeSettings() || {};
  const [expanded, setExpanded] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => {
    setExpanded(false);
    setCategoryFilter('all');
  }, [queryWord]);

  const categoryCounts = useMemo(() => {
    const counts = { all: results.length };
    for (const r of results) {
      const cat = (r.category || 'anya').toLowerCase();
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [results]);

  const activeCategory = categoryFilter !== 'all' && !categoryCounts[categoryFilter] ? 'all' : categoryFilter;

  const filtered = useMemo(() => {
    if (activeCategory === 'all') return results;
    return results.filter((r) => (r.category || 'anya').toLowerCase() === activeCategory);
  }, [results, activeCategory]);

  const visibleItems = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE_COUNT);
  const hiddenCount = Math.max(0, filtered.length - INITIAL_VISIBLE_COUNT);

  const availableCategories = useMemo(() => {
    return ['aṭṭhakathā', 'ṭīkā', 'mūla', 'anya'].filter((c) => (categoryCounts[c] || 0) > 0);
  }, [categoryCounts]);

  if (!results || results.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Summary & Category Filter Strip */}
      <div className="bold-def-nonlookup flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--border-color)]/60">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
          <Sparkles size={12} className="text-[var(--accent)] shrink-0" />
          <span>
            <strong className="text-[var(--text-primary)]">{results.length}</strong> bold definitions
          </span>
          {searchPrefix && searchPrefix.toLowerCase() !== (queryWord || '').toLowerCase() && (
            <span className="px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[10px] font-mono">
              stem: {toDisplayPali(searchPrefix, currentScript)}*
            </span>
          )}
        </div>

        {availableCategories.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold border transition cursor-pointer ${
                activeCategory === 'all'
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--accent)]'
              }`}
            >
              All ({results.length})
            </button>
            {availableCategories.map((cat) => {
              const meta = CATEGORY_META[cat] || CATEGORY_META.anya;
              const isSelected = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2 py-0.5 rounded-full text-[10.5px] font-semibold border transition cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--accent)]'
                  }`}
                >
                  {meta.label} ({categoryCounts[cat]})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-2.5">
        {visibleItems.map((item, idx) => {
          const catKey = (item.category || 'anya').toLowerCase();
          const catMeta = CATEGORY_META[catKey] || CATEGORY_META.anya;
          const displayWord = toDisplayPali(item.word, currentScript);
          const displayBook = toDisplayPali(item.book_title || item.book_code, currentScript);
          const beforeHtml = formatInlineBoldHtml(item.before_html, currentScript);
          const sentenceHtml = formatInlineBoldHtml(item.sentence_html, currentScript);
          const afterHtml = formatInlineBoldHtml(item.after_html, currentScript);
          const translations = item.translations && typeof item.translations === 'object'
            ? Object.entries(item.translations).filter(([, txt]) => txt && String(txt).trim())
            : [];
          const mat = item.mat && typeof item.mat === 'object' ? item.mat : null;
          const matEntries = mat
            ? [
                { key: 'mula', label: 'Mūla', data: mat.mula },
                { key: 'attha', label: 'Aṭṭha', data: mat.attha },
                { key: 'tika', label: 'Ṭīkā', data: mat.tika },
              ].filter((m) => m.data?.book_code && m.data.book_code !== item.book_code)
            : [];

          return (
            <div
              key={`${item.book_code}-${item.chapter_index}-${item.para_index}-${item.word}-${idx}`}
              id={`dict-entry-${idx}`}
              className="bold-def-card dict-entry-item rounded-xl border border-[var(--border-color)]/75 bg-[var(--bg-primary)] p-3 sm:p-3.5 space-y-2.5 shadow-2xs hover:border-[var(--accent-border)] transition"
            >
              {/* Card Header */}
              <div className="bold-def-nonlookup flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold text-[var(--accent)]">
                      {displayWord}
                    </span>
                    {item.ending && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] border border-[var(--border-color)]">
                        +{toDisplayPali(item.ending, currentScript)}
                      </span>
                    )}
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${catMeta.pillClass}`}>
                      {catMeta.label}
                    </span>
                    {(item.para_num || item.para_index !== undefined) && (
                      <span className="text-[10.5px] font-mono text-[var(--text-muted)]">
                        {item.para_num ? `§ ${item.para_num}` : `#${item.para_index}`}
                        {item.line_id ? ` · L${item.line_id}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="text-[11.5px] font-medium text-[var(--text-secondary)] truncate">
                    {displayBook}
                  </div>
                </div>

                {(onOpenPassage || onOpenAlongside) && (
                  <div className="flex items-center gap-1 shrink-0">
                    {onOpenAlongside && (
                      <button
                        type="button"
                        onClick={() => onOpenAlongside(item)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-[var(--bg-secondary)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white border border-[var(--accent)]/35 hover:border-[var(--accent)] transition cursor-pointer shrink-0"
                        title={`Open ${item.book_title || item.book_code} alongside current text`}
                      >
                        <Columns size={11} />
                        <span>Alongside</span>
                      </button>
                    )}
                    {onOpenPassage && (
                      <button
                        type="button"
                        onClick={() => onOpenPassage(item)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-[var(--accent-light)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white border border-[var(--accent-border)] transition cursor-pointer shrink-0"
                        title={`Open ${item.book_title || item.book_code} in Reader`}
                      >
                        <BookOpen size={11} />
                        <span>Open</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Pāḷi Context + Highlighted Sentence (tap any word to lookup via DictionaryModal click handler) */}
              <div className="bold-def-pali-text cursor-pointer space-y-1.5 text-[var(--text-primary)]">
                {beforeHtml && (
                  <div
                    className="text-[var(--text-secondary)] italic opacity-80"
                    dangerouslySetInnerHTML={{ __html: beforeHtml }}
                  />
                )}
                <div
                  className="bold-def-sentence"
                  dangerouslySetInnerHTML={{ __html: sentenceHtml }}
                />
                {afterHtml && (
                  <div
                    className="text-[var(--text-secondary)] italic opacity-80"
                    dangerouslySetInnerHTML={{ __html: afterHtml }}
                  />
                )}
              </div>

              {/* Active Translations (tap any translation word to continue dictionary lookup) */}
              {translations.length > 0 && (
                <div className="pt-2 border-t border-[var(--border-color)]/50 space-y-1.5">
                  {translations.map(([langCode, txt]) => {
                    const transColor = resolveTranslationTextColor(langCode, null, settings);
                    return (
                      <div
                        key={langCode}
                        data-trans-lang={langCode}
                        className="bold-def-trans-row flex items-start gap-2"
                      >
                        <span className="bold-def-nonlookup uppercase text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] text-[var(--text-muted)] shrink-0 mt-1">
                          {langCode}
                        </span>
                        <span
                          className="bold-def-trans-text cursor-pointer min-w-0 flex-1"
                          style={transColor ? { color: transColor } : undefined}
                          dangerouslySetInnerHTML={{ __html: formatSafeTranslationHtml(txt, langCode) }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Cross-Nikāya MAT Sibling Quick Jumps */}
              {matEntries.length > 0 && onOpenPassage && (
                <div className="bold-def-nonlookup pt-1.5 border-t border-[var(--border-color)]/40 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    MAT:
                  </span>
                  {matEntries.map((m) => (
                    <button
                      key={`${m.key}-${m.data.book_code}`}
                      type="button"
                      onClick={() =>
                        onOpenPassage({
                          book_code: m.data.book_code,
                          chapter_index: m.data.chapter,
                          para_num: m.data.para,
                          word: item.word,
                        })
                      }
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium bg-[var(--bg-secondary)] hover:bg-[var(--accent-light)] text-[var(--text-secondary)] hover:text-[var(--accent)] border border-[var(--border-color)] hover:border-[var(--accent-border)] transition cursor-pointer"
                      title={`Jump to ${m.data.title || m.data.book_code}`}
                    >
                      <span>{m.label}</span>
                      {m.data.para && <span className="font-mono opacity-80">§{m.data.para}</span>}
                      <ExternalLink size={9} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Show More / Less Toggle */}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full py-2 px-3 rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:bg-[var(--accent-light)] hover:border-[var(--accent-border)] text-xs font-semibold text-[var(--accent)] flex items-center justify-center gap-1.5 transition cursor-pointer"
        >
          {expanded ? (
            <>
              <ChevronUp size={14} />
              <span>Show less</span>
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              <span>Show {hiddenCount} more {hiddenCount === 1 ? 'definition' : 'definitions'}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}
