// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFlopsVault {
    function totalAssets() external view returns (uint256);
    function payout(address to, uint256 amount) external;
}

interface IFlopsPerps {
    /// @notice tUSD held by the vault that belongs to traders (margins, escrowed orders, fee deposits).
    function totalLocked() external view returns (uint256);
    /// @notice Aggregate unrealized trader P&L (price P&L minus funding owed). Positive = traders winning.
    function netTraderPnl() external view returns (int256);
    /// @notice Minimum pool assets needed so that open interest stays within the caps.
    function minPoolAssets() external view returns (uint256);
}
