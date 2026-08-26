'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  BookA,
  X,
  Search,
  ArrowLeft,
  ArrowRight,
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
} from 'lucide-react';
import { useDictionary } from '../context/DictionaryContext';
import { useThemeSettings } from '../context/ThemeSettingsContext';
import { typeVelthuis, convertAnyToRoman, convertPaliScript, cleanDictionaryQuery } from '../services/transliterate';
import { fetchDictionaryInflection } from '../services/api';

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
  if (!rawHtml || !targetScript || targetScript === 'roman') return rawHtml;
  if (typeof window === 'undefined') return rawHtml;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

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
    goForward,
    setDictTab,
    setDockMode,
    setFontSizeMultiplier,
    setDisplayWord,
  } = useDictionary();

  const { settings } = useThemeSettings();
  const [localInput, setLocalInput] = useState('');
  const inputRef = useRef(null);
  const contentContainerRef = useRef(null);
  const modalPanelRef = useRef(null);

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

  // Synchronize local input with context display word
  useEffect(() => {
    setLocalInput(displayWord || queryWord || '');
  }, [displayWord, queryWord]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 80);
    }
  }, [isOpen]);

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
      closeDictionary();
    };

    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDownOutside, true);
    }, 60);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
    };
  }, [isOpen, dockMode, closeDictionary]);

  // Register global window.playAudio for inline DPD audio buttons (Fix 3)
  useEffect(() => {
    window.playAudio = function (headword, buttonElement) {
      if (!headword) return;
      const gender = 'male';
      const baseUrl = 'https://www.dpdict.net/audio/';
      const audioUrl = `${baseUrl}${encodeURIComponent(headword)}?gender=${gender}`;
      const audio = new Audio(audioUrl);

      audio.addEventListener('error', () => {
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
        console.warn('Audio play failed:', err);
      });
    };

    return () => {
      try {
        delete window.playAudio;
      } catch (e) {}
    };
  }, []);

  // Touch Gesture Handling: Horizontal Swipe between Tabs (looping) + Pull Down to Dismiss
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

    // 1. Pull down gesture to dismiss (minimum 70px vertical swipe downwards)
    if (deltaY > 70 && absY > absX * 1.3) {
      const isAtTop = !contentContainerRef.current || contentContainerRef.current.scrollTop <= 5;
      if (start.isHeader || isAtTop) {
        closeDictionary();
        return;
      }
    }

    // 2. Horizontal swipe gesture to switch dictionary tabs (looping among dictionary tabs)
    if (absX > 45 && absX > absY * 1.3) {
      const tabIds = ['dpd', 'pts', 'abd', 'psd', 'sans', 'splitter'];
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
  }, [activeDictTab, closeDictionary, handleTabSelect]);

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
      // 1. Handle Audio play button clicks
      const playBtn = e.target.closest('a.dpd-button.play, button.play, a.play');
      if (playBtn) {
        e.preventDefault();
        e.stopPropagation();
        const onclickAttr = playBtn.getAttribute('onclick') || '';
        const match = onclickAttr.match(/playAudio\(['"]([^'"]+)['"]/);
        const headword = match ? match[1] : queryWord;
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

      // 3. Handle external links (e.g. feedback links, sutta external links)
      const externalLink = e.target.closest('a[href^="http"], a.link');
      if (externalLink && externalLink.getAttribute('href')?.startsWith('http')) {
        return;
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

      // 5. Handle clicking ANY word inside the dictionary text results (Task 3)
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
    [queryWord, currentScript, performLookup]
  );

  // Dictionary tab specifications
  const DICT_TABS = useMemo(
    () => [
      { id: 'dpd', label: 'DPD', desc: 'Digital Pāḷi Dictionary', count: lookupData?.counts?.dpd || 0 },
      { id: 'pts', label: 'PTS', desc: 'Pali Text Society PED', count: lookupData?.counts?.pts || 0 },
      { id: 'abd', label: 'အဘိဓာန်', desc: 'Abhidhānappadīpikā (MM)', count: lookupData?.counts?.abd || 0 },
      { id: 'psd', label: 'පාලි-සිංහල', desc: 'Pāli-Sinhala Dictionary', count: lookupData?.counts?.psd || 0 },
      { id: 'sans', label: 'Sanskrit', desc: 'Apte / Monier-Williams', count: lookupData?.counts?.sans || 0 },
      { id: 'splitter', label: 'Splitter', desc: 'Compound Deconstructor', count: lookupData?.counts?.splitter || 0 },
    ],
    [lookupData]
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
      {/* Top Header Bar */}
      {/* ========================================================= */}
      <div className="dict-header-bar px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center justify-between gap-1.5 sm:gap-2 select-none shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center text-[var(--accent)] shrink-0">
            <BookA size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs sm:text-sm font-bold tracking-tight text-[var(--text-primary)] truncate">
                Pāḷi Dictionary
              </h3>
              {queryWord && (
                <span className="hidden sm:inline-block text-[11px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--accent)] font-semibold truncate max-w-[120px]">
                  {queryWord}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Toolbar: History & Font Controls (Visible and center-aligned on mobile + desktop) */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* History Back / Forward */}
          <div className="flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-0.5">
            <button
              onClick={goBack}
              disabled={historyIndex <= 0}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title="Previous lookup (Back)"
              aria-label="Previous lookup"
            >
              <ArrowLeft size={13} />
            </button>
            <button
              onClick={goForward}
              disabled={historyIndex >= history.length - 1}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title="Next lookup (Forward)"
              aria-label="Next lookup"
            >
              <ArrowRight size={13} />
            </button>
          </div>

          {/* Font Size Adjust (Visible on mobile & desktop) */}
          <div className="flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-0.5 text-[11px]">
            <button
              onClick={() => setFontSizeMultiplier((f) => f - 0.1)}
              className="px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] font-bold transition cursor-pointer"
              title="Smaller font"
              aria-label="Smaller font"
            >
              A-
            </button>
            <span className="px-1 font-mono text-[10px] text-[var(--text-secondary)]">
              {Math.round(fontSizeMultiplier * 100)}%
            </span>
            <button
              onClick={() => setFontSizeMultiplier((f) => f + 0.1)}
              className="px-1.5 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] font-bold transition cursor-pointer"
              title="Larger font"
              aria-label="Larger font"
            >
              A+
            </button>
          </div>

          {/* Dock Position Switcher: Left Dock, Center Modal, Right Dock (Desktop only) */}
          <div className="hidden md:flex items-center bg-[var(--bg-card)] border border-[var(--border-color)] rounded-lg p-0.5">
            <button
              onClick={() => setDockMode('left')}
              className={`p-1 rounded transition cursor-pointer ${dockMode === 'left' ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              title="Left Dock Panel mode (Tree docks Right)"
            >
              <PanelLeft size={13} />
            </button>
            <button
              onClick={() => setDockMode('modal')}
              className={`p-1 rounded transition cursor-pointer ${dockMode === 'modal' ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              title="Center Modal mode"
            >
              <Maximize2 size={13} />
            </button>
            <button
              onClick={() => setDockMode('side')}
              className={`p-1 rounded transition cursor-pointer ${dockMode === 'side' || dockMode === 'right' ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              title="Right Dock Panel mode (Tree docks Left)"
            >
              <PanelRight size={13} />
            </button>
          </div>

          {/* Close Button with "Close" text label for easy touch */}
          <button
            onClick={closeDictionary}
            className="flex items-center gap-1 px-2 py-1 sm:px-2.5 sm:py-1 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200/80 dark:border-rose-900/50 text-xs font-semibold transition cursor-pointer min-h-[30px] touch-manipulation"
            title="Close dictionary (Esc)"
            aria-label="Close dictionary"
          >
            <X size={14} className="stroke-[2.5]" />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* Search Input Bar */}
      {/* ========================================================= */}
      <div className="p-2.5 sm:p-3 bg-[var(--bg-primary)] border-b border-[var(--border-color)] shrink-0">
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              type="text"
              value={localInput}
              onChange={(e) => {
                const raw = e.target.value;
                const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(raw);
                const converted = hasNonLatin ? raw : typeVelthuis(raw);
                setLocalInput(converted);
                setDisplayWord(converted);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.target?.blur();
                }
              }}
              placeholder="Multi words, 17 Pāḷi scripts & Velthuis input accepted"
              className="w-full bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl py-2 pl-9 pr-8 text-xs sm:text-sm outline-none focus:border-[var(--accent)] text-[var(--text-primary)] shadow-xs transition"
            />
            {localInput && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setLocalInput('');
                  setDisplayWord('');
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setLocalInput('');
                  setDisplayWord('');
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer touch-manipulation z-10"
                title="Clear input"
                aria-label="Clear input"
              >
                <X size={15} />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || !localInput.trim()}
            className="px-3.5 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-semibold hover:bg-[var(--accent-hover)] disabled:opacity-40 disabled:pointer-events-none shadow-xs transition shrink-0 cursor-pointer"
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {/* ========================================================= */}
      {/* Dictionary Switcher Tabs Bar */}
      {/* ========================================================= */}
      <div className="dict-tabs-bar px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
        {DICT_TABS.map((tab) => {
          const isActive = activeDictTab === tab.id;
          const hasMatches = tab.count > 0;
          const isTabPending = isBackgroundLoading && tab.id !== 'dpd' && tab.count === 0;

          return (
            <button
              key={tab.id}
              onClick={() => handleTabSelect(tab.id)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition cursor-pointer select-none ${
                isActive
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : hasMatches
                  ? 'bg-[var(--bg-card)] text-[var(--text-primary)] border border-[var(--border-color)] hover:border-[var(--accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
              title={tab.desc}
            >
              <span>{tab.label}</span>
              {hasMatches ? (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    isActive ? 'bg-white/25 text-white' : 'bg-[var(--accent-light)] text-[var(--accent)]'
                  }`}
                >
                  {tab.count}
                </span>
              ) : isTabPending ? (
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]/60 animate-pulse inline-block" />
              ) : null}
            </button>
          );
        })}
      </div>

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

        {/* Results List */}
        {!isLoading && currentTabResults.length > 0 && (
          <div className="space-y-2">
            {currentTabResults.map((item, idx) => {
              const rawHtml = item.html || '';
              const processedHtml = convertDictionaryEntryHtml(rawHtml, activeDictTab, currentScript);

              return (
                <div
                  key={idx}
                  className="dict-entry-item pb-2.5 mb-2.5 border-b border-[var(--border-color)]/30 last:border-b-0 last:pb-0 last:mb-0"
                >
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
                {['buddha', 'dhamma', 'saṅgha', 'bhikkhu', 'nibbāna', 'anatta', 'dukkha', 'paññā', 'samādhi', 'mettā'].map((w) => (
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
        onClick={closeDictionary}
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
