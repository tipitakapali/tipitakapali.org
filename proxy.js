import { NextResponse } from 'next/server';

/**
 * Next.js Proxy for AI Agent Content Negotiation
 * Supports Accept: text/markdown per RFC / llmstxt.org / Cloudflare Markdown for Agents.
 */
export function proxy(request) {
  const accept = request.headers.get('accept') || '';
  const pathname = request.nextUrl.pathname;

  const isStaticDoc = /\.(md|txt|json|xml|html|css|js|ico|png|svg|jpg|woff2?|ttf)$/i.test(pathname);

  // Check if client explicitly requests machine-readable markdown for HTML pages
  if (accept.includes('text/markdown') && !pathname.startsWith('/api/') && !isStaticDoc) {
    const targetPath = pathname === '/' ? '/llms.txt' : '/llms-full.txt';
    const response = NextResponse.rewrite(new URL(targetPath, request.url));
    response.headers.set('Content-Type', 'text/markdown; charset=utf-8');
    response.headers.set('Vary', 'Accept');
    response.headers.set('x-markdown-tokens', pathname === '/' ? '1250' : '8500');
    return response;
  }

  return NextResponse.next();
}

export default proxy;

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - fonts, icons, static assets
     */
    '/((?!_next/static|_next/image|fonts/|icons/|favicon.ico).*)',
  ],
};
