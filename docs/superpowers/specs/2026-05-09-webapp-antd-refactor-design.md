# Webapp Refactor: antd + TanStack Query (C2 + D2)

**Date:** 2026-05-09
**Scope:** `packages/webapp/` only
**Status:** Design — pending user approval (revised after codex CLI review)

## Goal

Refactor the FOGO OnRe webapp to use Ant Design 5 as the component
library and TanStack Query 5 as the data layer. Preserve bridge logic
semantically; modernize everything around it. Improve UX with antd
primitives where it's a clear win (Steps for bridge progress, Form for
the transfer card, notification for async errors). Drop the bespoke
Tailwind layout and toast systems.

## Non-Goals

- No changes to the Solana program or third-party CPI bindings.
- No changes to `packages/sdk/`.
- No semantic changes to `src/constants.ts`, `src/utils/transfer.ts`,
  or `src/lib/bridge/*` (call sites adjust; internals do not).
- No new tests, Storybook, Playwright, or i18n.
- No changes to wallet-adapter selection.

## Decisions Recap

- **Scope:** Option C (full architectural refactor), variant **C2**
  (refactor + UX polish, behavior-preserving for bridge calls).
- **Data layer:** Option **D2** — TanStack Query replaces the
  hand-rolled fetching hooks; pending-tx state collapses into a
  persisted `flow-status` query family; `settings` Zustand store
  stays; `toasts` store is deleted.
- **Validation:** Option **V1** — manual devnet smoke test, no new
  automated tests.
- **Tailwind:** Option **T2** — removed. Layout via antd `Layout`,
  `Flex`, `Space`.
- **Theme:** Option **Th3** — light/dark toggle, default dark,
  `colorPrimary: '#6366f1'` (indigo) **as a placeholder you may
  override at review time**.

## Architecture

### Dependency changes

Added (webapp only):
- `antd@^5`
- `@ant-design/v5-patch-for-react-19` — required because the webapp
  uses React 19; imported once at the top of `app/layout.tsx` *before*
  any antd component import.
- `@ant-design/nextjs-registry` (App Router CSS-in-JS SSR)
- `@tanstack/react-query@^5`
- `@tanstack/react-query-devtools` (dev only)
- `@tanstack/query-sync-storage-persister`
- `@tanstack/react-query-persist-client`
- `dayjs` (antd peer)

Removed:
- `tailwindcss`, `@tailwindcss/postcss`, postcss config, `tailwind.config.*`,
  `@tailwind` directives in `globals.css`.
- `src/components/ToastHost.tsx`
- `src/store/toasts.ts`
- `src/store/pending-txs.ts`

### Provider tree

```
<AntdRegistry>
  <ConfigProvider theme={...} locale={enUS}>
    <App>
      <PersistQueryClientProvider client={queryClient} persistOptions={...}>
        <WalletProviders>
          {children}
        </WalletProviders>
      </PersistQueryClientProvider>
    </App>
  </ConfigProvider>
</AntdRegistry>
```

The `App` wrapper must enclose every component that calls
`App.useApp()`. `ConfigProvider` is outside `App` so theme tokens
flow into `App`'s portal-rendered notifications/messages.

### Theme

- `algorithm`: `[theme.darkAlgorithm, theme.compactAlgorithm]` by
  default; `[theme.defaultAlgorithm, theme.compactAlgorithm]` when the
  toggle is set to light.
- `token.colorPrimary`: `#6366f1` (placeholder — override pre-merge
  if a real brand color is preferred).
- Persisted via the `settings` Zustand store under key `theme`
  (`'dark' | 'light' | 'auto'`, default `'dark'`).
- **SSR posture:** the server always renders with the default dark
  algorithm — `localStorage` is unreadable on the server. On the
  client, the `ConfigProvider` algorithm switches to the persisted
  preference at first paint after hydration. Users with `'light'` or
  `'auto'` will see one frame of dark theme on cold load; this is an
  accepted tradeoff (the alternative is no SSR at all). The inline
  `<script>` in `<head>` only sets `data-theme` on `<html>` for *non-
  antd* surfaces (raw body styling, scrollbar) — it does **not**
  drive antd tokens; antd tokens come exclusively from `ConfigProvider`.

### Bundle/perf rules applied

- `bundle-dynamic-imports`: `SettingsDrawer` is `next/dynamic`-loaded
  (`{ ssr: false }`); wallet adapter UI stays dynamic as today.
- `server-hoist-static-io`: query defaults (`staleTime`, `retry`)
  defined in a static `defaultOptions` object at module scope.
- **`QueryClient` lifecycle (App Router pattern):** never a true
  module-scope singleton. A `getQueryClient()` helper returns a fresh
  client on the server (per request) and a memoized browser singleton
  via `globalThis.__fogoQueryClient` on the client. `Providers` is a
  `'use client'` component that calls `getQueryClient()` inside a
  `useState` initializer (`rerender-lazy-state-init`). The
  `localStoragePersister` is constructed only when `typeof window !==
  'undefined'`; `PersistQueryClientProvider` is mounted only on the
  client to avoid SSR `localStorage` access.
- `bundle-barrel-imports`: import directly from `'antd'` (antd 5
  tree-shakes); revisit if bundle analysis shows regression.

## Component Map

| Today | Fate | New form |
|---|---|---|
| `app/page.tsx` | rewrite | `Layout.Header`/`Content`/`Footer`; `Tabs` replaces hand-rolled tablist |
| `app/layout.tsx` | minor | adds `AntdRegistry`; theme bootstrap script |
| `providers.tsx` | rewrite | new tree above |
| `Header.tsx` | rewrite | brand left; `ThemeToggle` + settings button + `WalletButton` right |
| `TransferCard.tsx` | rewrite | antd `Card` + `Form` + `Form.Item` + `InputNumber`; submit `Button type="primary" size="large" block loading={...}` |
| `AmountInput.tsx` | collapse | merged into `Form.Item` + `InputNumber` with `addonAfter={<SymbolPill/>}`; max-balance shortcut becomes adjacent `Button size="small"` |
| `ReceiveField.tsx` | collapse | merged into a read-only `Form.Item` + `Statistic` for the formatted output |
| `SymbolPill.tsx` | keep | reused as `addonAfter` |
| `ProtocolStats.tsx` | rewrite | `Statistic` cards in `Row`/`Col`; wrapped in `Suspense` with `Skeleton` fallback |
| `PendingTxList.tsx` | rewrite | antd `List` + `List.Item.Meta`; each item shows `BridgeSteps` (size="small"); `Empty` for the no-txs state |
| `SettingsDrawer.tsx` | rewrite | antd `Drawer` + `Form`; loaded via `next/dynamic` |
| `ToastHost.tsx` | delete | replaced by `App.useApp().notification` |
| `ErrorBoundary.tsx` | keep | fallback uses `Result status="error"` + retry `Button` |

New components:
- `BridgeSteps.tsx` — wraps antd `Steps` with the flow-status →
  step-index mapping. Single source of truth for "where is this
  bridge".
- `WalletButton.tsx` — primary `Button` when disconnected,
  `Dropdown` (address + disconnect) when connected.
- `ThemeToggle.tsx` — `Segmented` (☀️ / 🌙 / Auto), bound to
  `settings`.

### React perf rules baked in

- `rendering-conditional-render`: ternaries instead of `&&` in JSX.
- `rerender-no-inline-components`: subcomponents always defined at
  module scope.
- `rerender-defer-reads`: Zustand selectors so components subscribe
  only to slices they read.
- `rerender-derived-state-no-effect`: receive-amount derived during
  render from form input + quote query, never `useEffect`-stored.
- `rerender-lazy-state-init`: function form of `useState` for any
  expensive initial computation.
- `async-cheap-condition-before-await`: pre-checks (publicKey,
  amount, withdraw-singleton) run before the first `fetchQuery`.

### Form architecture

`TransferCard` uses antd `Form` with controlled validation:
- `Form.useForm()` for imperative submit/reset.
- `Form.useWatch('amount', form)` to drive the live receive-amount.
- `rules` for amount validation (positive, ≤ balance, decimals).
- `Form.onFinish` only fires when validation passes.
- `InputNumber` is configured with `stringMode` so token amounts
  preserve full decimal precision (no float coercion); the form
  value's type is `string`, and base-unit conversion happens in the
  submit handler.
- The submit `Button`'s `disabled` state is derived explicitly via
  `Form.useWatch` over the relevant fields plus
  `form.getFieldsError()` — antd does not provide "disable while
  invalid" automatically.

Collapses ~6 `useState`s into one form instance and gets
submit-on-Enter for free.

## Data Flow

### Query keys

All keys use string-safe primitives only — `PublicKey` becomes
`pubkey.toBase58()`, `bigint`/amounts become decimal strings. No
class instances or `bigint` in keys or persisted payloads.

| Key | `staleTime` | `refetchInterval` | Notes |
|---|---|---|---|
| `['balances', ownerB58, mintB58]` | `10s` | `15s` when tab visible, off when hidden | one query per (wallet, mint); visibility via `useDocumentVisible` in the `refetchInterval` callback |
| `['onyc-price']` | `60s` | `5min` | shared (`client-swr-dedup`) |
| `['protocol-state', programIdB58]` | `30s` | `1min` | feeds `ProtocolStats`; uses `useSuspenseQuery` so the `Suspense` + `Skeleton` boundary actually triggers |
| `['bridge-fee', srcChain, dstChain, mintB58, amountStr]` | `30s` | none | refetched on input change via key |
| `['flow-status', flowId]` | `5s` while non-terminal; `Infinity` once terminal | `5s` while non-terminal | per-pending-tx |
| `['pending-flow-ids']` | `Infinity` | none | persisted index of known flow IDs; the source of truth for `PendingTxList`'s `useQueries`. Mutated via `setQueryData` on submit and on terminal-prune. |

### Persisted flow-status payload

A persisted `['flow-status', flowId]` entry must carry enough state
to (a) render the row without re-fetching anything, and (b) resume
polling correctly after reload:

```ts
type PersistedFlowStatus = {
  flowId: string                 // PDA address (base58)
  kind: 'deposit' | 'withdraw'
  signature: string              // origin tx signature for explorer link
  ownerB58: string               // wallet that initiated
  mintB58: string                // source mint (USDC.s for deposit, ONyc for withdraw)
  amountStr: string              // base-unit amount as decimal string
  startedAt: number              // ms epoch
  baselineDestBalanceStr: string // dest balance captured *before* sign — see Race section
  status: 'pending' | 'in-progress' | 'terminal-success' | 'terminal-failure'
  notified: boolean              // whether the terminal notification has fired
  lastPolledAt: number           // ms epoch
}
```

### Persistence

- `localStoragePersister` keyed `fogo-onre.queries.v1`.
- `dehydrateOptions.shouldDehydrateQuery`: only
  `['flow-status', ...]` and `['pending-flow-ids']` queries persist.
  Balances/prices stay in-memory and refetch on load.
- **No `maxAge` cap.** Stale-but-still-pending entries are kept and
  surfaced with a warning state in the row (computed from
  `Date.now() - startedAt > 24h`). Capping via `maxAge` would silently
  drop them, which contradicts the warning UX.
- Schema versioning per `client-localstorage-schema`: bump the `.v1`
  suffix on the persister key when `PersistedFlowStatus` shape
  changes; old caches are then ignored on load.

### Submit flow (deposit/withdraw)

The submit handler is a `useMutation` so concurrent submits are
locked at the mutation level (TanStack Query's `mutate` is a no-op
while `isPending`). This is the local "double-click / reload race"
guard; the relayer's on-chain mutex remains the real enforcement.

1. `Form.onFinish` fires with `{ amount, recipient? }`; mutation runs.
2. Cheap pre-checks (`async-cheap-condition-before-await`):
   - `publicKey == null` → notification, abort mutation.
   - amount invalid → defensive abort (validation already caught).
   - withdraw + non-terminal withdraw flow exists in
     `['pending-flow-ids']` → notification "withdraw already in
     flight", abort.
3. **Capture destination baseline** before any signing:
   `baselineDestBalanceStr = await fetchBalance(destOwner, destMint)`.
   This is what the original hook comments already guarded; persisting
   it lets a post-reload poll distinguish "not yet delivered" from
   "delivered before page loaded".
4. `queryClient.fetchQuery({ queryKey: ['bridge-fee', ...], queryFn })`
   — one-shot (`async-defer-await`); v5 object syntax.
5. Build NTT instruction via the SDK
   (`buildFogoNttDepositIx` / `buildFogoNttWithdrawIx`) — semantically
   unchanged.
6. Send via wallet adapter; on signature returned:
   - `setQueryData(['flow-status', flowId], { ...PersistedFlowStatus, status: 'pending', notified: false })`
   - `setQueryData(['pending-flow-ids'], (prev) => [...prev, flowId])`
     — this is the reactive trigger that makes `PendingTxList`
     re-render (it subscribes to `['pending-flow-ids']` via `useQuery`).
7. `notification.success` confirms submission.
8. The per-row `useQuery(['flow-status', flowId])` polls every 5s
   while non-terminal. On observed transition to a terminal status:
   - `setQueryData(['flow-status', flowId], { ..., status, notified: true })`
   - if `notified` was `false` *before* this transition, fire
     `notification.success` (or `error`) with a "view explorer"
     action. The `notified` flag prevents replay on reload — if the
     flow was already terminal-and-notified in localStorage, no
     notification fires on rehydration.
   - polling stops because `staleTime` is `Infinity` once terminal.

### Withdraw singleton guard

Three layers, weakest to strongest:
1. **Mutation-level lock.** The submit `useMutation`'s `isPending`
   blocks rapid double-clicks within a tab.
2. **Cache-level guard.** Submit handler reads
   `['pending-flow-ids']` → checks if any non-terminal
   `['flow-status', id]` entry has `kind === 'withdraw'`; if so,
   notification "withdraw already in flight" and abort.
3. **On-chain mutex.** Relayer enforces a singleton
   `RedemptionTracker`. The cache guard is racy across tabs and
   reloads; the on-chain mutex catches what the UI misses. The
   handler treats the relayer's mutex error as expected UX (friendly
   notification, no console error spam).

## Error Handling

### Error boundaries

- Existing `ErrorBoundary` retained, fallback restyled to
  `Result status="error"` + reload `Button`.
- Boundaries on: `protocol stats`, the active tab's `TransferCard`,
  `recent transactions`, and the new `WalletButton`.

### Async error sink

- `notification.error({ key, message, description, btn })` from
  `App.useApp()` is the *only* user-visible async-error sink.
- Stable `key`s so retries replace prior notifications.
- `formatError(err)` maps known error classes (wallet-adapter
  `WalletSignTransactionError`, RPC errors with codes, NTT-specific
  errors) to friendly messages; unknown falls back to `err.message`.

### Query error policy

- `retry: 2` with exponential backoff for read queries.
- `retry: false` for the one-shot `fetchQuery` inside submit.
- `throwOnError: false` everywhere except `useSuspenseQuery` queries
  (which must throw to trigger Suspense/error fallbacks). Plain
  `useQuery` errors surface inline via `query.isError` /
  `query.error` rendered as antd `Alert` or `Result` mini-states —
  they do **not** propagate to `ErrorBoundary`. Render-time errors
  (component bugs) and runtime data errors stay on separate channels.

### Loading states

- `Suspense` + `Skeleton` for `ProtocolStats` is driven by
  `useSuspenseQuery` (plain `useQuery` does not suspend).
- `Spin` for `TransferCard` while wallet is connecting.
- `Button loading` for in-flight submits (sourced from
  `mutation.isPending`).
- `List` `loading` while persisted queries rehydrate (read from
  `useIsRestoring()` from `@tanstack/react-query-persist-client`).

### SSR / hydration

- `<AntdRegistry>` in `app/layout.tsx` collects antd CSS during SSR.
- The app remains client-rendered (`'use client'` on `page.tsx`).
- Theme bootstrap script in `<head>` sets `data-theme` on `<html>`
  before hydration to prevent FOUC.

## Implementation Order

Each step keeps the app buildable. Tailwind is removed **last**
among the convert-then-strip pairs, so every page renders with at
least one of {old Tailwind layout, new antd layout} at any moment.

1. **Provider scaffolding.** Add deps (including
   `@ant-design/v5-patch-for-react-19` imported first in
   `app/layout.tsx`); rewrite `providers.tsx` and `app/layout.tsx`
   with `AntdRegistry`, `ConfigProvider`, `App`, the
   `getQueryClient()` helper, and `PersistQueryClientProvider`
   mounted client-side only. App still renders the old `page.tsx`
   body. `ThemeToggle` not yet added — algorithm reads from store
   directly inside `Providers`.
2. **Hooks → TanStack Query.** Rewrite `useBalances`,
   `useOnycPrice`, `useProtocolState` (`useSuspenseQuery`),
   `useBridgeFee`, `useFlowStatus` to use `useQuery`. RPC internals
   in `utils/transfer.ts` and `lib/bridge/*` untouched. Old hook
   signatures preserved during this step so call sites don't churn.
3. **Combined: pending-tx persistence + `TransferCard` rewrite.**
   Done together because deleting `store/pending-txs.ts` requires
   the new submit handler to write to QueryClient instead. Adds
   `['pending-flow-ids']`, the `PersistedFlowStatus` schema, the
   `useMutation` submit, the baseline-balance capture, the
   notify-once flag. Rewrites `TransferCard` to antd `Form` + drops
   `AmountInput` / `ReceiveField`. Rewrites `PendingTxList` to
   `useQueries` driven by `['pending-flow-ids']`.
4. **Notifications.** Delete `ToastHost` and `store/toasts.ts`;
   replace every `pushToast` call site with `App.useApp().notification.X`.
5. **Polish.** `BridgeSteps` in `PendingTxList` items;
   `ProtocolStats` rewritten to `Statistic` + `Suspense`/`Skeleton`;
   `SettingsDrawer` rewritten to antd `Drawer` + `Form` and
   `next/dynamic`-loaded; `ThemeToggle` (`Segmented`) added to
   `Header` and wired to `settings`.
6. **Header & layout polish.** Convert `Header` and `page.tsx`
   chrome (footer, main wrapper) to antd `Layout` / `Flex`. At this
   point only utility classes remain; everything component-shaped is
   antd.
7. **Tailwind removal.** Strip `tailwindcss`,
   `@tailwindcss/postcss`, postcss config, `@tailwind` directives,
   `tailwind.config.*`. Convert any remaining utility classes to
   antd `Flex`/`Space` props or inline styles. App must still build
   and render after this step.
8. **Bundle pass.** Confirm `next/dynamic` on `SettingsDrawer` (and
   add for other heavy panels if measurement helps); `next build`;
   review the route's first-load JS for regressions.
9. **Cleanup.** Remove dead exports/CSS; `pnpm lint:fix`. (Skipping
   `pnpm sdk build` — webapp refactor doesn't touch the SDK and
   triggering it would violate the no-`packages/sdk` constraint.)

## Validation (V1)

Manual devnet smoke checklist:

- [ ] App boots; theme toggle persists across reload; no FOUC.
- [ ] Wallet connect/disconnect; address visible in header dropdown.
- [ ] `ProtocolStats` renders real numbers.
- [ ] Deposit happy path: validation → submit → notification → row
      appears → `BridgeSteps` advances → terminal notification.
- [ ] Withdraw happy path: same.
- [ ] Withdraw concurrency block: second withdraw rejected with
      "already in flight"; no on-chain call made.
- [ ] Reload mid-flow: persisted `flow-status` keeps row visible and
      resumes polling.
- [ ] Wallet rejection during signing: `warning` notification; no
      flow row created.
- [ ] Error boundary: throwing inside `ProtocolStats` renders
      `Result`; `TransferCard` keeps working.
- [ ] `next build` succeeds; no console errors on dev server.

## Estimated Diff

- ~17 files modified
- 3 files deleted (`ToastHost.tsx`, `store/toasts.ts`,
  `store/pending-txs.ts`) plus Tailwind config files
- 3 files added (`BridgeSteps.tsx`, `WalletButton.tsx`,
  `ThemeToggle.tsx`)

## Risks

- **React 19 + antd 5 internal-API breakages.** Antd 5 has known
  warnings under React 19 around `findDOMNode` and message/notification
  static methods. Mitigation: import
  `@ant-design/v5-patch-for-react-19` at the top of `app/layout.tsx`
  and use the contextual API (`App.useApp()`) exclusively — never the
  static `notification.error(...)` import.
- **CSS-in-JS SSR with App Router.** `@ant-design/nextjs-registry`
  is the supported path; verify on first boot that styles aren't
  duplicated between SSR injection and client hydration.
- **Persistence schema drift.** A future shape change to
  `PersistedFlowStatus` without bumping the `v1` key would
  deserialize stale entries. Mitigation: bump the `.v1` suffix in the
  persister key whenever the schema changes; treat the rehydrated
  cache as advisory and revalidate via the live `flow-status` query.
- **Cross-tab withdraw race.** Cache guard does not lock across tabs.
  Mitigation: rely on the on-chain mutex; render the relayer's mutex
  error as an expected UX state, not a failure.
- **Notify-once on reload.** Without the `notified` flag, terminal
  notifications would replay on every reload of a completed flow.
  The flag is persisted with the rest of the flow status and gated
  on the *transition* (not the value) so legitimate later
  transitions still notify.
- **SSR theme flash.** Users with non-default theme see one frame of
  dark on cold load. Accepted tradeoff; the alternative is no SSR.
