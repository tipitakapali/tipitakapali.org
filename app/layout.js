import './globals.css';
import './pali-fonts.css';
import { ThemeSettingsProvider } from '../context/ThemeSettingsContext';
import { TabProvider } from '../context/TabContext';
import { DictionaryProvider } from '../context/DictionaryContext';

export const metadata = {
  metadataBase: new URL('https://tipitakapali.org'),
  title: {
    default: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
    template: '%s | Tipiṭaka Pāḷi',
  },
  description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich multi-script typography, Digital Pāḷi Dictionary (DPD), and high-speed full-text search.',
  keywords: [
    'Tipitaka',
    'Tipitaka Pali',
    'Chattha Sangayana',
    'Pali Canon',
    'Theravada',
    'Vinaya Pitaka',
    'Sutta Pitaka',
    'Abhidhamma Pitaka',
    'Dhammapada',
    'VRI',
    'CSCD',
    'Digital Pali Dictionary',
    'DPD',
  ],
  authors: [{ name: 'VRI / Chaṭṭha Saṅgāyana Tipiṭaka' }],
  creator: 'Chaṭṭha Saṅgāyana Tipiṭaka',
  publisher: 'Chaṭṭha Saṅgāyana Tipiṭaka',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
    description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich typography, multi-script support, and full-text search.',
    url: 'https://tipitakapali.org',
    siteName: 'Chaṭṭha Saṅgāyana Tipiṭaka',
    locale: 'pi_IN',
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
    title: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
    description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich typography, multi-script support, and full-text search.',
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
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

const jsonLdWebsite = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi',
  alternateName: ['Tipitaka Pali', 'CSCD Tipitaka', 'VRI Tipitaka'],
  url: 'https://tipitakapali.org/',
  description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with multi-script typography, DPD dictionary, and full-text search.',
  inLanguage: ['pi', 'en', 'my', 'si', 'th', 'vi'],
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: 'https://tipitakapali.org/?q={search_term_string}',
    },
    'query-input': 'required name=search_term_string',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="light" data-script="roman" suppressHydrationWarning className="w-full max-w-full overflow-x-hidden">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdWebsite) }}
        />
      </head>
      <body suppressHydrationWarning className="w-full max-w-full overflow-x-hidden">
        <ThemeSettingsProvider>
          <TabProvider>
            <DictionaryProvider>
              {children}
            </DictionaryProvider>
          </TabProvider>
        </ThemeSettingsProvider>
      </body>
    </html>
  );
}

