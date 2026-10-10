'use client';

import React, { useEffect, useState } from 'react';
import { X, Book, Layers, ArrowUpRight, CheckCircle2, ExternalLink } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../services/transliterate';
import { fetchMatJump } from '../services/api';


export default function MatJumpModal({ isOpen, onClose }) {
  const { activeTab, activeParaNum, jumpToMat } = useTabs();
  const { settings, updateSetting } = useThemeSettings();

  const [apiMatByPara, setApiMatByPara] = useState({});
  const [visibleParas, setVisibleParas] = useState([]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Collect every paragraph currently visible in the reader viewport,
  // so jumps can be offered for all of them — not just the topmost one.
  useEffect(() => {
    if (!isOpen) return;
    let paras = [];
    if (typeof document !== 'undefined') {
      const container = document.querySelector('main.content-area') || document.querySelector('.content-area') || document.querySelector('main');
      if (container) {
        const cRect = container.getBoundingClientRect();
        const seen = new Set();
        container.querySelectorAll('[data-para]').forEach((el) => {
          let r;
          try {
            r = el.getBoundingClientRect();
          } catch (_) {
            return;
          }
          if (r.bottom > cRect.top && r.top < cRect.bottom) {
            const v = el.getAttribute('data-para');
            if (v && !seen.has(v)) {
              seen.add(v);
              paras.push(v);
            }
          }
        });
      }
    }
    paras = paras.slice(0, 20);
    setVisibleParas(paras);
  }, [isOpen, activeTab?.bookCode, activeParaNum]);

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
  if (activeParaNum && activeTab?.para_to_chapter?.[String(activeParaNum).replace(/^(?:para-?|p)/i, '').trim()] !== undefined) {
    cIdx = activeTab.para_to_chapter[String(activeParaNum).replace(/^(?:para-?|p)/i, '').trim()];
  } else if (typeof window !== 'undefined') {
    const m = window.location.pathname.match(/\/book\/[^/]+\/(\d+)/i);
    if (m) cIdx = Math.max(0, parseInt(m[1], 10) - 1);
  }

  const findSubKey = (idx) => {
    let k = activeTab?.chapter_to_sub_book?.[idx] || activeTab?.chapter_to_sub_book?.[String(idx)];
    if (!k && activeTab?.sub_books) {
      for (const [sk, v] of Object.entries(activeTab.sub_books)) {
        const cr = v.chapter_range || v.tika_chapter_range;
        if (cr && idx >= cr[0] && idx <= cr[1]) {
          k = sk;
          break;
        }
      }
    }
    return k;
  };
  const baseSubKey = findSubKey(cIdx);
  const splitTargets = activeTab?.split_targets || mat?.split_targets;

  const cleanOf = (p) => String(p || '').replace(/^(?:para-?|p)/i, '').trim();

  // Resolve chapter + sub-book context for one paragraph number.
  // On-screen paragraphs follow their own mapped chapter; the fallback
  // paragraph keeps the previous deep-link behaviour.
  const resolveParaCtx = (paraStr, fromScreen) => {
    const clean = cleanOf(paraStr);
    const validP = parseInt(clean, 10);
    let chap;
    let subKey;
    if (clean) {
      if (baseSubKey && activeTab?.sub_books_para_to_chapter?.[baseSubKey]?.[clean] !== undefined) {
        chap = activeTab.sub_books_para_to_chapter[baseSubKey][clean];
        subKey = baseSubKey;
      } else if (activeTab?.para_to_chapter?.[clean] !== undefined) {
        chap = activeTab.para_to_chapter[clean];
      } else if (activeTab?.sub_books_para_to_chapter) {
        for (const [sk, m] of Object.entries(activeTab.sub_books_para_to_chapter)) {
          if (m && m[clean] !== undefined) {
            chap = m[clean];
            subKey = sk;
            break;
          }
        }
      }
    }
    if (chap === undefined) {
      chap = cIdx;
    }
    subKey = subKey || findSubKey(chap);
    return { raw: paraStr, clean, validP, chap, subKey };
  };

  // Paragraphs to offer jumps for: everything on screen, else the current/hash fallback.
  const SECTION_CAP = 8;
  let fallbackPNum = activeParaNum;
  if (!fallbackPNum && typeof window !== 'undefined' && window.location.hash) {
    const hashMatch = window.location.hash.match(/^(?:#para-?|#p)?(\d+(?:-\d+)?)/i);
    if (hashMatch) fallbackPNum = hashMatch[1];
  }
  const allSectionParas = visibleParas.length ? visibleParas : (fallbackPNum ? [String(fallbackPNum)] : []);
  const sectionParas = allSectionParas.slice(0, SECTION_CAP);
  const extraParaCount = allSectionParas.length - sectionParas.length;
  const sectionKey = sectionParas.join('|');

  // Match data per paragraph (keyed by book + para so books never collide).
  useEffect(() => {
    if (!isOpen || !currentCode) return;
    const needed = [];
    const seen = new Set();
    sectionParas.forEach((p) => {
      const clean = cleanOf(p);
      const key = `${currentCode}::${clean}`;
      if (clean && !seen.has(key) && apiMatByPara[key] === undefined) {
        seen.add(key);
        needed.push(p);
      }
    });
    if (!needed.length) return;
    let isMounted = true;
    needed.forEach((p) => {
      const ctx = resolveParaCtx(p, true);
      const key = `${currentCode}::${ctx.clean}`;
      fetchMatJump(currentCode, ctx.clean, ctx.chap).then((data) => {
        if (isMounted && data) {
          setApiMatByPara((prev) => (prev[key] !== undefined ? prev : { ...prev, [key]: data }));
        }
      });
    });
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentCode, sectionKey]);

  if (!isOpen || !activeTab) return null;

  // Full jump-target resolution for ONE paragraph: connected books,
  // match info and jump action, all scoped to that paragraph's context.
  const resolveTargetsFor = (ctx) => {
    const { clean, validP, chap, subKey } = ctx;
    const mapKey = `${currentCode}::${clean}`;
    const apiData = (clean && apiMatByPara[mapKey]) || null;
    const subInfo = subKey && activeTab?.sub_books ? activeTab.sub_books[subKey] : null;

    // 1. High-Priority Precomputed Canon Mapping (from tipitaka.db or Tab Metadata)
    const paraMat = (!isNaN(validP) && clean)
      ? (subKey && activeTab?.sub_books_para_to_mat?.[subKey]?.[clean]) || activeTab?.para_to_mat?.[clean]
      : null;
    const chapMat = activeTab?.chapter_to_mat?.[chap] || activeTab?.chapter_to_mat?.[String(chap)];
    const preMat = apiData || paraMat || chapMat;

    // Split targets resolution (e.g. s0508, s0513, s0514, vin01)
    const splitFor = (layer) => {
      const rules = splitTargets?.[layer];
      if (!Array.isArray(rules)) return null;
      for (const rule of rules) {
        const inChap = rule.chapter_range && chap >= rule.chapter_range[0] && chap <= rule.chapter_range[1];
        let inPara = true;
        if (rule.para_range) {
          inPara = !isNaN(validP) && validP >= rule.para_range[0] && validP <= rule.para_range[1];
        }
        if (inChap && inPara) return rule;
      }
      return null;
    };
    const splitM = splitFor('mula');
    const splitA = splitFor('attha');
    const splitT = splitFor('tika');

    const layerCurrent = { mula: isCurrentMula, attha: isCurrentAttha, tika: isCurrentTika };
    const badgeByLayer = { mula: 'tree-tag-mula', attha: 'tree-tag-attha', tika: 'tree-tag-tika' };
    const textByLayer = { mula: 'tree-icon-mula', attha: 'tree-icon-attha', tika: 'tree-icon-tika' };
    const defs = [
      {
        layer: 'mula',
        label: 'Mūla',
        code: preMat?.mula?.book || splitM?.code || subInfo?.mula_code || mat?.mula_code || (isCurrentMula ? currentCode : null),
        title: preMat?.mula?.title || splitM?.title || subInfo?.mula_title || mat?.mula_title || (isCurrentMula ? activeTab?.title : 'Mūlapāḷi'),
      },
      {
        layer: 'attha',
        label: 'Aṭṭhakathā',
        code: preMat?.attha?.book || splitA?.code || subInfo?.attha_code || mat?.attha_code || (isCurrentAttha ? currentCode : null),
        title: preMat?.attha?.title || splitA?.title || subInfo?.attha_title || mat?.attha_title || (isCurrentAttha ? activeTab?.title : 'Aṭṭhakathā'),
      },
      {
        layer: 'tika',
        label: 'Ṭīkā',
        code: preMat?.tika?.book || splitT?.code || subInfo?.tika_code || mat?.tika_code || (isCurrentTika ? currentCode : null),
        title: preMat?.tika?.title || splitT?.title || subInfo?.tika_title || mat?.tika_title || (isCurrentTika ? activeTab?.title : 'Ṭīkā'),
      },
    ];

    return defs
      .map((d) => ({
        ...d,
        isCurrent: layerCurrent[d.layer] || currentCode === d.code,
        available: Boolean(d.code),
        badgeColor: badgeByLayer[d.layer],
        textColor: textByLayer[d.layer],
      }))
      .filter((item) => !item.isCurrent)
      .map((item) => {
        const pTarget = preMat?.[item.layer];
        const targetChapter = pTarget?.chapter !== undefined ? pTarget.chapter : undefined;
        const targetPara = pTarget?.para || null;
        const matchQuality = apiData?.match_quality;
        let info;
        if (!clean) {
          info = { isExact: false, isClosest: false, isChapterOnly: true, targetPara: null, targetChapter };
        } else {
          const isExact = Boolean(targetPara && String(targetPara) === clean && (!matchQuality || matchQuality === 'exact'));
          const isClosest = Boolean(
            (targetPara && String(targetPara) !== clean) ||
            (targetPara && matchQuality === 'closest') ||
            (targetPara && matchQuality === 'span')
          );
          info = { isExact, isClosest, isChapterOnly: !targetPara, targetPara, targetChapter, matchQuality };
        }

        const getFinalChapter = () => {
          let finalChapter = info.targetChapter;
          if (finalChapter === undefined) {
            if (pTarget?.chapter !== undefined) {
              finalChapter = pTarget.chapter;
            } else {
              const rule = splitFor(item.layer);
              if (rule) {
                if (rule.target_chapter !== undefined) {
                  finalChapter = rule.target_chapter;
                } else if (rule.target_chapter_offset !== undefined) {
                  finalChapter = Math.max(0, chap + rule.target_chapter_offset);
                }
              }
            }
          }
          return finalChapter;
        };

        const getTargetUrl = () => {
          const finalChapter = getFinalChapter();
          const targetCode = pTarget?.book || item.code;
          const chNum = (finalChapter !== undefined ? finalChapter : 0) + 1;
          const p = info.targetPara || clean;
          return `/book/${targetCode}/${chNum}${p ? `#para${p}` : ''}`;
        };

        const openInNewWindow = (e) => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          const url = getTargetUrl();
          if (typeof window !== 'undefined') {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
          onClose();
        };

        const jump = (e) => {
          if (e && (e.ctrlKey || e.metaKey || e.button === 1 || settings?.openMatInNewWindow)) {
            openInNewWindow(e);
            return;
          }
          const finalChapter = getFinalChapter();
          jumpToMat(item.layer, {
            title: pTarget?.title || item.title,
            code: pTarget?.book || item.code,
            chapter: finalChapter,
            targetChapterIdx: finalChapter,
            targetParaNum: info.targetPara || clean || undefined,
            subBook: activeTab?.sub_book || subKey || undefined,
          });
          onClose();
        };

        return { ...item, info, jump, openInNewWindow, getTargetUrl, srcPara: clean };
      });
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
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                Mūla · Aṭṭhakathā · Ṭīkā Jumps
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer select-none px-2 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] transition"
              title="Open MAT jumps in a new browser window/tab (ideal for dual monitors / PC)"
            >
              <input
                type="checkbox"
                checked={!!settings?.openMatInNewWindow}
                onChange={(e) => updateSetting && updateSetting('openMatInNewWindow', e.target.checked)}
                className="accent-[var(--accent)] w-3.5 h-3.5 rounded cursor-pointer"
              />
              <span className="hidden min-[420px]:inline font-medium">New window</span>
            </label>
            <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[9px] text-[var(--text-muted)]">
              Esc
            </kbd>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Current Context Info */}
        <div className="px-4 py-2.5 bg-[var(--bg-card)] border-b border-[var(--border-color)] flex items-center justify-between gap-2 text-xs">
          <div className="truncate flex items-center gap-1.5 min-w-0">
            <span className="text-[var(--text-muted)] shrink-0">Current Position:</span>
            <span className="mat-pali-title font-semibold text-[var(--text-primary)] truncate max-w-[160px]">
              {convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript)}
            </span>
          </div>
          {sectionParas.length > 0 && (
            <span className="font-mono font-bold px-2 py-0.5 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)] shrink-0">
              {sectionParas.length > 1
                ? `Paras ${cleanOf(sectionParas[0])}–${cleanOf(sectionParas[sectionParas.length - 1])}`
                : `Para ${cleanOf(sectionParas[0])}`}
            </span>
          )}
        </div>

        {/* Connected Books List — one jump-button group per on-screen paragraph */}
        <div className="p-2.5 sm:p-3 space-y-3 overflow-y-auto">
          {sectionParas.length === 0 ? (
            <div className="py-6 text-center text-xs text-[var(--text-muted)]">
              No paragraph position found.
            </div>
          ) : (
            sectionParas.map((paraStr) => {
              const targets = resolveTargetsFor(resolveParaCtx(paraStr, true));
              if (!targets.length) return null;
              return (
                <div key={paraStr}>
                  <div className="px-0.5 pb-1">
                    <span className="font-mono font-bold text-[11px] px-2 py-0.5 rounded-md bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent-border)]">
                      p.{cleanOf(paraStr)}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {targets.map((item) => {
                      const matchInfo = item.info;
                      return (
                <div
                  key={item.layer}
                  onClick={(e) => item.available && item.jump(e)}
                  onAuxClick={(e) => {
                    if (e.button === 1 && item.available) {
                      e.preventDefault();
                      item.openInNewWindow(e);
                    }
                  }}
                  className={`px-2.5 py-2 rounded-lg border transition flex items-center justify-between gap-2 select-none ${
                    item.available
                      ? 'border-[var(--border-color)] bg-[var(--bg-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-card)] cursor-pointer group'
                      : 'border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/40 opacity-45 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                        item.isCurrent
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                          : item.badgeColor
                      }`}
                    >
                      <Book size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`mat-pali-title font-bold text-xs sm:text-sm truncate ${item.textColor}`}>
                          {convertPaliScript(capitalizePali(item.title), settings?.paliScript)}
                        </span>
                        <span
                          className={`text-[9.5px] px-1.5 py-0.2 rounded font-semibold border ${item.badgeColor}`}
                        >
                          {item.label}
                        </span>
                      </div>
                      {/* Mention match quality: only show when not an exact match */}
                      {matchInfo && !matchInfo.isExact && (matchInfo.isClosest || (matchInfo.isChapterOnly && item.srcPara)) && (
                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                          {matchInfo.isClosest ? (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium border border-amber-500/30 flex items-center gap-1">
                              <span>Closest match: <strong>para {matchInfo.targetPara}</strong></span>
                              <span className="opacity-75">(no exact match for p.{item.srcPara})</span>
                            </span>
                          ) : matchInfo.isChapterOnly && item.srcPara ? (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 font-medium border border-sky-500/30">
                              Closest section: Chapter {matchInfo.targetChapter !== undefined ? matchInfo.targetChapter + 1 : 1} (no exact para)
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Button / Badge */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    {item.isCurrent ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1 rounded-lg border border-[var(--accent)]/20">
                        <CheckCircle2 size={13} />
                        Reading
                      </span>
                    ) : item.available ? (
                      <>
                        <a
                          href={item.getTargetUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                          }}
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 border border-[var(--border-color)] hover:border-[var(--accent)]/30 transition cursor-pointer inline-flex items-center justify-center"
                          title="Open in new window / tab (Ctrl+Click)"
                        >
                          <ExternalLink size={13} />
                        </a>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            item.jump(e);
                          }}
                          className="flex items-center gap-1 text-[11px] font-semibold text-[var(--text-primary)] group-hover:text-white group-hover:bg-[var(--accent)] px-2.5 py-1 rounded-lg border border-[var(--border-color)] group-hover:border-[var(--accent)] transition cursor-pointer"
                        >
                          <span>Jump</span>
                          {matchInfo?.isExact ? (
                            <span className="font-mono font-normal opacity-80 text-[10px]">p.{matchInfo.targetPara}</span>
                          ) : matchInfo?.isClosest ? (
                            <span className="font-mono font-normal opacity-80 text-[10px]">closest p.{matchInfo.targetPara}</span>
                          ) : (
                            <span className="font-sans text-[10px] opacity-75">
                              closest (Ch {(matchInfo?.targetChapter ?? 0) + 1})
                            </span>
                          )}
                          <ArrowUpRight size={12} />
                        </button>
                      </>
                    ) : (
                      <span className="text-[10.5px] text-[var(--text-muted)] px-2 py-1">
                        Unavailable
                      </span>
                    )}
                  </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
          {extraParaCount > 0 && (
            <div className="text-center text-[11px] text-[var(--text-muted)]">
              +{extraParaCount} more on screen — scroll the reader to narrow it down
            </div>
          )}
        </div>


      </div>
    </div>
  );
}
