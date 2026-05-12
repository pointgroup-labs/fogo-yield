import type { NextConfig } from 'next'

const config: NextConfig = {
  output: 'export',
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
