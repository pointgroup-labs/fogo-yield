import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  // SDK is a workspace dep that re-exports BN from a CJS-only package
  // (@anchor-lang/core whose "ESM" build is actually CJS source). Bundling
  // resolves the named exports at build time; emitting CJS sidesteps the
  // ESM↔CJS interop landmines (dynamic require, top-level exports.x, etc.).
  noExternal: ['@fogo-onre/sdk', '@anchor-lang/core', 'chalk'],
  // @anchor-lang/core's "module" entry is fake ESM (CJS source with .js
  // ESM extension). Resolve via "main" so esbuild gets real CJS instead.
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
