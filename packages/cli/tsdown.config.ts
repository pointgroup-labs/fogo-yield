import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  dts: false,
  outExtensions: () => ({ js: '.js' }),
  // Bundle deps whose "ESM" is actually CJS source under .js extensions
  // (named-export + dynamic-require landmines) or whose ESM index does
  // extensionless imports Node's strict resolver rejects (NTT SDK's
  // `import "./side-effects"`). Rolldown resolves both at build time.
  deps: {
    alwaysBundle: ['@ignitionfi/fogo-yield-sdk', '@fogo-yield/cranker', '@anchor-lang/core', '@wormhole-foundation/sdk-solana-ntt', 'chalk'],
  },
  inputOptions: {
    // Prefer each dep's CJS `main` over its broken ESM `module` entry.
    resolve: { mainFields: ['main', 'module'] },
  },
})
