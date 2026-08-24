import './globals.css';
import { ThemeSettingsProvider } from '../context/ThemeSettingsContext';
import { TabProvider } from '../context/TabContext';

export const metadata = {
  title: 'Chaṭṭha Saṅgāyana Tipiṭaka',
  description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich typography, multi-script support, and full-text search.',
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

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="light" className="w-full max-w-full overflow-x-hidden">
      <body className="w-full max-w-full overflow-x-hidden">
        <ThemeSettingsProvider>
          <TabProvider>
            {children}
          </TabProvider>
        </ThemeSettingsProvider>
      </body>
    </html>
  );
}
