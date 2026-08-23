'use client';

import React from 'react';
import { useTabs } from '../../context/TabContext';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript } from '../../services/transliterate';

const QUICK_STARTS = [
  {
    code: 'vin01m.mul',
    title: 'Vinayapiṭaka',
    desc: 'Pārājikapāḷi, Pācittiyapāḷi, Mahāvaggapāḷi, Cullavaggapāḷi, Parivārapāḷi',
  },
  {
    code: 's0101m.mul',
    title: 'Dīghanikāya',
    desc: 'Sīlakkhandhavaggapāḷi, Mahāvaggapāḷi, Pāthikavaggapāḷi',
  },
  {
    code: 's0201m.mul',
    title: 'Majjhimanikāya',
    desc: 'Mūlapaṇṇāsapāḷi, Majjhimapaṇṇāsapāḷi, Uparipaṇṇāsapāḷi',
  },
  {
    code: 's0502m.mul',
    title: 'Dhammapadapāḷi',
    desc: 'Yamakavaggo, Appamādavaggo, Cittavaggo, Pupphavaggo, Bālavaggo',
  },
];

export default function WelcomeView() {
  const { openBook } = useTabs();
  const { settings } = useThemeSettings();

  return (
    <div className="welcome-view">
      <div className="welcome-icon">🪷</div>
      <h1 className="welcome-title">{convertPaliScript('Chaṭṭha Saṅgāyana Tipiṭaka', settings?.paliScript)}</h1>
      <p className="welcome-desc">
        Explore the complete canonical Pali scriptures. Select any book from the
        navigation tree on the left, open multiple books in tabs, or search across 520,000+
        paragraphs.
      </p>
      <div className="category-grid">
        {QUICK_STARTS.map((item) => (
          <div
            key={item.code}
            className="category-card"
            onClick={() => openBook(item.code, { targetChapterIdx: 0 })}
          >
            <h3>{convertPaliScript(item.title, settings?.paliScript)}</h3>
            <p>{convertPaliScript(item.desc, settings?.paliScript)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

