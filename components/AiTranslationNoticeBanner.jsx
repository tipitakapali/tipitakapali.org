'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useThemeSettings } from '../context/ThemeSettingsContext';

const NOTICE_DISMISSED_KEY = 'tipitaka_ai_translation_notice_dismissed_v2';
const SHOW_WEB_AI_NOTICE = process.env.NEXT_PUBLIC_OFFLINE_APP !== 'true';

/**
 * Compact, cookie-banner-style bottom notice informing web visitors that
 * translations are AI-assisted and should be verified against the Pāḷi text.
 */
export default function AiTranslationNoticeBanner() {
  const { settings, isMounted } = useThemeSettings();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!SHOW_WEB_AI_NOTICE || typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(NOTICE_DISMISSED_KEY);
      setDismissed(saved === '1' || saved === 'true');
    } catch (_) {
      setDismissed(false);
    }
  }, []);

  if (!SHOW_WEB_AI_NOTICE || !isMounted || dismissed) {
    return null;
  }

  const hasEnabledTranslation = Object.entries(settings?.translations || {}).some(
    ([key, enabled]) => key !== 'pali' && Boolean(enabled)
  );
  if (!hasEnabledTranslation) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(NOTICE_DISMISSED_KEY, '1');
    } catch (_) {}
  };

  return (
    <div
      role="region"
      aria-label="AI translation notice"
      className="fixed bottom-3 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-3xl z-[900] pointer-events-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="pointer-events-auto rounded-xl border border-amber-500/35 bg-[var(--bg-secondary)]/95 backdrop-blur-md shadow-xl px-3.5 py-2.5 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-[var(--text-primary)]">
        <div className="flex items-start gap-2.5 min-w-0">
          <AlertTriangle
            size={17}
            className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">AI Translation Notice:</strong>{' '}
            Translations are AI-assisted (adapted from{' '}
            <a
              href="https://epitaka.org/about"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] underline font-semibold"
            >
              Epitaka
            </a>
            ) and may contain inaccuracies. Please use them as study aids and verify against the original Pāḷi text.
          </p>
        </div>

        <div className="flex items-center justify-end gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleDismiss}
            className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-semibold hover:opacity-90 transition cursor-pointer whitespace-nowrap"
          >
            Got it
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss AI translation notice"
            title="Dismiss"
            className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] transition cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
