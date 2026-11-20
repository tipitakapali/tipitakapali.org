import { NextResponse } from 'next/server';
import {
  renderMarkdownForPath,
  estimateMarkdownTokens,
} from '../../../../services/ssrMarkdown.js';

const IS_STATIC_EXPORT =
  process.env.NEXT_EXPORT === 'true' || process.env.STATIC_EXPORT === 'true';

export async function generateStaticParams() {
  if (IS_STATIC_EXPORT) {
    return [{ path: [] }];
  }
  return [];
}

function buildMarkdownHeaders(tokens) {
  return {
    'Content-Type': 'text/markdown; charset=utf-8',
    Vary: 'Accept',
    'x-markdown-tokens': String(tokens),
    'Content-Signal': 'ai-train=yes, search=yes, ai-input=yes',
    'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Type, x-markdown-tokens, Content-Signal, Vary',
  };
}

export async function GET(request, { params }) {
  const unwrappedParams = params && typeof params.then === 'function' ? await params : params;
  const segments = Array.isArray(unwrappedParams?.path) ? unwrappedParams.path : [];
  const targetPath = segments.length > 0 ? `/${segments.join('/')}` : '/';

  const rendered = await renderMarkdownForPath(targetPath);
  if (!rendered) {
    const notFoundMd = `---\ntitle: "404 Not Found | Tipiṭaka Pāḷi"\n---\n\n# 404 Not Found\n\nThe requested page \`${targetPath}\` was not found on TipitakaPali.org.\n\n- [Home & Tipiṭaka Reader](https://tipitakapali.org/)\n- [AI Agent Guide (/llms.txt)](https://tipitakapali.org/llms.txt)\n- [Full 217-Book Catalog (/llms-full.txt)](https://tipitakapali.org/llms-full.txt)\n`;
    const tokens = estimateMarkdownTokens(notFoundMd);
    return new NextResponse(notFoundMd, {
      status: 404,
      headers: buildMarkdownHeaders(tokens),
    });
  }

  return new NextResponse(rendered.markdown, {
    status: rendered.status,
    headers: buildMarkdownHeaders(rendered.tokens),
  });
}
