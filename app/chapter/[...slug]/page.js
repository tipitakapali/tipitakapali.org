'use client';

import React, { use, Suspense } from 'react';
import { MainAppContent } from '../../page';

export default function ChapterPage({ params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? use(params) : params;
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
          Loading Tipiṭaka Chapter...
        </div>
      }
    >
      <MainAppContent params={unwrappedParams} />
    </Suspense>
  );
}

