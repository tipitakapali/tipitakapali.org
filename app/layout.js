import './globals.css';
import { ThemeSettingsProvider } from '../context/ThemeSettingsContext';
import { TabProvider } from '../context/TabContext';

export const metadata = {
  title: 'Chaṭṭha Saṅgāyana Tipiṭaka',
  description: 'Complete Chaṭṭha Saṅgāyana Tipiṭaka Pali Canon with rich typography, multi-script support, and full-text search.',
  icons: {
    icon: '/favicon.ico',
  },
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
