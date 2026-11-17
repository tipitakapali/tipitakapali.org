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
  },
  ...(isExport
    ? {
        output: 'export',
        trailingSlash: false,
      }
    : {
        output: 'standalone',
        async headers() {
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
              source: '/api/:path*',
              destination: `${backendUrl}/api/:path*`,
            },
          ];
        },
      }),
};

module.exports = nextConfig;

