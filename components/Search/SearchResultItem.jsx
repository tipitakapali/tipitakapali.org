'use client';

import React from 'react';
import { Book } from 'lucide-react';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript, transliterateHtml, capitalizePali } from '../../services/transliterate';

export default function SearchResultItem({ result, onClick }) {
  const { settings } = useThemeSettings();
  const displayTitle = convertPaliScript(capitalizePali(result.book_title), settings?.paliScript);
  const displayNikaya = convertPaliScript(capitalizePali(result.nikaya || ''), settings?.paliScript);
  const displaySnippet = transliterateHtml(result.snippet, settings?.paliScript);

  return (
    <div className="search-result-item" onClick={onClick}>
      <div className="result-meta">
        <Book size={13} className="result-icon" />
        <span>{displayTitle}</span>
        {result.para_num && (
          <span className="result-paran-badge">Para #{result.para_num}</span>
        )}
        {displayNikaya && <span className="result-nikaya-badge">{displayNikaya}</span>}
      </div>
      <div
        className="result-snippet"
        dangerouslySetInnerHTML={{ __html: displaySnippet }}
      />
    </div>
  );
}

