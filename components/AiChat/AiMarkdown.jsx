'use client';

import React from 'react';
import { Quote, BookOpen } from 'lucide-react';

/**
 * Custom lightweight Markdown renderer tailored for Pāḷi Canon study and AI answers.
 * Parses headings, blockquotes, lists, bold, italics, code, and converts
 * canonical citation tags like [s0101m.mul:c0:p5] or [D-i:6:1] into interactive clickable buttons.
 */
export default function AiMarkdown({ content, onCitationClick }) {
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

  // Helper to render inline text with formatting and interactive citations
  const renderInline = (text) => {
    if (!text) return null;

    // Pattern for citation tags: [book_code:c{chap}:p{para}], [book_code:c{chap}:p{start}-{end}], or [book_code:{para}]
    const citationRegex = /\[([a-zA-Z0-9_.-]+)(?::c(\d+))?:p?(\d+)(?:[-–](\d+))?(?::(\d+))?\]/g;
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
      const paraEnd = match[4] ? parseInt(match[4], 10) : null;
      const lineId = match[5] ? parseInt(match[5], 10) : null;

      // Label to display on the interactive chip
      const displayLabel = paraEnd ? `${bookCode} §${paraIdx}–${paraEnd}` : `${bookCode} §${paraIdx}`;

      parts.push(
        <button
          key={`cite_${matchIndex}_${bookCode}_${paraIdx}_${paraEnd || ''}`}
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
          className="ai-citation-chip inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-md text-xs font-semibold font-mono bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/25 hover:bg-violet-500/20 hover:border-violet-500/50 hover:scale-105 active:scale-95 transition cursor-pointer select-none align-baseline shadow-2xs"
          title={`Click to preview passage ${displayLabel}`}
        >
          <Quote size={11} className="text-violet-500 shrink-0" />
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
    <div className="ai-markdown space-y-3 leading-relaxed text-[var(--text-primary)]">
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
                  <BookOpen size={16} className="text-violet-500 shrink-0" />
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
              className="my-2.5 pl-3.5 sm:pl-4 py-1.5 border-l-3 border-violet-500 bg-violet-500/5 dark:bg-violet-500/10 rounded-r-lg text-sm sm:text-[14.5px] italic text-[var(--text-primary)]"
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
