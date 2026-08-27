/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_EXPORT === 'true' || process.env.STATIC_EXPORT === 'true';

const nextConfig = {
  allowedDevOrigins: ['85.190.97.158'],
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  ...(isExport
    ? {
        output: 'export',
        trailingSlash: false,
      }
    : {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: 'http://127.0.0.1:5000/api/:path*',
            },
          ];
        },
      }),
};

module.exports = nextConfig;

