'use client';

import React, { useEffect, useState } from 'react';
import { X, BookOpen, Layers, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../services/transliterate';
import { fetchMatJump } from '../services/api';


export default function MatJumpModal({ isOpen, onClose }) {
  const { activeTab, activeParaNum, jumpToMat } = useTabs();
  const { settings } = useThemeSettings();

  const [apiMatData, setApiMatData] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const mat = activeTab?.mat;
  const currentCategory = (activeTab?.category || '').toLowerCase();
  const currentCode = activeTab?.bookCode || '';

  const isCurrentMula = currentCategory.includes('mūla') || currentCode.endsWith('.mul');
  const isCurrentAttha = currentCategory.includes('aṭṭhakathā') || currentCode.endsWith('.att');
  const isCurrentTika = currentCategory.includes('ṭīkā') || currentCode.endsWith('.tik');

  const baseCode = currentCode.split('.')[0] || '';
  const prefix = (baseCode.length > 2 && 'matn'.includes(baseCode.slice(-2, -1)))
    ? baseCode.slice(0, -2)
    : (baseCode.length > 1 && 'matn'.includes(baseCode.slice(-1)))
    ? baseCode.slice(0, -1)
    : baseCode;

  let cIdx = activeTab?.currentChapterIdx !== undefined && activeTab?.currentChapterIdx !== null ? activeTab.currentChapterIdx : 0;
  if (typeof window !== 'undefined') {
    const m = window.location.pathname.match(/\/book\/[^/]+\/(\d+)/i);
    if (m) cIdx = Math.max(0, parseInt(m[1], 10) - 1);
  }

  let activeSubKey = activeTab?.chapter_to_sub_book?.[cIdx] || activeTab?.chapter_to_sub_book?.[String(cIdx)];
  if (!activeSubKey && activeTab?.sub_books) {
    for (const [k, v] of Object.entries(activeTab.sub_books)) {
      const cr = v.chapter_range || v.tika_chapter_range;
      if (cr && cIdx >= cr[0] && cIdx <= cr[1]) {
        activeSubKey = k;
        break;
      }
    }
  }

  let activePNum = activeParaNum;
  if (!activePNum && typeof window !== 'undefined' && window.location.hash) {
    const hashMatch = window.location.hash.match(/^(?:#para-?|#p)?(\d+(?:-\d+)?)/i);
    if (hashMatch) activePNum = hashMatch[1];
  }

  const cleanPStr = String(activePNum || '').replace(/^(?:para-?|p)/i, '').trim();
  const currentP = parseInt(cleanPStr, 10);
  let validCurrentP = currentP;

  if (!isNaN(currentP) && cleanPStr) {
    let pChap = undefined;
    if (activeSubKey && activeTab?.sub_books_para_to_chapter?.[activeSubKey]) {
      pChap = activeTab.sub_books_para_to_chapter[activeSubKey][cleanPStr];
    } else if (activeTab?.para_to_chapter) {
      pChap = activeTab.para_to_chapter[cleanPStr];
    }

    if (pChap !== undefined && pChap !== cIdx) {
      const hasExplicitHash = typeof window !== 'undefined' && window.location.hash && window.location.hash.includes(cleanPStr);
      if (hasExplicitHash && !activeSubKey) {
        cIdx = pChap;
      } else if (pChap === undefined) {
        validCurrentP = NaN;
      }
    }
  }

  useEffect(() => {
    if (!isOpen || !currentCode) return;
    let isMounted = true;
    fetchMatJump(currentCode, cleanPStr, cIdx).then((data) => {
      if (isMounted && data) {
        setApiMatData(data);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [isOpen, currentCode, cleanPStr, cIdx]);

  if (!isOpen || !activeTab) return null;
  const currentSubInfo = activeSubKey && activeTab?.sub_books ? activeTab.sub_books[activeSubKey] : null;

  // 1. High-Priority Precomputed Canon Mapping (from tipitaka.db or Tab Metadata)
  const precomputedParaMat = (!isNaN(validCurrentP) && cleanPStr)
    ? (activeSubKey && activeTab?.sub_books_para_to_mat?.[activeSubKey]?.[cleanPStr]) || activeTab?.para_to_mat?.[cleanPStr]
    : null;
  const precomputedChapMat = activeTab?.chapter_to_mat?.[cIdx] || activeTab?.chapter_to_mat?.[String(cIdx)];
  const precomputedMat = apiMatData || precomputedParaMat || precomputedChapMat;

  // Split targets resolution (e.g. s0508, s0513, s0514, vin01)
  const splitTargets = activeTab?.split_targets || mat?.split_targets;

  const resolveSplitTarget = (layer) => {
    if (!splitTargets?.[layer] || !Array.isArray(splitTargets[layer])) return null;

    for (const rule of splitTargets[layer]) {
      const inChap = rule.chapter_range && cIdx >= rule.chapter_range[0] && cIdx <= rule.chapter_range[1];
      let inPara = true;
      if (rule.para_range) {
        inPara = !isNaN(validCurrentP) && validCurrentP >= rule.para_range[0] && validCurrentP <= rule.para_range[1];
      }
      if (inChap && inPara) return rule;
    }
    return null;
  };

  const splitMula = resolveSplitTarget('mula');
  const splitAttha = resolveSplitTarget('attha');
  const splitTika = resolveSplitTarget('tika');

  const resolvedMulaCode = precomputedMat?.mula?.book || splitMula?.code || currentSubInfo?.mula_code || mat?.mula_code || (isCurrentMula ? currentCode : null);
  const resolvedMulaTitle = precomputedMat?.mula?.title || splitMula?.title || currentSubInfo?.mula_title || mat?.mula_title || (isCurrentMula ? activeTab?.title : 'Mūlapāḷi');

  const resolvedAtthaCode = precomputedMat?.attha?.book || splitAttha?.code || currentSubInfo?.attha_code || mat?.attha_code || (isCurrentAttha ? currentCode : null);
  const resolvedAtthaTitle = precomputedMat?.attha?.title || splitAttha?.title || currentSubInfo?.attha_title || mat?.attha_title || (isCurrentAttha ? activeTab?.title : 'Aṭṭhakathā');

  const resolvedTikaCode = precomputedMat?.tika?.book || splitTika?.code || currentSubInfo?.tika_code || mat?.tika_code || (isCurrentTika ? currentCode : null);
  const resolvedTikaTitle = precomputedMat?.tika?.title || splitTika?.title || currentSubInfo?.tika_title || mat?.tika_title || (isCurrentTika ? activeTab?.title : 'Ṭīkā');

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
      code: resolvedAtthaCode,
      title: resolvedAtthaTitle,
      isCurrent: isCurrentAttha || currentCode === resolvedAtthaCode,
      available: Boolean(resolvedAtthaCode),
      badgeColor: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
    },
    {
      layer: 'tika',
      label: 'Ṭīkā',
      desc: 'Sub-commentary (Ṭīkā / Anuṭīkā)',
      code: resolvedTikaCode,
      title: resolvedTikaTitle,
      isCurrent: isCurrentTika || currentCode === resolvedTikaCode,
      available: Boolean(resolvedTikaCode),
      badgeColor: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25',
    },
  ];


  // Simplify Jump list by showing only other connected layers
  const jumpTargets = connectedBooks.filter((item) => !item.isCurrent);

  const handleJump = (item) => {
    let targetChapter = undefined;
    let targetPara = undefined;

    const preTarget = precomputedMat?.[item.layer];
    if (preTarget) {
      targetChapter = preTarget.chapter;
      targetPara = preTarget.para;
    } else {
      const splitRule = resolveSplitTarget(item.layer);
      if (splitRule) {
        if (splitRule.target_chapter !== undefined) {
          targetChapter = splitRule.target_chapter;
        } else if (splitRule.target_chapter_offset !== undefined) {
          targetChapter = Math.max(0, cIdx + splitRule.target_chapter_offset);
        }
      }
    }

    const finalTargetCode = preTarget?.book || item.code;
    const finalTargetTitle = preTarget?.title || item.title;

    jumpToMat(item.layer, {
      title: finalTargetTitle,
      code: finalTargetCode,
      chapter: targetChapter,
      targetChapterIdx: targetChapter,
      targetParaNum: targetPara,
      subBook: activeTab?.sub_book || activeSubKey || undefined,
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
                      {(() => {
                        const pTarget = precomputedMat?.[item.layer];
                        const displayP = pTarget ? pTarget.para : (precomputedMat ? null : activeParaNum);
                        if (displayP) {
                          return <span className="font-mono font-normal opacity-80 text-[10px]">p.{displayP}</span>;
                        }
                        if (activeParaNum || cleanPStr) {
                          return <span className="font-sans text-[10px] opacity-75">(Chapter)</span>;
                        }
                        return null;
                      })()}
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
