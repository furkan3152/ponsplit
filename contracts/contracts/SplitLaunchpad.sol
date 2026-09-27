// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SplitToken} from "./SplitToken.sol";
import {FeeVault} from "./FeeVault.sol";

/// @title SplitLaunchpad
/// @notice Launches tokens whose trading fees are split between X accounts.
///
///         Phase 1, bonding curve: constant product over virtual reserves (pump.fun style). The
///         curve sells `curveSupply` tokens; the last buy is capped and the excess refunded.
///         Phase 2, PonSwap: once the curve sells out, the collected ETH and the reserved
///         `lpSupply` tokens become a built-in constant-product pool (x * y = k over real reserves)
///         with permanently locked liquidity. The same fee split keeps paying the X accounts.
///
///         Both phases share one set of reserves: during the curve, `virtual*` drive the price and
///         `real*` track ETH held and tokens left for sale; at graduation both are set to the pool
///         reserves and move together from then on.
///
///         Every trade is also recorded on-chain so the app can draw charts and trade lists
///         without an indexer.
contract SplitLaunchpad is Ownable, ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 500; // 5%
    uint256 public constant MAX_GRADUATION_FEE_BPS = 1_000; // 10%
    uint256 public constant MAX_METADATA_BYTES = 2_000;

    struct CurveConfig {
        uint256 virtualEth; // initial virtual ETH reserve
        uint256 virtualToken; // initial virtual token reserve
        uint256 curveSupply; // tokens sold through the curve
        uint256 lpSupply; // tokens reserved for the PonSwap pool
    }

    struct Market {
        uint256 virtualEth; // price reserves (== realEth after graduation)
        uint256 virtualToken; // price reserves (== realToken after graduation)
        uint256 realEth; // ETH held for this token
        uint256 realToken; // curve: tokens left for sale. pool: token reserve
        uint256 lpSupply; // tokens waiting to seed the pool (0 after graduation)
        address creator;
        uint64 createdAt;
        uint64 graduatedAt; // 0 while on the curve
        bool graduated;
    }

    /// @notice What the signer attested for the fee split, plus the attestation itself.
    struct Split {
        uint64[] xIds;
        string[] handles; // lowercase usernames at launch time (display only; ids are authoritative)
        uint16[] bps;
        uint256 deadline;
        bytes attestation;
    }

    struct TradeRecord {
        address trader;
        uint40 timestamp;
        bool isBuy;
        uint128 ethAmount; // ETH paid (buy, incl. fee) or received (sell, after fee)
        uint128 tokenAmount;
        uint128 price; // wei per 1e18 token units after the trade
    }

    struct RecentTrade {
        address token;
        string symbol;
        TradeRecord trade;
    }

    struct TokenView {
        address token;
        string name;
        string symbol;
        string metadata; // JSON: { image, description, website, telegram, twitter }
        Market market;
        uint256 curveSupply;
        uint256 totalSupply;
        uint256 creatorFees;
        uint256 tradeCount;
        uint64 lastTradeAt;
        uint64[] xIds;
        string[] handles;
        uint16[] bps;
    }

    struct GlobalTrade {
        address token;
        uint96 index;
    }

    FeeVault public immutable vault;

    CurveConfig public curveConfig;
    uint256 public feeBps = 100; // 1% of every trade, curve and pool alike
    uint256 public protocolShareBps = 2_000; // 20% of the fee; the rest goes to the X accounts
    uint256 public graduationFeeBps; // taken from the curve ETH when the pool is seeded
    uint256 public creationFee;
    uint256 public protocolFees;

    address[] public allTokens;
    mapping(address token => Market) public markets;
    mapping(address token => uint256) public curveSupplyOf;
    mapping(address token => string) public metadataOf;
    mapping(address token => uint64[]) private _xIdsOf;
    mapping(address token => string[]) private _handlesOf;
    mapping(address token => uint16[]) private _bpsOf;
    mapping(address token => TradeRecord[]) private _trades;
    GlobalTrade[] private _globalTrades;

    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string metadata,
        uint64[] xIds,
        string[] handles,
        uint16[] bps
    );
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 virtualEth,
        uint256 virtualToken
    );
    event Graduated(address indexed token, uint256 poolEth, uint256 poolTokens);
    event CurveConfigSet(uint256 virtualEth, uint256 virtualToken, uint256 curveSupply, uint256 lpSupply);
    event FeesSet(uint256 feeBps, uint256 protocolShareBps, uint256 graduationFeeBps, uint256 creationFee);

    error InvalidConfig();
    error InvalidMetadata();
    error UnknownToken();
    error Slippage();
    error ZeroAmount();
    error InsufficientPayment();
    error TransferFailed();

    constructor(address owner_, FeeVault vault_, CurveConfig memory config_) Ownable(owner_) {
        vault = vault_;
        _setCurveConfig(config_);
    }

    // ---------------------------------------------------------------- launch

    /// @notice Creates a token. Any ETH sent above `creationFee` is used as the creator's first buy.
    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata metadata,
        Split calldata split,
        uint256 minTokensOut
    ) external payable nonReentrant returns (address token) {
        if (bytes(name).length == 0 || bytes(name).length > 32) revert InvalidMetadata();
        if (bytes(symbol).length == 0 || bytes(symbol).length > 10) revert InvalidMetadata();
        if (bytes(metadata).length > MAX_METADATA_BYTES) revert InvalidMetadata();
        if (msg.value < creationFee) revert InsufficientPayment();

        CurveConfig memory cfg = curveConfig;
        token = address(new SplitToken(name, symbol, cfg.curveSupply + cfg.lpSupply));

        markets[token] = Market({
            virtualEth: cfg.virtualEth,
            virtualToken: cfg.virtualToken,
            realEth: 0,
            realToken: cfg.curveSupply,
            lpSupply: cfg.lpSupply,
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            graduatedAt: 0,
            graduated: false
        });
        curveSupplyOf[token] = cfg.curveSupply;
        metadataOf[token] = metadata;
        allTokens.push(token);

        vault.setSplit(token, msg.sender, split.xIds, split.handles, split.bps, split.deadline, split.attestation);
        _xIdsOf[token] = split.xIds;
        _handlesOf[token] = split.handles;
        _bpsOf[token] = split.bps;
        protocolFees += creationFee;

        emit TokenCreated(token, msg.sender, name, symbol, metadata, split.xIds, split.handles, split.bps);

        uint256 initialBuy = msg.value - creationFee;
        if (initialBuy > 0) _buy(token, initialBuy, minTokensOut);
    }

    // ----------------------------------------------------------------- trade

    function buy(address token, uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (markets[token].creator == address(0)) revert UnknownToken();
        if (msg.value == 0) revert ZeroAmount();
        tokensOut = _buy(token, msg.value, minTokensOut);
    }

    function sell(address token, uint256 tokenAmount, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        Market storage m = markets[token];
        if (m.creator == address(0)) revert UnknownToken();
        if (tokenAmount == 0) revert ZeroAmount();

        uint256 gross = (m.virtualEth * tokenAmount) / (m.virtualToken + tokenAmount);
        if (gross > m.realEth) gross = m.realEth;
        uint256 fee = (gross * feeBps) / BPS;
        ethOut = gross - fee;
        if (ethOut == 0 || ethOut < minEthOut) revert Slippage();

        m.virtualEth -= gross;
        m.virtualToken += tokenAmount;
        m.realEth -= gross;
        m.realToken += tokenAmount;

        // SplitToken lets the launchpad pull without an allowance; it only ever pulls from msg.sender.
        if (!SplitToken(token).transferFrom(msg.sender, address(this), tokenAmount)) revert TransferFailed();

        _distributeFee(token, fee);
        _record(token, false, ethOut, tokenAmount, m);
        _sendEth(msg.sender, ethOut);

        emit Trade(token, msg.sender, false, ethOut, tokenAmount, fee, m.virtualEth, m.virtualToken);
    }

    // ----------------------------------------------------------------- quotes

    /// @return tokensOut tokens received
    /// @return fee total fee charged
    /// @return refund ETH returned because the curve sold out
    function quoteBuy(address token, uint256 ethIn) public view returns (uint256 tokensOut, uint256 fee, uint256 refund) {
        Market storage m = markets[token];
        if (m.creator == address(0) || ethIn == 0) return (0, 0, 0);

        fee = (ethIn * feeBps) / BPS;
        uint256 net = ethIn - fee;
        tokensOut = (m.virtualToken * net) / (m.virtualEth + net);

        // Only reachable on the curve: in the pool virtualToken == realToken and tokensOut < virtualToken.
        if (tokensOut >= m.realToken) {
            tokensOut = m.realToken;
            // Smallest net input that buys the rest of the curve, rounded up.
            uint256 remainingVirtual = m.virtualToken - tokensOut;
            net = (m.virtualEth * tokensOut + remainingVirtual - 1) / remainingVirtual;
            fee = (net * feeBps + (BPS - feeBps) - 1) / (BPS - feeBps);
            if (net + fee > ethIn) fee = ethIn - net;
            refund = ethIn - net - fee;
        }
    }

    function quoteSell(address token, uint256 tokenAmount) external view returns (uint256 ethOut, uint256 fee) {
        Market storage m = markets[token];
        if (m.creator == address(0) || tokenAmount == 0) return (0, 0);
        uint256 gross = (m.virtualEth * tokenAmount) / (m.virtualToken + tokenAmount);
        if (gross > m.realEth) gross = m.realEth;
        fee = (gross * feeBps) / BPS;
        ethOut = gross - fee;
    }

    // ------------------------------------------------------------------ views

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice Newest-first page of tokens.
    function getTokens(uint256 offset, uint256 limit) external view returns (TokenView[] memory page) {
        uint256 total = allTokens.length;
        if (offset >= total) return new TokenView[](0);
        uint256 n = total - offset < limit ? total - offset : limit;
        page = new TokenView[](n);
        for (uint256 i; i < n; ++i) {
            page[i] = getToken(allTokens[total - 1 - offset - i]);
        }
    }

    function getToken(address token) public view returns (TokenView memory v) {
        Market memory m = markets[token];
        if (m.creator == address(0)) return v;
        v.token = token;
        v.name = SplitToken(token).name();
        v.symbol = SplitToken(token).symbol();
        v.metadata = metadataOf[token];
        v.market = m;
        v.curveSupply = curveSupplyOf[token];
        v.totalSupply = SplitToken(token).totalSupply();
        v.creatorFees = vault.tokenFees(token);
        uint256 count = _trades[token].length;
        v.tradeCount = count;
        v.lastTradeAt = count == 0 ? m.createdAt : _trades[token][count - 1].timestamp;
        v.xIds = _xIdsOf[token];
        v.handles = _handlesOf[token];
        v.bps = _bpsOf[token];
    }

    function tradeCount(address token) external view returns (uint256) {
        return _trades[token].length;
    }

    /// @notice Oldest-first slice of a token's trades, starting at `offset`.
    function getTrades(address token, uint256 offset, uint256 limit) external view returns (TradeRecord[] memory page) {
        TradeRecord[] storage all = _trades[token];
        uint256 total = all.length;
        if (offset >= total) return new TradeRecord[](0);
        uint256 n = total - offset < limit ? total - offset : limit;
        page = new TradeRecord[](n);
        for (uint256 i; i < n; ++i) {
            page[i] = all[offset + i];
        }
    }

    function globalTradeCount() external view returns (uint256) {
        return _globalTrades.length;
    }

    /// @notice Most recent trades across every token, newest first.
    function getRecentTrades(uint256 limit) external view returns (RecentTrade[] memory page) {
        uint256 total = _globalTrades.length;
        uint256 n = total < limit ? total : limit;
        page = new RecentTrade[](n);
        for (uint256 i; i < n; ++i) {
            GlobalTrade memory g = _globalTrades[total - 1 - i];
            page[i] = RecentTrade(g.token, SplitToken(g.token).symbol(), _trades[g.token][g.index]);
        }
    }

    // ------------------------------------------------------------------ admin

    function setCurveConfig(CurveConfig calldata config_) external onlyOwner {
        _setCurveConfig(config_);
    }

    function setFees(uint256 feeBps_, uint256 protocolShareBps_, uint256 graduationFeeBps_, uint256 creationFee_)
        external
        onlyOwner
    {
        if (feeBps_ > MAX_FEE_BPS || protocolShareBps_ > BPS || graduationFeeBps_ > MAX_GRADUATION_FEE_BPS) {
            revert InvalidConfig();
        }
        feeBps = feeBps_;
        protocolShareBps = protocolShareBps_;
        graduationFeeBps = graduationFeeBps_;
        creationFee = creationFee_;
        emit FeesSet(feeBps_, protocolShareBps_, graduationFeeBps_, creationFee_);
    }

    function withdrawProtocolFees(address to) external onlyOwner nonReentrant {
        uint256 amount = protocolFees;
        protocolFees = 0;
        _sendEth(to, amount);
    }

    // --------------------------------------------------------------- internal

    function _buy(address token, uint256 ethIn, uint256 minTokensOut) internal returns (uint256 tokensOut) {
        Market storage m = markets[token];

        uint256 fee;
        uint256 refund;
        (tokensOut, fee, refund) = quoteBuy(token, ethIn);
        if (tokensOut == 0 || tokensOut < minTokensOut) revert Slippage();
        uint256 net = ethIn - fee - refund;

        m.virtualEth += net;
        m.virtualToken -= tokensOut;
        m.realEth += net;
        m.realToken -= tokensOut;

        if (!SplitToken(token).transfer(msg.sender, tokensOut)) revert TransferFailed();
        _distributeFee(token, fee);
        _record(token, true, net + fee, tokensOut, m);

        emit Trade(token, msg.sender, true, net + fee, tokensOut, fee, m.virtualEth, m.virtualToken);

        if (!m.graduated && m.realToken == 0) _graduate(token, m);
        if (refund > 0) _sendEth(msg.sender, refund);
    }

    /// @dev Turns the sold-out curve into the PonSwap pool. The pool price matches the curve's
    ///      final price when the config keeps virtualEth/virtualToken proportional to lpSupply.
    function _graduate(address token, Market storage m) internal {
        uint256 gradFee = (m.realEth * graduationFeeBps) / BPS;
        protocolFees += gradFee;
        uint256 poolEth = m.realEth - gradFee;
        uint256 poolTokens = m.lpSupply;

        m.graduated = true;
        m.graduatedAt = uint64(block.timestamp);
        m.realEth = poolEth;
        m.realToken = poolTokens;
        m.virtualEth = poolEth;
        m.virtualToken = poolTokens;
        m.lpSupply = 0;

        emit Graduated(token, poolEth, poolTokens);
    }

    function _record(address token, bool isBuy, uint256 ethAmount, uint256 tokenAmount, Market storage m) internal {
        TradeRecord[] storage list = _trades[token];
        _globalTrades.push(GlobalTrade(token, uint96(list.length)));
        list.push(
            TradeRecord({
                trader: msg.sender,
                timestamp: uint40(block.timestamp),
                isBuy: isBuy,
                ethAmount: uint128(ethAmount),
                tokenAmount: uint128(tokenAmount),
                price: uint128((m.virtualEth * 1e18) / m.virtualToken)
            })
        );
    }

    function _distributeFee(address token, uint256 fee) internal {
        if (fee == 0) return;
        uint256 protocolCut = (fee * protocolShareBps) / BPS;
        protocolFees += protocolCut;
        uint256 creatorCut = fee - protocolCut;
        if (creatorCut > 0) vault.deposit{value: creatorCut}(token);
    }

    function _setCurveConfig(CurveConfig memory cfg) internal {
        if (cfg.virtualEth == 0 || cfg.curveSupply == 0 || cfg.lpSupply == 0 || cfg.virtualToken <= cfg.curveSupply) {
            revert InvalidConfig();
        }
        curveConfig = cfg;
        emit CurveConfigSet(cfg.virtualEth, cfg.virtualToken, cfg.curveSupply, cfg.lpSupply);
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
