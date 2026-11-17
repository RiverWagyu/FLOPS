// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title tUSD — FLOPS test dollar
/// @notice Valueless testnet token. Anyone can claim FAUCET_AMOUNT as often as they like.
contract TUSD is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 10_000e18;

    event FaucetClaimed(address indexed to, uint256 amount);

    constructor(address owner_) ERC20("FLOPS Test USD", "tUSD") Ownable(owner_) {}

    /// @notice Claim 10,000 tUSD. Unlimited — this token has no value.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }

    /// @notice Owner mint, used to seed the liquidity pool at deployment.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
