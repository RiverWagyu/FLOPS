// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TUSD} from "../src/TUSD.sol";
import {FlopsVault} from "../src/FlopsVault.sol";
import {FlopsPerps} from "../src/FlopsPerps.sol";
import {IFlopsVault} from "../src/interfaces/IFlops.sol";

/// @notice Deploys tUSD, the FLP vault and the perps engine, lists the four GPU markets and
///         seeds the pool. Writes addresses to deployments/<chainId>.json.
///
///   forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast
///
/// Env: DEPLOYER_PRIVATE_KEY, KEEPER_ADDRESS, POOL_SEED (whole tUSD, default 1,000,000)
contract Deploy is Script {
    uint256 constant DEPTH = 100_000_000e18;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address keeper = vm.envAddress("KEEPER_ADDRESS");
        uint256 seed = vm.envOr("POOL_SEED", uint256(1_000_000)) * 1e18;

        vm.startBroadcast(pk);
        TUSD token = new TUSD(deployer);
        FlopsVault vault = new FlopsVault(IERC20(address(token)), deployer);
        FlopsPerps perps = new FlopsPerps(IERC20(address(token)), IFlopsVault(address(vault)), keeper, deployer);
        vault.setPerps(address(perps));

        perps.addMarket("H100", 2.5e18, DEPTH);
        perps.addMarket("A100", 1.2e18, DEPTH);
        perps.addMarket("RTX4090", 0.4e18, DEPTH);
        perps.addMarket("L40S", 0.9e18, DEPTH);

        token.mint(deployer, seed);
        token.approve(address(vault), seed);
        vault.deposit(seed, deployer);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeUint(key, "startBlock", block.number);
        vm.serializeAddress(key, "tusd", address(token));
        vm.serializeAddress(key, "vault", address(vault));
        vm.serializeAddress(key, "keeper", keeper);
        string memory json = vm.serializeAddress(key, "perps", address(perps));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));

        console.log("tUSD  ", address(token));
        console.log("Vault ", address(vault));
        console.log("Perps ", address(perps));
    }
}
