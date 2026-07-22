# Integration Guide

For any protocol integrating a Fogo Yield token — money markets, vaults,
dashboards, wallets. Fogo Yield is asset-agnostic (one relayer config per
`(USDC, asset)` pair), so the same steps apply to every token. This covers two
things: **identifying** a token and **pricing** it via Pyth. ONyc is the first
live token and the worked example throughout; new tokens add an entry to
[the registry](#token-registry) and nothing else here changes.

## The Model

- A token is an SPL mint on FOGO plus a Pyth price feed. That is all you need to
  list or value it.
- The read pattern and valuation math are **identical across tokens** — only the
  per-token parameters (mint, decimals, feed id) change.
- Size the staleness window to the **feed's cadence**: a NAV feed updates ~daily
  (window in hours); a market feed updates sub-second (window in seconds).

## Shared Infra

Chain-wide Pyth, same program ids on Solana and FOGO — reference once, reuse for
every token:

| Component               | Address                                        |
| ----------------------- | ---------------------------------------------- |
| Hermes (off-chain REST) | `https://hermes.pyth.network`                  |
| Pyth Receiver           | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`  |
| Pyth push-oracle        | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`  |
| Wormhole guardian       | `HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ` |

## Token Registry

A token contributes just three things — mint, decimals, and one Pyth feed id.
Every other address is derived: the on-chain price account is the push-oracle PDA
of `[u16_le(0), feed_id]`, identical on every chain.

```ts
const [priceAccount] = PublicKey.findProgramAddressSync(
  [Buffer.alloc(2), Buffer.from(feedId, 'hex')], // shard 0
  new PublicKey('pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT'),
)
```

**ONyc** — yield-bearing, backed by [OnRe](https://onre.finance/) reinsurance; priced
by a NAV feed that accrues over time (no fixed $1 peg).

| Field         | Value                                                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FOGO mint     | `oNyCm1QsAatj3ckaEwZjtAPWvstPn3Zm5MAYPtkjEfa` · 9 dp                                                                                                                          |
| Pyth feed id  | [babbfcc7f46b6e7df73adcccece8b6782408ed27c4e77f35ba39a449440170ab](https://pythfeeds.com/feeds/babbfcc7f46b6e7df73adcccece8b6782408ed27c4e77f35ba39a449440170ab) · NAV, daily |
| Price account | [8uto8utKdfs2ajrmBtcFL5s9mXbc7UPg8HSdLwCn1Mg7](https://fogoscan.com/account/8uto8utKdfs2ajrmBtcFL5s9mXbc7UPg8HSdLwCn1Mg7) (derived)                                           |
| Solana mint   | [5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5](https://solscan.io/account/5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5) (bridge only)                                         |

## Pricing

The feed id and the price account are the same feed, two access paths. A Pyth
price is `price × 10^expo` (`expo` is negative). Everything below is
parameterized by `FEED_ID` and the token's `DECIMALS`.

**Off-chain** — one HTTP GET against Hermes, the simplest path to a live price
and no on-chain dependency:

```ts
const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?ids[]=${FEED_ID}&parsed=true`)
const { price, expo, conf } = (await res.json()).parsed[0].price
const priceUsd = Number(price) * 10 ** expo
const lowerUsd = Number(BigInt(price) - BigInt(conf)) * 10 ** expo // conservative bound for collateral
```

**On-chain (FOGO)** — read the `PriceUpdateV2` account with Pyth's receiver SDK;
it fails closed if the feed is missing, mismatched, or older than
`MAX_AGE_SECONDS` (size that from the feed's cadence — hours for a daily NAV):

```rust
use pyth_solana_receiver_sdk::price_update::{get_feed_id_from_hex, PriceUpdateV2};

let feed_id = get_feed_id_from_hex(FEED_ID_HEX) ?;
let price = price_update.get_price_no_older_than( & Clock::get() ?, MAX_AGE_SECONDS, & feed_id) ?;
// price_usd = price.price × 10^price.exponent
```

> The on-chain account exists on FOGO only after a keeper posts the feed there.
> Confirm it exists and is fresh before depending on it in-program. Off-chain
> reads via Hermes have no such dependency.

**Value a balance** — `amount` is in base units (`10^DECIMALS`):

```ts
const usd = (Number(amount) / 10 ** DECIMALS) * priceUsd
```

For integer math in USDC base units (6 dp), fold in the decimal delta and handle
the negative exponent as a division:

```text
scale = expo + 6 − DECIMALS
value_usdc_base = amount * price * 10^scale       (scale ≥ 0)
                = amount * price / 10^(−scale)     (scale < 0)

ONyc (DECIMALS 9, price 1.07e8, expo −8): scale = −11
      1e9 * 1.07e8 / 10^11 = 1_070_000 = $1.07 ✓
```

## Integrate a Token

1. **Identify** it — take the mint, decimals, and feed id from the
   [registry](#token-registry).
2. **Price** it — Hermes off-chain, the `PriceUpdateV2` account in-program.
   Verify the feed id matches the registry and reject any price past your
   staleness window.
3. **Model** it — Fogo Yield tokens are not stablecoins: a NAV feed accrues and
   drifts, a market feed is volatile, and neither is pegged. For collateral,
   value against a conservative bound (`price − conf`) with a prudent LTV, and
   assume the exit price can differ from the reading.
