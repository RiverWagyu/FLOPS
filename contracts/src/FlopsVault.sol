// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IFlopsPerps} from "./interfaces/IFlops.sol";

/// @title FlopsVault — the house liquidity pool (FLP)
/// @notice Holds every tUSD in the protocol. LPs own whatever is not owed to traders:
///         balance − trader collateral − unrealized trader P&L. LPs earn fees and trader
///         losses, and pay out trader profits.
contract FlopsVault is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    IFlopsPerps public perps;

    error PerpsAlreadySet();
    error OnlyPerps();

    constructor(IERC20 asset_, address owner_)
        ERC20("FLOPS Liquidity", "FLP")
        ERC4626(asset_)
        Ownable(owner_)
    {}

    /// @notice One-time wiring to the perps engine.
    function setPerps(address perps_) external onlyOwner {
        if (address(perps) != address(0)) revert PerpsAlreadySet();
        perps = IFlopsPerps(perps_);
    }

    /// @notice Pool value that belongs to LPs.
    function totalAssets() public view override returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        if (address(perps) == address(0)) return bal;
        int256 lp = int256(bal) - int256(perps.totalLocked()) - perps.netTraderPnl();
        return lp > 0 ? uint256(lp) : 0;
    }

    /// @notice LPs can only withdraw what is not needed to back open interest.
    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 own = super.maxWithdraw(owner);
        uint256 free = freeAssets();
        return own < free ? own : free;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 own = balanceOf(owner);
        uint256 freeShares = _convertToShares(freeAssets(), Math.Rounding.Floor);
        return own < freeShares ? own : freeShares;
    }

    /// @notice Assets above the minimum required by the open-interest caps.
    function freeAssets() public view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 minAssets = address(perps) == address(0) ? 0 : perps.minPoolAssets();
        return assets > minAssets ? assets - minAssets : 0;
    }

    /// @notice Pay tUSD out of the pool. Only the perps engine can call this.
    function payout(address to, uint256 amount) external {
        if (msg.sender != address(perps)) revert OnlyPerps();
        if (amount > 0) IERC20(asset()).safeTransfer(to, amount);
    }

    /// @dev Virtual shares make the first-depositor inflation attack uneconomic.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

}
