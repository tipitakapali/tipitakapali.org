'use client';

import React, { Suspense } from 'react';
import { MainAppContent } from '../../page';

export default function ChapterPage({ params }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
          Loading Tipiṭaka Chapter...
        </div>
      }
    >
      <MainAppContent params={params} />
    </Suspense>
  );
}
