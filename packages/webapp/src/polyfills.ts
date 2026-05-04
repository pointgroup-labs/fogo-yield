// The Solana wallet-adapter / bn.js / @noble stack used by
// `@fogo/sessions-sdk-react` reaches for `globalThis.Buffer` at module
// load. Next.js doesn't polyfill Node globals into the browser bundle,
// so without this the FogoSessionProvider hangs in `Initializing` and
// the SessionButton sits in a permanent loading state.
//
// Import this file BEFORE anything that touches the sessions SDK
// (i.e. as the first import in `providers.tsx`).
import { Buffer as BufferPolyfill } from 'buffer'

if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = BufferPolyfill
}
