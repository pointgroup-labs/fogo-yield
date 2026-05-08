import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    bin: 'src/bin.ts',
    vaa: 'src/vaa.ts',
    wormholescan: 'src/wormholescan.ts',
  },
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  // Note: shebang is preserved from src/bin.ts; no banner needed.
  sourcemap: true,
  clean: true,
  // Only the library entries get .d.ts — bin is a binary, no one
  // imports types from it. Keeps ./dist lean.
  dts: { entry: { vaa: 'src/vaa.ts', wormholescan: 'src/wormholescan.ts' } },
  // Bundle the SDK + @anchor-lang/core (same rationale as packages/cli):
  // their ESM builds are CJS source under .js extensions, so letting Node
  // resolve them at runtime triggers the dynamic-require / named-export
  // landmines. Bundling resolves everything at build time.
  noExternal: ['@fogo-onre/sdk', '@anchor-lang/core'],
  esbuildOptions(options) {
    options.mainFields = ['main', 'module']
  },
})
