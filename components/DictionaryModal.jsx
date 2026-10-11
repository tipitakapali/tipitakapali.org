'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  BookSearch,
  X,
  Search,
  ArrowLeft,
  History,
  Clock,
  Trash2,
  Layers,
  PanelLeft,
  PanelRight,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  Sparkles,
  ExternalLink,
  Split,
  BookOpen,
  Languages,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useDictionary, DEFAULT_DICT_ORDER, DEFAULT_DICT_ENABLED } from '../context/DictionaryContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { typeVelthuis, convertAnyToRoman, convertPaliScript, cleanDictionaryQuery } from '../services/transliterate';
import { fetchDictionaryInflection } from '../services/api';
import { restoreMinifiedLinks } from '../services/dpdFeedback';

// Helper to highlight exact matching inflections in table cells (CC BY-NC-SA 4.0 DPD)
function highlightInflections(searchTerm, container, targetScript = 'roman') {
  if (!searchTerm || !container) return;
  const romanSearch = searchTerm.toLowerCase().trim();
  const convertedSearch =
    targetScript && targetScript !== 'roman'
      ? convertPaliScript(searchTerm, targetScript)?.toLowerCase().trim()
      : null;

  const inflectionTables = container.querySelectorAll('table.inflection');

  inflectionTables.forEach((table) => {
    const cells = table.querySelectorAll('td');
    cells.forEach((cell) => {
      const cellHTML = cell.innerHTML;
      const parts = cellHTML.split(/<br\s*\/?>/i);
      let modified = false;

      const newParts = parts.map((part) => {
        const tempElement = document.createElement('div');
        tempElement.innerHTML = part;
        const partText = (tempElement.textContent || '').toLowerCase().trim();

        if (partText === romanSearch || (convertedSearch && partText === convertedSearch)) {
          modified = true;
          return `<span class="inflection-highlight font-bold text-[var(--accent)] bg-[var(--accent-light)] px-1 py-0.5 rounded shadow-xs">${part}</span>`;
        }
        return part;
      });

      if (modified) {
        cell.innerHTML = newParts.join('<br>');
      }
    });
  });
}

// Helper to extract word under cursor on click event (supports Pāḷi Roman diacritics, Devanagari, Myanmar, Sinhala, Thai)
function extractWordFromPointerEvent(e) {
  if (typeof document === 'undefined') return '';
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

  if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = range.startContainer.textContent || '';
    const offset = range.startOffset;
    let start = offset;
    let end = offset;

    const isWordChar = (ch) => /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\u0900-\u097F\u1000-\u109F\u0D80-\u0DFF\u0E00-\u0E7F]/.test(ch);

    while (start > 0 && isWordChar(text[start - 1])) {
      start--;
    }
    while (end < text.length && isWordChar(text[end])) {
      end++;
    }

    const raw = text.slice(start, end).trim();
    return raw;
  }
  return '';
}

// Helper to selectively convert only Pāḷi content in dictionary entries (leaves English buttons, definitions, & EPD English headwords untouched)
function convertDictionaryEntryHtml(rawHtml, dictType, targetScript) {
  if (!rawHtml) return '';
  let restored = dictType === 'dpd' ? restoreMinifiedLinks(rawHtml) : rawHtml;

  // DPD: Hide button-box by default and inject toggle play button at end of definition
  if (dictType === 'dpd' && !restored.includes('dpd-toggle-play-btn')) {
    const toggleBtnHtml =
      '<button type="button" class="dpd-toggle-play-btn" title="Toggle buttons" aria-label="Toggle buttons"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg></button>';
    if (/<\/div>\s*<div\s+class=["']?(?:button[-_]box)/i.test(restored)) {
      restored = restored.replace(
        /(<\/div>\s*<div\s+class=["']?(button[-_]box)([^"'>]*)["']?>)/gi,
        ` ${toggleBtnHtml}</div><div class="$2 dpd-collapsed$3">`
      );
    } else {
      restored = restored.replace(
        /<div\s+class=["']?(button[-_]box)([^"'>]*)["']?>/gi,
        `${toggleBtnHtml}<div class="$1 dpd-collapsed$2">`
      );
    }
  }

  if (!targetScript || targetScript === 'roman') return restored;
  if (typeof window === 'undefined') return restored;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(restored, 'text/html');

    if (dictType === 'dpd') {
      // 1. Process sections / entries in DPD
      const sections = doc.querySelectorAll('section.dp9, .dp9');
      if (sections.length > 0) {
        sections.forEach((sec) => {
          // Check if this section is an EPD (English-Pāḷi Dictionary) entry
          const isEpd = sec.querySelector('b.epd, .epd') !== null;
          if (isEpd) {
            // EPD entry:
            // The headword (span.p1w, span.p2w) is the English lookup word (e.g. "cheerful", "happy").
            // DO NOT convert the English headword!
            // Convert only the Pāḷi target words in b.epd / .epd:
            sec.querySelectorAll('b.epd, .epd').forEach((el) => {
              const text = el.textContent || '';
              const converted = convertPaliScript(text, targetScript);
              if (converted) el.textContent = converted;
            });
          } else {
            // Regular DPD entry: headwords (span.p1w, span.p2w, span.p3w, span.pp1w, span.pp2w, span.pm1w, span.pm2w) are Pāḷi
            sec.querySelectorAll('span.p1w, span.p2w, span.p3w, span.pp1w, span.pp2w, span.pm1w, span.pm2w').forEach((el) => {
              const text = el.textContent || '';
              const converted = convertPaliScript(text, targetScript);
              if (converted) el.textContent = converted;
            });
          }
        });
      } else {
        // Fallback for flat HTML
        const isEpd = doc.querySelector('b.epd, .epd') !== null;
        if (isEpd) {
          doc.querySelectorAll('b.epd, .epd').forEach((el) => {
            const text = el.textContent || '';
            const converted = convertPaliScript(text, targetScript);
            if (converted) el.textContent = converted;
          });
        } else {
          doc.querySelectorAll('span.p1w, span.p2w, span.p3w, span.pp1w, span.pp2w, span.pm1w, span.pm2w').forEach((el) => {
            const text = el.textContent || '';
            const converted = convertPaliScript(text, targetScript);
            if (converted) el.textContent = converted;
          });
        }
      }

      // 2. Convert root and compound family headwords in table headers (these are Pāḷi)
      doc.querySelectorAll('table.family th, table.root_family th').forEach((el) => {
        const text = el.textContent || '';
        if (!/^(Total|Count|ID|No\.)/i.test(text)) {
          const converted = convertPaliScript(text, targetScript);
          if (converted) el.textContent = converted;
        }
      });

      // 3. Convert deconstructor lines and terms (these are Pāḷi)
      doc.querySelectorAll('.dp9 p.dec, .dp9 .dec-term, .dec').forEach((el) => {
        const text = el.textContent || '';
        const converted = convertPaliScript(text, targetScript);
        if (converted) el.textContent = converted;
      });
    } else if (dictType === 'pts') {
      doc.querySelectorAll('span.pp1w, span.pp2w').forEach((el) => {
        const text = el.textContent || '';
        const converted = convertPaliScript(text, targetScript);
        if (converted) el.textContent = converted;
      });
    } else if (dictType === 'abd') {
      doc.querySelectorAll('span.pm1w, span.pm2w').forEach((el) => {
        const text = el.textContent || '';
        const converted = convertPaliScript(text, targetScript);
        if (converted) el.textContent = converted;
      });
    } else if (dictType === 'psd') {
      doc.querySelectorAll('span.psdW, span.p2w').forEach((el) => {
        const text = el.textContent || '';
        const converted = convertPaliScript(text, targetScript);
        if (converted) el.textContent = converted;
      });
    } else if (dictType === 'splitter') {
      doc.querySelectorAll('span.p2w, p.dec, .dec-term').forEach((el) => {
        const text = el.textContent || '';
        const converted = convertPaliScript(text, targetScript);
        if (converted) el.textContent = converted;
      });
    }

    return doc.body.innerHTML;
  } catch (err) {
    console.warn('Error converting dictionary entry script:', err);
    return rawHtml;
  }
}

// Helper to extract concise summary information from a DPD HTML entry (matches dpdict.net & @tpo export)
function extractDpdSummaryItem(rawHtml, fallbackWord = '') {
  if (!rawHtml) {
    return { headword: fallbackWord, pos: '', enMeaning: '', viMeaning: '', viLit: '', construction: '', isEpd: false };
  }

  // 1. Headword (quoted or unquoted class)
  const hwMatch = rawHtml.match(/<span class=["']?(?:p1w|p2w|p3w|pm1w|pm2w|pp1w|pp2w)["']?[^>]*>([\s\S]*?)<\/span>/i);
  let headword = hwMatch ? hwMatch[1].replace(/<[^>]+>/g, '').trim() : fallbackWord;

  // 1.5 Check if this is an English-Pali Dictionary (EPD) entry
  const isEpd = /<b class=["']?epd["']?>|class=["']?epd["']?/i.test(rawHtml);
  if (isEpd) {
    let epdMeaning = '';
    const epdContentMatch = rawHtml.match(/<div class=["']?dpd(?:\s+[^"'>]*)?["']?>\s*<p[^>]*>([\s\S]*?)<\/div>/i);
    if (epdContentMatch) {
      let clean = epdContentMatch[1].replace(/<br\s*\/?>/gi, '; ');
      clean = clean.replace(/<b class=["']?epd["']?>[\s\S]*?<\/b>/gi, '');
      clean = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      epdMeaning = clean.slice(0, 110);
    }
    return {
      headword,
      pos: 'English.',
      viMeaning: '',
      viLit: '',
      enMeaning: epdMeaning,
      construction: '',
      isEpd: true,
    };
  }

  // 1.6 Check if this is a Root entry (<p>root. <b>√brah</b>...)
  const rootMatch = rawHtml.match(/<p>root\.\s*<b>([^<]+)<\/b>(?:<sup>[^<]*<\/sup>)?\s*([^(<]*)\(([^)]+)\)/i);
  if (rootMatch) {
    const rootSign = rootMatch[1].trim();
    const group = rootMatch[2].trim();
    const meaning = rootMatch[3].trim();
    return {
      headword: rootSign || headword,
      pos: 'root.',
      viMeaning: '',
      viLit: '',
      enMeaning: meaning ? `${meaning}` : '',
      construction: group,
      isEpd: false,
    };
  }
  const rootFallback = rawHtml.match(/<p>root\.\s*<b>([^<]+)<\/b>(?:<sup>[^<]*<\/sup>)?\s*([^<]+)/i);
  if (rootFallback) {
    return {
      headword: rootFallback[1].trim() || headword,
      pos: 'root.',
      viMeaning: '',
      viLit: '',
      enMeaning: rootFallback[2].trim().slice(0, 80),
      construction: '',
      isEpd: false,
    };
  }

  // 2. Vietnamese meaning (from customized @tpo export)
  let viPos = '';
  let viMeaning = '';
  let viLit = '';
  const viMatch = rawHtml.match(/<p class=["']?dpd-meaning-vi["']?>([\s\S]*?)<\/p>/i);
  if (viMatch) {
    const viContent = viMatch[1];
    const viPosMatch = viContent.match(/^\s*([^<]+?\.)/);
    if (viPosMatch) viPos = viPosMatch[1].trim();
    const viBoldMatch = viContent.match(/<b>([\s\S]*?)<\/b>/i);
    if (viBoldMatch) viMeaning = viBoldMatch[1].replace(/<[^>]+>/g, '').trim();
    const viLitMatch = viContent.match(/<span class=["']?meaning-lit["']?>([\s\S]*?)<\/span>/i);
    if (viLitMatch) viLit = viLitMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // 3. English meaning
  let enPos = '';
  let enMeaning = '';
  let construction = '';
  const enMatch =
    rawHtml.match(/<p class=["']?dpd-meaning-en["']?>([\s\S]*?)<\/p>/i) ||
    rawHtml.match(/<div class=["']?dpd(?:\s+[^"'>]*)?["']?>\s*<p[^>]*>([\s\S]*?)<\/p>/i);

  if (enMatch) {
    const enContent = enMatch[1];
    const enPosMatch = enContent.match(/^\s*([a-z\s]+?\.)/i);
    if (enPosMatch) enPos = enPosMatch[1].trim();

    const constrMatch = enContent.match(/\[([^\]]+)\]/);
    if (constrMatch) construction = constrMatch[1].trim();

    const enBoldMatch = enContent.match(/<b>([\s\S]*?)<\/b>/i);
    if (enBoldMatch) {
      enMeaning = enBoldMatch[1].replace(/<[^>]+>/g, '').trim();
    } else {
      let clean = enContent.replace(/\[[^\]]+\]/g, '');
      clean = clean.replace(/<span class=["']?gray["']?>[\s\S]*?<\/span>/gi, '');
      clean = clean.replace(/<[^>]+>/g, ' ');
      if (enPos && clean.trim().toLowerCase().startsWith(enPos.toLowerCase())) {
        clean = clean.trim().slice(enPos.length).trim();
      }
      enMeaning = clean.replace(/\s+/g, ' ').trim().slice(0, 110);
    }
  }

  return {
    headword,
    pos: viPos || enPos,
    viMeaning,
    viLit,
    enMeaning,
    construction,
    isEpd: false,
  };
}

// Helper to extract concise preview information for other dictionaries (PTS, ABD, PSD, SANS, Splitter)
function extractOtherSummaryItem(rawHtml, dictType, fallbackWord = '', index = 0) {
  if (!rawHtml) {
    return { headword: fallbackWord || `Meaning ${index + 1}`, label: `Meaning ${index + 1}`, pos: '', snippet: '' };
  }

  if (dictType === 'pts') {
    const hwM = rawHtml.match(/<b>([A-Za-zāīūṭḍṅñṇḷṃ\s]+)(?:<sup>(\d+)<\/sup>)?<\/b>/i);
    const hw = hwM ? hwM[1].trim() + (hwM[2] ? ` ${hwM[2]}` : '') : (fallbackWord || `Meaning ${index + 1}`);
    const posM = rawHtml.match(/<b>(?:[A-Za-zāīūṭḍṅñṇḷṃ\s]|<sup>\d+<\/sup>)+<\/b>\s*(\([^)]+\))/i);
    const pos = posM ? posM[1].trim() : '';
    let clean = rawHtml.replace(/<span class=["']?pp[12]w["']?>[\s\S]*?<\/span><br\s*\/?>/gi, '');
    clean = clean.replace(/<div class=["']?pts15["']?>/gi, '');
    const bracketM = clean.match(/<b>[\s\S]*?<\/b>\s*(?:\([^)]+\))?\s*\[[\s\S]*?\]/i);
    let after = bracketM ? clean.slice(bracketM.index + bracketM[0].length) : clean.replace(/<b>[\s\S]*?<\/b>/i, '');
    after = after.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (after.startsWith('.')) after = after.slice(1).trim();
    return { headword: hw, label: hw, pos, snippet: after.slice(0, 100) };
  }

  if (dictType === 'abd') {
    const wordM = rawHtml.match(/<p class=["']?word["']?>\s*([^<\s]+)\s*(?:<span class=["']?gender["']?>\s*([^<]+)<\/span>)?/i);
    const hw = wordM ? wordM[1].trim() : (fallbackWord || `Meaning ${index + 1}`);
    const gender = wordM && wordM[2] ? wordM[2].trim() : '';
    const defM = rawHtml.match(/<div class=["']?definition["']?>([\s\S]*?)<\/div>/i);
    let snippet = '';
    if (defM) {
      snippet = defM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    } else {
      const vigM = rawHtml.match(/<div class=["']?viggaha["']?>([\s\S]*?)<\/div>/i);
      snippet = vigM ? vigM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    }
    return { headword: hw, label: gender ? `${hw} ${gender}` : hw, pos: gender, snippet: snippet.slice(0, 100) };
  }

  if (dictType === 'psd') {
    const dictNameM = rawHtml.match(/<div class=["']?psdT["']?>([^<]+)<\/div>/i);
    const hwM = rawHtml.match(/<span class=["']?(?:p2w|psdW|p1w)["']?[^>]*>([^<]+)<\/span>/i);
    const hw = hwM ? hwM[1].trim() : (fallbackWord || `Meaning ${index + 1}`);
    const posM = rawHtml.match(/<r[^>]*>([^<]+)<\/r>/i);
    const pos = posM ? posM[1].trim() : '';
    const dictName = dictNameM ? dictNameM[1].trim() : '';
    const shortDict = dictName.includes('බුද්ධදත්ත')
      ? 'Buddhadatta'
      : dictName.includes('සුමඞ්ගල')
      ? 'Sumangala'
      : dictName.slice(0, 18);
    const liM = rawHtml.match(/<li>([\s\S]*?)<\/li>/i);
    let snippet = '';
    if (liM) {
      let liText = liM[1].replace(/<r[^>]*>[\s\S]*?<\/r>/gi, '');
      snippet = liText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return { headword: hw, label: shortDict ? `${hw} (${shortDict})` : hw, pos, snippet: snippet.slice(0, 100) };
  }

  if (dictType === 'sans') {
    const dictNameM = rawHtml.match(/<div class=["']?Dn["']?>([^<]+)<\/div>/i);
    const hwM = rawHtml.match(/<span class=["']?sdata["']?>([^<]+)<\/span>/i);
    const hw = hwM ? hwM[1].trim() : (fallbackWord || `Meaning ${index + 1}`);
    const dictName = dictNameM ? dictNameM[1].trim() : '';
    const shortDict = dictName.includes('Edgerton')
      ? 'Edgerton'
      : dictName.includes('Monier-Williams')
      ? 'Monier-Williams'
      : dictName.includes('Apte')
      ? 'Apte'
      : dictName.slice(0, 18);
    let after = rawHtml.replace(/^[\s\S]*?\[Printed book page [^\]]+\]\s*/i, '');
    after = after.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (hw && after.toLowerCase().startsWith(hw.toLowerCase())) {
      after = after.slice(hw.length).trim();
    }
    return { headword: hw, label: shortDict || `Meaning ${index + 1}`, pos: '', snippet: after.slice(0, 100) };
  }

  if (dictType === 'splitter') {
    const hwM = rawHtml.match(/<span class=["']?p2w["']?[^>]*>([^<]+)<\/span>/i);
    const hw = hwM ? hwM[1].trim() : (fallbackWord || `Split ${index + 1}`);
    const decs = [];
    const decRegex = /<p class=["']?dec["']?>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = decRegex.exec(rawHtml)) !== null) {
      const part = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (part) decs.push(part);
    }
    const snippet = decs.join(' • ');
    return { headword: hw, label: hw, pos: '', snippet: snippet.slice(0, 100) };
  }

  const clean = rawHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    headword: fallbackWord || `Meaning ${index + 1}`,
    label: `Meaning ${index + 1}`,
    pos: '',
    snippet: clean.slice(0, 90),
  };
}

export default function DictionaryModal() {
  const {
    isOpen,
    queryWord,
    displayWord,
    activeDictTab,
    dockMode,
    fontSizeMultiplier,
    history,
    historyIndex,
    lookupData,
    isLoading,
    isBackgroundLoading,
    error,
    openDictionary,
    closeDictionary,
    performLookup,
    goBack,
    setDictTab,
    setDockMode,
    setFontSizeMultiplier,
    setDisplayWord,
    clearDictionaryInput,
    dictOrder,
    dictEnabled,
    lookupHistory,
    clearLookupHistory,
    removeLookupHistoryItem,
  } = useDictionary();

  const { settings } = useThemeSettings();
  const [localInput, setLocalInput] = useState('');
  const inputRef = useRef(null);
  const contentContainerRef = useRef(null);
  const modalPanelRef = useRef(null);

  // History Dropdown State & Refs
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const historyBtnRef = useRef(null);
  const historyDropdownRef = useRef(null);

  // Close history dropdown on click outside or Escape
  useEffect(() => {
    if (!isHistoryOpen) return;
    const handleClickOutside = (e) => {
      if (
        historyDropdownRef.current &&
        !historyDropdownRef.current.contains(e.target) &&
        historyBtnRef.current &&
        !historyBtnRef.current.contains(e.target)
      ) {
        setIsHistoryOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsHistoryOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isHistoryOpen]);

  // Close history dropdown whenever the dictionary is closed
  useEffect(() => {
    if (!isOpen) {
      setIsHistoryOpen(false);
    }
  }, [isOpen]);

  // Resizable Width State (persisted in localStorage)
  const [dictWidth, setDictWidth] = useState(420);
  const [isResizing, setIsResizing] = useState(false);

  const currentScript = settings?.paliScript || 'roman';

  // Load saved dimensions from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedW = localStorage.getItem('tipitaka_dict_dock_width');
      if (savedW) {
        const parsedW = parseInt(savedW, 10);
        if (!isNaN(parsedW) && parsedW >= 260 && parsedW <= 1000) {
          setDictWidth(parsedW);
        }
      }
    } catch (e) {}
  }, []);

  // Meanings Preview Bar Collapse/Expand State (persisted in localStorage)
  const [isMeaningsExpanded, setIsMeaningsExpanded] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedMeanings = localStorage.getItem('tipitaka_dict_meanings_expanded');
      if (savedMeanings !== null) {
        setIsMeaningsExpanded(savedMeanings === 'true');
      }
    } catch (e) {}
  }, []);

  const toggleMeaningsExpanded = useCallback(() => {
    setIsMeaningsExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('tipitaka_dict_meanings_expanded', String(next));
      } catch (e) {}
      return next;
    });
  }, []);

  // Jump to specific meaning/entry with smooth scrolling and flash highlight
  const handleJumpToEntry = useCallback((index) => {
    const container = contentContainerRef.current;
    if (!container) return;
    const targetEl = container.querySelector(`#dict-entry-${index}`);
    if (targetEl) {
      const containerRect = container.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const scrollOffset = targetRect.top - containerRect.top + container.scrollTop;
      container.scrollTo({ top: Math.max(0, scrollOffset - 8), behavior: 'smooth' });

      targetEl.classList.remove('dict-entry-highlighted');
      void targetEl.offsetWidth; // force reflow
      targetEl.classList.add('dict-entry-highlighted');
      setTimeout(() => {
        targetEl.classList.remove('dict-entry-highlighted');
      }, 1600);
    }
  }, []);

  // Reset scroll position to top whenever active dictionary tab or query word changes (Task 2)
  useEffect(() => {
    if (contentContainerRef.current) {
      contentContainerRef.current.scrollTop = 0;
    }
  }, [activeDictTab, queryWord]);

  const handleTabSelect = useCallback((tabId) => {
    setDictTab(tabId);
    if (contentContainerRef.current) {
      contentContainerRef.current.scrollTop = 0;
    }
  }, [setDictTab]);

  // Dictionary tab specifications respecting custom order & enabled state
  const DICT_TABS = useMemo(() => {
    const rawTabs = [
      { id: 'dpd', label: 'DPD', desc: 'Digital Pāḷi Dictionary', count: lookupData?.counts?.dpd || 0 },
      { id: 'abd', label: 'အဘိဓာန်', desc: 'Tipiṭaka Pāḷi-Myanmar Dictionary', count: lookupData?.counts?.abd || 0 },
	    { id: 'pts', label: 'PTS', desc: 'Pāḷi Text Society PED', count: lookupData?.counts?.pts || 0 },
      { id: 'psd', label: 'සිංහල', desc: 'Pāḷi-Sinhala Dictionary', count: lookupData?.counts?.psd || 0 },
      { id: 'sans', label: 'Sanskrit', desc: 'Apte / Monier-Williams / Edgerton', count: lookupData?.counts?.sans || 0 },
      { id: 'splitter', label: 'Splitter', desc: 'Compound Deconstructor', count: lookupData?.counts?.splitter || 0 },
    ];
    const order = dictOrder || DEFAULT_DICT_ORDER;
    const enabled = dictEnabled || DEFAULT_DICT_ENABLED;

    const tabMap = new Map(rawTabs.map((t) => [t.id, t]));
    const result = [];
    for (const id of order) {
      if (enabled[id] !== false && tabMap.has(id)) {
        result.push(tabMap.get(id));
      }
    }
    return result.length > 0 ? result : rawTabs;
  }, [lookupData, dictOrder, dictEnabled]);

  // Only display tabs that have lookup results (Task 4)
  const visibleTabs = useMemo(() => {
    return DICT_TABS.filter((t) => t.count > 0);
  }, [DICT_TABS]);

  // Auto-switch to first available tab with results if current tab has none
  useEffect(() => {
    if (visibleTabs.length > 0) {
      const hasActive = visibleTabs.some((t) => t.id === activeDictTab);
      if (!hasActive) {
        setDictTab(visibleTabs[0].id);
      }
    }
  }, [visibleTabs, activeDictTab, setDictTab]);

  // Resize handler for docked width (Left or Right panel)

  const startResizingWidth = useCallback(
    (mouseDownEvent) => {
      mouseDownEvent.preventDefault();
      setIsResizing(true);
      const startX = mouseDownEvent.clientX;
      const startWidth = dictWidth;

      const onMouseMove = (mouseMoveEvent) => {
        let newWidth;
        if (dockMode === 'side' || dockMode === 'right') {
          newWidth = startWidth - (mouseMoveEvent.clientX - startX);
        } else {
          newWidth = startWidth + (mouseMoveEvent.clientX - startX);
        }
        const maxW = Math.min(950, typeof window !== 'undefined' ? window.innerWidth * 0.75 : 850);
        const clamped = Math.max(280, Math.min(newWidth, maxW));
        setDictWidth(clamped);
        try {
          localStorage.setItem('tipitaka_dict_dock_width', String(clamped));
        } catch (e) {}
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      };

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [dictWidth, dockMode]
  );

  // Synchronize local input with context display word ONLY when an external lookup occurs
  useEffect(() => {
    if (displayWord || queryWord) {
      setLocalInput(displayWord || queryWord || '');
    }
  }, [queryWord]);

  // Dedicated instant clear handler
  const handleClearInput = useCallback((e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setLocalInput('');
    if (clearDictionaryInput) {
      clearDictionaryInput();
    } else {
      setDisplayWord('');
    }
  }, [clearDictionaryInput, setDisplayWord]);

  // Focus search input on desktop open only (avoid auto-keyboard and auto-highlight on mobile)
  useEffect(() => {
    if (isOpen) {
      const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
      if (!isTouch) {
        setTimeout(() => {
          inputRef.current?.focus();
        }, 80);
      }
    }
  }, [isOpen]);

  // Safe dismiss handler that stops mobile ghost click-through
  const handleSafeDismiss = useCallback((e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (typeof window !== 'undefined') {
      window.__tipitaka_dict_just_closed = Date.now();
    }
    closeDictionary();
  }, [closeDictionary]);

  // Outside click listener: closes modal or top/bottom drawer when clicking outside (docked left/right stays docked like sidebar)
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (e) => {
      // In docked side panel modes (left/right), keep it docked like the navigation tree
      if (dockMode === 'left' || dockMode === 'side' || dockMode === 'right') {
        return;
      }
      // Don't close if click is inside the dictionary panel
      if (modalPanelRef.current && modalPanelRef.current.contains(e.target)) {
        return;
      }
      // Don't close if clicking on an interactive trigger meant to open/toggle dictionary
      if (e.target.closest('[data-dict-trigger]') || e.target.closest('.dict-quick-btn')) {
        return;
      }
      handleSafeDismiss(e);
    };

    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDownOutside, true);
    }, 60);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
    };
  }, [isOpen, dockMode, handleSafeDismiss]);

  // Register global window.playAudio for inline DPD audio buttons (Fix 3) - singleton + dedupe to prevent double 206
  useEffect(() => {
    window.playAudio = function (headword, buttonElement) {
      if (!headword) return;
      const now = Date.now();
      // Dedupe: inline onclick + delegated handler both fire (~0-50ms apart) → keep only first
      if (
        window._lastAudioPlay &&
        window._lastAudioPlay.headword === headword &&
        now - window._lastAudioPlay.time < 800
      ) {
        return;
      }
      window._lastAudioPlay = { headword, time: now };

      // Stop any currently playing audio (prevents overlap/echo)
      if (window._currentAudio) {
        try {
          window._currentAudio.pause();
          window._currentAudio.currentTime = 0;
        } catch (e) {}
        window._currentAudio = null;
      }

      const gender = 'male';
      const baseUrl = 'https://www.dpdict.net/audio/';
      const audioUrl = `${baseUrl}${encodeURIComponent(headword)}?gender=${gender}`;
      const audio = new Audio(audioUrl);
      window._currentAudio = audio;

      audio.addEventListener('ended', () => {
        if (window._currentAudio === audio) window._currentAudio = null;
      });
      audio.addEventListener('error', () => {
        if (window._currentAudio === audio) window._currentAudio = null;
        if (buttonElement) {
          buttonElement.innerHTML = `
            <svg viewBox="0 0 24 24" width="14px" height="14px" fill="none" stroke="currentColor" stroke-width="2" class="text-rose-500 inline-block">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          `;
          buttonElement.classList.add('disabled');
          buttonElement.style.pointerEvents = 'none';
          buttonElement.title = 'Audio not found';
          buttonElement.removeAttribute('onclick');
        }
      });

      audio.play().catch((err) => {
        if (window._currentAudio === audio) window._currentAudio = null;
        console.warn('Audio play failed:', err);
      });
    };

    return () => {
      try {
        if (window._currentAudio) {
          window._currentAudio.pause();
          window._currentAudio = null;
        }
        delete window.playAudio;
        delete window._lastAudioPlay;
        delete window._currentAudio;
      } catch (e) {}
    };
  }, []);

  // Touch Gesture Handling: Horizontal Swipe between available Tabs (Task 7: swipe down disabled)
  const touchStartRef = useRef({ x: 0, y: 0, time: 0, isHeader: false });


  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const target = e.target;
    // Don't intercept touches inside inputs or resizer
    if (target.closest('input, textarea, select, .dict-resizer-handle')) return;

    const isHeader = Boolean(target.closest('.dict-header-bar, .dict-tabs-bar'));
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      isHeader,
    };
  }, []);

  const handleTouchEnd = useCallback((e) => {
    if (e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];
    const start = touchStartRef.current;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const duration = Date.now() - start.time;

    // Only handle quick gestures (< 600ms)
    if (duration > 600) return;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Horizontal swipe gesture to switch dictionary tabs among tabs that have results
    if (absX > 45 && absX > absY * 1.3 && visibleTabs.length > 1) {
      const tabIds = visibleTabs.map((t) => t.id);
      const currentIndex = tabIds.indexOf(activeDictTab);
      if (currentIndex !== -1) {
        if (deltaX < 0) {
          // Swipe Left -> Next tab (looping)
          const nextIndex = (currentIndex + 1) % tabIds.length;
          handleTabSelect(tabIds[nextIndex]);
        } else {
          // Swipe Right -> Prev tab (looping)
          const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
          handleTabSelect(tabIds[prevIndex]);
        }
      }
    }
  }, [activeDictTab, handleTabSelect, visibleTabs]);

  // Handle word search submission
  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    inputRef.current?.blur();
    if (localInput.trim()) {
      performLookup(localInput.trim(), true);
    }
  };

  // Intercept clicks inside definitions (DPD buttons, inflection loader, auto-collapse, word jump)
  const handleContentClick = useCallback(
    async (e) => {
      // 0. Handle DPD button-box toggle play button
      const toggleBtn = e.target.closest('.dpd-toggle-play-btn');
      if (toggleBtn) {
        e.preventDefault();
        e.stopPropagation();

        const container = toggleBtn.closest('section.dp9, div.dp9, .dict-entry-item') || toggleBtn.parentElement;
        const buttonBox =
          toggleBtn.nextElementSibling &&
          (toggleBtn.nextElementSibling.classList.contains('button-box') ||
            toggleBtn.nextElementSibling.classList.contains('button_box'))
            ? toggleBtn.nextElementSibling
            : container?.querySelector('.button-box, .button_box');

        if (buttonBox) {
          const isCurrentlyCollapsed = buttonBox.classList.contains('dpd-collapsed');
          if (isCurrentlyCollapsed) {
            buttonBox.classList.remove('dpd-collapsed');
            toggleBtn.classList.add('active');
            toggleBtn.setAttribute('title', 'Hide buttons');
            toggleBtn.setAttribute('aria-label', 'Hide buttons');
          } else {
            buttonBox.classList.add('dpd-collapsed');
            toggleBtn.classList.remove('active');
            toggleBtn.setAttribute('title', 'Toggle buttons');
            toggleBtn.setAttribute('aria-label', 'Toggle buttons');

            // Collapse any open drawers/tables in this entry
            if (container) {
              const allContentDivs = container.querySelectorAll(
                '[id^="grammar_"], [id^="examples_"], [id^="declension_"], [id^="conjugation_"], [id^="family_"], [id^="feedback_"], div.content'
              );
              allContentDivs.forEach((d) => d.classList.add('hidden'));

              const allButtons = container.querySelectorAll('a.dpd-button, a.button');
              allButtons.forEach((b) => b.classList.remove('active'));
            }
          }
        }
        return;
      }

      // 1. Handle Audio play button clicks — neutralize inline onclick + delegated double-fire
      const playBtn = e.target.closest('a.dpd-button.play, button.play, a.play');
      if (playBtn) {
        e.preventDefault();
        e.stopPropagation();
        // Capture headword before removing inline handler
        const onclickAttr = playBtn.getAttribute('onclick') || '';
        const match = onclickAttr.match(/playAudio\(['"]([^'"]+)['"]/);
        const headword = match ? match[1] : queryWord;
        // Remove inline onclick so future clicks go only through delegated path (prevents recurring double)
        if (playBtn.hasAttribute('onclick')) {
          playBtn.removeAttribute('onclick');
        }
        if (typeof window.playAudio === 'function' && headword) {
          window.playAudio(headword, playBtn);
        }
        return;
      }

      // 2. Handle DPD interactive button clicks (grammar, examples, declension, conjugation, families, fb)
      const buttonEl = e.target.closest('a.dpd-button, a.button, button[data-target]');
      if (buttonEl) {
        e.preventDefault();
        e.stopPropagation();

        const targetId = buttonEl.getAttribute('data-target');
        if (!targetId) return;

        // Find enclosing entry container (div.dpd or section.dp9)
        const entryEl =
          buttonEl.closest('div.dpd') ||
          buttonEl.closest('section.dp9') ||
          buttonEl.closest('.dict-entry-box') ||
          contentContainerRef.current;

        const targetDiv = entryEl?.querySelector(`#${CSS.escape(targetId)}`) || document.getElementById(targetId);
        if (!targetDiv) return;

        const isCurrentlyHidden = targetDiv.classList.contains('hidden');

        // Fix 4: Auto-collapse all other button data in this entry so user doesn't need to scroll up and down
        if (entryEl) {
          const allContentDivs = entryEl.querySelectorAll(
            '[id^="grammar_"], [id^="examples_"], [id^="declension_"], [id^="conjugation_"], [id^="family_"], [id^="feedback_"], div.content'
          );
          allContentDivs.forEach((d) => {
            if (d !== targetDiv) {
              d.classList.add('hidden');
            }
          });

          const allButtons = entryEl.querySelectorAll('a.dpd-button, a.button');
          allButtons.forEach((b) => {
            if (b !== buttonEl) {
              b.classList.remove('active');
            }
          });
        }

        // Toggle state of clicked button & content
        if (isCurrentlyHidden) {
          // Fix 2: Fetch and render inflection table (Dual display: Converted Script + Roman Pāḷi)
          if (
            (targetId.startsWith('declension_') || targetId.startsWith('conjugation_')) &&
            (targetDiv.innerHTML.trim().length < 10 || targetDiv.innerHTML.includes('Loading'))
          ) {
            targetDiv.innerHTML = '<div class="p-3 text-xs text-[var(--text-muted)] animate-pulse">Loading inflection table...</div>';
            targetDiv.classList.remove('hidden');
            buttonEl.classList.add('active');

            try {
              const res = await fetchDictionaryInflection(targetId);
              if (res && res.html) {
                let finalInfHtml = res.html;

                // Fix 2: Dual Inflection Table Display (Converted Script on top, Roman Pāḷi below)
                if (currentScript && currentScript !== 'roman') {
                  const tempContainer = document.createElement('div');
                  tempContainer.innerHTML = res.html;

                  const origTable = tempContainer.querySelector('table.inflection');
                  if (origTable) {
                    const roTableHtml = `
                      <div class="mt-4 pt-3 border-t border-[var(--border-color)]">
                        <div class="text-xs font-bold text-center text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2">
                          Inflection in Roman Pāḷi
                        </div>
                        ${origTable.outerHTML}
                      </div>
                    `;

                    // Transliterate cells of the top table
                    const cells = origTable.querySelectorAll('td');
                    cells.forEach((cell) => {
                      const rawCellHtml = cell.innerHTML.replace(/<\/b>ṃ/g, 'ṃ</b>').replace(/<\/?b>/g, '');
                      const parts = rawCellHtml.split(/<br\s*\/?>/i);
                      const convertedParts = parts.map((part) => {
                        const cleanPart = part.replace(/<[^>]+>/g, '').trim();
                        if (!cleanPart) return part;
                        const converted = convertPaliScript(cleanPart, currentScript);
                        return `<b>${converted}</b>`;
                      });
                      cell.innerHTML = convertedParts.join('<br>');
                    });

                    finalInfHtml = tempContainer.innerHTML + roTableHtml;
                  }
                }

                targetDiv.innerHTML = finalInfHtml;

                // Highlight matching search word across both tables
                if (queryWord) {
                  highlightInflections(queryWord, targetDiv, currentScript);
                }
              } else {
                targetDiv.innerHTML = '<div class="p-2.5 text-xs text-rose-500">Inflection table not available.</div>';
              }
            } catch (err) {
              targetDiv.innerHTML = `<div class="p-2.5 text-xs text-rose-500">Failed to load: ${err.message}</div>`;
            }
          } else {
            targetDiv.classList.remove('hidden');
            buttonEl.classList.add('active');
          }

          // Smoothly scroll target content into view
          setTimeout(() => {
            targetDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 30);
        } else {
          targetDiv.classList.add('hidden');
          buttonEl.classList.remove('active');
        }
        return;
      }

      // 3. Handle external & feedback links (e.g. Google Forms, mailto, GitHub releases, sutta links)
      const externalLink = e.target.closest('a[href^="http"], a[href^="https"], a[href^="mailto"], a.link, a.dpd-link');
      if (externalLink) {
        return;
      }

      // 3.5 Handle summary jump links & anchor jumps (e.g. #dict-entry-1, #brahma_1, data-jump-index)
      const summaryOrAnchor = e.target.closest('a.summary-link, a.summary-jump-arrow, [data-jump-index], a[href^="#"]');
      if (summaryOrAnchor) {
        const jumpIdxAttr = summaryOrAnchor.getAttribute('data-jump-index');
        if (jumpIdxAttr !== null) {
          e.preventDefault();
          e.stopPropagation();
          handleJumpToEntry(parseInt(jumpIdxAttr, 10));
          return;
        }
        const href = summaryOrAnchor.getAttribute('href');
        if (href && href.startsWith('#')) {
          e.preventDefault();
          e.stopPropagation();
          const targetId = href.slice(1);
          if (targetId.startsWith('dict-entry-')) {
            const idx = parseInt(targetId.replace('dict-entry-', ''), 10);
            if (!isNaN(idx)) {
              handleJumpToEntry(idx);
              return;
            }
          }
          const targetEl =
            contentContainerRef.current?.querySelector(`#${CSS.escape(targetId)}`) ||
            contentContainerRef.current?.querySelector(`[data-anchor="${CSS.escape(targetId)}"]`) ||
            document.getElementById(targetId);
          if (targetEl && contentContainerRef.current) {
            const container = contentContainerRef.current;
            const containerRect = container.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();
            const scrollOffset = targetRect.top - containerRect.top + container.scrollTop;
            container.scrollTo({ top: Math.max(0, scrollOffset - 8), behavior: 'smooth' });
            targetEl.classList.remove('dict-entry-highlighted');
            void targetEl.offsetWidth;
            targetEl.classList.add('dict-entry-highlighted');
            setTimeout(() => {
              targetEl.classList.remove('dict-entry-highlighted');
            }, 1600);
            return;
          }
        }
      }

      // 4. Handle clicks on clickable terms / jumps inside definitions (Explicit jump links)
      const jumpLink = e.target.closest('a.jump, span.p1w, span.p2w, span.p3w, .dec-term, b.epd, .epd');
      if (jumpLink) {
        const text = jumpLink.textContent?.trim();
        if (text && text.length > 1) {
          e.preventDefault();
          e.stopPropagation();
          const cleanWord = cleanDictionaryQuery(text);
          if (cleanWord && cleanWord.length >= 2) {
            performLookup(cleanWord, true);
            return;
          }
        }
      }

      // 5. Handle clicking ANY word inside the dictionary text results
      // Don't trigger if clicked inside buttons, inputs, links, resizers, feedback boxes, or audio
      if (e.target.closest('button, input, a, select, option, .dict-resizer-handle, .play, .dpd-button, [id^="feedback_"], .feedback')) {
        return;
      }

      const clickedWord = extractWordFromPointerEvent(e);
      const cleanClicked = clickedWord ? cleanDictionaryQuery(clickedWord) : '';
      if (cleanClicked && cleanClicked.length >= 2) {
        const sel = window.getSelection()?.toString()?.trim();
        if (!sel || sel.length <= 1) {
          e.preventDefault();
          e.stopPropagation();
          performLookup(cleanClicked, true);
        }
      }
    },
    [queryWord, currentScript, performLookup, handleJumpToEntry]
  );

  // Active results list for current tab
  const currentTabResults = useMemo(() => {
    if (!lookupData) return [];
    if (activeDictTab === 'dpd') return lookupData.dpd || [];
    if (activeDictTab === 'pts') return lookupData.pts || [];
    if (activeDictTab === 'abd') return lookupData.abd || [];
    if (activeDictTab === 'psd') return lookupData.psd || [];
    if (activeDictTab === 'sans') return lookupData.sans || [];
    if (activeDictTab === 'splitter') return lookupData.splitter || [];
    return [];
  }, [lookupData, activeDictTab]);

  if (!isOpen) return null;

  const renderInnerContent = () => (
    <>
      {/* Resizer handle on left edge (when docked right/side) */}
      {(dockMode === 'side' || dockMode === 'right') && (
        <div
          className={`dict-resizer-handle dict-resizer-handle-left ${isResizing ? 'resizing' : ''}`}
          onMouseDown={startResizingWidth}
          title="Drag to resize dictionary panel width"
        />
      )}

      {/* Resizer handle on right edge (when docked left) */}
      {dockMode === 'left' && (
        <div
          className={`dict-resizer-handle dict-resizer-handle-right ${isResizing ? 'resizing' : ''}`}
          onMouseDown={startResizingWidth}
          title="Drag to resize dictionary panel width"
        />
      )}

      {/* Resizer handle on bottom edge (when top drawer) */}
      {/* Resizer handle on right edge (when docked left) */}
      {dockMode === 'left' && (
        <div
          className={`dict-resizer-handle dict-resizer-handle-right ${isResizing ? 'resizing' : ''}`}
          onMouseDown={startResizingWidth}
          title="Drag to resize dictionary panel width"
        />
      )}

      {/* ========================================================= */}
      {/* Streamlined Dictionary Header & Search Bar */}
      {/* ========================================================= */}
      <div className="dict-header-bar bg-[var(--bg-secondary)] pt-2 sm:pt-2.5 px-2 sm:px-2.5 pb-0 flex items-center gap-1.5 sm:gap-2 shrink-0 select-none">

        {/* Previous Lookup & History Controls */}
        <div className="relative flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-0.5 shrink-0 shadow-2xs">
          <button
            type="button"
            onClick={goBack}
            disabled={historyIndex <= 0}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            title="Previous lookup (Back)"
            aria-label="Previous lookup"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            ref={historyBtnRef}
            type="button"
            onClick={() => setIsHistoryOpen((prev) => !prev)}
            className={`p-1.5 rounded-lg transition cursor-pointer ${
              isHistoryOpen
                ? 'text-[var(--accent)] bg-[var(--accent-light)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
            }`}
            title="Lookup history"
            aria-label="Lookup history"
            aria-expanded={isHistoryOpen}
          >
            <History size={14} />
          </button>

          {/* History Dropdown Menu */}
          {isHistoryOpen && (
            <div
              ref={historyDropdownRef}
              className="absolute left-0 top-full mt-1.5 w-64 sm:w-72 max-w-[calc(100vw-2rem)] bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-xl overflow-hidden z-50 text-xs animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] select-none">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                  <History size={13} className="text-[var(--accent)]" />
                  <span>Recent Lookups</span>
                  {lookupHistory && lookupHistory.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--accent-light)] text-[var(--accent)] font-bold">
                      {lookupHistory.length}
                    </span>
                  )}
                </div>
                {lookupHistory && lookupHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearLookupHistory();
                    }}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 p-1 rounded hover:bg-[var(--bg-card)] transition cursor-pointer"
                    title="Clear lookup history"
                  >
                    <Trash2 size={12} />
                    <span>Clear</span>
                  </button>
                )}
              </div>

              <div className="max-h-60 overflow-y-auto divide-y divide-[var(--border-color)]/40">
                {!lookupHistory || lookupHistory.length === 0 ? (
                  <div className="px-4 py-6 text-center text-[var(--text-muted)] flex flex-col items-center gap-1.5 select-none">
                    <History size={18} className="opacity-35" />
                    <span>No recent lookup words</span>
                  </div>
                ) : (
                  lookupHistory.map((word, idx) => {
                    const isCurrent =
                      (displayWord && word.toLowerCase() === displayWord.toLowerCase()) ||
                      (queryWord && word.toLowerCase() === queryWord.toLowerCase());
                    const scriptDisplay =
                      currentScript && currentScript !== 'roman'
                        ? convertPaliScript(word, currentScript)
                        : word;

                    return (
                      <div
                        key={`${word}-${idx}`}
                        className={`group flex items-center justify-between px-3 py-2 cursor-pointer transition select-none ${
                          isCurrent
                            ? 'bg-[var(--accent-light)]/60 text-[var(--accent)] font-semibold'
                            : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                        }`}
                        onClick={() => {
                          performLookup(word, true);
                          setIsHistoryOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1 pr-2">
                          <Clock
                            size={12}
                            className={`shrink-0 ${
                              isCurrent ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] opacity-60'
                            }`}
                          />
                          <span className="truncate font-medium" title={word}>
                            {scriptDisplay}
                          </span>
                          {currentScript && currentScript !== 'roman' && scriptDisplay !== word && (
                            <span className="text-[10px] text-[var(--text-muted)] truncate shrink-0">
                              ({word})
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeLookupHistoryItem(word);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--text-muted)] hover:text-rose-600 hover:bg-[var(--bg-card)] transition shrink-0"
                          title="Remove from history"
                          aria-label={`Remove ${word} from history`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Input Field with Dictionary Icon */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-0">
          <BookSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--accent)] pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={localInput}
            onChange={(e) => {
              const raw = e.target.value;
              const isDeleting = raw.length < localInput.length;
              let finalVal = raw;
              if (!isDeleting) {
                const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
                finalVal = hasNonLatin ? raw : typeVelthuis(raw);
              }
              setLocalInput(finalVal);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearchSubmit(e);
              }
            }}
            placeholder="Dictionary - multi words & 17 pāḷi scripts input accepted"
            className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-1.5 sm:py-2 pl-9 pr-8 text-xs sm:text-sm outline-none focus:border-[var(--accent)] text-[var(--text-primary)] shadow-2xs transition"
          />
          {localInput && (
            <button
              type="button"
              onMouseDown={handleClearInput}
              onTouchStart={handleClearInput}
              onPointerDown={handleClearInput}
              onClick={handleClearInput}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] active:bg-[var(--bg-secondary)] cursor-pointer touch-manipulation z-20"
              title="Clear input"
              aria-label="Clear input"
            >
              <X size={14} />
            </button>
          )}
        </form>

        {/* Close Button */}
        <button
          type="button"
          onClick={handleSafeDismiss}
          className="flex items-center px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-card)] hover:bg-[var(--bg-secondary)] border border-[var(--border-color)] text-xs font-medium shadow-2xs transition cursor-pointer shrink-0"
          title="Close dictionary (Esc)"
          aria-label="Close dictionary"
        >
          <span>Close</span>
        </button>
      </div>

      {/* ========================================================= */}
      {/* Dictionary Switcher Tabs Bar (Only display tabs with results - Task 4) */}
      {/* ========================================================= */}
      {(visibleTabs.length > 0 || queryWord) && (
        <div className="dict-tabs-bar px-3 py-1.5 bg-[var(--bg-secondary)] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 min-h-[38px]">
          {visibleTabs.map((tab) => {
            const isActive = activeDictTab === tab.id;
            const hasMatches = tab.count > 0;
            const displayCount = tab.count > 99 ? '99+' : tab.count;

            return (
              <button
                key={tab.id}
                onClick={() => handleTabSelect(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer select-none shrink-0 transition-colors ${
                  isActive
                    ? 'bg-[var(--accent)] text-white shadow-xs'
                    : 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-color)] hover:border-[var(--accent)]'
                }`}
                title={tab.desc}
              >
                <span>{tab.label}</span>
                {hasMatches && (
                  <span className="inline-flex items-center justify-center min-w-[22px] h-[16px] shrink-0">
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold min-w-[20px] text-center leading-none inline-flex items-center justify-center ${
                        isActive ? 'bg-white/25 text-white' : 'bg-[var(--accent-light)] text-[var(--accent)]'
                      }`}
                    >
                      {displayCount}
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}


      {/* ========================================================= */}
      {/* Definition Content Body (Lean & Seamless without chunky borders) */}
      {/* ========================================================= */}
      <div
        ref={contentContainerRef}
        onClick={handleContentClick}
        className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5"
      >
        {/* Error Message */}
        {error && !isLoading && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
            {error}
          </div>
        )}

        {/* Background Loading for active non-DPD tab */}
        {!isLoading && currentTabResults.length === 0 && isBackgroundLoading && activeDictTab !== 'dpd' && queryWord && (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
            <div className="w-5 h-5 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-medium">Loading {DICT_TABS.find((t) => t.id === activeDictTab)?.label} results for &ldquo;{queryWord}&rdquo;...</span>
          </div>
        )}

        {/* ========================================================= */}
        {/* Other Dictionaries: Jump to Meaning Bar (1, 2, 3...)      */}
        {/* ========================================================= */}
        {!isLoading && activeDictTab !== 'dpd' && currentTabResults.length > 1 && (
          <div className="dict-meanings-jump-bar mb-3 bg-[var(--bg-secondary)] border border-[var(--border-color)]/80 rounded-xl p-2.5 sm:p-3 shadow-2xs space-y-2">
            {/* Header with Meaning Count & Jump Title */}
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[var(--border-color)]/50">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1">
                  <Layers size={13} className="shrink-0" />
                  <span>Jump to meaning</span>
                </span>
                <span className="inline-flex items-center justify-center min-w-[22px] h-[16px] shrink-0">
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold min-w-[20px] text-center leading-none inline-flex items-center justify-center bg-[var(--accent)] text-white">
                    {currentTabResults.length}
                  </span>
                </span>
              </div>

              {/* Quick Jump Pills (1, 2, 3...) & Toggle */}
              <div className="flex items-center gap-1 shrink-0">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                  {currentTabResults.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleJumpToEntry(i)}
                      className="inline-flex items-center justify-center min-w-[22px] h-[18px] rounded-full text-[10px] font-bold bg-[var(--bg-card)] hover:bg-[var(--accent)] text-[var(--text-primary)] hover:text-white border border-[var(--border-color)] hover:border-[var(--accent)] transition-all cursor-pointer shadow-2xs"
                      title={`Jump to meaning ${i + 1}`}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={toggleMeaningsExpanded}
                  className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition cursor-pointer ml-1"
                  title={isMeaningsExpanded ? 'Collapse meanings preview' : 'Expand meanings preview'}
                  aria-label={isMeaningsExpanded ? 'Collapse meanings preview' : 'Expand meanings preview'}
                >
                  {isMeaningsExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
              </div>
            </div>

            {/* Meaning Quick Jump Buttons (Links to Jump to Meaning 1, 2, 3...) */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {currentTabResults.map((item, idx) => {
                const itemSummary = extractOtherSummaryItem(item.html, activeDictTab, item.word, idx);
                const displayHw =
                  activeDictTab === 'pts' || activeDictTab === 'splitter'
                    ? convertPaliScript(itemSummary.headword, currentScript) || itemSummary.headword
                    : itemSummary.headword;

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleJumpToEntry(idx)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-card)] hover:bg-[var(--accent-light)] text-[var(--text-primary)] hover:text-[var(--accent)] border border-[var(--border-color)] hover:border-[var(--accent)] transition-all cursor-pointer shadow-2xs group"
                    title={`Jump to Meaning ${idx + 1}: ${displayHw}`}
                  >
                    <span className="inline-flex items-center justify-center min-w-[22px] h-[16px] shrink-0">
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold min-w-[20px] text-center leading-none inline-flex items-center justify-center bg-[var(--accent)] text-white group-hover:scale-105 transition-transform">
                        {idx + 1}
                      </span>
                    </span>
                    <span className="font-semibold">Meaning {idx + 1}</span>
                    {itemSummary.label && (
                      <span className="text-[11px] text-[var(--text-muted)] group-hover:text-[var(--accent)]/80 max-w-[130px] truncate">
                        ({itemSummary.label})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* At-a-glance Detailed Meanings Preview List (Expanded by default) */}
            {isMeaningsExpanded && (
              <div className="pt-2 border-t border-[var(--border-color)]/50 space-y-1.5">
                {currentTabResults.map((item, idx) => {
                  const itemSummary = extractOtherSummaryItem(item.html, activeDictTab, item.word, idx);
                  const displayHw =
                    activeDictTab === 'pts' || activeDictTab === 'splitter'
                      ? convertPaliScript(itemSummary.headword, currentScript) || itemSummary.headword
                      : itemSummary.headword;

                  return (
                    <div
                      key={idx}
                      onClick={() => handleJumpToEntry(idx)}
                      className="dict-summary-row flex items-baseline justify-between gap-2 p-1.5 rounded-lg hover:bg-[var(--bg-card)] transition-colors group cursor-pointer text-xs"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 min-w-0">
                        <span className="text-[10px] font-mono text-[var(--text-muted)] font-semibold shrink-0">
                          {idx + 1}.
                        </span>
                        <a
                          href={`#dict-entry-${idx}`}
                          onClick={(e) => {
                            e.preventDefault();
                            handleJumpToEntry(idx);
                          }}
                          className="summary-link font-bold text-[var(--accent)] hover:underline whitespace-nowrap"
                          title={`Jump to Meaning ${idx + 1}`}
                        >
                          Meaning {idx + 1}: {displayHw}
                        </a>
                        {itemSummary.pos && (
                          <span className="text-[var(--text-muted)] italic font-serif text-[11px]">
                            {itemSummary.pos}
                          </span>
                        )}
                        {itemSummary.snippet && (
                          <span className="text-[var(--text-secondary)] text-[11.5px] leading-relaxed">
                            {itemSummary.snippet}...
                          </span>
                        )}
                      </div>
                      <span className="summary-jump-arrow text-[var(--accent)] opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all text-xs font-bold px-1 shrink-0">
                        ►
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* Results List                                              */}
        {/* ========================================================= */}
        {!isLoading && currentTabResults.length > 0 && (
          <div className="space-y-3">
            {currentTabResults.map((item, idx) => {
              const rawHtml = item.html || '';
              const processedHtml = convertDictionaryEntryHtml(rawHtml, activeDictTab, currentScript);

              // Extract item headword for anchor
              const s =
                activeDictTab === 'dpd'
                  ? extractDpdSummaryItem(rawHtml, item.word)
                  : extractOtherSummaryItem(rawHtml, activeDictTab, item.word, idx);
              const itemHw = s.headword;
              const lemmaAnchor = itemHw ? itemHw.toLowerCase().replace(/\s+/g, '_') : '';

              return (
                <div
                  key={idx}
                  id={`dict-entry-${idx}`}
                  data-anchor={lemmaAnchor}
                  className="dict-entry-item pb-3 mb-3 border-b border-[var(--border-color)]/30 last:border-b-0 last:pb-0 last:mb-0 transition-colors"
                >
                  {/* Anchor for lemma hash e.g. #brahma_1 */}
                  {lemmaAnchor && <span id={lemmaAnchor} className="sr-only" />}

                  {/* Entry Meaning Header (only for non-DPD dictionaries when multiple entries exist) */}
                  {activeDictTab !== 'dpd' && currentTabResults.length > 1 && (
                    <div className="flex items-center justify-end py-0.5 px-2 mb-2 rounded-lg bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] border border-[var(--border-color)]/60">
                      <button
                        type="button"
                        onClick={() => {
                          if (contentContainerRef.current) {
                            contentContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                            setIsMeaningsExpanded(true);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer py-0.5 shrink-0"
                        title="Jump back to meanings"
                      >
                        <span className="inline-flex items-center justify-center h-[16px] shrink-0">
                          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold text-center leading-none inline-flex items-center justify-center bg-[var(--accent)] text-white">
                            {idx + 1}/{currentTabResults.length}
                          </span>
                        </span>
                        <span>↑ Meanings</span>
                      </button>
                    </div>
                  )}

                  <div
                    className="dp9 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: processedHtml }}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* No results for current tab (after loading is complete) */}
        {!isLoading && !isBackgroundLoading && currentTabResults.length === 0 && queryWord && (
          <div className="py-10 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--text-muted)]">
              <BookOpen size={20} />
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              No entries found in <b>{DICT_TABS.find((t) => t.id === activeDictTab)?.label}</b> for &ldquo;{queryWord}&rdquo;.
            </p>
            {lookupData?.hasResults && (
              <p className="text-xs text-[var(--accent)]">
                Check other tabs above for matching entries in different dictionaries.
              </p>
            )}
          </div>
        )}

        {/* Initial / Empty State with Suggestions */}
        {!isLoading && !queryWord && (
          <div className="py-8 text-center space-y-4 text-xs text-[var(--text-muted)]">
            <div className="w-12 h-12 mx-auto rounded-full bg-[var(--bg-secondary)] flex items-center justify-center text-[var(--accent)]">
              <Sparkles size={22} />
            </div>
            <div className="max-w-sm mx-auto space-y-1">
              <h4 className="font-bold text-[var(--text-primary)] text-sm">Comprehensive Pāḷi Dictionaries</h4>
              <p className="text-[11.5px] text-[var(--text-secondary)] leading-relaxed">
                Type any Pāḷi word, root, or inflected form in the search box above, or double-click any word in the reader to look up definitions instantly.
              </p>
            </div>

            {/* Sample Quick Terms */}
            <div className="pt-2">
              <span className="text-[11px] text-[var(--text-muted)] block mb-2">Try quick lookup:</span>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
		{['buddha', 'dhamma', 'saṅgha', 'nibbāna', 'anatta', 'how are you', 'venerable paññindriya', 'sīla', 'samādhi', 'paññā', 'mettā'].map((w) => (
                  <button
                    key={w}
                    onClick={() => performLookup(w, true)}
                    className="px-2.5 py-1 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] border border-[var(--border-color)] text-xs font-mono transition cursor-pointer"
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );

  // 1. Center Modal Mode
  if (dockMode === 'modal') {
    return (
      <div
        className="dict-overlay animate-fade-in"
        onClick={handleSafeDismiss}
        onTouchEnd={(e) => {
          if (e.target === e.currentTarget) {
            handleSafeDismiss(e);
          }
        }}
      >
        <div
          ref={modalPanelRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="dict-panel-modal flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] border-[var(--border-color)]"
          style={{ '--dict-font-size': `${15 * fontSizeMultiplier}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          {renderInnerContent()}
        </div>
      </div>
    );
  }

  // 2. Docked Left or Right Panels (Docked into layout alongside Reader & Sidebar)
  return (
    <aside
      ref={modalPanelRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={`dict-dock-panel dock-${dockMode === 'left' ? 'left' : 'side'} flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] ${
        isResizing ? 'select-none' : ''
      }`}
      style={{
        width: `${dictWidth}px`,
        '--dict-font-size': `${15 * fontSizeMultiplier}px`,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {renderInnerContent()}
    </aside>
  );
}
