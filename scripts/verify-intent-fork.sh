#!/usr/bin/env bash
set -euo pipefail
# Audit-carryover gate for the in-tree intent-transfer fork.
# Proves the two properties the carryover actually needs:
#   (1) vendored src/ differs from pinned upstream by ONLY the reviewed
#       patch set in scripts/intent-fork.expected.diff (declare_id! swap +
#       FOGO session-rail user-token debit)
#   (2) the deployed .so is a deterministic (verifiable) build of it
#
# Run from repo root. Pins are embedded (not read from gitignored docs).
# To extend the fork, regenerate the artifact (see REGEN below) in a
# separate, reviewable commit — drift from it otherwise fails the gate.

UPSTREAM_TAG="intent-transfer/v0.1.2"
UPSTREAM_COMMIT="f372c48df8215f5db76d51e914a6d4e9dc31f69e"
FORK_PROGRAM_ID="inTFf5S7ZtYr8SkwGG85mjDwAyJwjqEPdH2p2nuyrL9"
FORK_SRC="programs/intent-transfer/src"
EXPECTED_DIFF="scripts/intent-fork.expected.diff"
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' EXIT

git clone --quiet --depth 1 --branch "$UPSTREAM_TAG" \
  -c advice.detachedHead=false \
  https://github.com/fogo-foundation/fogo-sessions "$VERIFY_DIR"
GOT=$(git -C "$VERIFY_DIR" rev-parse HEAD)
if [ "$GOT" != "$UPSTREAM_COMMIT" ]; then
  echo "FAIL: $UPSTREAM_TAG resolved to $GOT, expected $UPSTREAM_COMMIT"; exit 1
fi

# `-N` makes added/deleted files appear as full +/- hunks instead of silent
# "Only in ..." lines, so a new backdoor.rs cannot slip past the +/- filter.
# Content lines start with a single +/- (the +++/--- file headers are dropped).
# REGEN: this exact pipeline (redirected to $EXPECTED_DIFF) regenerates the
# artifact after a reviewed fork change. Generate with GNU diff (CI's flavor);
# BSD/macOS diff emits an equivalent patch with a different hunk layout that
# fails the byte match. On macOS, run the regen in a Linux container.
CHANGED=$(diff -ruN "$VERIFY_DIR/programs/intent-transfer/src" "$FORK_SRC" \
  | grep -E '^[+-]' \
  | grep -Ev '^(\+\+\+|---)' || true)

# The carryover is valid iff the diff is exactly the committed patch set.
# The artifact embeds the declare_id! swap and the session-rail edits; any
# unreviewed line (e.g. `pub mod evil;`) diverges and is rejected here.
if ! EXPECTED=$(cat "$EXPECTED_DIFF" 2>/dev/null); then
  echo "FAIL: missing expected-diff artifact $EXPECTED_DIFF"; exit 1
fi
if [ "$CHANGED" != "$EXPECTED" ]; then
  echo "FAIL: fork src diff does not match $EXPECTED_DIFF"
  diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$CHANGED") || true
  exit 1
fi
if ! grep -qx "+declare_id!(\"$FORK_PROGRAM_ID\");" "$EXPECTED_DIFF"; then
  echo "FAIL: $EXPECTED_DIFF does not pin fork program id $FORK_PROGRAM_ID"; exit 1
fi
echo "OK: fork src matches reviewed patch set in $EXPECTED_DIFF (upstream $UPSTREAM_COMMIT)"

# Reproducible build (requires Docker; run at deploy/CI time).
# Base image pinned to upstream's audited toolchain
# (fogo-sessions build-and-upload-svm-programs.yaml @ intent-transfer/v0.1.2).
# A newer platform-tools inflates BridgeNttTokens::try_accounts past SBF's
# 4096-byte stack frame -> runtime access violation, so this pin is
# load-bearing; do NOT drop it for a bare `solana-verify build`.
VERIFY_BASE_IMAGE="solanafoundation/solana-verifiable-build:2.2.18"
if [ "${SKIP_REPRODUCIBLE_BUILD:-0}" = "1" ]; then
  echo "SKIP: reproducible build (SKIP_REPRODUCIBLE_BUILD=1)"; exit 0
fi
( cd programs/intent-transfer \
  && solana-verify build --library-name intent_transfer --base-image "$VERIFY_BASE_IMAGE" \
  && solana-verify get-executable-hash target/deploy/intent_transfer.so \
       | tee target/deploy/intent_transfer.sha256 )
