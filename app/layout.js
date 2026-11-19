import './globals.css';
import './pali-fonts.css';
import { ThemeSettingsProvider } from '../context/ThemeSettingsContext';
import { TabProvider } from '../context/TabContext';
import { TtsProvider } from '../context/TtsContext';
import { DictionaryProvider } from '../context/DictionaryContext';
import WebMcpRegistration from '../components/WebMcpRegistration';
import AiTranslationNoticeBanner from '../components/AiTranslationNoticeBanner';
import {
  DEFAULT_SEO_TITLE,
  DEFAULT_SEO_DESCRIPTION,
  ALL_SCHEMA_LANGUAGES,
} from '../services/seoMetadata';

export const metadata = {
  metadataBase: new URL('https://tipitakapali.org'),
  title: {
    default: DEFAULT_SEO_TITLE,
    template: '%s | Tipiṭaka Pāḷi',
  },
  description: DEFAULT_SEO_DESCRIPTION,
  keywords: [
    'Tipitaka',
    'Tipitaka Pali',
    'Chattha Sangayana',
    'Pali Canon',
    'Theravada',
    'Vinaya Pitaka',
    'Sutta Pitaka',
    'Abhidhamma Pitaka',
    'Atthakatha',
    'Tika',
    'Dhammapada',
    'VRI',
    'CSCD',
    'Digital Pali Dictionary',
    'DPD',
    'Pali bold definitions',
    'Tipitaka translations',
    'Pali English translation',
    'Kinh Phật Tiếng Việt',
    'Pali Tipitaka Myanmar translation',
    'Pali translation German',
    'Pali Canon Thai translation',
    'Sinhala Tipitaka',
    'Pali Hindi translation',
    'sentence by sentence translation',
  ],
  authors: [{ name: 'VRI / Chaṭṭha Saṅgāyana Tipiṭaka' }],
  creator: 'Chaṭṭha Saṅgāyana Tipiṭaka',
  publisher: 'TipitakaPali.org',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: DEFAULT_SEO_TITLE,
    description: DEFAULT_SEO_DESCRIPTION,
    url: 'https://tipitakapali.org/',
    siteName: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
    locale: 'pi_IN',
    alternateLocales: ['en_US', 'vi_VN', 'my_MM', 'th_TH', 'si_LK', 'de_DE', 'ja_JP', 'hi_IN', 'zh_CN', 'pt_PT'],
    type: 'website',
    images: [
      {
        url: '/android-chrome-512x512.png',
        width: 512,
        height: 512,
        alt: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_SEO_TITLE,
    description: DEFAULT_SEO_DESCRIPTION,
    images: ['/android-chrome-512x512.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { rel: 'mask-icon', url: '/safari-pinned-tab.svg', color: '#8b2500' },
    ],
  },
  manifest: '/site.webmanifest',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Initial iOS Safari theme-color (classic bg-primary); updated dynamically per theme in ThemeSettingsContext.
  themeColor: '#f0eee5',
};

const jsonLdWebsite = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://tipitakapali.org/#website',
      name: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
      alternateName: ['Tipitaka Pali', 'TipitakaPali.org', 'CSCD Tipitaka', 'VRI Tipitaka'],
      url: 'https://tipitakapali.org/',
      description: DEFAULT_SEO_DESCRIPTION,
      inLanguage: ALL_SCHEMA_LANGUAGES,
      publisher: { '@id': 'https://tipitakapali.org/#organization' },
      potentialAction: [
        {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: 'https://tipitakapali.org/?q={search_term_string}',
          },
          'query-input': 'required name=search_term_string',
        },
        {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: 'https://api.tipitakapali.org/api/dict/lookup?w={search_term_string}&dict=dpd',
          },
          'query-input': 'required name=search_term_string',
        },
      ],
    },
    {
      '@type': 'Organization',
      '@id': 'https://tipitakapali.org/#organization',
      name: 'TipitakaPali.org',
      url: 'https://tipitakapali.org/',
      logo: 'https://tipitakapali.org/android-chrome-512x512.png',
      sameAs: [
        'https://github.com/tipitakapali/tipitakapali.org',
        'https://apps.apple.com/vn/app/tipitaka-pali-cst/id6743404213',
        'https://play.google.com/store/apps/details?id=org.tipitakapali.android',
      ],
    },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="classic" data-script="roman" data-font="default" suppressHydrationWarning className="w-full max-w-full overflow-x-hidden">
      <head>
        <link
          rel="preload"
          href="/fonts/pali/Noto_Sans/static/NotoSans-Regular.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/pali/Gentium_Plus/GentiumPlus-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdWebsite) }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{var p=location.pathname||"/";var isBook=p.indexOf("/book/")===0||p.indexOf("/chapter/")===0;var isTrans=p.indexOf("/translation/")===0;if(!isBook&&!isTrans)return;var existingR=document.querySelector(\'meta[name="robots"]\');if(existingR&&/noindex/i.test(existingR.getAttribute("content")||""))return;var c=document.querySelector(\'link[rel="canonical"]\');var h=(c&&c.getAttribute("href"))||"";if(h&&h!=="https://tipitakapali.org/"&&h!=="https://tipitakapali.org"&&h!=="/")return;var target=null;if(isTrans){var tp=p.replace(/^\\/translation\\//,"").split("/");var tl=tp[0]?decodeURIComponent(tp[0]):"";var tb=tp[1]?decodeURIComponent(tp[1]):"";var tc=tp[2]?decodeURIComponent(tp[2]):"";if(!/^(?:en|vi|my|my_nissaya|si|zh|th|km|lo|ta|hi|id|es|fr|de|ja|pt|ru|ko|ne|be|cs|mr)$/.test(tl)||!/^[a-z0-9_.-]+\\.(?:mul|att|tik|nrf)$/i.test(tb))return;target="https://tipitakapali.org/translation/"+tl+"/"+tb+(/^[1-9]\\d*$/.test(tc)?"/"+tc:"");}else{var bp=p.replace(/^\\/(?:book|chapter)\\//,"").split("/");var raw=bp[0]?decodeURIComponent(bp[0]):"";var bc=bp[1]?decodeURIComponent(bp[1]):"";if(!raw)return;var prefMatch=raw.match(/^(si|hi|thai|laos|my|km|beng|gurm|tham|guja|telu|kann|mala|brah|tibt|cyrl)\\.(.*)$/i);var pref=prefMatch?prefMatch[1].toLowerCase():"";var code=prefMatch?prefMatch[2]:raw;var m=code.match(/^(.*?\\.(?:mul|att|tik|nrf))(\\d+)$/i);if(m){code=m[1];if(!bc)bc=String(parseInt(m[2],10)+1);}if(!/^[a-z0-9_.-]+\\.(?:mul|att|tik|nrf)$/i.test(code))return;target="https://tipitakapali.org/book/"+(pref?pref+".":"")+code+(/^[1-9]\\d*$/.test(bc)?"/"+bc:"");}if(!target)return;if(!c){c=document.createElement("link");c.setAttribute("rel","canonical");document.head.appendChild(c);}c.setAttribute("href",target);var r=existingR||document.querySelector(\'meta[name="robots"]\');if(!r){r=document.createElement("meta");r.setAttribute("name","robots");document.head.appendChild(r);}r.setAttribute("content","noindex, follow");}catch(e){}})();',
          }}
        />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        {/* Agent & Machine Discovery Links */}
        <link rel="api-catalog" href="/.well-known/api-catalog" />
        <link rel="ai-catalog" href="/.well-known/ai-catalog.json" />
        <link rel="service-desc" type="application/openapi+json" href="/openapi.json" />
        <link rel="describedby" type="text/plain" href="/llms.txt" />
        <link rel="agent-card" type="application/json" href="/.well-known/agent-card.json" />
      </head>
      <body suppressHydrationWarning className="w-full max-w-full overflow-x-hidden">
        <WebMcpRegistration />
        <ThemeSettingsProvider>
          <TabProvider>
            <TtsProvider>
              <DictionaryProvider>
                {children}
                <AiTranslationNoticeBanner />
              </DictionaryProvider>
            </TtsProvider>
          </TabProvider>
        </ThemeSettingsProvider>
      </body>
    </html>
  );
}

