/** @type {import('next').NextConfig} */
const os = require('os');
const isExport = process.env.NEXT_EXPORT === 'true' || process.env.STATIC_EXPORT === 'true';

function getLocalDevOrigins() {
  const origins = new Set([
    'localhost',
    '127.0.0.1',
    'localhost:3000',
    '127.0.0.1:3000',
    '85.190.97.158',
    '85.190.97.158:3000',
    '*.local',
  ]);
  try {
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const addr of iface || []) {
        if (addr && addr.family === 'IPv4' && addr.address) {
          origins.add(addr.address);
          origins.add(`${addr.address}:3000`);
        }
      }
    }
  } catch (_) {}
  return Array.from(origins);
}

const nextConfig = {
  allowedDevOrigins: getLocalDevOrigins(),
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  // Reduce Legacy JavaScript: browserslist in package.json ["baseline widely available"]
  // saves ES5 transforms; remaining 14 KiB is Next's mandatory fetch/URL polyfill (Turbopack)
  experimental: {
    optimizePackageImports: ['lucide-react'],
    // Keep VPS SSR cache strictly bounded in RAM (50MB LRU) instead of writing
    // 116K+ pages (and 404 bot scans) indefinitely to .next/server/route-cache on disk;
    // Cloudflare CDN handles long-term edge caching via s-maxage=86400.
    ...(!isExport ? { isrFlushToDisk: false } : {}),
  },
  ...(isExport
    ? {
        output: 'export',
        trailingSlash: false,
      }
    : {
        output: 'standalone',
        // Always resolve generateMetadata synchronously into <head> so Cloudflare CDN
        // caches complete <title>, <meta description>, canonical, and hreflang tags
        // regardless of whether a browser or search bot warmed the edge cache first.
        htmlLimitedBots: /.*/,
        serverExternalPackages: ['better-sqlite3'],
        outputFileTracingExcludes: {
          '/*': [
            './server_api/db/**/*',
            './server_api/node_modules/**/*',
            './tipitakapali_org_app/**/*',
            './next_tipitakapali.org/**/*',
            './dev_build_vri_db_2026/**/*',
            './cloudflare_pages_dist/**/*',
          ],
        },
        async headers() {
          const edgeCacheHeaders = [
            {
              key: 'Cache-Control',
              value: 'public, s-maxage=86400, stale-while-revalidate=604800',
            },
          ];
          return [
            {
              source: '/:path*',
              headers: [
                {
                  key: 'Link',
                  value: '</.well-known/api-catalog>; rel="api-catalog", </.well-known/ai-catalog.json>; rel="ai-catalog", </openapi.json>; rel="service-desc"; type="application/openapi+json", </llms.txt>; rel="describedby"; type="text/plain"',
                },
              ],
            },
            {
              source: '/book/:path*',
              headers: edgeCacheHeaders,
            },
            {
              source: '/translation/:path*',
              headers: edgeCacheHeaders,
            },
            {
              source: '/:file(llms\\.txt|llms-full\\.txt|auth\\.md|privacy_policy\\.md|terms_of_service\\.md)',
              headers: [
                {
                  key: 'Content-Type',
                  value: 'text/markdown; charset=utf-8',
                },
                {
                  key: 'Vary',
                  value: 'Accept',
                },
                {
                  key: 'Content-Signal',
                  value: 'ai-train=yes, search=yes, ai-input=yes',
                },
                ...edgeCacheHeaders,
              ],
            },
            {
              source: '/:file(sitemap.*\\.xml)',
              headers: [
                {
                  key: 'Content-Type',
                  value: 'application/xml; charset=utf-8',
                },
                ...edgeCacheHeaders,
              ],
            },
          ];
        },
        async rewrites() {
          const backendUrl = process.env.BACKEND_API_URL || 'http://127.0.0.1:8400';
          return [
            {
              source: '/info',
              destination: '/info.html',
            },
            {
              source: '/pali-script-converter',
              destination: '/pali-script-converter.html',
            },
            {
              source: '/api/:path((?!markdown(?:/|$)).*)',
              destination: `${backendUrl}/api/:path`,
            },
          ];
        },
      }),
};

module.exports = nextConfig;
