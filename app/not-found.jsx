'use client';

import { useEffect } from 'react';

/**
 * Next.js App Router 404 handler for static export (output: 'export').
 * Cloudflare Pages serves `404.html` for unmatched routes. This component
 * ensures any client-side 404 immediately redirects to the homepage (/),
 * covering legacy URLs when _redirects is not respected (e.g. local preview).
 *
 * For Cloudflare Pages deployment, the primary redirect is handled by
 * `public/_redirects` (`/* / 302`). This file is the fallback for Next.js
 * static build (generates 404.html + _not-found.html).
 */
export default function NotFound() {
  useEffect(() => {
    // Preserve no history entry for the 404 URL
    window.location.replace('/');
  }, []);

  return (
    <>
      {/* No-JS / crawler fallback: instant meta refresh */}
      <meta httpEquiv="refresh" content="0; url=/" />
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '40px', textAlign: 'center' }}>
        <p>Page not found — redirecting to homepage…</p>
        <p>
          <a href="/" style={{ color: '#8b2500', fontWeight: 600 }}>
            Go to TipitakaPali.org homepage
          </a>
        </p>
      </div>
    </>
  );
}
