// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IFlopsPerps, IFlopsVault} from "./interfaces/IFlops.sol";

/// @title FlopsPerps — GPU-hour perpetual futures against a house pool
/// @notice Traders go long or short the simulated hourly rental price of a GPU, with 1–50x
///         isolated leverage. Every position is its own isolated position. The counterparty is
///         the FlopsVault LP pool. Prices are posted by a keeper (simulated oracle).
/// @dev    All amounts are 18-decimal fixed point (WAD). `size` is entry notional in tUSD and
///         `units` is GPU-hours (size / entryPrice), so P&L is linear in the index price.
///         Testnet demo — not audited.
contract FlopsPerps is IFlopsPerps, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_IMPACT = 1e16; // fill impact is capped at 1%

    enum CloseReason {
        User,
        TakeProfit,
        StopLoss,
        Liquidation
    }

    struct Market {
        string symbol;
        uint256 price; // index price, tUSD per GPU-hour
        uint256 impactDepth; // impact = size / impactDepth (capped at MAX_IMPACT)
        int256 cumFundingLong; // cumulative funding paid per 1 tUSD of long notional
        int256 cumFundingShort; // cumulative funding paid per 1 tUSD of short notional
        uint64 priceUpdatedAt;
        uint64 lastFundingAt;
        bool active;
    }

    struct Side {
        uint256 size; // sum of entry notional
        uint256 units; // sum of GPU-hours
        int256 fundingWeighted; // sum of size * entryFunding / WAD
    }

    struct Position {
        address owner;
        uint32 marketId;
        bool isLong;
        uint64 openedAt;
        uint256 size;
        uint256 units;
        uint256 collateral; // what the trader deposited (incl. open fee)
        uint256 margin; // collateral − open fee
        uint256 entryPrice;
        int256 entryFunding;
        uint256 tp;
        uint256 sl;
        uint256 execFeeDeposit; // pays whoever triggers TP/SL
    }

    struct Order {
        address owner;
        uint32 marketId;
        bool isLong;
        uint256 collateral;
        uint256 size;
        uint256 triggerPrice;
        uint256 tp;
        uint256 sl;
        uint256 execFee; // pays whoever executes the order
        uint256 tpslFee; // becomes the position's execFeeDeposit
    }

    struct MarketView {
        uint256 id;
        string symbol;
        uint256 price;
        uint256 priceUpdatedAt;
        bool active;
        uint256 impactDepth;
        uint256 longSize;
        uint256 shortSize;
        int256 fundingRatePerHour; // >0: longs pay shorts, <0: shorts pay longs (per 1 tUSD notional)
        uint256 maxPositionSize;
        uint256 longCapacity; // remaining size before the long OI cap
        uint256 shortCapacity;
    }

    struct PositionStatus {
        int256 pnl; // at index price
        int256 funding; // owed (>0) or earned (<0)
        uint256 closeFee;
        int256 equity;
        uint256 liquidationPrice;
        bool liquidatable;
    }

    IERC20 public immutable asset;
    IFlopsVault public immutable vault;
    address public keeper;

    uint256 public openFeeBps = 10; // 0.1%
    uint256 public closeFeeBps = 10; // 0.1%
    uint256 public executionFee = 1e18; // 1 tUSD per limit order / TP-SL
    uint256 public maxLeverage = 50;
    uint256 public maintenanceBps = 100; // liquidate below 1% of size
    uint256 public liquidationRewardBps = 50; // liquidator gets up to 0.5% of size
    uint256 public oiCapBps = 3_000; // each side of each market ≤ 30% of pool
    uint256 public maxPositionBps = 500; // one position ≤ 5% of pool
    uint256 public minCollateral = 10e18;
    uint256 public maxFundingRatePerHour = 5e14; // 0.05%/h at 100% skew
    uint256 public maxPriceAge = 30; // seconds

    Market[] internal _markets;
    mapping(uint256 => Side) public longs;
    mapping(uint256 => Side) public shorts;

    mapping(uint256 => Position) internal _positions;
    mapping(uint256 => Order) internal _orders;
    mapping(address => EnumerableSet.UintSet) internal _userPositions;
    mapping(address => EnumerableSet.UintSet) internal _userOrders;
    EnumerableSet.UintSet internal _openPositions;
    EnumerableSet.UintSet internal _openOrders;

    uint256 public nextPositionId = 1;
    uint256 public nextOrderId = 1;
    uint256 public override totalLocked;

    event MarketAdded(uint256 indexed marketId, string symbol, uint256 price, uint256 impactDepth);
    event MarketUpdated(uint256 indexed marketId, bool active, uint256 impactDepth);
    event PricesUpdated(uint256[] prices, uint256 timestamp);
    event PositionOpened(
        uint256 indexed id,
        address indexed owner,
        uint256 indexed marketId,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 margin,
        uint256 entryPrice,
        uint256 openFee,
        uint256 orderId
    );
    event PositionClosed(
        uint256 indexed id,
        address indexed owner,
        uint256 indexed marketId,
        bool isLong,
        uint256 size,
        uint256 collateral,
        uint256 exitPrice,
        int256 pnl,
        int256 funding,
        uint256 closeFee,
        uint256 payout,
        CloseReason reason,
        address executor
    );
    event TpSlUpdated(uint256 indexed id, uint256 tp, uint256 sl);
    event OrderPlaced(
        uint256 indexed id,
        address indexed owner,
        uint256 indexed marketId,
        bool isLong,
        uint256 collateral,
        uint256 size,
        uint256 triggerPrice,
        uint256 tp,
        uint256 sl
    );
    event OrderCancelled(uint256 indexed id, address indexed owner);
    event OrderExecuted(uint256 indexed id, uint256 indexed positionId, address executor);
    event KeeperUpdated(address keeper);
    event ParamsUpdated();

    error OnlyKeeper();
    error BadMarket();
    error StalePrice();
    error BadLength();
    error NotOwner();
    error NoPosition();
    error NoOrder();
    error CollateralTooLow();
    error LeverageTooHigh();
    error LeverageTooLow();
    error PositionTooLarge();
    error OpenInterestCap();
    error InvalidTpSl();
    error NotTriggered();
    error NotLiquidatable();
    error Liquidatable();
    error BadParam();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert OnlyKeeper();
        _;
    }

    constructor(IERC20 asset_, IFlopsVault vault_, address keeper_, address owner_) Ownable(owner_) {
        asset = asset_;
        vault = vault_;
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    // ───────────────────────────── admin ─────────────────────────────

    function addMarket(string calldata symbol, uint256 price, uint256 impactDepth) external onlyOwner {
        if (price == 0 || impactDepth == 0) revert BadParam();
        _markets.push(
            Market({
                symbol: symbol,
                price: price,
                impactDepth: impactDepth,
                cumFundingLong: 0,
                cumFundingShort: 0,
                priceUpdatedAt: uint64(block.timestamp),
                lastFundingAt: uint64(block.timestamp),
                active: true
            })
        );
        emit MarketAdded(_markets.length - 1, symbol, price, impactDepth);
    }

    function setMarket(uint256 marketId, bool active, uint256 impactDepth) external onlyOwner {
        if (marketId >= _markets.length || impactDepth == 0) revert BadParam();
        Market storage mk = _markets[marketId];
        mk.active = active;
        mk.impactDepth = impactDepth;
        emit MarketUpdated(marketId, active, impactDepth);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperUpdated(keeper_);
    }

    function setFees(uint256 openBps, uint256 closeBps, uint256 execFee) external onlyOwner {
        if (openBps > 100 || closeBps > 100 || execFee > 10e18) revert BadParam();
        openFeeBps = openBps;
        closeFeeBps = closeBps;
        executionFee = execFee;
        emit ParamsUpdated();
    }

    function setRiskParams(
        uint256 maxLev,
        uint256 maintBps,
        uint256 liqRewardBps,
        uint256 oiCap,
        uint256 maxPos,
        uint256 minColl
    ) external onlyOwner {
        if (maxLev == 0 || maxLev > 100) revert BadParam();
        // maintenance margin must sit below initial margin at max leverage
        if (maintBps == 0 || maintBps * maxLev >= BPS) revert BadParam();
        if (liqRewardBps > maintBps || oiCap > BPS || maxPos > oiCap || oiCap == 0) revert BadParam();
        maxLeverage = maxLev;
        maintenanceBps = maintBps;
        liquidationRewardBps = liqRewardBps;
        oiCapBps = oiCap;
        maxPositionBps = maxPos;
        minCollateral = minColl;
        emit ParamsUpdated();
    }

    function setFunding(uint256 ratePerHour) external onlyOwner {
        if (ratePerHour > 1e16) revert BadParam();
        for (uint256 i; i < _markets.length; ++i) {
            _updateFunding(i);
        }
        maxFundingRatePerHour = ratePerHour;
        emit ParamsUpdated();
    }

    function setMaxPriceAge(uint256 age) external onlyOwner {
        if (age < 5 || age > 1 hours) revert BadParam();
        maxPriceAge = age;
        emit ParamsUpdated();
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ───────────────────────────── oracle ─────────────────────────────

    /// @notice Keeper posts the simulated index price of every market. 0 = leave unchanged.
    function setPrices(uint256[] calldata prices) external onlyKeeper {
        if (prices.length != _markets.length) revert BadLength();
        for (uint256 i; i < prices.length; ++i) {
            if (prices[i] == 0) continue;
            Market storage mk = _markets[i];
            mk.price = prices[i];
            mk.priceUpdatedAt = uint64(block.timestamp);
        }
        emit PricesUpdated(prices, block.timestamp);
    }

    // ───────────────────────────── trading ─────────────────────────────

    /// @notice Open a position at the current price.
    /// @param collateral tUSD to deposit; the open fee is taken from it.
    /// @param size       notional in tUSD. Leverage = size / (collateral − fee).
    /// @param tp,sl      optional take-profit / stop-loss index prices (0 = none).
    function openPosition(uint256 marketId, bool isLong, uint256 collateral, uint256 size, uint256 tp, uint256 sl)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        uint256 tpslFee = (tp != 0 || sl != 0) ? executionFee : 0;
        _pull(msg.sender, collateral + tpslFee);
        id = _open(msg.sender, marketId, isLong, collateral, size, tp, sl, tpslFee, 0);
    }

    function closePosition(uint256 id) external nonReentrant {
        if (_positions[id].owner != msg.sender) revert NotOwner();
        _close(id, CloseReason.User, msg.sender);
    }

    /// @notice Update take-profit / stop-loss. Setting either for the first time escrows the execution fee.
    function setTpSl(uint256 id, uint256 tp, uint256 sl) external nonReentrant {
        Position storage p = _positions[id];
        if (p.owner != msg.sender) revert NotOwner();
        Market storage mk = _markets[p.marketId];
        if (!_tpSlValid(p.isLong, mk.price, tp, sl)) revert InvalidTpSl();
        bool wants = tp != 0 || sl != 0;
        if (wants && p.execFeeDeposit == 0) {
            _pull(msg.sender, executionFee);
            p.execFeeDeposit = executionFee;
        } else if (!wants && p.execFeeDeposit > 0) {
            uint256 refund = p.execFeeDeposit;
            p.execFeeDeposit = 0;
            totalLocked -= refund;
            vault.payout(msg.sender, refund);
        }
        p.tp = tp;
        p.sl = sl;
        emit TpSlUpdated(id, tp, sl);
    }

    /// @notice Place a limit order: long fills when price ≤ trigger, short when price ≥ trigger.
    function placeOrder(
        uint256 marketId,
        bool isLong,
        uint256 collateral,
        uint256 size,
        uint256 triggerPrice,
        uint256 tp,
        uint256 sl
    ) external nonReentrant whenNotPaused returns (uint256 id) {
        _activeMarket(marketId);
        if (triggerPrice == 0) revert BadParam();
        _checkLeverage(collateral, size);
        if (!_tpSlValid(isLong, triggerPrice, tp, sl)) revert InvalidTpSl();

        uint256 tpslFee = (tp != 0 || sl != 0) ? executionFee : 0;
        _pull(msg.sender, collateral + executionFee + tpslFee);

        id = nextOrderId++;
        _orders[id] = Order({
            owner: msg.sender,
            marketId: uint32(marketId),
            isLong: isLong,
            collateral: collateral,
            size: size,
            triggerPrice: triggerPrice,
            tp: tp,
            sl: sl,
            execFee: executionFee,
            tpslFee: tpslFee
        });
        _userOrders[msg.sender].add(id);
        _openOrders.add(id);
        emit OrderPlaced(id, msg.sender, marketId, isLong, collateral, size, triggerPrice, tp, sl);
    }

    function cancelOrder(uint256 id) external nonReentrant {
        Order memory o = _orders[id];
        if (o.owner != msg.sender) revert NotOwner();
        _removeOrder(id, o.owner);
        uint256 refund = o.collateral + o.execFee + o.tpslFee;
        totalLocked -= refund;
        vault.payout(o.owner, refund);
        emit OrderCancelled(id, o.owner);
    }

    // ───────────────────────────── keepers (anyone) ─────────────────────────────

    function executeOrder(uint256 id) external nonReentrant whenNotPaused returns (uint256 positionId) {
        Order memory o = _orders[id];
        if (o.owner == address(0)) revert NoOrder();
        Market storage mk = _activeMarket(o.marketId);
        _requireFresh(mk);
        uint256 price = mk.price;
        bool triggered = o.isLong ? price <= o.triggerPrice : price >= o.triggerPrice;
        if (!triggered) revert NotTriggered();

        _removeOrder(id, o.owner);
        totalLocked -= o.execFee;
        vault.payout(msg.sender, o.execFee);

        uint256 tp = o.tp;
        uint256 sl = o.sl;
        uint256 tpslFee = o.tpslFee;
        // If the price gapped past the order's TP/SL, drop them rather than fail the fill.
        if ((tp != 0 || sl != 0) && !_tpSlValid(o.isLong, price, tp, sl)) {
            tp = 0;
            sl = 0;
            totalLocked -= tpslFee;
            vault.payout(o.owner, tpslFee);
            tpslFee = 0;
        }
        positionId = _open(o.owner, o.marketId, o.isLong, o.collateral, o.size, tp, sl, tpslFee, id);
        emit OrderExecuted(id, positionId, msg.sender);
    }

    function executeTpSl(uint256 id) external nonReentrant {
        Position storage p = _positions[id];
        if (p.owner == address(0)) revert NoPosition();
        Market storage mk = _markets[p.marketId];
        uint256 price = mk.price;
        CloseReason reason;
        if (p.isLong) {
            if (p.tp != 0 && price >= p.tp) reason = CloseReason.TakeProfit;
            else if (p.sl != 0 && price <= p.sl) reason = CloseReason.StopLoss;
            else revert NotTriggered();
        } else {
            if (p.tp != 0 && price <= p.tp) reason = CloseReason.TakeProfit;
            else if (p.sl != 0 && price >= p.sl) reason = CloseReason.StopLoss;
            else revert NotTriggered();
        }
        (int256 cl, int256 cs) = _pendingFunding(p.marketId);
        if (_liquidatable(p, price, p.isLong ? cl : cs)) revert Liquidatable();
        _close(id, reason, msg.sender);
    }

    function liquidate(uint256 id) external nonReentrant {
        Position storage p = _positions[id];
        if (p.owner == address(0)) revert NoPosition();
        (int256 cl, int256 cs) = _pendingFunding(p.marketId);
        if (!_liquidatable(p, _markets[p.marketId].price, p.isLong ? cl : cs)) revert NotLiquidatable();
        _close(id, CloseReason.Liquidation, msg.sender);
    }

    // ───────────────────────────── internals ─────────────────────────────

    function _pull(address from, uint256 amount) internal {
        asset.safeTransferFrom(from, address(vault), amount);
        totalLocked += amount;
    }

    /// @dev Assumes `collateral + execDeposit` is already in the vault and counted in totalLocked.
    function _open(
        address owner,
        uint256 marketId,
        bool isLong,
        uint256 collateral,
        uint256 size,
        uint256 tp,
        uint256 sl,
        uint256 execDeposit,
        uint256 orderId
    ) internal returns (uint256 id) {
        Market storage mk = _activeMarket(marketId);
        _requireFresh(mk);
        uint256 openFee = _checkLeverage(collateral, size);
        if (!_tpSlValid(isLong, mk.price, tp, sl)) revert InvalidTpSl();

        _updateFunding(marketId);

        uint256 pool = vault.totalAssets();
        if (size > pool * maxPositionBps / BPS) revert PositionTooLarge();
        Side storage s = isLong ? longs[marketId] : shorts[marketId];
        if (s.size + size > pool * oiCapBps / BPS) revert OpenInterestCap();

        uint256 entry = _fillPrice(mk, size, isLong);
        uint256 units = size * WAD / entry;
        int256 idx = isLong ? mk.cumFundingLong : mk.cumFundingShort;

        id = nextPositionId++;
        _positions[id] = Position({
            owner: owner,
            marketId: uint32(marketId),
            isLong: isLong,
            openedAt: uint64(block.timestamp),
            size: size,
            units: units,
            collateral: collateral,
            margin: collateral - openFee,
            entryPrice: entry,
            entryFunding: idx,
            tp: tp,
            sl: sl,
            execFeeDeposit: execDeposit
        });
        s.size += size;
        s.units += units;
        s.fundingWeighted += _fw(size, idx);
        totalLocked -= openFee; // the fee now belongs to LPs
        _userPositions[owner].add(id);
        _openPositions.add(id);

        emit PositionOpened(id, owner, marketId, isLong, size, collateral, collateral - openFee, entry, openFee, orderId);
        if (tp != 0 || sl != 0) emit TpSlUpdated(id, tp, sl);
    }

    function _close(uint256 id, CloseReason reason, address executor) internal {
        Position memory p = _positions[id];
        if (p.owner == address(0)) revert NoPosition();
        Market storage mk = _markets[p.marketId];
        _requireFresh(mk);
        _updateFunding(p.marketId);

        bool liq = reason == CloseReason.Liquidation;
        uint256 exit = liq ? mk.price : _fillPrice(mk, p.size, !p.isLong);
        (int256 pnl, int256 funding, uint256 closeFee, int256 equity) =
            _settle(p, exit, p.isLong ? mk.cumFundingLong : mk.cumFundingShort);

        Side storage s = p.isLong ? longs[p.marketId] : shorts[p.marketId];
        s.size -= p.size;
        s.units -= p.units;
        s.fundingWeighted -= _fw(p.size, p.entryFunding);
        totalLocked -= p.margin + p.execFeeDeposit;
        _userPositions[p.owner].remove(id);
        _openPositions.remove(id);
        delete _positions[id];

        uint256 remaining = equity > 0 ? uint256(equity) : 0;
        uint256 toOwner;
        uint256 toExecutor;
        if (liq) {
            uint256 reward = p.size * liquidationRewardBps / BPS;
            toExecutor = (reward < remaining ? reward : remaining) + p.execFeeDeposit;
        } else if (reason == CloseReason.User) {
            toOwner = remaining + p.execFeeDeposit;
        } else {
            toOwner = remaining;
            toExecutor = p.execFeeDeposit;
        }
        vault.payout(p.owner, toOwner);
        vault.payout(executor, toExecutor);

        emit PositionClosed(
            id,
            p.owner,
            p.marketId,
            p.isLong,
            p.size,
            p.collateral,
            exit,
            pnl,
            funding,
            liq ? 0 : closeFee,
            liq ? 0 : toOwner,
            reason,
            executor
        );
    }

    function _settle(Position memory p, uint256 exit, int256 cumFunding)
        internal
        view
        returns (int256 pnl, int256 funding, uint256 closeFee, int256 equity)
    {
        uint256 value = p.units * exit / WAD;
        pnl = p.isLong ? int256(value) - int256(p.size) : int256(p.size) - int256(value);
        funding = int256(p.size) * (cumFunding - p.entryFunding) / int256(WAD);
        closeFee = value * closeFeeBps / BPS;
        equity = int256(p.margin) + pnl - funding - int256(closeFee);
    }

    function _liquidatable(Position memory p, uint256 price, int256 cumFunding) internal view returns (bool) {
        (,,, int256 equity) = _settle(p, price, cumFunding);
        return equity < int256(p.size * maintenanceBps / BPS);
    }

    /// @return openFee
    function _checkLeverage(uint256 collateral, uint256 size) internal view returns (uint256 openFee) {
        if (collateral < minCollateral) revert CollateralTooLow();
        openFee = size * openFeeBps / BPS;
        if (collateral <= openFee) revert CollateralTooLow();
        uint256 margin = collateral - openFee;
        if (size < margin) revert LeverageTooLow();
        if (size > margin * maxLeverage) revert LeverageTooHigh();
    }

    function _fillPrice(Market storage mk, uint256 size, bool buy) internal view returns (uint256) {
        uint256 impact = size * WAD / mk.impactDepth;
        if (impact > MAX_IMPACT) impact = MAX_IMPACT;
        return buy ? mk.price * (WAD + impact) / WAD : mk.price * (WAD - impact) / WAD;
    }

    function _tpSlValid(bool isLong, uint256 price, uint256 tp, uint256 sl) internal pure returns (bool) {
        if (isLong) return (tp == 0 || tp > price) && (sl == 0 || sl < price);
        return (tp == 0 || tp < price) && (sl == 0 || sl > price);
    }

    function _pendingFunding(uint256 marketId) internal view returns (int256 cl, int256 cs) {
        Market storage mk = _markets[marketId];
        cl = mk.cumFundingLong;
        cs = mk.cumFundingShort;
        uint256 dt = block.timestamp - mk.lastFundingAt;
        uint256 l = longs[marketId].size;
        uint256 s = shorts[marketId].size;
        if (dt == 0 || l == 0 || s == 0) return (cl, cs);
        int256 rate = _fundingRate(l, s);
        int256 delta = rate * int256(dt) / 3600;
        if (delta > 0) {
            cl += delta;
            cs -= delta * int256(l) / int256(s);
        } else if (delta < 0) {
            cs += -delta;
            cl -= (-delta) * int256(s) / int256(l);
        }
    }

    /// @dev Per-hour rate paid by longs (if >0) or shorts (if <0), proportional to skew.
    function _fundingRate(uint256 l, uint256 s) internal view returns (int256) {
        if (l + s == 0) return 0;
        int256 skew = (int256(l) - int256(s)) * int256(WAD) / int256(l + s);
        return skew * int256(maxFundingRatePerHour) / int256(WAD);
    }

    function _updateFunding(uint256 marketId) internal {
        (int256 cl, int256 cs) = _pendingFunding(marketId);
        Market storage mk = _markets[marketId];
        mk.cumFundingLong = cl;
        mk.cumFundingShort = cs;
        mk.lastFundingAt = uint64(block.timestamp);
    }

    function _fw(uint256 size, int256 idx) internal pure returns (int256) {
        return int256(size) * idx / int256(WAD);
    }

    function _activeMarket(uint256 marketId) internal view returns (Market storage mk) {
        if (marketId >= _markets.length) revert BadMarket();
        mk = _markets[marketId];
        if (!mk.active) revert BadMarket();
    }

    function _requireFresh(Market storage mk) internal view {
        if (block.timestamp - mk.priceUpdatedAt > maxPriceAge) revert StalePrice();
    }

    function _removeOrder(uint256 id, address owner) internal {
        _userOrders[owner].remove(id);
        _openOrders.remove(id);
        delete _orders[id];
    }

    // ───────────────────────────── views ─────────────────────────────

    function netTraderPnl() public view override returns (int256 total) {
        for (uint256 m; m < _markets.length; ++m) {
            uint256 price = _markets[m].price;
            (int256 cl, int256 cs) = _pendingFunding(m);
            Side storage l = longs[m];
            Side storage s = shorts[m];
            total += int256(l.units * price / WAD) - int256(l.size);
            total += int256(s.size) - int256(s.units * price / WAD);
            total -= _fw(l.size, cl) - l.fundingWeighted;
            total -= _fw(s.size, cs) - s.fundingWeighted;
        }
    }

    function minPoolAssets() public view override returns (uint256 minAssets) {
        for (uint256 m; m < _markets.length; ++m) {
            uint256 l = longs[m].size;
            uint256 s = shorts[m].size;
            uint256 need = (l > s ? l : s) * BPS / oiCapBps;
            if (need > minAssets) minAssets = need;
        }
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _markets[marketId];
    }

    function getMarkets() external view returns (MarketView[] memory views) {
        uint256 pool = vault.totalAssets();
        uint256 cap = pool * oiCapBps / BPS;
        views = new MarketView[](_markets.length);
        for (uint256 m; m < _markets.length; ++m) {
            Market storage mk = _markets[m];
            uint256 l = longs[m].size;
            uint256 s = shorts[m].size;
            views[m] = MarketView({
                id: m,
                symbol: mk.symbol,
                price: mk.price,
                priceUpdatedAt: mk.priceUpdatedAt,
                active: mk.active,
                impactDepth: mk.impactDepth,
                longSize: l,
                shortSize: s,
                fundingRatePerHour: (l == 0 || s == 0) ? int256(0) : _fundingRate(l, s),
                maxPositionSize: pool * maxPositionBps / BPS,
                longCapacity: cap > l ? cap - l : 0,
                shortCapacity: cap > s ? cap - s : 0
            });
        }
    }

    function getPosition(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }

    function getOrder(uint256 id) external view returns (Order memory) {
        return _orders[id];
    }

    function positionStatus(uint256 id) public view returns (PositionStatus memory st) {
        Position memory p = _positions[id];
        if (p.owner == address(0)) revert NoPosition();
        uint256 price = _markets[p.marketId].price;
        (int256 cl, int256 cs) = _pendingFunding(p.marketId);
        int256 cum = p.isLong ? cl : cs;
        (st.pnl, st.funding, st.closeFee, st.equity) = _settle(p, price, cum);
        st.liquidatable = st.equity < int256(p.size * maintenanceBps / BPS);
        st.liquidationPrice = _liquidationPrice(p, st.funding);
    }

    /// @notice Batch status for keepers. Closed/unknown ids return an empty status.
    function positionStatuses(uint256[] calldata ids) external view returns (PositionStatus[] memory out) {
        out = new PositionStatus[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            if (_positions[ids[i]].owner != address(0)) out[i] = positionStatus(ids[i]);
        }
    }

    /// @dev Index price at which equity (after close fee) hits the maintenance margin.
    function _liquidationPrice(Position memory p, int256 funding) internal view returns (uint256) {
        int256 maint = int256(p.size * maintenanceBps / BPS);
        int256 num;
        uint256 feeAdj;
        if (p.isLong) {
            num = maint + int256(p.size) + funding - int256(p.margin);
            feeAdj = BPS - closeFeeBps;
        } else {
            num = int256(p.margin) + int256(p.size) - funding - maint;
            feeAdj = BPS + closeFeeBps;
        }
        if (num <= 0) return 0;
        return uint256(num) * WAD / p.units * BPS / feeAdj;
    }

    function getUserPositions(address owner) external view returns (uint256[] memory ids, Position[] memory ps) {
        ids = _userPositions[owner].values();
        ps = new Position[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            ps[i] = _positions[ids[i]];
        }
    }

    function getUserOrders(address owner) external view returns (uint256[] memory ids, Order[] memory os) {
        ids = _userOrders[owner].values();
        os = new Order[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            os[i] = _orders[ids[i]];
        }
    }

    /// @notice Open position ids, paginated, for keepers.
    function openPositionIds(uint256 offset, uint256 limit) external view returns (uint256[] memory ids, uint256 total) {
        return _page(_openPositions, offset, limit);
    }

    function openOrderIds(uint256 offset, uint256 limit) external view returns (uint256[] memory ids, uint256 total) {
        return _page(_openOrders, offset, limit);
    }

    function _page(EnumerableSet.UintSet storage set, uint256 offset, uint256 limit)
        internal
        view
        returns (uint256[] memory ids, uint256 total)
    {
        total = set.length();
        if (offset >= total) return (new uint256[](0), total);
        uint256 end = offset + limit > total ? total : offset + limit;
        ids = new uint256[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            ids[i - offset] = set.at(i);
        }
    }
}
