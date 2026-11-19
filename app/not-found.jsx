import NotFoundView from '../components/NotFoundView';

export const metadata = {
  title: { absolute: 'Lost in Saṃsāra (404) — Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi' },
  description: 'The requested page could not be found on TipitakaPali.org. Return to the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon.',
  alternates: { canonical: null },
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return <NotFoundView />;
}
