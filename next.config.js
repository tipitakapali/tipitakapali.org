/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_EXPORT === 'true' || process.env.STATIC_EXPORT === 'true';

const nextConfig = {
  allowedDevOrigins: ['85.190.97.158'],
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
        async rewrites() {
          const backendUrl = process.env.BACKEND_API_URL || 'http://127.0.0.1:8400';
          return [
            {
              source: '/api/:path*',
              destination: `${backendUrl}/api/:path*`,
            },
          ];
        },
      }),
};

module.exports = nextConfig;

