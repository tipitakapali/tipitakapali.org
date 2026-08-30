'use client';

import { useEffect, useState } from 'react';

/**
 * 404 — Lost in Saṃsāra
 * Custom 404 for static export (output: 'export').
 * Cloudflare Pages serves `404.html` for unmatched legacy URLs.
 * Shows a dhammic message, then gently redirects to the Buddha's teachings (homepage).
 *
 * Primary instant 302 for legacy URLs is handled by `public/_redirects` (`/* / 302` → homepage).
 * This page is still preserved for direct /404.html hits and local dev, with the same message + countdown.
 */
export default function NotFound() {
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    // Countdown for UX, then redirect (replace avoids polluting history with the 404 URL)
    const interval = setInterval(() => {
      setCountdown((c) => (c > 1 ? c - 1 : 1));
    }, 1000);

    const timer = setTimeout(() => {
      window.location.replace('/');
    }, 2800);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {/* Fallback for no-JS / crawlers: delayed meta refresh — lets humans read the message */}
      <meta httpEquiv="refresh" content="3; url=/" />

      <div className="relative isolate flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden bg-[var(--bg-primary)] px-6 py-12 sm:py-16 text-center">
        {/* Subtle ambient background — respects theme via CSS vars */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(600px 400px at 50% 20%, var(--accent-light) 0%, transparent 70%), radial-gradient(800px 600px at 50% 100%, var(--bg-secondary) 0%, transparent 60%)`,
            opacity: 0.9,
          }}
        />

        <div className="flex w-full max-w-[640px] flex-col items-center animate-[fadeIn_0.6s_ease-out_both]">
          {/* Lotus / Dhamma icon in soft pill */}
          <div
            className="mb-7 flex h-[72px] w-[72px] select-none items-center justify-center rounded-[22px] border bg-[var(--bg-card)] text-[42px] shadow-sm"
            style={{ borderColor: 'var(--border-color)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}
            aria-hidden
          >
            🪷
          </div>

          <h1
            className="text-balance font-bold tracking-tight text-[var(--accent)] text-[32px] leading-none sm:text-[42px]"
            style={{ fontFamily: 'var(--font-reader)' }}
          >
            Lost in Saṃsāra?
          </h1>

          <p className="mt-4 max-w-[560px] text-balance text-[16px] leading-[1.7] text-[var(--text-secondary)] sm:text-[18px]">
            The page you seek has wandered — like all conditioned things, it is{' '}
            <em className="font-semibold not-italic text-[var(--accent)]">anicca</em>, impermanent.
          </p>

          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] leading-relaxed text-[var(--text-muted)] sm:text-[14px]">
            <span>Redirecting you to the Chaṭṭha Saṅgāyana Tipiṭaka at</span>
            <span className="font-semibold text-[var(--accent)]">TipitakaPali.org</span>
            <span className="hidden sm:inline opacity-30">·</span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--bg-card)] px-2.5 py-1 font-mono text-[11px] tabular-nums"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
              aria-live="polite"
              aria-label={`Redirecting in ${countdown} seconds`}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" aria-hidden />
              in {countdown}s
            </span>
          </p>

          {/* Progress bar */}
          <div className="mt-6 h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-[var(--border-color)]/70 p-[3px]">
            <div className="h-full w-full origin-left rounded-full bg-[var(--accent)] animate-[shrink_2.8s_linear_forwards]" />
          </div>

          <div className="mt-8">
            <a
              href="/"
              className="group inline-flex items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-7 py-[11px] text-[14px] font-semibold text-white shadow-[0_2px_12px_rgba(0,0,0,0.12)] transition hover:bg-[var(--accent-hover)] hover:shadow-[0_4px_18px_rgba(0,0,0,0.16)] hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
            >
              Go to TipitakaPali.org now
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </a>
          </div>

          <p className="mt-10 max-w-[520px] border-t pt-6 text-[12px] leading-relaxed text-[var(--text-muted)] sm:text-[11px]" style={{ borderColor: 'var(--border-color)' }}>
            <em>“Sabbe saṅkhārā aniccā”</em> — All formations are impermanent.
          </p>
        </div>

        <style>{`
          @keyframes shrink { from { transform: scaleX(1); } to { transform: scaleX(0); } }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          @media (prefers-reduced-motion: reduce) {
            .animate-[shrink_2.8s_linear_forwards], .animate-[fadeIn_0.6s_ease-out_both], .animate-pulse { animation: none !important; }
          }
        `}</style>
      </div>
    </>
  );
}
