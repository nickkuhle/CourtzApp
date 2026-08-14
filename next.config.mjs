/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Serve responses gzipped even on hosts that don't compress at the edge.
  compress: true,
  // Don't advertise the framework in the Server header.
  poweredByHeader: false,

  async headers() {
    // A strict-but-safe Content-Security-Policy. Next.js inline hydration
    // scripts need 'unsafe-inline'; dev-mode bundlers also need 'unsafe-eval'
    // (left out of production). frame-ancestors is deliberately not set so
    // the app can be embedded (preview panes, tournament portals).
    const isDev = process.env.NODE_ENV === 'development'
    const scriptSrc = isDev
      ? "'self' 'unsafe-inline' 'unsafe-eval'"
      : "'self' 'unsafe-inline'"
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Static assets (the logo and any public images) never change, so
        // browsers may cache them forever. Security headers above still apply.
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

export default nextConfig
