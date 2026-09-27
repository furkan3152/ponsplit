// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SplitToken} from "./SplitToken.sol";
import {FeeVault} from "./FeeVault.sol";
import {IUniswapV2Factory, IUniswapV2Pair, IWETH} from "./interfaces/IUniswapV2.sol";

/// @title SplitLaunchpad
/// @notice Launches tokens on a constant-product bonding curve (virtual reserves, pump.fun style)
///         and routes the creator share of every trading fee to a set of X accounts via FeeVault.
///         When the curve sells out the token graduates, and anyone can migrate its ETH plus the
///         reserved LP tokens into a Uniswap V2 style pool whose LP tokens are burned.
contract SplitLaunchpad is Ownable, ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_FEE_BPS = 500; // 5%
    uint256 public constant MAX_MIGRATION_FEE_BPS = 1_000; // 10%
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    struct CurveConfig {
        uint256 virtualEth; // initial virtual ETH reserve
        uint256 virtualToken; // initial virtual token reserve
        uint256 curveSupply; // tokens sold through the curve
        uint256 lpSupply; // tokens reserved for the DEX pool
    }

    struct Curve {
        uint256 virtualEth;
        uint256 virtualToken;
        uint256 realEth; // ETH actually held for this token
        uint256 realToken; // curve tokens still for sale
        uint256 lpSupply;
        address creator;
        uint64 createdAt;
        bool graduated;
        bool migrated;
    }

    struct TokenView {
        address token;
        string name;
        string symbol;
        string imageUrl;
        string description;
        Curve curve;
        uint256 curveSupply;
        uint256 creatorFees;
        string[] handles;
        uint16[] bps;
    }

    FeeVault public immutable vault;

    CurveConfig public curveConfig;
    uint256 public feeBps = 100; // 1% of every trade
    uint256 public protocolShareBps = 2_000; // 20% of the fee; the rest goes to the X accounts
    uint256 public migrationFeeBps; // taken from the curve ETH at migration
    uint256 public creationFee;
    uint256 public protocolFees;

    address public dexFactory;
    address public weth;

    address[] public allTokens;
    mapping(address token => Curve) public curves;
    mapping(address token => uint256) public curveSupplyOf;
    mapping(address token => string) public imageUrlOf;
    mapping(address token => string) public descriptionOf;
    mapping(address token => string[]) private _handlesOf;
    mapping(address token => uint16[]) private _bpsOf;

    event TokenCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string imageUrl,
        string description,
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
    event Graduated(address indexed token, uint256 realEth);
    event Migrated(address indexed token, address indexed pair, uint256 ethAmount, uint256 tokenAmount, uint256 liquidity);
    event CurveConfigSet(uint256 virtualEth, uint256 virtualToken, uint256 curveSupply, uint256 lpSupply);
    event FeesSet(uint256 feeBps, uint256 protocolShareBps, uint256 migrationFeeBps, uint256 creationFee);
    event DexSet(address factory, address weth);

    error InvalidConfig();
    error InvalidMetadata();
    error InvalidHandle();
    error UnknownToken();
    error CurveComplete();
    error NotGraduated();
    error AlreadyMigrated();
    error DexNotSet();
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
    /// @param handles X usernames without the at-sign, lowercase; validated on-chain so a typo in
    ///        case or format can never strand fees under a hash nobody can claim.
    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata imageUrl,
        string calldata description,
        string[] calldata handles,
        uint16[] calldata bps,
        uint256 minTokensOut
    ) external payable nonReentrant returns (address token) {
        if (bytes(name).length == 0 || bytes(name).length > 32) revert InvalidMetadata();
        if (bytes(symbol).length == 0 || bytes(symbol).length > 10) revert InvalidMetadata();
        if (bytes(imageUrl).length > 256 || bytes(description).length > 500) revert InvalidMetadata();
        if (msg.value < creationFee) revert InsufficientPayment();

        CurveConfig memory cfg = curveConfig;
        token = address(new SplitToken(name, symbol, cfg.curveSupply + cfg.lpSupply));

        curves[token] = Curve({
            virtualEth: cfg.virtualEth,
            virtualToken: cfg.virtualToken,
            realEth: 0,
            realToken: cfg.curveSupply,
            lpSupply: cfg.lpSupply,
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            graduated: false,
            migrated: false
        });
        curveSupplyOf[token] = cfg.curveSupply;
        imageUrlOf[token] = imageUrl;
        descriptionOf[token] = description;
        allTokens.push(token);

        bytes32[] memory hashes = new bytes32[](handles.length);
        for (uint256 i; i < handles.length; ++i) {
            hashes[i] = _handleHash(handles[i]);
        }
        vault.setSplit(token, hashes, bps);
        _handlesOf[token] = handles;
        _bpsOf[token] = bps;
        protocolFees += creationFee;

        emit TokenCreated(token, msg.sender, name, symbol, imageUrl, description, handles, bps);

        uint256 initialBuy = msg.value - creationFee;
        if (initialBuy > 0) _buy(token, initialBuy, minTokensOut);
    }

    // ----------------------------------------------------------------- trade

    function buy(address token, uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        if (curves[token].creator == address(0)) revert UnknownToken();
        if (msg.value == 0) revert ZeroAmount();
        tokensOut = _buy(token, msg.value, minTokensOut);
    }

    function sell(address token, uint256 tokenAmount, uint256 minEthOut) external nonReentrant returns (uint256 ethOut) {
        Curve storage c = curves[token];
        if (c.creator == address(0)) revert UnknownToken();
        if (c.graduated) revert CurveComplete();
        if (tokenAmount == 0) revert ZeroAmount();

        uint256 gross = (c.virtualEth * tokenAmount) / (c.virtualToken + tokenAmount);
        if (gross > c.realEth) gross = c.realEth;
        uint256 fee = (gross * feeBps) / BPS;
        ethOut = gross - fee;
        if (ethOut < minEthOut) revert Slippage();

        c.virtualEth -= gross;
        c.virtualToken += tokenAmount;
        c.realEth -= gross;
        c.realToken += tokenAmount;

        // SplitToken lets the launchpad pull without an allowance; it only ever pulls from msg.sender.
        SplitToken(token).transferFrom(msg.sender, address(this), tokenAmount);

        _distributeFee(token, fee);
        _sendEth(msg.sender, ethOut);

        emit Trade(token, msg.sender, false, ethOut, tokenAmount, fee, c.virtualEth, c.virtualToken);
    }

    /// @notice Moves a graduated token's ETH and LP reserve into a Uniswap V2 pool. Permissionless.
    function migrate(address token) external nonReentrant returns (address pair) {
        Curve storage c = curves[token];
        if (!c.graduated) revert NotGraduated();
        if (c.migrated) revert AlreadyMigrated();
        if (dexFactory == address(0) || weth == address(0)) revert DexNotSet();

        c.migrated = true;
        uint256 migrationFee = (c.realEth * migrationFeeBps) / BPS;
        uint256 ethForLp = c.realEth - migrationFee;
        uint256 tokensForLp = c.lpSupply;
        c.realEth = 0;
        c.lpSupply = 0;
        protocolFees += migrationFee;

        pair = IUniswapV2Factory(dexFactory).getPair(token, weth);
        if (pair == address(0)) pair = IUniswapV2Factory(dexFactory).createPair(token, weth);

        // Transfers were locked until now, so the pair cannot already hold any of this token.
        SplitToken(token).openTrading();
        IWETH(weth).deposit{value: ethForLp}();
        if (!IWETH(weth).transfer(pair, ethForLp)) revert TransferFailed();
        if (!SplitToken(token).transfer(pair, tokensForLp)) revert TransferFailed();
        uint256 liquidity = IUniswapV2Pair(pair).mint(DEAD);

        emit Migrated(token, pair, ethForLp, tokensForLp, liquidity);
    }

    // ----------------------------------------------------------------- quotes

    /// @return tokensOut tokens received
    /// @return fee total fee charged
    /// @return refund ETH returned because the curve sold out
    function quoteBuy(address token, uint256 ethIn) public view returns (uint256 tokensOut, uint256 fee, uint256 refund) {
        Curve storage c = curves[token];
        if (c.graduated || ethIn == 0) return (0, 0, 0);

        fee = (ethIn * feeBps) / BPS;
        uint256 net = ethIn - fee;
        tokensOut = (c.virtualToken * net) / (c.virtualEth + net);

        if (tokensOut >= c.realToken) {
            tokensOut = c.realToken;
            // Smallest net input that buys the rest of the curve, rounded up.
            uint256 remainingVirtual = c.virtualToken - tokensOut;
            net = (c.virtualEth * tokensOut + remainingVirtual - 1) / remainingVirtual;
            fee = (net * feeBps + (BPS - feeBps) - 1) / (BPS - feeBps);
            if (net + fee > ethIn) fee = ethIn - net;
            refund = ethIn - net - fee;
        }
    }

    function quoteSell(address token, uint256 tokenAmount) external view returns (uint256 ethOut, uint256 fee) {
        Curve storage c = curves[token];
        if (c.graduated || tokenAmount == 0) return (0, 0);
        uint256 gross = (c.virtualEth * tokenAmount) / (c.virtualToken + tokenAmount);
        if (gross > c.realEth) gross = c.realEth;
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
        v.token = token;
        v.name = SplitToken(token).name();
        v.symbol = SplitToken(token).symbol();
        v.imageUrl = imageUrlOf[token];
        v.description = descriptionOf[token];
        v.curve = curves[token];
        v.curveSupply = curveSupplyOf[token];
        v.creatorFees = vault.tokenFees(token);
        v.handles = _handlesOf[token];
        v.bps = _bpsOf[token];
    }

    // ------------------------------------------------------------------ admin

    function setCurveConfig(CurveConfig calldata config_) external onlyOwner {
        _setCurveConfig(config_);
    }

    function setFees(uint256 feeBps_, uint256 protocolShareBps_, uint256 migrationFeeBps_, uint256 creationFee_)
        external
        onlyOwner
    {
        if (feeBps_ > MAX_FEE_BPS || protocolShareBps_ > BPS || migrationFeeBps_ > MAX_MIGRATION_FEE_BPS) {
            revert InvalidConfig();
        }
        feeBps = feeBps_;
        protocolShareBps = protocolShareBps_;
        migrationFeeBps = migrationFeeBps_;
        creationFee = creationFee_;
        emit FeesSet(feeBps_, protocolShareBps_, migrationFeeBps_, creationFee_);
    }

    function setDex(address factory_, address weth_) external onlyOwner {
        dexFactory = factory_;
        weth = weth_;
        emit DexSet(factory_, weth_);
    }

    function withdrawProtocolFees(address to) external onlyOwner nonReentrant {
        uint256 amount = protocolFees;
        protocolFees = 0;
        _sendEth(to, amount);
    }

    // --------------------------------------------------------------- internal

    function _buy(address token, uint256 ethIn, uint256 minTokensOut) internal returns (uint256 tokensOut) {
        Curve storage c = curves[token];
        if (c.graduated) revert CurveComplete();

        uint256 fee;
        uint256 refund;
        (tokensOut, fee, refund) = quoteBuy(token, ethIn);
        if (tokensOut == 0 || tokensOut < minTokensOut) revert Slippage();
        uint256 net = ethIn - fee - refund;

        c.virtualEth += net;
        c.virtualToken -= tokensOut;
        c.realEth += net;
        c.realToken -= tokensOut;

        if (!SplitToken(token).transfer(msg.sender, tokensOut)) revert TransferFailed();
        _distributeFee(token, fee);
        if (refund > 0) _sendEth(msg.sender, refund);

        emit Trade(token, msg.sender, true, net + fee, tokensOut, fee, c.virtualEth, c.virtualToken);

        if (c.realToken == 0) {
            c.graduated = true;
            emit Graduated(token, c.realEth);
        }
    }

    /// @dev X usernames are 1-15 chars of [a-z0-9_] once lowercased. Uppercase is rejected rather
    ///      than folded so the stored handle, the hash and the OAuth username always agree.
    function _handleHash(string calldata handle) internal pure returns (bytes32) {
        bytes calldata b = bytes(handle);
        if (b.length == 0 || b.length > 15) revert InvalidHandle();
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39) || c == 0x5f;
            if (!ok) revert InvalidHandle();
        }
        return keccak256(b);
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
