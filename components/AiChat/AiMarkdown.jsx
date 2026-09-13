'use client';

import React, { useCallback } from 'react';
import { Quote, BookOpen } from 'lucide-react';
import { useDictionary } from '../../context/DictionaryContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { cleanDictionaryQuery } from '../../services/transliterate';

/**
 * Extract the word-like segment at a viewport point (mirrors Reader word lookup).
 * Returns the raw word string or null.
 */
function extractWordAtPoint(clientX, clientY) {
  let range = null;
  try {
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos && pos.offsetNode) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
  } catch (e) {
    return null;
  }
  if (!range) return null;

  let node = range.startContainer;
  let offset = range.startOffset || 0;
  if (node && node.nodeType === Node.ELEMENT_NODE) {
    const child = node.childNodes[offset] || node.lastChild;
    if (child && child.nodeType === Node.TEXT_NODE) {
      node = child;
      offset = 0;
    } else {
      return null;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent || '';
  if (!text) return null;
  const safeOffset = Math.min(offset, Math.max(0, text.length - 1));

  try {
    const segmenter = new Intl.Segmenter('en', { granularity: 'word' });
    const segments = Array.from(segmenter.segment(text));
    for (const seg of segments) {
      const start = seg.index;
      const end = seg.index + seg.segment.length;
      if (seg.isWordLike && safeOffset >= start && safeOffset < end) {
        return seg.segment;
      }
    }
    for (const seg of segments) {
      const start = seg.index;
      const end = seg.index + seg.segment.length;
      if (seg.isWordLike && safeOffset === end) {
        return seg.segment;
      }
    }
  } catch (e) {
    return null;
  }
  return null;
}

/**
 * Custom lightweight Markdown renderer tailored for Pāḷi Canon study and AI answers.
 * Parses headings, blockquotes, lists, bold, italics, code, and converts
 * canonical citation tags like [s0101m.mul:c0:p5] or [D-i:6:1] into interactive clickable buttons.
 * Single/double-clicking any word opens the app-wide dictionary lookup,
 * honoring the same Settings → dictLookupTrigger mode as the Reader.
 */
export default function AiMarkdown({ content, onCitationClick }) {
  const { openDictionary, clickToLookupEnabled, clickLookupMode } = useDictionary();
  const { settings } = useThemeSettings();

  const lookupWordAtPoint = useCallback((e) => {
    // 0. Ignore ghost clicks from backdrop/modal dismiss on mobile devices
    if (typeof window !== 'undefined' && window.__tipitaka_dict_just_closed) {
      if (Date.now() - window.__tipitaka_dict_just_closed < 500) {
        return;
      }
    }

    // Never hijack citation chips, links, or buttons.
    if (e.target?.closest?.('button, a, input, textarea')) return;
    // Don't hijack text selection (copy flow).
    const selection = window.getSelection()?.toString()?.trim();
    if (selection && selection.length > 1) return;

    const rawWord = extractWordAtPoint(e.clientX, e.clientY);
    if (!rawWord) return;
    const wordToLookup = cleanDictionaryQuery(rawWord);
    if (!wordToLookup || !(wordToLookup.length >= 2 || /\p{L}/u.test(wordToLookup))) return;

    try {
      const sel = window.getSelection();
      if (sel) sel.removeAllRanges();
    } catch (err) {}
    openDictionary(wordToLookup);
  }, [openDictionary]);

  const handleClick = useCallback((e) => {
    if (typeof window !== 'undefined' && window.__tipitaka_dict_just_closed) {
      if (Date.now() - window.__tipitaka_dict_just_closed < 500) {
        return;
      }
    }
    const isLookupActive = clickToLookupEnabled !== false && settings?.dictLookupTrigger !== 'off';
    const mode = (settings?.dictLookupTrigger && settings.dictLookupTrigger !== 'off')
      ? settings.dictLookupTrigger
      : (clickLookupMode || 'single');
    if (!isLookupActive || mode !== 'single') return;
    lookupWordAtPoint(e);
  }, [clickToLookupEnabled, clickLookupMode, settings?.dictLookupTrigger, lookupWordAtPoint]);

  const handleDoubleClick = useCallback((e) => {
    if (typeof window !== 'undefined' && window.__tipitaka_dict_just_closed) {
      if (Date.now() - window.__tipitaka_dict_just_closed < 500) {
        return;
      }
    }
    const isLookupActive = clickToLookupEnabled !== false && settings?.dictLookupTrigger !== 'off';
    const mode = (settings?.dictLookupTrigger && settings.dictLookupTrigger !== 'off')
      ? settings.dictLookupTrigger
      : (clickLookupMode || 'single');
    if (!isLookupActive || mode !== 'double') return;
    lookupWordAtPoint(e);
  }, [clickToLookupEnabled, clickLookupMode, settings?.dictLookupTrigger, lookupWordAtPoint]);

  if (!content) return null;

  // Split content into blocks (paragraphs, headers, lists, quotes)
  const lines = content.split('\n');
  const blocks = [];
  let currentBlock = [];
  let currentType = 'p'; // 'p' | 'quote' | 'ul' | 'ol'

  const flushBlock = () => {
    if (currentBlock.length === 0) return;
    blocks.push({
      type: currentType,
      text: currentBlock.join('\n'),
      lines: [...currentBlock],
    });
    currentBlock = [];
    currentType = 'p';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushBlock();
      continue;
    }

    // GFM table rows: consecutive lines starting with `|` containing another `|`
    if (trimmed.startsWith('|') && trimmed.slice(1).includes('|')) {
      if (currentType !== 'table') {
        flushBlock();
        currentType = 'table';
      }
      currentBlock.push(line);
      continue;
    }

    if (trimmed.startsWith('# ') || trimmed.startsWith('## ') || trimmed.startsWith('### ') || trimmed.startsWith('#### ')) {
      flushBlock();
      blocks.push({ type: 'header', text: trimmed });
      continue;
    }

    if (trimmed.startsWith('> ') || trimmed.startsWith('>')) {
      if (currentType !== 'quote') {
        flushBlock();
        currentType = 'quote';
      }
      currentBlock.push(trimmed.replace(/^>\s?/, ''));
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (currentType !== 'ul') {
        flushBlock();
        currentType = 'ul';
      }
      currentBlock.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (currentType !== 'ol') {
        flushBlock();
        currentType = 'ol';
      }
      currentBlock.push(trimmed.replace(/^\d+\.\s+/, ''));
      continue;
    }

    if (currentType !== 'p') {
      flushBlock();
    }
    currentBlock.push(line);
  }
  flushBlock();

  // ── GFM table helpers ────────────────────────────────────────────────
  // Split a table row on unescaped pipes, ignoring pipes inside `code spans`.
  const splitTableRow = (line) => {
    let t = line.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    const cells = [];
    let cur = '';
    let inCode = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '`') {
        inCode = !inCode;
        cur += ch;
      } else if (ch === '\\' && t[i + 1] === '|') {
        cur += '|';
        i++;
      } else if (ch === '|' && !inCode) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const isDelimiterRow = (cells) =>
    cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));

  // Returns { header, aligns, body } or null when the block is not a valid table.
  const parseTable = (tableLines) => {
    const rows = tableLines.map(splitTableRow);
    if (rows.length < 2 || !isDelimiterRow(rows[1])) return null;
    const colCount = Math.max(...rows.map((r) => r.length));
    const pad = (r, fill) => {
      const c = [...r];
      while (c.length < colCount) c.push(fill);
      return c.slice(0, colCount);
    };
    const aligns = pad(
      rows[1].map((c) =>
        c.startsWith(':') && c.endsWith(':') && c.length > 2
          ? 'center'
          : c.endsWith(':')
          ? 'right'
          : 'left'
      ),
      'left'
    );
    return {
      header: pad(rows[0], ''),
      aligns,
      body: rows.slice(2).map((r) => pad(r, '')),
    };
  };

  // Helper to render inline text with formatting and interactive citations
  const renderInline = (text) => {
    if (!text) return null;

    // Pattern for citation tags: [book_code:c{chap}:p{para}], [book_code:c{chap}:p{start}-{end}], [book_code:{para}], or sentence-level [book_code:c{chap}:p{para}-L{line}] / [book_code:c{chap}:p{para}:L{line}]
    const citationRegex = /\[([a-zA-Z0-9_.-]+)(?::c(\d+))?:p?(\d+)(?:[-–]L?(\d+))?(?::L?(\d+))?\]/gi;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(text)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        parts.push(text.substring(lastIndex, matchIndex));
      }

      const rawTag = match[0];
      const bookCode = match[1];
      const chapIdx = match[2] !== undefined ? parseInt(match[2], 10) : 0;
      const paraIdx = parseInt(match[3], 10);
      let paraEnd = match[4] ? parseInt(match[4], 10) : null;
      let lineId = match[5] ? parseInt(match[5], 10) : null;

      // Sentence-level citation [book:cX:pY-LZ] uses dash-L; promote to lineId
      if (/-L\d+/i.test(rawTag) && !lineId && paraEnd !== null) {
        lineId = paraEnd;
        paraEnd = null;
      }

      // Label to display on the interactive chip
      const displayLabel = lineId
        ? `${bookCode} §${paraIdx}:L${lineId}`
        : paraEnd
        ? `${bookCode} §${paraIdx}–${paraEnd}`
        : `${bookCode} §${paraIdx}`;

      parts.push(
        <button
          key={`cite_${matchIndex}_${bookCode}_${paraIdx}_${lineId || ''}_${paraEnd || ''}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onCitationClick) {
              onCitationClick({
                bookCode,
                chapterIndex: chapIdx,
                paraIndex: paraIdx,
                paraEnd,
                lineId,
                ref: rawTag,
              });
            }
          }}
          className="ai-citation-chip inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-md text-xs font-semibold font-mono bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)] hover:bg-[var(--accent-light)] hover:border-[var(--accent-border)] hover:scale-105 active:scale-95 transition cursor-pointer select-none align-baseline shadow-2xs"
          title={`Click to preview ${lineId ? `sentence line ${lineId}` : 'passage'} ${displayLabel}`}
        >
          <Quote size={11} className="text-[var(--accent)] shrink-0" />
          <span>{displayLabel}</span>
        </button>
      );

      lastIndex = match.endIndex || (matchIndex + rawTag.length);
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    // Now format bold, italics, inline code for each text part
    return parts.map((part, pIdx) => {
      if (typeof part !== 'string') return part;

      // Split by bold (**...**)
      const boldSegments = part.split(/(\*\*[^*]+\*\*)/g);
      return (
        <React.Fragment key={`p_${pIdx}`}>
          {boldSegments.map((bSeg, bIdx) => {
            if (bSeg.startsWith('**') && bSeg.endsWith('**')) {
              return (
                <strong key={`b_${bIdx}`} className="font-bold text-[var(--text-primary)]">
                  {bSeg.slice(2, -2)}
                </strong>
              );
            }

            // Split by italic (*...*)
            const italicSegments = bSeg.split(/(?<!\*)\*([^*\n]+)\*(?!\*)/g);
            return (
              <React.Fragment key={`b_sub_${bIdx}`}>
                {italicSegments.map((iSeg, iIdx) => {
                  if (iIdx % 2 === 1) {
                    return (
                      <em key={`i_${iIdx}`} className="italic text-[var(--text-primary)]">
                        {iSeg}
                      </em>
                    );
                  }

                  // Split by code (`...`)
                  const codeSegments = iSeg.split(/(`[^`]+`)/g);
                  return (
                    <React.Fragment key={`i_sub_${iIdx}`}>
                      {codeSegments.map((cSeg, cIdx) => {
                        if (cSeg.startsWith('`') && cSeg.endsWith('`')) {
                          return (
                            <code
                              key={`c_${cIdx}`}
                              className="px-1.5 py-0.5 mx-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-color)] font-mono text-xs text-amber-700 dark:text-amber-400"
                            >
                              {cSeg.slice(1, -1)}
                            </code>
                          );
                        }
                        return cSeg;
                      })}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </React.Fragment>
      );
    });
  };

  return (
    <div
      className="ai-markdown space-y-3 leading-relaxed text-[var(--text-primary)]"
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      title="Click any word for dictionary lookup"
    >
      {blocks.map((block, bIdx) => {
        if (block.type === 'header') {
          const match = block.text.match(/^(#{1,4})\s+(.+)$/);
          if (match) {
            const level = match[1].length;
            const title = match[2];
            if (level === 1) {
              return (
                <h1 key={`h_${bIdx}`} className="text-xl font-bold text-[var(--accent)] mt-4 mb-2 pb-1 border-b border-[var(--border-color)]">
                  {renderInline(title)}
                </h1>
              );
            }
            if (level === 2) {
              return (
                <h2 key={`h_${bIdx}`} className="text-base sm:text-lg font-bold text-[var(--accent)] mt-3 mb-1.5 flex items-center gap-1.5">
                  <BookOpen size={16} className="text-[var(--accent)] shrink-0" />
                  <span>{renderInline(title)}</span>
                </h2>
              );
            }
            if (level === 3) {
              return (
                <h3 key={`h_${bIdx}`} className="text-sm sm:text-base font-semibold text-[var(--text-primary)] mt-2.5 mb-1">
                  {renderInline(title)}
                </h3>
              );
            }
            return (
              <h4 key={`h_${bIdx}`} className="text-xs sm:text-sm font-semibold text-[var(--text-secondary)] mt-2 mb-1">
                {renderInline(title)}
              </h4>
            );
          }
        }

        if (block.type === 'quote') {
          return (
            <blockquote
              key={`q_${bIdx}`}
              className="my-2.5 pl-3.5 sm:pl-4 py-1.5 border-l-3 border-[var(--accent)] bg-[var(--accent-light)] rounded-r-lg text-sm sm:text-[14.5px] italic text-[var(--text-primary)]"
            >
              {block.lines.map((line, lIdx) => (
                <div key={`ql_${lIdx}`} className="leading-relaxed">
                  {renderInline(line)}
                </div>
              ))}
            </blockquote>
          );
        }

        if (block.type === 'ul') {
          return (
            <ul key={`ul_${bIdx}`} className="my-2 space-y-1.5 pl-5 list-disc text-sm sm:text-[14px]">
              {block.lines.map((item, iIdx) => (
                <li key={`uli_${iIdx}`} className="pl-1 leading-relaxed">
                  {renderInline(item)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ol') {
          return (
            <ol key={`ol_${bIdx}`} className="my-2 space-y-1.5 pl-5 list-decimal text-sm sm:text-[14px]">
              {block.lines.map((item, iIdx) => (
                <li key={`oli_${iIdx}`} className="pl-1 leading-relaxed">
                  {renderInline(item)}
                </li>
              ))}
            </ol>
          );
        }

        if (block.type === 'table') {
          const table = parseTable(block.lines);
          if (!table) {
            // Not a valid table (e.g. missing delimiter row) — render as paragraph.
            return (
              <p key={`p_${bIdx}`} className="text-sm sm:text-[14.5px] leading-relaxed text-[var(--text-primary)]">
                {renderInline(block.text)}
              </p>
            );
          }
          return (
            <div
              key={`tbl_${bIdx}`}
              className="my-3 overflow-x-auto rounded-xl border border-[var(--border-color)] shadow-2xs"
            >
              <table className="w-full border-collapse text-xs sm:text-[13px] leading-relaxed min-w-[520px]">
                <thead>
                  <tr className="bg-[var(--accent-light)]">
                    {table.header.map((cell, cIdx) => (
                      <th
                        key={`th_${cIdx}`}
                        style={{ textAlign: table.aligns[cIdx] || 'left' }}
                        className="px-3 py-2 font-bold text-[var(--text-primary)] border-b border-[var(--border-color)] whitespace-normal align-top"
                      >
                        {renderInline(cell)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.body.map((row, rIdx) => (
                    <tr
                      key={`tr_${rIdx}`}
                      className={
                        rIdx % 2 === 1
                          ? 'bg-[var(--bg-secondary)]/60'
                          : 'bg-[var(--bg-card)]'
                      }
                    >
                      {row.map((cell, cIdx) => (
                        <td
                          key={`td_${rIdx}_${cIdx}`}
                          style={{ textAlign: table.aligns[cIdx] || 'left' }}
                          className="px-3 py-2 text-[var(--text-primary)] border-t border-[var(--border-color)]/60 whitespace-normal align-top"
                        >
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        // Paragraph
        return (
          <p key={`p_${bIdx}`} className="text-sm sm:text-[14.5px] leading-relaxed text-[var(--text-primary)]">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
