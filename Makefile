# Fogo OnRe — operational entrypoints.
#
# Convention: every target documented with `## section: description` shows
# up grouped under its section in `make help`. Sections are ordered by the
# first appearance of each name.

.DEFAULT_GOAL := help
SHELL := bash
.SHELLFLAGS := -eu -o pipefail -c
MAKEFLAGS += --no-print-directory --warn-undefined-variables

# Override on CLI:  make deploy CLUSTER=devnet
CLUSTER ?= localnet

# Auto-PHONY: every target name extracted from the Makefile becomes phony.
# Avoids the maintenance burden of a hand-curated `.PHONY:` list.
.PHONY: $(shell awk -F':' '/^[a-zA-Z_-]+:.*##/ {print $$1}' $(MAKEFILE_LIST))

help: ## info: List targets, grouped by section
	@awk 'BEGIN {FS = ":.*## "} \
	  /^[a-zA-Z_-]+:.*## / { \
	    p = index($$2, ": "); \
	    sec = substr($$2, 1, p - 1); \
	    desc = substr($$2, p + 2); \
	    if (!(sec in seen)) { seen[sec] = 1; order[++n] = sec; } \
	    body[sec] = body[sec] sprintf("  \033[36m%-14s\033[0m %s\n", $$1, desc); \
	  } \
	  END { \
	    printf "\nUsage: make <target>\n"; \
	    for (i = 1; i <= n; i++) { \
	      printf "\n\033[1m%s\033[0m\n%s", order[i], body[order[i]]; \
	    } \
	  }' $(MAKEFILE_LIST)

info: ## info: Print toolchain versions (paste into bug reports)
	@printf "node    "; node --version
	@printf "pnpm    "; pnpm --version
	@printf "rustc   "; rustc --version
	@printf "cargo   "; cargo --version
	@printf "anchor  "; anchor --version
	@printf "solana  "; solana --version

install: ## setup: Install JS deps (frozen lockfile)
	pnpm install --frozen-lockfile

build: ## build: anchor build → sync IDL into SDK → sdk build
	pnpm build

sync-idl: ## build: Copy fresh target/idl/relayer.json into the SDK
	@test -f target/idl/relayer.json || { echo "target/idl/relayer.json missing; run 'make build' first" >&2; exit 1; }
	pnpm sync-idl

idl-check: ## build: Verify SDK IDL matches the freshly-built canonical IDL (CI guard)
	@anchor build >/dev/null
	@diff -q target/idl/relayer.json packages/sdk/src/idl/fogo_onre_relayer.json \
	  || { echo "SDK IDL is stale. Run 'make build' and commit." >&2; exit 1; }
	@echo "✓ SDK IDL in sync with Rust source"

test: ## test: Full suite (rebuilds via pretest)
	pnpm test

test-rust: ## test: Rust unit tests only (no rebuild)
	cargo test --lib -p fogo-onre-relayer

test-ts: ## test: TS tests only, no rebuild (assumes 'make build' already ran)
	pnpm exec vitest run

test-watch: ## test: TS tests in watch mode
	pnpm exec vitest

# Usage:  make test-only T='claim_usdc'
test-only: ## test: Run a single test by name (T=...)
	@test -n "$$T" || { echo "Usage: make test-only T='test name'" >&2; exit 1; }
	pnpm exec vitest run -t "$$T"

lint: ## quality: ESLint + clippy (fails on warnings)
	pnpm lint
	cargo clippy --workspace --all-targets -- -D warnings

lint-fix: ## quality: ESLint --fix
	pnpm lint:fix

fmt: ## quality: cargo fmt --all
	cargo fmt --all

fmt-check: ## quality: cargo fmt --check (CI gate)
	cargo fmt --all -- --check

check: fmt-check lint test idl-check ## quality: Pre-push gate (fmt + lint + test + idl drift)

audit: ## quality: cargo audit + pnpm audit (advisory; non-blocking)
	-cargo audit
	-pnpm audit

clean: ## clean: Remove build artefacts (target/, dist/, .next/)
	rm -rf target packages/sdk/dist packages/webapp/.next packages/webapp/.turbo

reset: clean ## clean: clean + drop node_modules (re-run 'make install' after)
	rm -rf node_modules packages/*/node_modules

validator: ## dev: Run solana-test-validator with the relayer .so preloaded
	@test -f target/deploy/fogo_onre_relayer.so || $(MAKE) build
	solana-test-validator --reset \
	  --bpf-program onrenRKgX54qtWeK3cuaTBE71xx7dWMXn82ubH61vAp target/deploy/fogo_onre_relayer.so

webapp-dev: ## dev: Next.js webapp in dev mode
	pnpm webapp dev

webapp-build: ## dev: Production build of the webapp
	pnpm webapp build

deploy: ## deploy: anchor deploy to $CLUSTER (default: localnet)
	anchor deploy --provider.cluster $(CLUSTER)

deploy-devnet: ## deploy: anchor deploy to devnet
	@$(MAKE) deploy CLUSTER=devnet

deploy-mainnet: ## deploy: anchor deploy to mainnet (typed confirmation required)
	@echo "MAINNET DEPLOY — review docs/deploy-mainnet.md and docs/deploy-checklist.md first."
	@read -r -p "Type 'mainnet' to proceed: " confirm; \
	  [[ "$$confirm" == "mainnet" ]] || { echo "Aborted." >&2; exit 1; }
	@$(MAKE) deploy CLUSTER=mainnet

ci: install fmt-check lint test idl-check ## ci: Exact sequence CI runs
