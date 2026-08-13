/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Performance improvements: compress and optimize
  compress: true,
  poweredByHeader: false,
  // Optimize images and static assets
  experimental: {
    // Enable optimistic client cache
    optimizePackageImports: ['react'],
  },
  // Headers for caching static assets
  async headers() {
    return [
      {
        source: '/:all*(svg|jpg|png)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
