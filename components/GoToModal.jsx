'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Navigation, Hash, BookOpen, CornerDownLeft, AlertCircle } from 'lucide-react';
import { useTabs } from '../context/TabContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../services/transliterate';
import { fetchBookTocOnly } from '../services/api';

const EDITION_ORDER = ['M', 'V', 'P', 'T', 'O'];

export function extractEditionVolumes(pageToChapterEd) {
  if (!pageToChapterEd || typeof pageToChapterEd !== 'object') return [];
  const byVol = new Map();
  for (const key of Object.keys(pageToChapterEd)) {
    if (!key.includes('.')) continue;
    const [volStr, pageStr] = key.split('.');
    const vol = parseInt(volStr, 10);
    const num = parseInt(pageStr, 10);
    if (Number.isNaN(vol) || Number.isNaN(num) || vol < 0) continue;
    const prev = byVol.get(vol);
    if (!prev) {
      byVol.set(vol, { vol, minNum: num, maxNum: num, count: 1 });
    } else {
      if (num < prev.minNum) prev.minNum = num;
      if (num > prev.maxNum) prev.maxNum = num;
      prev.count += 1;
    }
  }
  return Array.from(byVol.values()).sort((a, b) => a.vol - b.vol);
}

export function resolveBookPageTarget({
  pageInput,
  edition,
  editionRange,
  pageToChapter,
  pageToPara,
  pageAnchors,
  selectedVolume = null,
}) {
  const clean = String(pageInput ?? '').trim();
  if (!clean) {
    return { ok: false, error: 'Please enter a page number' };
  }

  const ed = String(edition || 'M').trim().toUpperCase();
  if (!editionRange || !editionRange.available) {
    return { ok: false, error: `${ed} edition page numbers are not available for this book.` };
  }

  let explicitVol = null;
  let enteredNum = NaN;
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '') {
      return { ok: false, error: 'Please enter a valid positive page number.' };
    }
    explicitVol = parseInt(parts[0], 10);
    enteredNum = parseInt(parts[1], 10);
    if (Number.isNaN(explicitVol) || explicitVol < 0) {
      return { ok: false, error: 'Please enter a valid positive page number.' };
    }
  } else if (/^\d+$/.test(clean)) {
    enteredNum = parseInt(clean, 10);
  }

  if (Number.isNaN(enteredNum) || enteredNum <= 0) {
    return { ok: false, error: 'Please enter a valid positive page number.' };
  }

  const volumes = extractEditionVolumes(pageToChapter);
  const isMultiVol = volumes.length > 1;
  const effectiveVol =
    explicitVol !== null
      ? explicitVol
      : isMultiVol && selectedVolume !== null && selectedVolume !== undefined
        ? Number(selectedVolume)
        : null;

  const volInfo =
    effectiveVol !== null && effectiveVol >= 0
      ? volumes.find((v) => v.vol === effectiveVol) || null
      : null;

  if (explicitVol !== null && explicitVol >= 0 && volumes.length > 1 && !volInfo) {
    const availVols = volumes.map((v) => v.vol).join(', ');
    return {
      ok: false,
      error: `Volume ${explicitVol} was not found in ${ed} edition (available volumes: ${availVols}).`,
    };
  }

  const minBound = volInfo ? volInfo.minNum : editionRange.minNum;
  const maxBound = volInfo ? volInfo.maxNum : editionRange.maxNum;
  if (minBound !== undefined && maxBound !== undefined) {
    if (enteredNum < minBound || enteredNum > maxBound) {
      const volPrefix = volInfo && isMultiVol ? ` (Vol ${volInfo.vol})` : '';
      return {
        ok: false,
        error: `Page ${enteredNum} is out of range for ${ed} edition${volPrefix}. Please enter a page between ${minBound} and ${maxBound}.`,
      };
    }
  }

  const pMap = pageToChapter || {};
  const paraMap = pageToPara || {};
  const anchorMap = pageAnchors || {};
  const padded4 = String(enteredNum).padStart(4, '0');

  let matchedKey = null;
  let targetChap = undefined;
  let targetPara = undefined;

  // 1. Explicit or selected volume match (e.g. "2.0015" or "2.15")
  if (effectiveVol !== null) {
    const volPadded = `${effectiveVol}.${padded4}`;
    const volPlain = `${effectiveVol}.${enteredNum}`;
    if (pMap[volPadded] !== undefined) {
      matchedKey = volPadded;
      targetChap = pMap[volPadded];
    } else if (pMap[volPlain] !== undefined) {
      matchedKey = volPlain;
      targetChap = pMap[volPlain];
    } else if (explicitVol !== null && pMap[clean] !== undefined) {
      matchedKey = clean;
      targetChap = pMap[clean];
    }
  }

  // 2. When no explicit/selected volume, align with page_anchors[ed][clean] first so multi-volume
  // plain-page lookups never disagree between page_to_chapter and page_anchors
  if (targetChap === undefined && effectiveVol === null) {
    const knownAnchor = anchorMap[clean] || anchorMap[String(enteredNum)];
    if (knownAnchor && typeof knownAnchor === 'string') {
      const stripped = knownAnchor.startsWith(ed) ? knownAnchor.slice(ed.length) : knownAnchor;
      if (stripped && pMap[stripped] !== undefined) {
        matchedKey = stripped;
        targetChap = pMap[stripped];
      }
    }
  }

  // 3. Exact or suffix match in page_to_chapter
  if (targetChap === undefined && effectiveVol === null) {
    for (const [pKey, cIdx] of Object.entries(pMap)) {
      if (pKey.includes('.')) {
        if (pKey.endsWith(`.${padded4}`) || pKey.endsWith(`.${enteredNum}`)) {
          matchedKey = pKey;
          targetChap = cIdx;
          break;
        }
      }
    }
    if (targetChap === undefined) {
      if (pMap[clean] !== undefined) {
        matchedKey = clean;
        targetChap = pMap[clean];
      } else if (pMap[String(enteredNum)] !== undefined) {
        matchedKey = String(enteredNum);
        targetChap = pMap[String(enteredNum)];
      } else if (pMap[padded4] !== undefined) {
        matchedKey = padded4;
        targetChap = pMap[padded4];
      }
    }
  }

  // 4. Nearest-page fallback within bounds (handles print editions that skipped an intermediate page number, e.g. abh03m7.mul V 519)
  if (targetChap === undefined) {
    let bestBefore = null;
    let bestAfter = null;
    for (const [pKey, cIdx] of Object.entries(pMap)) {
      let kVol = null;
      let kNum = NaN;
      if (pKey.includes('.')) {
        const [vs, ps] = pKey.split('.');
        kVol = parseInt(vs, 10);
        kNum = parseInt(ps, 10);
        if (effectiveVol !== null && kVol !== effectiveVol) continue;
      } else {
        if (effectiveVol !== null && effectiveVol > 0) continue;
        kNum = parseInt(pKey, 10);
      }
      if (Number.isNaN(kNum)) continue;
      if (kNum <= enteredNum) {
        if (!bestBefore || enteredNum - kNum < enteredNum - bestBefore.num || (kNum === bestBefore.num && pKey.includes('.'))) {
          bestBefore = { key: pKey, num: kNum, chap: cIdx };
        }
      } else if (!bestAfter || kNum - enteredNum < bestAfter.num - enteredNum || (kNum === bestAfter.num && pKey.includes('.'))) {
        bestAfter = { key: pKey, num: kNum, chap: cIdx };
      }
    }
    const chosen = bestBefore || bestAfter;
    if (chosen) {
      matchedKey = chosen.key;
      targetChap = chosen.chap;
    }
  }

  if (matchedKey !== null) {
    const numFromKey = matchedKey.includes('.') ? String(parseInt(matchedKey.split('.')[1], 10)) : matchedKey;
    targetPara = paraMap[matchedKey] ?? (!isMultiVol ? paraMap[numFromKey] ?? paraMap[clean] : undefined);
  } else if (paraMap[clean] !== undefined) {
    targetPara = paraMap[clean];
  }

  if (targetChap === undefined && targetPara === undefined) {
    return { ok: false, error: `Page "${clean}" was not found in ${ed} edition for this book.` };
  }

  // Preserve volume-qualified page key when disambiguated or nearest-resolved so ReaderView jumps to the exact pb span
  const targetPage =
    matchedKey && (matchedKey.includes('.') || parseInt(matchedKey, 10) !== enteredNum)
      ? matchedKey
      : clean;

  return {
    ok: true,
    targetChapterIdx: targetChap,
    targetParaNum: targetPara || undefined,
    targetPage,
    targetPageSystem: ed,
  };
}

export default function GoToModal({ isOpen, onClose, initialTab = 'para', initialEdition = null }) {
  const { activeTab, openBook, activeParaNum } = useTabs();
  const { settings } = useThemeSettings();

  const [activeTabMode, setActiveTabMode] = useState(initialTab || 'para'); // 'para' | 'page'
  const [paraInput, setParaInput] = useState('');
  const [pageInput, setPageInput] = useState('');
  const [pageSystem, setPageSystem] = useState(initialEdition || 'M'); // Default to 'M' (Myanmar)
  const [selectedVolume, setSelectedVolume] = useState(null);
  const [fetchedMeta, setFetchedMeta] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  const inputRef = useRef(null);

  const effectiveBookMeta = useMemo(() => {
    if (!activeTab) return null;
    if (fetchedMeta && fetchedMeta.code === activeTab.bookCode) {
      return {
        ...activeTab,
        para_to_chapter:
          activeTab.para_to_chapter && Object.keys(activeTab.para_to_chapter).length > 0
            ? activeTab.para_to_chapter
            : fetchedMeta.para_to_chapter || {},
        page_to_chapter:
          activeTab.page_to_chapter && Object.keys(activeTab.page_to_chapter).length > 0
            ? activeTab.page_to_chapter
            : fetchedMeta.page_to_chapter || {},
        page_to_para:
          activeTab.page_to_para && Object.keys(activeTab.page_to_para).length > 0
            ? activeTab.page_to_para
            : fetchedMeta.page_to_para || {},
        page_anchors:
          activeTab.page_anchors && Object.keys(activeTab.page_anchors).length > 0
            ? activeTab.page_anchors
            : fetchedMeta.page_anchors || {},
        para_range: activeTab.para_range || fetchedMeta.para_range || null,
        edition_ranges:
          activeTab.edition_ranges && Object.keys(activeTab.edition_ranges).length > 0
            ? activeTab.edition_ranges
            : fetchedMeta.edition_ranges || null,
      };
    }
    return activeTab;
  }, [activeTab, fetchedMeta]);

  // Lazy-fetch navigation metadata if GoToModal opens on an unhydrated/TOC tab missing page_to_chapter
  useEffect(() => {
    if (!isOpen || !activeTab?.bookCode || activeTab.bookCode === 'ai_chat') return;
    const hasPages = activeTab.page_to_chapter && Object.keys(activeTab.page_to_chapter).length > 0;
    const hasEdRanges = activeTab.edition_ranges && Object.keys(activeTab.edition_ranges).length > 0;
    if (hasPages && hasEdRanges) return;
    if (fetchedMeta?.code === activeTab.bookCode) return;

    let cancelled = false;
    fetchBookTocOnly(activeTab.bookCode)
      .then((data) => {
        if (!cancelled && data) {
          setFetchedMeta({ ...data, code: data.code || activeTab.bookCode });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTab?.bookCode, activeTab?.page_to_chapter, activeTab?.edition_ranges, fetchedMeta?.code]);

  // Load saved edition preference or initialEdition
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (initialEdition && EDITION_ORDER.includes(initialEdition)) {
      setPageSystem(initialEdition);
      return;
    }
    try {
      const savedEd = localStorage.getItem('tipitaka_goto_edition_v2');
      if (savedEd && EDITION_ORDER.includes(savedEd)) {
        setPageSystem(savedEd);
      }
    } catch (e) {}
  }, [initialEdition]);

  useEffect(() => {
    let focusTimer;
    if (isOpen) {
      if (initialTab) {
        setActiveTabMode(initialTab);
      }
      if (initialEdition && EDITION_ORDER.includes(initialEdition)) {
        setPageSystem(initialEdition);
      }
      setErrorMessage('');
      focusTimer = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
    }
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
    };
  }, [isOpen, initialTab, initialEdition]);

  // 1. Direct precomputed paragraph limits (from server DB/JSON, 0ms compute)
  const paraRange = useMemo(() => {
    if (effectiveBookMeta?.para_range && effectiveBookMeta.para_range.total > 0) {
      return effectiveBookMeta.para_range;
    }
    const pMap = effectiveBookMeta?.para_to_chapter || {};
    let min = Infinity;
    let max = -Infinity;
    let count = 0;
    for (const k of Object.keys(pMap)) {
      const n = parseInt(k, 10);
      if (!isNaN(n)) {
        if (n < min) min = n;
        if (n > max) max = n;
        count++;
      }
    }
    if (count === 0) return { min: 1, max: 1, total: 0 };
    return { min, max, total: count };
  }, [effectiveBookMeta]);

  // 2. Direct precomputed page limits per edition (from server DB/JSON, 0ms compute)
  const editionRanges = useMemo(() => {
    if (
      effectiveBookMeta?.edition_ranges &&
      Object.keys(effectiveBookMeta.edition_ranges).length > 0
    ) {
      return effectiveBookMeta.edition_ranges;
    }
    const res = {};
    const pageToChap = effectiveBookMeta?.page_to_chapter || {};
    for (const sys of EDITION_ORDER) {
      const pMap = pageToChap[sys] || {};
      const uniquePages = new Set();
      let minNum = Infinity;
      let maxNum = -Infinity;
      for (const p of Object.keys(pMap)) {
        let n = NaN;
        if (p.includes('.')) {
          const parts = p.split('.');
          n = parseInt(parts[1], 10);
        } else {
          n = parseInt(p, 10);
        }
        if (!isNaN(n)) {
          uniquePages.add(n);
          if (n < minNum) minNum = n;
          if (n > maxNum) maxNum = n;
        }
      }
      if (uniquePages.size === 0) {
        res[sys] = {
          available: false,
          count: 0,
          minNum: 1,
          maxNum: 1,
          label: 'Unavailable',
          hint: '1',
        };
      } else {
        res[sys] = {
          available: true,
          count: uniquePages.size,
          minNum,
          maxNum,
          label: `Page ${minNum} – ${maxNum}`,
          hint: `e.g. ${minNum} to ${maxNum}`,
        };
      }
    }
    return res;
  }, [effectiveBookMeta]);

  // Auto-switch to the first available edition when the stored/default edition is unavailable in this book
  useEffect(() => {
    if (!isOpen) return;
    if (editionRanges[pageSystem]?.available) return;
    const firstAvail = EDITION_ORDER.find((code) => editionRanges[code]?.available);
    if (firstAvail && firstAvail !== pageSystem) {
      setPageSystem(firstAvail);
    }
  }, [isOpen, editionRanges, pageSystem]);

  const editionVolumes = useMemo(
    () => extractEditionVolumes(effectiveBookMeta?.page_to_chapter?.[pageSystem]),
    [effectiveBookMeta, pageSystem]
  );

  useEffect(() => {
    if (editionVolumes.length > 1) {
      setSelectedVolume((prev) =>
        editionVolumes.some((v) => v.vol === prev) ? prev : editionVolumes[0].vol
      );
    } else {
      setSelectedVolume(null);
    }
  }, [editionVolumes, activeTab?.bookCode, pageSystem]);

  const activeVolumeInfo = useMemo(() => {
    if (editionVolumes.length <= 1 || selectedVolume === null) return null;
    return editionVolumes.find((v) => v.vol === selectedVolume) || editionVolumes[0] || null;
  }, [editionVolumes, selectedVolume]);

  const baseEdRange = editionRanges[pageSystem] || { available: false, label: 'Unavailable' };
  const currentEdRange = useMemo(() => {
    if (!baseEdRange.available || !activeVolumeInfo) return baseEdRange;
    return {
      ...baseEdRange,
      count: activeVolumeInfo.count,
      minNum: activeVolumeInfo.minNum,
      maxNum: activeVolumeInfo.maxNum,
      label: `Vol ${activeVolumeInfo.vol}: p.${activeVolumeInfo.minNum} – ${activeVolumeInfo.maxNum}`,
      hint: `e.g. ${activeVolumeInfo.minNum} to ${activeVolumeInfo.maxNum} (or ${activeVolumeInfo.vol}.${activeVolumeInfo.minNum})`,
    };
  }, [baseEdRange, activeVolumeInfo]);

  // 3. Dynamic quick paragraph chips
  const quickParaChips = useMemo(() => {
    if (!paraRange || paraRange.total === 0) return [1];
    const { min, max } = paraRange;
    if (max - min <= 5) {
      const arr = [];
      for (let i = min; i <= max; i++) arr.push(i);
      return arr;
    }
    const step1 = Math.round(min + (max - min) * 0.25);
    const step2 = Math.round(min + (max - min) * 0.5);
    const step3 = Math.round(min + (max - min) * 0.75);
    const set = new Set([min, step1, step2, step3, max]);
    return Array.from(set).sort((a, b) => a - b);
  }, [paraRange]);

  // 4. Dynamic quick page chips
  const quickPageChips = useMemo(() => {
    if (!currentEdRange.available) return [];
    const { minNum, maxNum } = currentEdRange;
    if (maxNum - minNum <= 5) {
      const arr = [];
      for (let i = minNum; i <= maxNum; i++) arr.push(i);
      return arr;
    }
    const step1 = Math.round(minNum + (maxNum - minNum) * 0.25);
    const step2 = Math.round(minNum + (maxNum - minNum) * 0.5);
    const step3 = Math.round(minNum + (maxNum - minNum) * 0.75);
    const set = new Set([minNum, step1, step2, step3, maxNum]);
    return Array.from(set).sort((a, b) => a - b);
  }, [currentEdRange]);

  useEffect(() => {
    let focusTimer;
    if (isOpen) {
      setErrorMessage('');
      setParaInput(activeParaNum || '');
      focusTimer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus({ preventScroll: true });
          inputRef.current.select();
        }
      }, 60);
    }
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
    };
  }, [isOpen, activeTabMode, activeParaNum]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);



  const pageSystems = [
    { code: 'M', label: 'Myanmar', name: 'Chaṭṭha Saṅgāyana Edition' },
    { code: 'V', label: 'VRI', name: 'Vipassana Research Institute' },
    { code: 'P', label: 'PTS', name: 'Pali Text Society' },
    { code: 'T', label: 'Thai', name: 'Royal Thai Edition' },
    { code: 'O', label: 'Other', name: 'Other Extra-canonical' },
  ];


  const handleParaSubmit = (e) => {
    if (e) e.preventDefault();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const clean = String(paraInput || '').trim().replace(/^(?:para-?|p)/i, '');
    if (!clean) {
      setErrorMessage('Please enter a paragraph number');
      return;
    }

    const intVal = parseInt(clean, 10);
    if (isNaN(intVal) || intVal <= 0) {
      setErrorMessage('Please enter a valid positive paragraph number.');
      return;
    }

    if (!paraRange || paraRange.total === 0) {
      setErrorMessage('Paragraph navigation is not available for this book.');
      return;
    }

    if (intVal < paraRange.min || intVal > paraRange.max) {
      setErrorMessage(
        `Paragraph ${intVal} is out of range. Please enter a paragraph between ${paraRange.min} and ${paraRange.max}.`
      );
      return;
    }

    if (typeof window !== 'undefined') {
      window.__tpoModalClosedAt = Date.now();
    }
    openBook(activeTab.bookCode, { targetParaNum: clean });
    onClose();
  };

  const handlePageSubmit = (e) => {
    if (e) e.preventDefault();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    const ed = pageSystem.toUpperCase();
    const resolved = resolveBookPageTarget({
      pageInput,
      edition: ed,
      editionRange: editionRanges[ed],
      pageToChapter: effectiveBookMeta?.page_to_chapter?.[ed],
      pageToPara: effectiveBookMeta?.page_to_para?.[ed],
      pageAnchors: effectiveBookMeta?.page_anchors?.[ed],
      selectedVolume,
    });
    if (!resolved.ok) {
      setErrorMessage(resolved.error);
      return;
    }

    if (typeof window !== 'undefined') {
      window.__tpoModalClosedAt = Date.now();
    }
    openBook(activeTab.bookCode, {
      targetChapterIdx: resolved.targetChapterIdx,
      targetParaNum: resolved.targetParaNum,
      targetPage: resolved.targetPage,
      targetPageSystem: resolved.targetPageSystem,
    });
    onClose();
  };



  // Only return null after ALL hooks have executed unconditionally
  if (!isOpen || !activeTab) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
              <Navigation size={18} />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[var(--text-primary)]">
                Go to Location
              </h3>
              <p className="text-[11px] text-[var(--text-muted)] truncate max-w-[240px]">
                {convertPaliScript(capitalizePali(activeTab.title), settings?.paliScript)}
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

        {/* Mode Tabs */}
        <div className="flex border-b border-[var(--border-color)] bg-[var(--bg-card)] p-1 gap-1">
          <button
            type="button"
            onClick={() => {
              setActiveTabMode('para');
              setErrorMessage('');
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTabMode === 'para'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <Hash size={14} />
            <span>Paragraph</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTabMode('page');
              setErrorMessage('');
            }}
            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              activeTabMode === 'page'
                ? 'bg-[var(--accent)] text-white shadow-xs'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
            }`}
          >
            <BookOpen size={14} />
            <span>Page Number</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-4">
          {activeTabMode === 'para' ? (
            <form onSubmit={handleParaSubmit} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Paragraph Number
                  </label>
                  {paraRange.total > 0 && (
                    <span className="text-[11px] font-mono font-semibold text-[var(--accent)] bg-[var(--accent-light)] px-1.5 py-0.2 rounded border border-[var(--accent-border)]">
                      {paraRange.min} – {paraRange.max}
                    </span>
                  )}
                </div>

                <div className="relative flex items-center">
                  <input
                    ref={inputRef}
                    type="number"
                    min={paraRange.min}
                    max={paraRange.max}
                    value={paraInput}
                    onChange={(e) => {
                      setParaInput(e.target.value);
                      setErrorMessage('');
                    }}
                    placeholder={`Enter paragraph (${paraRange.min} – ${paraRange.max})`}
                    className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-base sm:text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono"
                  />
                </div>
              </div>

              {/* Quick Paragraph Chips */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                  <span>Quick Select:</span>
                  <span>{paraRange.total} total paras</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {quickParaChips.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        setParaInput(String(n));
                        setErrorMessage('');
                      }}
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                        String(n) === String(paraInput)
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                          : 'bg-[var(--bg-secondary)] hover:bg-[var(--accent)] hover:text-white border-[var(--border-color)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              {errorMessage && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center gap-2 text-xs">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--accent)] text-white font-semibold text-xs flex items-center justify-center gap-2 hover:opacity-90 shadow-sm transition cursor-pointer"
              >
                <span>Go to Paragraph</span>
                <CornerDownLeft size={14} />
              </button>
            </form>
          ) : (
            <form onSubmit={handlePageSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                  Page Numbering Edition
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {pageSystems.map((sys) => {
                    const rangeInfo = editionRanges[sys.code] || { available: false, label: 'Unavailable' };
                    return (
                      <button
                        key={sys.code}
                        type="button"
                        disabled={!rangeInfo.available}
                        onClick={() => {
                          setPageSystem(sys.code);
                          setErrorMessage('');
                          try {
                            localStorage.setItem('tipitaka_goto_edition_v2', sys.code);
                          } catch (e) {}
                        }}
                        className={`p-2 rounded-lg border text-left transition flex flex-col justify-between ${
                          pageSystem === sys.code
                            ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] font-bold'
                            : rangeInfo.available
                            ? 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:border-[var(--border-color)]/80 cursor-pointer'
                            : 'border-[var(--border-color)]/50 bg-[var(--bg-secondary)]/40 text-[var(--text-muted)] opacity-40 cursor-not-allowed'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs">{sys.label}</span>
                          <span className="text-[10px] opacity-60">[{sys.code}]</span>
                        </div>
                        <span className="text-[10.5px] font-mono font-normal mt-1 opacity-80">
                          {rangeInfo.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5 leading-normal">
                  <span className="font-semibold text-[var(--text-primary)]">Editions:</span> <strong>M</strong> = Myanmar (Chaṭṭha Saṅgāyana) • <strong>V</strong> = VRI • <strong>P</strong> = PTS (Pali Text Society) • <strong>T</strong> = Thai • <strong>O</strong> = Other
                </p>
              </div>


              {editionVolumes.length > 1 && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                    Volume ({pageSystem})
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {editionVolumes.map((v) => (
                      <button
                        key={v.vol}
                        type="button"
                        onClick={() => {
                          setSelectedVolume(v.vol);
                          setErrorMessage('');
                        }}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-mono transition cursor-pointer ${
                          selectedVolume === v.vol
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)] font-semibold'
                            : 'bg-[var(--bg-secondary)] hover:border-[var(--accent)] border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        Vol {v.vol} ({v.minNum}–{v.maxNum})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Page Number ({pageSystem})
                  </label>
                  {currentEdRange.available && (
                    <span className="text-[11px] font-mono font-semibold text-[var(--accent)] bg-[var(--accent-light)] px-1.5 py-0.2 rounded border border-[var(--accent-border)]">
                      {currentEdRange.label}
                    </span>
                  )}
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={pageInput}
                  disabled={!currentEdRange.available}
                  onChange={(e) => {
                    setPageInput(e.target.value);
                    setErrorMessage('');
                  }}
                  placeholder={currentEdRange.available ? currentEdRange.hint : 'Unavailable in this book'}
                  className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-base sm:text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition font-mono disabled:opacity-50"
                />
              </div>

              {/* Quick Page Chips */}
              {quickPageChips.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                    <span>Quick Select:</span>
                    <span>{currentEdRange.count} page breaks</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {quickPageChips.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setPageInput(String(p));
                          setErrorMessage('');
                        }}
                        className={`px-2 py-0.5 rounded-md border text-[11px] font-mono transition cursor-pointer ${
                          String(p) === String(pageInput)
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'bg-[var(--bg-secondary)] hover:bg-[var(--accent)] hover:text-white border-[var(--border-color)] text-[var(--text-secondary)]'
                        }`}
                      >
                        p.{p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center gap-2 text-xs">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!currentEdRange.available}
                className="w-full py-2.5 px-4 rounded-lg bg-[var(--accent)] text-white font-semibold text-xs flex items-center justify-center gap-2 hover:opacity-90 shadow-sm transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>Go to Page</span>
                <CornerDownLeft size={14} />
              </button>
            </form>
          )}
        </div>

        {/* Footer info tip */}
        <div className="px-4 py-2.5 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] text-[11px] text-[var(--text-muted)] flex items-center justify-between">
          <span>Press Enter to navigate immediately</span>
          <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-card)] border border-[var(--border-color)] font-mono text-[9px]">
            Enter
          </kbd>
        </div>
      </div>
    </div>
  );
}
