import React, { Suspense } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
import { MainAppContent } from '../../page';
import SsrBookArticle from '../../../components/SsrBookArticle';
import {
  SITE_URL,
  TRANSLATION_LANGS,
  PALI_SCRIPT_LIST,
  buildBookSeoMetadata,
  buildPageJsonLd,
} from '../../../services/seoMetadata';
import {
  getBooksCatalog,
  parseBookRouteParams,
} from '../../../services/ssrCatalog';
import {
  getAvailableTranslationLangs,
  getSsrChapterContent,
} from '../../../services/ssrContent';

export { TRANSLATION_LANGS, PALI_SCRIPT_LIST };

const IS_STATIC_EXPORT =
  process.env.NEXT_EXPORT === 'true' || process.env.STATIC_EXPORT === 'true';

export async function generateStaticParams() {
  if (!IS_STATIC_EXPORT) {
    // In VPS SSR mode, render all 17 scripts x 217 books x chapters on-demand
    // (cached at the Cloudflare CDN edge via Cache-Control s-maxage=86400).
    return [];
  }
  const catalog = getBooksCatalog();
  const codes = Object.keys(catalog);
  if (codes.length > 0) {
    return codes.map((code) => ({ slug: [code] }));
  }
  return [{ slug: ['default'] }];
}

export async function generateMetadata({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const parsed = parseBookRouteParams(unwrappedParams?.slug);

  if (parsed.redirectTo) {
    return {
      alternates: { canonical: `${SITE_URL}${parsed.redirectTo}` },
      robots: { index: false, follow: true },
    };
  }

  if (!parsed.valid) {
    notFound();
  }

  const availableTranslationLangs = await getAvailableTranslationLangs(
    parsed.bookCode,
    parsed.chapterNum ? parsed.chapterIndex : null
  );

  const seo = buildBookSeoMetadata(parsed.bookCode, parsed.entry, parsed.chaptersForBook, {
    scriptPrefix: parsed.scriptPrefix,
    chapterNum: parsed.chapterNum,
    availableTranslationLangs,
  });

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

export default async function BookPage({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const parsed = parseBookRouteParams(unwrappedParams?.slug);

  if (parsed.redirectTo) {
    permanentRedirect(parsed.redirectTo);
  }

  if (!parsed.valid) {
    notFound();
  }

  const [availableTranslationLangs, chapterContent] = await Promise.all([
    getAvailableTranslationLangs(parsed.bookCode, parsed.chapterNum ? parsed.chapterIndex : null),
    getSsrChapterContent({
      bookCode: parsed.bookCode,
      chapterIndex: parsed.chapterIndex,
      scriptId: parsed.scriptId,
    }),
  ]);

  const seo = buildBookSeoMetadata(parsed.bookCode, parsed.entry, parsed.chaptersForBook, {
    scriptPrefix: parsed.scriptPrefix,
    chapterNum: parsed.chapterNum,
    availableTranslationLangs,
  });

  const { primaryJsonLd, breadcrumbJsonLd } = buildPageJsonLd(
    parsed.bookCode,
    parsed.entry,
    parsed.chaptersForBook,
    seo
  );

  const ssrArticle = (
    <SsrBookArticle
      bookCode={parsed.bookCode}
      entry={parsed.entry}
      chaptersForBook={parsed.chaptersForBook}
      seo={seo}
      chapterContent={chapterContent}
      availableTranslationLangs={availableTranslationLangs}
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
            Loading Tipiṭaka...
          </div>
        }
      >
        <MainAppContent
          params={unwrappedParams}
          ssrContent={ssrArticle}
          initialRoute={{
            bookCode: parsed.bookCode,
            scriptPrefix: parsed.scriptPrefix,
            translationLang: null,
            chapterNum: parsed.chapterNum,
            canonicalUrl: seo.canonicalUrl,
            fromTranslationRoute: false,
          }}
        />
      </Suspense>
    </>
  );
}
