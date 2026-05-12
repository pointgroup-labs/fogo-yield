import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'export',
  // Static export has no Node server, so the `/_next/image?url=…`
  // optimizer endpoint isn't reachable at runtime. Without this flag,
  // raster assets (PNG/JPG) imported via `next/image` 404 in production
  // because their src points at the dead optimizer route. SVGs happen
  // to work without it because Next bypasses the optimizer for them.
  // Setting `unoptimized: true` makes Next emit the raw hashed asset
  // URL directly — same caching, no optimizer dependency.
  images: {
    unoptimized: true,
  },
  devIndicators: {
    position: 'bottom-right',
  },
  poweredByHeader: false,
  reactStrictMode: true,
  reactCompiler: process.env.NODE_ENV === 'production', // Keep the development environment fast
  logging: {
    browserToTerminal: process.env.BROWSER_TO_TERMINAL_DISABLED !== 'true',
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
}

export default config
