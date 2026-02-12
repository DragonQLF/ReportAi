/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: 'pub-*.r2.dev' },
      { protocol: 'https', hostname: '*.cloudflarestorage.com' },
    ],
  },
  // Webpack alias for react-pdf (pdfjs-dist uses canvas optionally)
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  // Turbopack alias for react-pdf (Next.js 16+ uses Turbopack by default)
  turbopack: {
    resolveAlias: {
      canvas: './empty-module.js',
    },
  },
};

module.exports = nextConfig;
