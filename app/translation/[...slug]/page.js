import React, { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { MainAppContent } from '../../page';
import SsrBookArticle from '../../../components/SsrBookArticle';
import {
  SITE_URL,
  TRANSLATION_LANGS,
  PALI_SCRIPT_LIST,
  buildBookSeoMetadata,
  buildCanonicalPath,
  buildPageJsonLd,
} from '../../../services/seoMetadata';
import { parseTranslationRouteParams } from '../../../services/ssrCatalog';
import {
  getAvailableTranslationLangs,
  getTranslatedChapterIndices,
  getSsrChapterContent,
} from '../../../services/ssrContent';

export { TRANSLATION_LANGS, PALI_SCRIPT_LIST };

const IS_STATIC_EXPORT =
  process.env.NEXT_EXPORT === 'true' || process.env.STATIC_EXPORT === 'true';

export async function generateStaticParams() {
  if (!IS_STATIC_EXPORT) {
    // In VPS SSR mode, render all 23 translations x 217 books x chapters dynamically on-demand
    // (cached at the Cloudflare CDN edge via Cache-Control s-maxage=86400).
    return [];
  }
  // Minimal valid static param so offline Flutter STATIC_EXPORT=true build stays fast and clean
  // (sync_web_bundle.sh excludes the top-level translation/ directory from assets/web.zip).
  return [{ slug: ['en', 's0101m.mul'] }];
}

export async function generateMetadata({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const parsed = parseTranslationRouteParams(unwrappedParams?.slug);

  if (!parsed.valid) {
    notFound();
  }

  const availableTranslationLangs = await getAvailableTranslationLangs(
    parsed.bookCode,
    parsed.chapterNum ? parsed.chapterIndex : null
  );
  const hasTranslation =
    availableTranslationLangs === null || availableTranslationLangs.has(parsed.translationLang);

  const seo = buildBookSeoMetadata(parsed.bookCode, parsed.entry, parsed.chaptersForBook, {
    translationLang: parsed.translationLang,
    chapterNum: parsed.chapterNum,
    availableTranslationLangs,
  });

  if (!hasTranslation) {
    const romanCanonicalUrl = `${SITE_URL}${buildCanonicalPath({
      bookCode: parsed.bookCode,
      chapterNum: parsed.chapterNum,
    })}`;
    return {
      title: { absolute: seo.title },
      description: seo.description,
      alternates: {
        canonical: romanCanonicalUrl,
      },
      robots: { index: false, follow: true },
    };
  }

  return {
    title: { absolute: seo.title },
    description: seo.description,
    keywords: seo.keywords,
    alternates: {
      canonical: seo.canonicalUrl,
      languages: seo.alternatesLanguages,
    },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: seo.canonicalUrl,
      siteName: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
      locale: seo.ogLocale,
      alternateLocales: ['en_US', 'vi_VN', 'my_MM', 'th_TH', 'si_LK', 'de_DE', 'ja_JP', 'hi_IN', 'zh_CN', 'pt_PT'],
      type: 'article',
      images: [
        {
          url: '/android-chrome-512x512.png',
          width: 512,
          height: 512,
          alt: seo.displayTitle,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.title,
      description: seo.description,
      images: ['/android-chrome-512x512.png'],
    },
  };
}

export default async function TranslationPage({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const parsed = parseTranslationRouteParams(unwrappedParams?.slug);

  if (!parsed.valid) {
    notFound();
  }

  const [availableTranslationLangs, availableChapterIndices, chapterContent] = await Promise.all([
    getAvailableTranslationLangs(parsed.bookCode, parsed.chapterNum ? parsed.chapterIndex : null),
    getTranslatedChapterIndices(parsed.bookCode, parsed.translationLang),
    getSsrChapterContent({
      bookCode: parsed.bookCode,
      chapterIndex: parsed.chapterIndex,
      translationLang: parsed.translationLang,
      isBookRoot: !parsed.chapterNum,
    }),
  ]);

  const hasTranslation =
    availableTranslationLangs === null || availableTranslationLangs.has(parsed.translationLang);

  const seo = buildBookSeoMetadata(parsed.bookCode, parsed.entry, parsed.chaptersForBook, {
    translationLang: parsed.translationLang,
    chapterNum: parsed.chapterNum,
    availableTranslationLangs,
  });

  const effectiveCanonicalUrl = hasTranslation
    ? seo.canonicalUrl
    : `${SITE_URL}${buildCanonicalPath({
        bookCode: parsed.bookCode,
        chapterNum: parsed.chapterNum,
      })}`;

  const { primaryJsonLd, breadcrumbJsonLd } = hasTranslation
    ? buildPageJsonLd(parsed.bookCode, parsed.entry, parsed.chaptersForBook, seo)
    : { primaryJsonLd: null, breadcrumbJsonLd: null };

  const ssrArticle = (
    <SsrBookArticle
      bookCode={parsed.bookCode}
      entry={parsed.entry}
      chaptersForBook={parsed.chaptersForBook}
      seo={seo}
      chapterContent={chapterContent}
      availableTranslationLangs={availableTranslationLangs}
      availableChapterIndices={availableChapterIndices}
    />
  );

  return (
    <>
      {primaryJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(primaryJsonLd) }}
        />
      )}
      {breadcrumbJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
      )}
      <Suspense
        fallback={
          <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
            Loading Tipiṭaka Translation...
          </div>
        }
      >
        <MainAppContent
          params={unwrappedParams}
          ssrContent={ssrArticle}
          initialRoute={{
            bookCode: parsed.bookCode,
            scriptPrefix: null,
            translationLang: parsed.translationLang,
            chapterNum: parsed.chapterNum,
            canonicalUrl: effectiveCanonicalUrl,
            fromTranslationRoute: true,
          }}
        />
      </Suspense>
    </>
  );
}
