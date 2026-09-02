'use client';

import React, { useEffect } from 'react';
import { X, BookOpen, Layers, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../services/transliterate';


export default function MatJumpModal({ isOpen, onClose }) {
  const { activeTab, activeParaNum, jumpToMat } = useTabs();
  const { settings } = useThemeSettings();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !activeTab) return null;

  const mat = activeTab.mat;
  const currentCategory = (activeTab.category || '').toLowerCase();
  const currentCode = activeTab.bookCode || '';

  const isCurrentMula = currentCategory.includes('mūla') || currentCode.endsWith('.mul');
  const isCurrentAttha = currentCategory.includes('aṭṭhakathā') || currentCode.endsWith('.att');
  const isCurrentTika = currentCategory.includes('ṭīkā') || currentCode.endsWith('.tik');

  const baseCode = currentCode.split('.')[0] || '';
  const prefix = (baseCode.length > 2 && 'matn'.includes(baseCode.slice(-2, -1)))
    ? baseCode.slice(0, -2)
    : (baseCode.length > 1 && 'matn'.includes(baseCode.slice(-1)))
    ? baseCode.slice(0, -1)
    : baseCode;

  let activeSubKey = activeTab?.chapter_to_sub_book?.[activeTab?.currentChapterIdx || 0];
  if (!activeSubKey && activeTab?.sub_books) {
    const cIdx = activeTab?.currentChapterIdx || 0;
    for (const [k, v] of Object.entries(activeTab.sub_books)) {
      const cr = v.chapter_range || v.tika_chapter_range;
      if (cr && cIdx >= cr[0] && cIdx <= cr[1]) {
        activeSubKey = k;
        break;
      }
    }
  }
  const currentSubInfo = activeSubKey && activeTab?.sub_books ? activeTab.sub_books[activeSubKey] : null;

  const resolvedMulaCode = currentSubInfo?.mula_code || mat?.mula_code || (isCurrentMula ? currentCode : null);
  const resolvedMulaTitle = currentSubInfo?.mula_title || mat?.mula_title || (isCurrentMula ? activeTab?.title : 'Mūlapāḷi');

  const connectedBooks = [
    {
      layer: 'mula',
      label: 'Mūla',
      desc: 'Pāḷi Canon (Root Text)',
      code: resolvedMulaCode,
      title: resolvedMulaTitle,
      isCurrent: isCurrentMula || currentCode === resolvedMulaCode,
      available: Boolean(resolvedMulaCode),
      badgeColor: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    },
    {
      layer: 'attha',
      label: 'Aṭṭhakathā',
      desc: 'Commentary (Aṭṭhakathā)',
      code: currentSubInfo?.attha_code || mat?.attha_code || (isCurrentAttha ? currentCode : null),
      title: currentSubInfo?.attha_title || mat?.attha_title || (isCurrentAttha ? activeTab?.title : 'Aṭṭhakathā'),
      isCurrent: isCurrentAttha || currentCode === (currentSubInfo?.attha_code || mat?.attha_code),
      available: Boolean(currentSubInfo?.attha_code || mat?.attha_code),
      badgeColor: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
    },
    {
      layer: 'tika',
      label: 'Ṭīkā',
      desc: 'Sub-commentary (Ṭīkā / Anuṭīkā)',
      code: currentSubInfo?.tika_code || mat?.tika_code || (isCurrentTika ? currentCode : null),
      title: currentSubInfo?.tika_title || mat?.tika_title || (isCurrentTika ? activeTab.title : 'Ṭīkā'),
      isCurrent: isCurrentTika || currentCode === (currentSubInfo?.tika_code || mat?.tika_code),
      available: Boolean(currentSubInfo?.tika_code || mat?.tika_code),
      badgeColor: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25',
    },
  ];


  // Simplify Jump list by showing only other connected layers
  const jumpTargets = connectedBooks.filter((item) => !item.isCurrent);

  const handleJump = (item) => {
    jumpToMat(item.layer, {
      title: item.title,
      code: item.code,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
              <Layers size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[var(--text-primary)]">
                MAT Connected Books
              </h3>
              <p className="text-[11px] text-[var(--text-muted)]">
                Jump to connected Commentary or Sub-commentary
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Current Context Info */}
        <div className="px-4 py-2.5 bg-[var(--bg-card)] border-b border-[var(--border-color)] flex items-center justify-between text-xs">
          <div className="truncate flex items-center gap-1.5">
            <span className="text-[var(--text-muted)]">Current Position:</span>
            <span className="mat-pali-title font-semibold text-[var(--text-primary)] truncate max-w-[220px]">
              {convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript)}
            </span>
          </div>
          {activeParaNum && (
            <span className="font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)] shrink-0">
              Para {activeParaNum}
            </span>
          )}
        </div>

        {/* Connected Books List */}
        <div className="p-3 sm:p-4 space-y-2.5 overflow-y-auto">
          {jumpTargets.length === 0 ? (
            <div className="py-6 text-center text-xs text-[var(--text-muted)]">
              No other connected MAT books found.
            </div>
          ) : (
            jumpTargets.map((item) => (
              <div
                key={item.layer}
                onClick={() => item.available && handleJump(item)}
                className={`p-3 rounded-xl border transition flex items-center justify-between gap-3 select-none ${
                  item.available
                    ? 'border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-card)] cursor-pointer group'
                    : 'border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/40 opacity-45 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                      item.isCurrent
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : item.badgeColor
                    }`}
                  >
                    <BookOpen size={16} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="mat-pali-title font-bold text-xs sm:text-sm text-[var(--text-primary)] truncate">
                        {convertPaliScript(capitalizePali(item.title), settings?.paliScript)}
                      </span>
                      <span
                        className={`text-[9.5px] px-1.5 py-0.2 rounded font-semibold border ${item.badgeColor}`}
                      >
                        {item.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                      {item.code} • {item.desc}
                    </p>
                  </div>
                </div>

                {/* Action Button / Badge */}
                <div className="shrink-0">
                  {item.isCurrent ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1 rounded-lg border border-[var(--accent)]/20">
                      <CheckCircle2 size={13} />
                      Reading
                    </span>
                  ) : item.available ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleJump(item);
                      }}
                      className="flex items-center gap-1 text-[11px] font-semibold text-[var(--text-primary)] group-hover:text-white group-hover:bg-[var(--accent)] px-2.5 py-1 rounded-lg border border-[var(--border-color)] group-hover:border-[var(--accent)] transition cursor-pointer"
                    >
                      <span>Jump</span>
                      {activeParaNum && <span className="font-mono font-normal opacity-80 text-[10px]">p.{activeParaNum}</span>}
                      <ArrowUpRight size={12} />
                    </button>
                  ) : (
                    <span className="text-[10.5px] text-[var(--text-muted)] px-2 py-1">
                      Unavailable
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>


        {/* Footer info tip */}
        <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] text-[11px] text-[var(--text-muted)] flex items-center justify-between">
          <span>Target paragraph will be highlighted with a smooth pulse.</span>
          <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[9px]">
            Esc
          </kbd>
        </div>
      </div>
    </div>
  );
}
