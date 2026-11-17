#!/usr/bin/env bash
# One command to run all of FLOPS locally:
#   local chain (anvil) → deploy contracts → export ABIs → keeper → website
# Requires: node ≥ 22, foundry (forge + anvil) on PATH, and `npm install` already run.
set -euo pipefail
cd "$(dirname "$0")/.."

# Anvil's built-in, publicly known test accounts. Never use these on a real network.
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # account #0
KEEPER_ADDR=0x70997970C51812dc3A010C7d01b50e0d17dc79C8                           # account #1

pids=()
cleanup() { echo; echo "Stopping…"; kill "${pids[@]}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "▸ starting anvil on :8545"
anvil --host 127.0.0.1 --port 8545 --silent &
pids+=($!)
until curl -s -o /dev/null -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545; do sleep 0.3; done

echo "▸ deploying contracts"
(cd contracts && DEPLOYER_PRIVATE_KEY=$DEPLOYER_KEY KEEPER_ADDRESS=$KEEPER_ADDR \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --silent)
node scripts/export-abi.mjs

[ -f keeper/.env ] || cp keeper/.env.example keeper/.env
[ -f web/.env.local ] || cp web/.env.example web/.env.local
rm -rf keeper/.data # fresh chain → fresh index

echo "▸ starting keeper on :8787"
(cd keeper && npm start) &
pids+=($!)

echo "▸ starting web on :3000"
(cd web && npm run dev) &
pids+=($!)

echo
echo "  FLOPS is starting → http://localhost:3000  (use the 'Dev wallet' button)"
echo "  Ctrl-C to stop everything."
wait
