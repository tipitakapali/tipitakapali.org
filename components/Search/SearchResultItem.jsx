'use client';

import React from 'react';
import { Book } from 'lucide-react';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript, transliterateHtml, capitalizePali, convertAnyToRoman, normalizePaliForSearch } from '../../services/transliterate';

function getNikayaBadgeKey(nikayaRaw, bookCode) {
  const raw = String(nikayaRaw || '').trim();
  let norm = '';
  try {
    const roman = convertAnyToRoman(raw) || raw;
    norm = normalizePaliForSearch(roman).toLowerCase();
  } catch (_) {
    norm = raw.toLowerCase();
  }
  // Fallback via book_code prefix when nikaya is empty / ambiguous
  if (!norm || norm.length < 2) {
    const code = String(bookCode || '').toLowerCase();
    if (code.startsWith('vin') || code.startsWith('vi')) return 'vinaya';
    if (code.startsWith('s01')) return 'digha';
    if (code.startsWith('s02')) return 'majjhima';
    if (code.startsWith('s03')) return 'samyutta';
    if (code.startsWith('s04')) return 'anguttara';
    if (code.startsWith('s05')) return 'khuddaka';
    if (code.startsWith('abh')) return 'abhidhamma';
    if (code.startsWith('e')) return 'anna';
    if (code.startsWith('s0')) return 'sutta';
    return 'default';
  }
  if (norm.includes('vinaya')) return 'vinaya';
  if (norm.includes('digha')) return 'digha';
  if (norm.includes('majjhima')) return 'majjhima';
  if (norm.includes('samyutta') || norm.includes('samyut')) return 'samyutta';
  if (norm.includes('anguttara')) return 'anguttara';
  if (norm.includes('khuddaka')) return 'khuddaka';
  if (norm.includes('abhidhamma') || norm.includes('abhidham') || norm.includes('abhidhamavatara')) return 'abhidhamma';
  if (norm.includes('suttanta') || norm === 'sutta' || norm.includes('suttanta')) return 'sutta';
  if (norm.includes('anna') || norm.includes('anya') || norm.includes('abhidhamavatara')) return 'anna';
  // Generic sutta pitaka fallback (e.g. "Suttantapitaka")
  if (norm.includes('sutta')) return 'sutta';
  return 'default';
}

export default function SearchResultItem({ result, onClick }) {
  const { settings } = useThemeSettings();
  const displayTitle = convertPaliScript(capitalizePali(result.book_title), settings?.paliScript);
  const displayNikaya = convertPaliScript(capitalizePali(result.nikaya || ''), settings?.paliScript);
  const displaySnippet = transliterateHtml(result.snippet, settings?.paliScript);
  const badgeKey = getNikayaBadgeKey(result.nikaya, result.book_code);

  return (
    <div className="search-result-item" onClick={onClick}>
      <div className="result-meta">
        <Book size={13} className="result-icon" />
        <span>{displayTitle}</span>
        {result.para_num && (
          <span className="result-paran-badge">Para #{result.para_num}</span>
        )}
        {displayNikaya && (
          <span className={`result-nikaya-badge nikaya-badge-${badgeKey}`} title={result.nikaya}>
            <span className="nikaya-badge-dot" aria-hidden="true" />
            {displayNikaya}
          </span>
        )}
      </div>
      <div
        className="result-snippet"
        dangerouslySetInnerHTML={{ __html: displaySnippet }}
      />
    </div>
  );
}

