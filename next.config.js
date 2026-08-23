/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['85.190.97.158'],
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:5000/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
