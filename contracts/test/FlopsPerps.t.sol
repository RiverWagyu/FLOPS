// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TUSD} from "../src/TUSD.sol";
import {FlopsVault} from "../src/FlopsVault.sol";
import {FlopsPerps} from "../src/FlopsPerps.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFlopsVault} from "../src/interfaces/IFlops.sol";

contract FlopsPerpsTest is Test {
    TUSD token;
    FlopsVault vault;
    FlopsPerps perps;

    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address lp = makeAddr("lp");
    address liquidator = makeAddr("liquidator");

    uint256 constant H100 = 0;
    uint256 constant A100 = 1;
    uint256 constant DEPTH = 100_000_000e18;
    uint256 constant POOL = 1_000_000e18;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.startPrank(owner);
        token = new TUSD(owner);
        vault = new FlopsVault(IERC20(address(token)), owner);
        perps = new FlopsPerps(IERC20(address(token)), IFlopsVault(address(vault)), keeper, owner);
        vault.setPerps(address(perps));
        perps.addMarket("H100", 2.5e18, DEPTH);
        perps.addMarket("A100", 1.2e18, DEPTH);
        token.mint(lp, POOL);
        vm.stopPrank();

        vm.startPrank(lp);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(POOL, lp);
        vm.stopPrank();

        address[2] memory traders = [alice, bob];
        for (uint256 i; i < traders.length; ++i) {
            vm.prank(owner);
            token.mint(traders[i], 100_000e18);
            vm.prank(traders[i]);
            token.approve(address(perps), type(uint256).max);
        }
    }

    // ───────────── helpers ─────────────

    function _setPrice(uint256 marketId, uint256 price) internal {
        uint256[] memory prices = new uint256[](perps.marketCount());
        prices[marketId] = price;
        vm.prank(keeper);
        perps.setPrices(prices);
    }

    function _refresh() internal {
        _setPrice(H100, perps.getMarket(H100).price);
    }

    function _open(address who, bool isLong, uint256 collateral, uint256 size) internal returns (uint256 id) {
        vm.prank(who);
        id = perps.openPosition(H100, isLong, collateral, size, 0, 0);
    }

    function _assertSettledClean() internal view {
        assertEq(perps.totalLocked(), 0, "locked after all closed");
        assertEq(vault.totalAssets(), token.balanceOf(address(vault)), "LP owns whole vault");
        assertEq(perps.netTraderPnl(), 0, "no open pnl");
    }

    // ───────────── faucet ─────────────

    function test_faucetIsUnlimited() public {
        address u = makeAddr("u");
        vm.startPrank(u);
        token.faucet();
        token.faucet();
        vm.stopPrank();
        assertEq(token.balanceOf(u), 20_000e18);
    }

    // ───────────── open / close ─────────────

    function test_longProfit() public {
        uint256 before = token.balanceOf(alice);
        uint256 id = _open(alice, true, 1_000e18, 10_000e18);

        FlopsPerps.Position memory p = perps.getPosition(id);
        assertEq(p.margin, 990e18, "0.1% open fee");
        // impact = 10k / 100M = 0.01%
        assertEq(p.entryPrice, 2.5e18 * (1e18 + 1e14) / 1e18);

        _setPrice(H100, 2.75e18); // +10%
        vm.prank(alice);
        perps.closePosition(id);

        int256 delta = int256(token.balanceOf(alice)) - int256(before);
        // ~ +1000 price pnl − 10 open fee − ~11 close fee − ~2 impact
        assertGt(delta, 970e18);
        assertLt(delta, 980e18);
        _assertSettledClean();
        assertEq(token.balanceOf(address(vault)), uint256(int256(POOL) - delta), "pool paid the winner");
    }

    function test_shortLoss() public {
        uint256 before = token.balanceOf(bob);
        uint256 id = _open(bob, false, 1_000e18, 5_000e18);
        _setPrice(H100, 2.6e18); // +4% against the short
        vm.prank(bob);
        perps.closePosition(id);
        int256 delta = int256(token.balanceOf(bob)) - int256(before);
        // −200 price pnl − ~10 fees
        assertLt(delta, -205e18);
        assertGt(delta, -215e18);
        _assertSettledClean();
    }

    function test_onlyOwnerCanClose() public {
        uint256 id = _open(alice, true, 1_000e18, 2_000e18);
        vm.prank(bob);
        vm.expectRevert(FlopsPerps.NotOwner.selector);
        perps.closePosition(id);
    }

    function test_manyPositionsPerWallet() public {
        _open(alice, true, 100e18, 1_000e18);
        _open(alice, true, 100e18, 2_000e18);
        _open(alice, false, 100e18, 500e18);
        (uint256[] memory ids,) = perps.getUserPositions(alice);
        assertEq(ids.length, 3);
    }

    // ───────────── leverage & caps ─────────────

    function test_leverageLimits() public {
        vm.startPrank(alice);
        vm.expectRevert(FlopsPerps.LeverageTooHigh.selector);
        perps.openPosition(H100, true, 100e18, 2_600e18, 0, 0);
        vm.expectRevert(FlopsPerps.LeverageTooLow.selector);
        perps.openPosition(H100, true, 1_000e18, 500e18, 0, 0);
        vm.expectRevert(FlopsPerps.CollateralTooLow.selector);
        perps.openPosition(H100, true, 5e18, 50e18, 0, 0);
        // exactly 25x after fee is fine: size = 25 * (c − size*0.001)
        perps.openPosition(H100, true, 205e18, 5_000e18, 0, 0);
        vm.stopPrank();
    }

    function test_maxPositionSize() public {
        vm.prank(alice);
        vm.expectRevert(FlopsPerps.PositionTooLarge.selector);
        perps.openPosition(H100, true, 2_100e18, 51_000e18, 0, 0); // > 5% of 1M, under 25x
    }

    function test_openInterestCap() public {
        vm.prank(owner);
        token.mint(alice, 1_000_000e18);
        // 30% of 1M = 300k per side. Six 50k longs fill it.
        for (uint256 i; i < 6; ++i) {
            _open(alice, true, 5_000e18, 49_000e18);
        }
        vm.prank(alice);
        vm.expectRevert(FlopsPerps.OpenInterestCap.selector);
        perps.openPosition(H100, true, 5_000e18, 49_000e18, 0, 0);
        // shorts have their own cap
        _open(alice, false, 5_000e18, 49_000e18);
    }

    // ───────────── liquidation ─────────────

    function test_liquidation() public {
        uint256 before = token.balanceOf(alice);
        uint256 id = _open(alice, true, 205e18, 5_000e18); // 25x
        FlopsPerps.PositionStatus memory st = perps.positionStatus(id);
        assertFalse(st.liquidatable);
        assertGt(st.liquidationPrice, 2.4e18);
        assertLt(st.liquidationPrice, 2.5e18);

        vm.prank(liquidator);
        vm.expectRevert(FlopsPerps.NotLiquidatable.selector);
        perps.liquidate(id);

        _setPrice(H100, st.liquidationPrice + 1e15);
        assertFalse(perps.positionStatus(id).liquidatable, "just above liq price");
        _setPrice(H100, st.liquidationPrice - 1e15);
        assertTrue(perps.positionStatus(id).liquidatable, "just below liq price");

        vm.prank(liquidator);
        perps.liquidate(id);
        assertEq(token.balanceOf(alice), before - 205e18, "trader loses collateral");
        assertGt(token.balanceOf(liquidator), 0, "liquidator rewarded");
        assertLe(token.balanceOf(liquidator), 25e18, "reward <= 0.5% of size");
        _assertSettledClean();
    }

    // ───────────── TP / SL ─────────────

    function test_takeProfit() public {
        vm.prank(alice);
        uint256 id = perps.openPosition(H100, true, 1_000e18, 5_000e18, 2.7e18, 2.3e18);
        assertEq(perps.getPosition(id).execFeeDeposit, 1e18);

        vm.prank(keeper);
        vm.expectRevert(FlopsPerps.NotTriggered.selector);
        perps.executeTpSl(id);

        _setPrice(H100, 2.71e18);
        uint256 before = token.balanceOf(alice);
        vm.prank(keeper);
        perps.executeTpSl(id);
        assertGt(token.balanceOf(alice), before + 1_300e18, "profit paid");
        assertEq(token.balanceOf(keeper), 1e18, "keeper earns execution fee");
        _assertSettledClean();
    }

    function test_stopLossShort() public {
        vm.prank(bob);
        uint256 id = perps.openPosition(H100, false, 1_000e18, 5_000e18, 0, 2.6e18);
        _setPrice(H100, 2.61e18);
        vm.prank(keeper);
        perps.executeTpSl(id);
        _assertSettledClean();
    }

    function test_invalidTpSl() public {
        vm.prank(alice);
        vm.expectRevert(FlopsPerps.InvalidTpSl.selector);
        perps.openPosition(H100, true, 1_000e18, 5_000e18, 2.4e18, 0); // TP below price for a long
    }

    function test_setTpSlEscrowsAndRefunds() public {
        uint256 id = _open(alice, true, 1_000e18, 5_000e18);
        uint256 b0 = token.balanceOf(alice);
        vm.prank(alice);
        perps.setTpSl(id, 3e18, 0);
        assertEq(token.balanceOf(alice), b0 - 1e18);
        vm.prank(alice);
        perps.setTpSl(id, 0, 0);
        assertEq(token.balanceOf(alice), b0, "fee refunded when cleared");
    }

    // ───────────── limit orders ─────────────

    function test_limitOrderLong() public {
        vm.prank(alice);
        uint256 oid = perps.placeOrder(H100, true, 500e18, 5_000e18, 2.4e18, 0, 0);
        assertEq(perps.totalLocked(), 501e18);

        vm.prank(keeper);
        vm.expectRevert(FlopsPerps.NotTriggered.selector);
        perps.executeOrder(oid);

        _setPrice(H100, 2.39e18);
        vm.prank(keeper);
        uint256 pid = perps.executeOrder(oid);
        assertEq(token.balanceOf(keeper), 1e18);
        FlopsPerps.Position memory p = perps.getPosition(pid);
        assertEq(p.owner, alice);
        assertTrue(p.isLong);
        (uint256[] memory orderIds,) = perps.getUserOrders(alice);
        assertEq(orderIds.length, 0);
    }

    function test_limitOrderDropsGappedTpSl() public {
        vm.prank(bob);
        // short at >= 2.6 with TP 2.55. If price gaps to 2.5... that wouldn't trigger; gap up instead:
        uint256 oid = perps.placeOrder(H100, false, 500e18, 5_000e18, 2.6e18, 2.55e18, 2.9e18);
        _setPrice(H100, 3.0e18); // above SL already
        uint256 b0 = token.balanceOf(bob);
        vm.prank(keeper);
        uint256 pid = perps.executeOrder(oid);
        FlopsPerps.Position memory p = perps.getPosition(pid);
        assertEq(p.tp, 0);
        assertEq(p.sl, 0);
        assertEq(token.balanceOf(bob), b0 + 1e18, "tp/sl fee refunded");
    }

    function test_cancelOrderRefunds() public {
        uint256 b0 = token.balanceOf(alice);
        vm.prank(alice);
        uint256 oid = perps.placeOrder(H100, true, 500e18, 5_000e18, 2.4e18, 2.8e18, 0);
        assertEq(token.balanceOf(alice), b0 - 502e18);
        vm.prank(alice);
        perps.cancelOrder(oid);
        assertEq(token.balanceOf(alice), b0);
        _assertSettledClean();
    }

    // ───────────── funding ─────────────

    function test_fundingFlowsFromBiggerSide() public {
        uint256 l = _open(alice, true, 1_000e18, 10_000e18);
        uint256 s = _open(bob, false, 1_000e18, 5_000e18);
        vm.warp(block.timestamp + 1 hours);
        _refresh();

        // skew = 5k/15k = 1/3 → longs pay 0.05%/3 per hour on 10k ≈ 1.667 tUSD
        int256 longPays = perps.positionStatus(l).funding;
        int256 shortPays = perps.positionStatus(s).funding;
        assertApproxEqAbs(longPays, 1.6667e18, 1e15);
        assertApproxEqAbs(shortPays, -1.6667e18, 1e15, "short receives the same amount");

        vm.prank(alice);
        perps.closePosition(l);
        vm.prank(bob);
        perps.closePosition(s);
        _assertSettledClean();
    }

    function test_noFundingWhenOneSided() public {
        uint256 l = _open(alice, true, 1_000e18, 10_000e18);
        vm.warp(block.timestamp + 1 hours);
        _refresh();
        assertEq(perps.positionStatus(l).funding, 0);
    }

    // ───────────── oracle & admin ─────────────

    function test_onlyKeeperPostsPrices() public {
        uint256[] memory prices = new uint256[](2);
        vm.expectRevert(FlopsPerps.OnlyKeeper.selector);
        perps.setPrices(prices);
        vm.prank(keeper);
        vm.expectRevert(FlopsPerps.BadLength.selector);
        perps.setPrices(new uint256[](1));
    }

    function test_stalePriceBlocksTrading() public {
        vm.warp(block.timestamp + 31);
        vm.prank(alice);
        vm.expectRevert(FlopsPerps.StalePrice.selector);
        perps.openPosition(H100, true, 1_000e18, 5_000e18, 0, 0);
    }

    function test_pauseBlocksOpenNotClose() public {
        uint256 id = _open(alice, true, 1_000e18, 5_000e18);
        vm.prank(owner);
        perps.pause();
        vm.prank(alice);
        vm.expectRevert();
        perps.openPosition(H100, true, 1_000e18, 5_000e18, 0, 0);
        vm.prank(alice);
        perps.closePosition(id);
    }

    function test_riskParamGuards() public {
        vm.startPrank(owner);
        vm.expectRevert(FlopsPerps.BadParam.selector);
        perps.setRiskParams(50, 200, 50, 3000, 500, 10e18); // maint 2% == initial margin at 50x
        perps.setRiskParams(20, 100, 50, 3000, 500, 10e18);
        vm.stopPrank();
        assertEq(perps.maxLeverage(), 20);
    }

    // ───────────── LP ─────────────

    function test_lpEarnsFromLosers() public {
        uint256 id = _open(bob, false, 1_000e18, 5_000e18);
        _setPrice(H100, 2.6e18);
        vm.prank(bob);
        perps.closePosition(id);
        assertGt(vault.totalAssets(), POOL + 200e18);
        assertGt(vault.previewRedeem(vault.balanceOf(lp)), POOL + 200e18);
    }

    function test_lpWithdrawLimitedByOpenInterest() public {
        vm.prank(owner);
        token.mint(alice, 1_000_000e18);
        for (uint256 i; i < 6; ++i) {
            _open(alice, true, 5_000e18, 49_000e18); // 294k long OI → needs 980k pool
        }
        uint256 free = vault.maxWithdraw(lp);
        assertLt(free, 30_000e18);
        vm.prank(lp);
        vm.expectRevert();
        vault.withdraw(free + 1_000e18, lp, lp);
        vm.prank(lp);
        vault.withdraw(free, lp, lp);
    }

    function test_vaultPayoutOnlyPerps() public {
        vm.expectRevert(FlopsVault.OnlyPerps.selector);
        vault.payout(alice, 1);
    }

    // ───────────── fuzz: accounting is conserved ─────────────

    function testFuzz_conservation(uint256 longSize, uint256 shortSize, uint256 newPrice, uint256 dt) public {
        longSize = bound(longSize, 100e18, 49_000e18);
        shortSize = bound(shortSize, 100e18, 49_000e18);
        newPrice = bound(newPrice, 1.75e18, 3.25e18); // ±30%
        dt = bound(dt, 0, 3 days);

        uint256 supply = token.totalSupply();
        uint256 l = _open(alice, true, longSize / 5, longSize);
        uint256 s = _open(bob, false, shortSize / 5, shortSize);
        assertEq(token.balanceOf(address(vault)), POOL + longSize / 5 + shortSize / 5);

        vm.warp(block.timestamp + dt);
        _setPrice(H100, newPrice);

        uint256[2] memory ids = [l, s];
        address[2] memory who = [alice, bob];
        for (uint256 i; i < 2; ++i) {
            if (perps.positionStatus(ids[i]).liquidatable) {
                vm.prank(liquidator);
                perps.liquidate(ids[i]);
            } else {
                vm.prank(who[i]);
                perps.closePosition(ids[i]);
            }
        }
        _assertSettledClean();
        assertEq(token.totalSupply(), supply, "no tUSD created or destroyed");
        assertEq(
            token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(liquidator)
                + token.balanceOf(address(vault)),
            200_000e18 + POOL,
            "every tUSD accounted for"
        );
    }
}
