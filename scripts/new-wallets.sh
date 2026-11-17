#!/usr/bin/env bash
# Creates the two Base Sepolia wallets FLOPS needs (deployer + keeper) and writes
# their private keys straight into contracts/.env, which git ignores.
# Only the public addresses are printed, so nothing secret appears on screen.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/foundry/bin:$PATH"

OUT="${WALLETS_OUT:-contracts/.env}"

if [ -f "$OUT" ] && grep -qE '^DEPLOYER_PRIVATE_KEY=0x' "$OUT"; then
  echo "$OUT already has a deployer key, so nothing was changed."
  echo "Addresses already set up:"
  echo "  deployer: $(cast wallet address "$(grep -E '^DEPLOYER_PRIVATE_KEY=' "$OUT" | cut -d= -f2)")"
  echo "  keeper:   $(grep -E '^KEEPER_ADDRESS=' "$OUT" | cut -d= -f2)"
  exit 0
fi

new_wallet() { cast wallet new --json | python3 -c 'import sys,json; d=json.load(sys.stdin); d=d.get("data", d) if isinstance(d, dict) else d; w=d[0] if isinstance(d, list) else d; print(w["address"], w["private_key"])'; }
read -r DEPLOYER_ADDR DEPLOYER_KEY < <(new_wallet)
read -r KEEPER_ADDR KEEPER_KEY < <(new_wallet)

umask 077
cat > "$OUT" <<EOF
# FLOPS Base Sepolia wallets. Created by scripts/new-wallets.sh. NEVER commit or share this file.
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
# Deployer / owner (address $DEPLOYER_ADDR)
DEPLOYER_PRIVATE_KEY=$DEPLOYER_KEY
# Keeper (posts prices). Its private key goes into Railway later.
KEEPER_ADDRESS=$KEEPER_ADDR
KEEPER_PRIVATE_KEY=$KEEPER_KEY
POOL_SEED=1000000
# Optional: verify contracts on Basescan
ETHERSCAN_API_KEY=
EOF

echo "Created two new wallets. Keys are saved in $OUT (private, ignored by git)."
echo
echo "  Deployer address: $DEPLOYER_ADDR"
echo "  Keeper address:   $KEEPER_ADDR"
echo
echo "Next: send Base Sepolia test ETH to BOTH addresses from a faucet."
