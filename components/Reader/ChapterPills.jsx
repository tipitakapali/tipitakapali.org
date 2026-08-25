'use client';

import React, { useRef, useEffect } from 'react';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript, capitalizePali } from '../../services/transliterate';

export default function ChapterPills({ chapters: propsChapters, currentChapterIdx: propsIdx, onChapterSelect: propsOnSelect }) {
  const { activeTab, setChapterForActiveTab } = useTabs();
  const { settings } = useThemeSettings();
  const pillsScrollRef = useRef(null);

  const chapters = propsChapters || activeTab?.chapters || [];
  const currentChapterIdx = propsIdx !== undefined ? propsIdx : (activeTab?.currentChapterIdx || 0);
  const onChapterSelect = propsOnSelect || setChapterForActiveTab;

  useEffect(() => {
    if (pillsScrollRef.current) {
      const activeEl = pillsScrollRef.current.querySelector('.chapter-pill.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [currentChapterIdx]);

  if (!chapters || chapters.length <= 1) return null;

  return (
    <div className="chapter-pills-bar" ref={pillsScrollRef}>
      {chapters.map((chap, i) => {
        const isActive = i === currentChapterIdx;
        const displayTitle = convertPaliScript(capitalizePali(chap.title), settings?.paliScript) || `Chapter ${i + 1}`;
        return (
          <button
            key={chap.chapter_index !== undefined ? chap.chapter_index : i}
            className={`chapter-pill ${isActive ? 'active' : ''}`}
            onClick={() => onChapterSelect(i)}
            title={displayTitle}
          >
            <span className="chapter-num-badge">{i + 1}</span>
            <span className="chapter-pill-title">{displayTitle}</span>
          </button>
        );
      })}
    </div>
  );
}

