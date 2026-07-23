import type { NextConfig } from 'next';

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  
  // Experimental features
  experimental: {
    // Enable typed routes (Next.js 16)
    typedRoutes: true,
    
    // Optimize package imports
    optimizePackageImports: ['lucide-react', '@tremor/react', 'recharts'],
  },
  
  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
      {
        source: '/share/(.*)',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
  
  // Sentry configuration (added when Sentry is initialized)
  // sentry: { ... },
  
  // Webpack tweaks (if needed)
  webpack: (config) => {
    // Externalize puppeteer (used only in worker service)
    config.externals = [...(config.externals || []), { puppeteer: 'commonjs puppeteer' }];
    return config;
  },
};

export default nextConfig;