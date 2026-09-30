'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { X, BookOpen, ExternalLink, Globe, Loader2, Quote, Sparkles } from 'lucide-react';
import { useThemeSettings } from '../../context/ThemeSettingsContext';
import { convertPaliScript, transliterateHtml } from '../../services/transliterate';
import { getApiBase } from '../../services/api';
import { TRANSLATIONS } from '../LanguageMenu';

// Translation language key → canonical DB lang code (subset used by the quick view)
const TRANS_ID_TO_CODE = {
  english: 'en',
  vietnamese: 'vi',
  myanmar: 'my',
  my_nissaya: 'my_nissaya',
  sinhala: 'si',
  chinese: 'zh',
  khmer: 'km',
  thai: 'th',
  lao: 'lo',
  tamil: 'ta',
  hindi: 'hi',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  indonesian: 'id',
  nepali: 'ne',
  bengali: 'be',
  portuguese: 'pt',
  russian: 'ru',
};

// Localized “Translation” heading per language code (mirrors LanguageMenu descriptions)
const LANG_HEADERS = {
  en: 'English Translation',
  vi: 'Bản dịch Tiếng Việt',
  my: 'မြန်မာဘာသာပြန်',
  my_nissaya: 'Myanmar Nissaya',
  si: 'සිංහල පරිවර්තනය',
  zh: '中文翻译',
  km: 'ការបកប្រែជាភាសាខ្មែរ',
  th: 'ฉบับแปลภาษาไทย',
  lo: 'ການແປພາສາລາວ',
  ta: 'தமிழ் மொழிபெயர்ப்பு',
  hi: 'हिन्दी अनुवाद',
  de: 'Deutsche Übersetzung',
  ja: '日本語訳',
  ko: '한국어 번역',
  id: 'Terjemahan Bahasa Indonesia',
  ne: 'नेपाली अनुवाद',
  be: 'বাংলা অনুবাদ',
  pt: 'Tradução em Português',
  ru: 'Русский перевод',
};

// Language id → colour used by the language menu (for the heading accent)
const TRANS_ID_COLOR = Object.fromEntries(
  TRANSLATIONS.filter((t) => t.id !== 'pali').map((t) => [t.id, t.color])
);

export default function CitationQuickviewModal({ isOpen, citation, onClose, onOpenInReader }) {
  const { settings } = useThemeSettings();
  const [loading, setLoading] = useState(false);
  const [passageData, setPassageData] = useState(null);
  const [citedSentence, setCitedSentence] = useState(null);
  const [error, setError] = useState(null);

  // Pāḷi + the next two enabled translation languages, in the user's order
  const previewLangs = useMemo(() => {
    const order = Array.isArray(settings?.translationOrder) && settings.translationOrder.length > 0
      ? settings.translationOrder
      : TRANSLATIONS.map((t) => t.id);
    const langs = [];
    for (const id of order) {
      if (id === 'pali' || !TRANS_ID_TO_CODE[id]) continue;
      if (settings?.translations?.[id] && !langs.some((l) => l.id === id)) {
        langs.push({
          id,
          code: TRANS_ID_TO_CODE[id],
          label: LANG_HEADERS[TRANS_ID_TO_CODE[id]] || id,
          color: TRANS_ID_COLOR[id],
        });
        if (langs.length >= 2) break;
      }
    }
    if (langs.length === 0) {
      langs.push({
        id: 'english',
        code: 'en',
        label: LANG_HEADERS['en'] || 'English Translation',
        color: TRANS_ID_COLOR['english'] || '#3b82f6',
      });
    }
    return langs;
  }, [settings?.translationOrder, settings?.translations]);

  useEffect(() => {
    if (!isOpen || !citation) {
      setPassageData(null);
      setCitedSentence(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);
    setCitedSentence(null);

    const { bookCode, chapterIndex = 0, paraIndex = 0, paraEnd, lineId } = citation;
    const endPara = paraEnd !== null && paraEnd !== undefined ? paraEnd : paraIndex;
    const langsParam = previewLangs.map((l) => l.code).join(',');
    const paraUrl = `${getApiBase()}/api/ai/paragraph_content?book=${encodeURIComponent(bookCode)}&chapter=${chapterIndex}&start=${paraIndex}&end=${endPara}&langs=${encodeURIComponent(langsParam)}`;

    const fetchParaPromise = fetch(paraUrl).then((res) => {
      if (!res.ok) throw new Error(`Failed to load passage (${res.status})`);
      return res.json();
    });

    const fetchSentencePromise = lineId
      ? fetch(`${getApiBase()}/api/ai/sentences?book=${encodeURIComponent(bookCode)}&chapter=${chapterIndex}&para_index=${paraIndex}&langs=${encodeURIComponent(langsParam)}`)
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null)
      : Promise.resolve(null);

    Promise.all([fetchParaPromise, fetchSentencePromise])
      .then(([paraResult, sentenceResult]) => {
        if (!isMounted) return;

        if (sentenceResult?.success && sentenceResult.pali_sentences && lineId) {
          const targetPali = sentenceResult.pali_sentences.find((s) => s.line_id === lineId);
          if (targetPali) {
            const transMap = {};
            for (const l of previewLangs) {
              const tr = (sentenceResult.translations?.[l.code] || []).find((t) => t.line_id === lineId);
              if (tr) transMap[l.code] = tr.translation;
            }
            setCitedSentence({
              lineId,
              pali: targetPali.sentence || targetPali.text,
              translations: transMap,
            });
          }
        }

        if (paraResult.success && paraResult.passages && paraResult.passages.length > 0) {
          if (paraResult.passages.length === 1) {
            setPassageData(paraResult.passages[0]);
          } else {
            const first = paraResult.passages[0];
            const combinedPali = paraResult.passages.map((p) => p.pali).filter(Boolean).join('\n\n');
            const translations = {};
            for (const l of previewLangs) {
              const texts = paraResult.passages.map((p) => p.translations?.[l.code]).filter(Boolean);
              if (texts.length > 0) translations[l.code] = texts.join('\n\n');
            }
            setPassageData({
              ...first,
              para_num: `${first.para_num || paraIndex}–${paraResult.passages[paraResult.passages.length - 1].para_num || endPara}`,
              pali: combinedPali,
              translations,
            });
          }
        } else if (!lineId) {
          setError('Passage content not found in local database.');
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'Error fetching citation passage');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, citation, previewLangs]);

  if (!isOpen || !citation) return null;

  const { bookCode, chapterIndex = 0, paraIndex = 0, paraEnd, lineId, ref = '' } = citation;
  const bookTitle = passageData?.book_title || bookCode;
  const chapterTitle = passageData?.chapter_title || `Chapter ${chapterIndex + 1}`;
  const paraNum = passageData?.para_num || (paraEnd ? `${paraIndex}–${paraEnd}` : (paraIndex + 1));

  // Transliterate only text nodes, preserving inline HTML markup (e.g. <i>, <strong class="paranum">)
  const displayPali = passageData?.pali
    ? transliterateHtml(passageData.pali, settings?.paliScript)
    : '';

  const displayCitedPali = citedSentence?.pali
    ? transliterateHtml(citedSentence.pali, settings?.paliScript)
    : '';

  const effectiveChap = passageData?.chapter_index !== undefined ? passageData.chapter_index : chapterIndex;
  const handleOpenReader = () => {
    if (onOpenInReader) {
      onOpenInReader(bookCode, effectiveChap, paraIndex, paraNum, lineId);
    }
    if (onClose) onClose();
  };

  return (
    <div
      className="citation-quickview-modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-gradient-to-r from-violet-600 via-indigo-600 to-violet-700 text-white flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Quote size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm tracking-tight truncate">
                  {convertPaliScript(bookTitle, settings?.paliScript)}
                </h3>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/20 text-white/90">
                  §{paraNum}{lineId ? `:L${lineId}` : ''}
                </span>
              </div>
              <p className="text-xs text-white/80 truncate">
                {chapterTitle} • {ref || `${bookCode}:c${chapterIndex}:p${paraIndex}${lineId ? `-L${lineId}` : ''}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-[var(--bg-secondary)]/40 text-[var(--text-primary)]">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)] gap-2.5">
              <Loader2 size={24} className="animate-spin text-violet-500" />
              <span className="text-xs font-medium">Retrieving passage from canonical database…</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 text-xs">
              <p className="font-semibold mb-1">Notice</p>
              <p>{error}</p>
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                Citation target: <code>{ref || `${bookCode}:c${chapterIndex}:p${paraIndex}${lineId ? `-L${lineId}` : ''}`}</code>
              </p>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Prominent Cited Sentence Card (Line-Level Alignment) */}
              {citedSentence && (
                <div className="p-4 rounded-xl bg-violet-500/10 border border-violet-500/30 shadow-xs space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-violet-700 dark:text-violet-300 uppercase tracking-wider">
                    <span className="flex items-center gap-1.5">
                      <Sparkles size={14} className="text-violet-600 dark:text-violet-400" />
                      Cited Sentence
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-800 dark:text-violet-200 font-mono text-[11px]">
                      Line {lineId}
                    </span>
                  </div>
                  <div
                    className="text-sm sm:text-[15px] font-medium leading-relaxed font-serif text-[var(--text-primary)]"
                    dangerouslySetInnerHTML={{ __html: displayCitedPali }}
                  />
                  {previewLangs.map((lang) =>
                    citedSentence.translations?.[lang.code] ? (
                      <div
                        key={`cite_sent_${lang.code}`}
                        className="pt-2 border-t border-violet-500/20 text-xs sm:text-sm text-[var(--text-secondary)] space-y-0.5"
                      >
                        <div className="font-semibold text-[11px] uppercase tracking-wider" style={{ color: lang.color }}>
                          {lang.label}
                        </div>
                        <div
                          className="leading-relaxed text-[var(--text-primary)]"
                          dangerouslySetInnerHTML={{ __html: citedSentence.translations[lang.code] }}
                        />
                      </div>
                    ) : null
                  )}
                </div>
              )}

              {passageData && citedSentence && (
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] pt-1">
                  <BookOpen size={12} className="text-violet-500" />
                  <span>Full Paragraph Context (§{paraNum})</span>
                </div>
              )}

              {passageData && (
                <>
                  {/* Pāḷi Text Card */}
                  <div className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xs space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider">
                  <span className="flex items-center gap-1.5">
                    <BookOpen size={13} />
                    Chaṭṭha Saṅgāyana Pāḷi
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)]">
                    {settings?.paliScript ? settings.paliScript.toUpperCase() : 'ROMAN'}
                  </span>
                </div>
                <div
                  className="text-sm sm:text-[15px] leading-relaxed font-serif text-[var(--text-primary)]"
                  dangerouslySetInnerHTML={{ __html: displayPali }}
                />
              </div>

              {/* Next two enabled translation languages (Pāḷi is always shown above) */}
              {previewLangs.map((lang) =>
                passageData.translations?.[lang.code] ? (
                  <div
                    key={lang.code}
                    className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] shadow-2xs space-y-2"
                  >
                    <div
                      className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
                      style={{ color: lang.color }}
                    >
                      <Globe size={13} />
                      {lang.label}
                    </div>
                    <div
                      className="text-sm sm:text-[14.5px] leading-relaxed text-[var(--text-primary)]"
                      dangerouslySetInnerHTML={{ __html: passageData.translations[lang.code] }}
                    />
                  </div>
                ) : null
              )}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 bg-[var(--bg-primary)] border-t border-[var(--border-color)] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
          >
            Back to Chat
          </button>

          <button
            type="button"
            onClick={handleOpenReader}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium text-xs shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition cursor-pointer"
          >
            <span>Open in Reader Tab</span>
            <ExternalLink size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
