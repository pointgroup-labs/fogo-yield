/**
 * Manual cranker commands. Deposit-leg scope (steps 1-3):
 *
 *   - `cranker status   --fogo-tx <SIG>`    — read on-chain Flow PDA, tell
 *                                              operator which step is next.
 *   - `cranker claim-usdc       --fogo-tx <SIG>` — step 1: NTT redeem +
 *                                                 per-user inbox sweep.
 *                                                 Writes inflight Flow.
 *   - `cranker swap-usdc-to-onyc --fogo-tx <SIG>` — step 2: OnRe `take_offer`
 *                                                  CPI swaps USDC → ONyc into
 *                                                  the relayer's ONyc ATA.
 *                                                  Advances Flow to Swapped.
 *   - `cranker lock-onyc        --fogo-tx <SIG>` — step 3: NTT `transfer_lock`
 *                                                 ONyc back to FOGO as ONyc,
 *                                                 closes the inflight Flow.
 *
 * Withdraw-leg commands (`unlock-onyc`, `request-redemption`,
 * `claim-redemption`, `send-usdc-to-user`) are still deferred — they
 * mirror the deposit pattern but on the ONyc-redeem side and only
 * matter once a user actually withdraws.
 *
 * `--fogo-tx <SIG>` is the universal handle: every command resolves it to
 * the same VAA (and therefore the same `nttInboxItem`), so the operator
 * uses one signature across all three deposit steps. `--vaa <HEX>` is
 * the deterministic fallback for the first command (claim-usdc) when
 * Wormholescan is degraded; later steps don't need it because they
 * key on the on-chain Flow PDA, not the VAA bytes.
 *
 * Pre-flight philosophy mirrors `relayer initialize` / `configure`:
 * dry-run by default, `--confirm` to broadcast, every plan-line keyed on
 * an explicit pubkey/value the operator can cross-check before signing.
 * Each step also gates on the prior Flow status, so re-running a
 * landed step is a hard error rather than wasted gas.
 */
import { Command } from 'commander'
import { advanceCommand } from './advance'
import { claimUsdcCommand } from './claim-usdc'
import { diagnoseCommand } from './diagnose'
import { lockOnycCommand } from './lock-onyc'
import { redeemFogoCommand } from './redeem-fogo'
import { releaseOutboundCommand } from './release-outbound'
import { sendUsdcToUserCommand } from './send-usdc-to-user'
import { statusCommand } from './status'
import { swapUsdcToOnycCommand } from './swap-usdc-to-onyc'
import { unlockOnycCommand } from './unlock-onyc'

export function crankerCommands(): Command {
  const cranker = new Command('cranker').description(
    'Permissionless flow-driving instructions. Anyone can run these — '
    + 'they just move funds along the relayer\'s state machine.',
  )

  cranker.addCommand(statusCommand())
  cranker.addCommand(diagnoseCommand())
  cranker.addCommand(claimUsdcCommand())
  cranker.addCommand(swapUsdcToOnycCommand())
  cranker.addCommand(lockOnycCommand())
  cranker.addCommand(releaseOutboundCommand())
  cranker.addCommand(advanceCommand())
  cranker.addCommand(redeemFogoCommand())
  cranker.addCommand(unlockOnycCommand())
  cranker.addCommand(sendUsdcToUserCommand())

  return cranker
}
