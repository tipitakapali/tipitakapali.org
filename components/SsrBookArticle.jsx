import React from 'react';
import { capitalizePali, convertPaliScript } from '../services/transliterate.js';
import {
  TRANSLATION_LANGS,
  PALI_SCRIPT_LIST,
  buildCanonicalPath,
} from '../services/seoMetadata.js';

export default function SsrBookArticle({
  bookCode,
  entry,
  chaptersForBook = [],
  seo,
  chapterContent = null,
  availableTranslationLangs = null,
  availableChapterIndices = null,
}) {
  if (!entry || !seo) return null;

  const isChapterPage = Boolean(seo.chapterNum);
  const scriptMeta = seo.scriptMeta || null;
  const langMeta = seo.langMeta || null;
  const paliLangTag = scriptMeta ? scriptMeta.bcp47 : 'pi';
  const transLangTag = langMeta ? langMeta.bcp47 : null;

  const allowedLangSet =
    availableTranslationLangs instanceof Set
      ? availableTranslationLangs
      : Array.isArray(availableTranslationLangs)
        ? new Set(availableTranslationLangs)
        : null;
  const visibleTranslationLangs = allowedLangSet
    ? TRANSLATION_LANGS.filter((t) => allowedLangSet.has(t.code))
    : TRANSLATION_LANGS;

  const presentChapSet =
    langMeta && availableChapterIndices instanceof Set
      ? availableChapterIndices
      : langMeta && Array.isArray(availableChapterIndices)
        ? new Set(availableChapterIndices)
        : null;

  const bookBasePath = buildCanonicalPath({
    bookCode,
    scriptPrefix: scriptMeta?.code || null,
    translationLang: langMeta?.code || null,
    chapterNum: null,
  });

  const activeChapIdx = isChapterPage
    ? seo.chapterNum - 1
    : Number.isInteger(chapterContent?.chapterIndex) && chapterContent.chapterIndex >= 0
      ? chapterContent.chapterIndex
      : 0;
  const activeChapMeta = chaptersForBook[activeChapIdx] || null;
  const rawChapTitle = activeChapMeta?.title
    ? capitalizePali(String(activeChapMeta.title).trim())
    : `Chapter ${activeChapIdx + 1}`;
  const displayActiveChapTitle = scriptMeta
    ? convertPaliScript(rawChapTitle, scriptMeta.scriptId)
    : rawChapTitle;

  const prevChapNum = isChapterPage && seo.chapterNum > 1 ? seo.chapterNum - 1 : null;
  const nextChapNum =
    isChapterPage && seo.chapterNum < chaptersForBook.length ? seo.chapterNum + 1 : null;

  const prevChapPath = prevChapNum
    ? buildCanonicalPath({
        bookCode,
        scriptPrefix: scriptMeta?.code || null,
        translationLang:
          langMeta && (!presentChapSet || presentChapSet.has(prevChapNum - 1))
            ? langMeta.code
            : null,
        chapterNum: prevChapNum,
      })
    : null;

  const nextChapPath = nextChapNum
    ? buildCanonicalPath({
        bookCode,
        scriptPrefix: scriptMeta?.code || null,
        translationLang:
          langMeta && (!presentChapSet || presentChapSet.has(nextChapNum - 1))
            ? langMeta.code
            : null,
        chapterNum: nextChapNum,
      })
    : null;

  const paragraphs = Array.isArray(chapterContent?.paragraphs)
    ? chapterContent.paragraphs
    : [];

  return (
    <article className="ssr-reader-article" lang={seo.inLanguage}>
      <nav className="ssr-breadcrumb" aria-label="Breadcrumb">
        <ol className="ssr-breadcrumb-list">
          <li>
            <a href="/">Tipiṭaka Pāḷi</a>
          </li>
          {seo.pitakaLabel && (
            <li>
              <span>{seo.pitakaLabel}</span>
            </li>
          )}
          {seo.parentLabel && seo.parentLabel !== seo.pitakaLabel && (
            <li>
              <span>{seo.parentLabel}</span>
            </li>
          )}
          {isChapterPage ? (
            <>
              <li>
                <a href={bookBasePath}>{seo.displayTitle}</a>
              </li>
              <li aria-current="page">
                <span>{seo.displayChapterTitle || `Chapter ${seo.chapterNum}`}</span>
              </li>
            </>
          ) : (
            <li aria-current="page">
              <span>{seo.displayTitle}</span>
            </li>
          )}
        </ol>
      </nav>

      <header className="ssr-reader-header">
        <h1 className="ssr-reader-h1">
          {isChapterPage
            ? `${seo.displayChapterTitle || `Chapter ${seo.chapterNum}`} — ${seo.displayTitle}`
            : seo.displayTitle}
        </h1>
        <p className="ssr-reader-meta">
          <span>Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi (VRI / CSCD)</span>
          {seo.layerLabel && <span> · {seo.layerLabel}</span>}
          {langMeta && (
            <span>
              {' '}
              · {langMeta.native} ({langMeta.name})
            </span>
          )}
          {scriptMeta && (
            <span>
              {' '}
              · {scriptMeta.name} ({scriptMeta.native})
            </span>
          )}
        </p>
        <p className="ssr-reader-desc">{seo.description}</p>
      </header>

      {paragraphs.length > 0 && (
        <section className="ssr-chapter-body" aria-labelledby="ssr-chapter-heading">
          <h2 id="ssr-chapter-heading" className="ssr-section-h2">
            {isChapterPage
              ? displayActiveChapTitle
              : `${displayActiveChapTitle} (Ch. ${activeChapIdx + 1})`}
          </h2>
          <div className="ssr-paragraphs">
            {paragraphs.map((para, idx) => (
              <div key={`${para.paraIndex}-${idx}`} className="ssr-para-block">
                {para.translation && (
                  <p
                    className={
                      para.isHeading ? 'ssr-para-translation ssr-para-heading' : 'ssr-para-translation'
                    }
                    lang={transLangTag || undefined}
                  >
                    {para.translation}
                  </p>
                )}
                {para.pali && (
                  <p
                    className={
                      para.isHeading
                        ? 'ssr-para-pali ssr-para-heading'
                        : para.translation
                          ? 'ssr-para-pali ssr-para-pali-paired'
                          : 'ssr-para-pali'
                    }
                    lang={paliLangTag}
                  >
                    {para.pali}
                  </p>
                )}
              </div>
            ))}
          </div>
          {chapterContent?.truncated && (
            <p className="ssr-truncated-note">
              Showing opening {paragraphs.length} of {chapterContent.totalParagraphs} paragraphs in this chapter.
            </p>
          )}
        </section>
      )}

      {isChapterPage && (prevChapPath || nextChapPath) && (
        <nav className="ssr-chapter-pager" aria-label="Chapter pagination">
          {prevChapPath ? (
            <a className="ssr-pager-link" href={prevChapPath} rel="prev">
              ← Previous Chapter ({prevChapNum})
            </a>
          ) : (
            <span />
          )}
          <a className="ssr-pager-link" href={bookBasePath}>
            All Chapters ({chaptersForBook.length})
          </a>
          {nextChapPath ? (
            <a className="ssr-pager-link" href={nextChapPath} rel="next">
              Next Chapter ({nextChapNum}) →
            </a>
          ) : (
            <span />
          )}
        </nav>
      )}

      {chaptersForBook.length > 0 && (
        <section className="ssr-section" aria-labelledby="ssr-toc-heading">
          <h2 id="ssr-toc-heading" className="ssr-section-h2">
            Chapters in {seo.displayTitle} ({chaptersForBook.length})
          </h2>
          <nav aria-label="Book chapters">
            <ol className="ssr-link-grid">
              {chaptersForBook.map((ch, idx) => {
                const chNum = idx + 1;
                const chLabelRaw = capitalizePali(ch.title || `Chapter ${chNum}`);
                const chLabel = scriptMeta
                  ? convertPaliScript(chLabelRaw, scriptMeta.scriptId)
                  : chLabelRaw;
                const href = buildCanonicalPath({
                  bookCode,
                  scriptPrefix: scriptMeta?.code || null,
                  translationLang:
                    langMeta && (!presentChapSet || presentChapSet.has(idx))
                      ? langMeta.code
                      : null,
                  chapterNum: chNum,
                });
                const isCurrent = isChapterPage && seo.chapterNum === chNum;
                return (
                  <li key={chNum}>
                    <a
                      href={href}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={isCurrent ? 'ssr-link-active' : undefined}
                    >
                      {chLabel}
                    </a>
                  </li>
                );
              })}
            </ol>
          </nav>
        </section>
      )}

      {visibleTranslationLangs.length > 0 && (
        <section className="ssr-section" aria-labelledby="ssr-langs-heading">
          <h2 id="ssr-langs-heading" className="ssr-section-h2">
            Modern Translations ({visibleTranslationLangs.length} Languages)
          </h2>
          <nav aria-label="Modern translations">
            <ul className="ssr-pill-list">
              {visibleTranslationLangs.map((t) => {
                const href = buildCanonicalPath({
                  bookCode,
                  translationLang: t.code,
                  chapterNum: seo.chapterNum || null,
                });
                const isCurrent = langMeta?.code === t.code;
                return (
                  <li key={t.code}>
                    <a
                      href={href}
                      hrefLang={t.hreflang}
                      aria-current={isCurrent ? 'page' : undefined}
                      className={isCurrent ? 'ssr-pill ssr-pill-active' : 'ssr-pill'}
                    >
                      {t.native} ({t.name})
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </section>
      )}

      <section className="ssr-section" aria-labelledby="ssr-scripts-heading">
        <h2 id="ssr-scripts-heading" className="ssr-section-h2">
          Pāḷi Scripts (17 Transliterations)
        </h2>
        <nav aria-label="Pāḷi scripts">
          <ul className="ssr-pill-list">
            <li>
              <a
                href={buildCanonicalPath({ bookCode, chapterNum: seo.chapterNum || null })}
                hrefLang="pi"
                aria-current={!scriptMeta && !langMeta ? 'page' : undefined}
                className={!scriptMeta && !langMeta ? 'ssr-pill ssr-pill-active' : 'ssr-pill'}
              >
                Roman Pāḷi (IAST)
              </a>
            </li>
            {PALI_SCRIPT_LIST.map((s) => {
              const href = buildCanonicalPath({
                bookCode,
                scriptPrefix: s.code,
                chapterNum: seo.chapterNum || null,
              });
              const isCurrent = scriptMeta?.code === s.code;
              return (
                <li key={s.code}>
                  <a
                    href={href}
                    hrefLang={s.bcp47}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={isCurrent ? 'ssr-pill ssr-pill-active' : 'ssr-pill'}
                  >
                    {s.native} ({s.shortName})
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </section>
    </article>
  );
}
