// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {FeeVault} from "./FeeVault.sol";
import {FeeSplitter} from "./FeeSplitter.sol";
import {PonsEarnRouter} from "./PonsEarnRouter.sol";
import {
    IPonsCurve,
    IPonsEscrow,
    IPonsFactory,
    IPonsHook,
    IPonsToken,
    PonsLaunchedToken,
    PonsSocials,
    PonsTokenParams
} from "./interfaces/IPons.sol";
import {IPoolManager, PoolKey} from "./interfaces/IUniswapV4.sol";

/// @title PonsEarnLauncher
/// @notice Launches coins on Pons (ponsfamily.com) whose creator fees are split between up to 10 X
///         (Twitter) accounts. Pons mints the coin, runs its bonding curve and graduates it into a
///         locked Uniswap v4 pool exactly as for any other Pons launch; the only difference is that
///         the coin's creator fee recipient is a per-coin FeeSplitter:
///           - `platformShareBps` of the standard creator fee goes to PonsEarn,
///           - the rest of it, and the whole creator tax the launcher chose, goes to the X accounts.
///         PonsEarn is not affiliated with Pons.
/// @dev Pons's creator share is 70% of its 1% trade fee, plus the creator tax (0–10%). A splitter
///      cannot tell the two apart once Pons has paid them out, so each coin snapshots the fraction of
///      every payout that PonsEarn's share amounts to (`platformBps`) at launch.
contract PonsEarnLauncher is Ownable2Step, ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    /// @notice PonsEarn never takes more than 30% of the standard creator fee.
    uint16 public constant MAX_PLATFORM_SHARE_BPS = 3_000;
    /// @dev Transient slot holding the curve allowed to refund ETH during a launch's first buy.
    bytes32 private constant REFUNDER_SLOT = keccak256("ponsearn.launcher.refunder");

    struct LaunchParams {
        string name;
        string symbol;
        string logo;
        string description;
        PonsSocials socials;
        uint16 creatorTaxBps;
        bytes32 salt; // any unused value; combined with the launching wallet
        bytes32 expectedEconomics; // Pons's previewLaunchEconomics, pinned so its terms can't move underneath
    }

    /// @notice What the signer attested for the fee split, plus the attestation itself.
    struct SplitParams {
        uint64[] xIds;
        string[] handles; // lowercase usernames at launch time (display only; ids are authoritative)
        uint16[] bps;
        uint256 deadline;
        bytes attestation;
    }

    struct Launch {
        address token;
        address curve;
        address splitter;
        address creator;
        uint64 createdAt;
        uint64 createdBlock; // the chain's own block number (where to start reading its trades)
        uint16 creatorTaxBps;
        uint16 platformBps; // share of every payout that goes to PonsEarn
        bytes32 poolId; // the Uniswap v4 pool it graduates into
    }

    struct LaunchView {
        Launch launch;
        string name;
        string symbol;
        string logo;
        uint8 phase; // Pons: 0 curve, 1 graduating, 2 Uniswap v4 pool, 3 rescued
        address feeRecipient; // Pons's current creator fee recipient (the splitter unless Pons moved it)
        uint256 quoteReserve; // curve pricing reserves, including the virtual ETH
        uint256 tokenReserve;
        uint256 raised; // real ETH on the curve
        uint256 threshold; // ETH the curve raises before it graduates
        uint256 sellable; // tokens the curve still sells
        uint256 phantomQuote; // the curve's virtual ETH (sets the opening price)
        uint256 reservedTokens; // held back for the pool; the curve closes when only these are left
        uint160 sqrtPriceX96; // pool price once on Uniswap v4
        uint128 liquidity;
        uint256 feesSplit; // ETH already credited to the X accounts
        uint256 feesPending; // creator fees earned but not split yet (before PonsEarn's share)
        uint64[] xIds;
        string[] handles;
        uint16[] bps;
    }

    IPonsFactory public immutable ponsFactory;
    IPonsEscrow public immutable ponsEscrow;
    IPonsHook public immutable ponsHook;
    IPoolManager public immutable poolManager;
    FeeVault public immutable feeVault;
    FeeSplitter public immutable splitterImplementation;
    PonsEarnRouter public immutable router;

    /// @notice PonsEarn's cut of the standard creator fee, in bps of it (2000 = 20%).
    uint16 public platformShareBps = 2_000;
    /// @notice The Pons launch config coins use (0: ETH-paired, graduating at 4.2 ETH).
    uint256 public launchConfigId;
    /// @notice Bumped whenever a term above changes; a launch pins the version it was shown.
    uint256 public termsVersion = 1;
    bool public launchesPaused;
    /// @notice PonsEarn's share collected so far and not withdrawn yet.
    uint256 public platformFees;
    uint256 public totalPlatformFees;

    Launch[] private _launches;
    mapping(address token => uint256) private _indexOf; // index + 1
    mapping(address token => string[]) private _handlesOf;
    mapping(address splitter => bool) public isSplitter;

    event Launched(
        address indexed token,
        address indexed creator,
        address curve,
        address splitter,
        uint16 creatorTaxBps,
        uint16 platformBps,
        uint256 firstBuy,
        uint256 tokensOut
    );
    event PlatformFee(address indexed token, uint256 amount);
    event PlatformFeesWithdrawn(address indexed to, uint256 amount);
    event PlatformShareSet(uint16 bps);
    event LaunchConfigSet(uint256 id);
    event LaunchesPausedSet(bool paused);

    error LaunchesPaused();
    error TermsChanged();
    error WrongValue(uint256 sent, uint256 expected);
    error ShareTooHigh();
    error NotSplitter();
    error UnexpectedEth();
    error TransferFailed();
    error PonsMismatch();
    error ZeroAddress();

    constructor(address owner_, FeeVault feeVault_, IPonsFactory ponsFactory_) Ownable(owner_) {
        if (address(feeVault_) == address(0) || address(ponsFactory_) == address(0)) revert ZeroAddress();
        feeVault = feeVault_;
        ponsFactory = ponsFactory_;
        ponsEscrow = IPonsEscrow(ponsFactory_.feeEscrow());
        ponsHook = IPonsHook(ponsFactory_.memeHook());
        poolManager = IPoolManager(ponsFactory_.poolManager());
        splitterImplementation = new FeeSplitter(address(this), feeVault_, ponsEscrow, ponsHook);
        router = new PonsEarnRouter(poolManager, ponsFactory_);
    }

    // ----------------------------------------------------------------- launch

    /// @notice Launches a coin on Pons with the X-account split `s`, optionally buying `firstBuy` of it
    ///         for the caller in the same transaction (before anyone else can trade).
    /// @dev msg.value must be exactly Pons's launch fee plus `firstBuy`, so a changed Pons fee reverts
    ///      rather than silently shrinking the buy. The caller is exempt from Pons's opening snipe tax.
    function launch(
        LaunchParams calldata p,
        SplitParams calldata s,
        uint256 firstBuy,
        uint256 minTokensOut,
        uint256 expectedTermsVersion
    ) external payable nonReentrant returns (address token, address curve, address splitter, uint256 tokensOut) {
        if (launchesPaused) revert LaunchesPaused();
        if (expectedTermsVersion != termsVersion) revert TermsChanged();
        uint256 fee = ponsFactory.launchFee();
        if (msg.value != fee + firstBuy) revert WrongValue(msg.value, fee + firstBuy);

        splitter = Clones.clone(address(splitterImplementation));
        address[] memory exempt = new address[](1);
        exempt[0] = msg.sender;
        (token, curve) = ponsFactory.launchToken{value: fee}(
            PonsTokenParams({
                name: p.name,
                symbol: p.symbol,
                logo: p.logo,
                description: p.description,
                socials: p.socials,
                creatorFeeRecipient: splitter,
                creatorTaxBps: p.creatorTaxBps,
                buybackEnabled: false,
                expectedEconomics: p.expectedEconomics,
                salt: keccak256(abi.encode(msg.sender, p.salt))
            }),
            launchConfigId,
            address(0),
            exempt
        );

        PonsLaunchedToken memory rec = ponsFactory.getLaunchedToken(token);
        if (rec.curve != curve || rec.creatorFeeRecipient != splitter || rec.pairToken != address(0)) revert PonsMismatch();
        uint16 pBps = platformBpsFor(IPonsCurve(curve).feeBps(), ponsFactory.getLaunchFeePolicy(token).protocolFeeShareBps, p.creatorTaxBps);
        bytes32 poolId = keccak256(abi.encode(PoolKey(address(0), token, rec.poolFee, rec.tickSpacing, address(ponsHook))));

        FeeSplitter(payable(splitter)).initialize(token, curve, poolId, pBps);
        feeVault.setSplit(token, msg.sender, s.xIds, s.handles, s.bps, s.deadline, s.attestation);
        _launches.push(
            Launch(token, curve, splitter, msg.sender, uint64(block.timestamp), uint64(_blockNumber()), p.creatorTaxBps, pBps, poolId)
        );
        _indexOf[token] = _launches.length;
        _handlesOf[token] = s.handles;
        isSplitter[splitter] = true;

        if (firstBuy != 0) tokensOut = _firstBuy(curve, firstBuy, minTokensOut);
        emit Launched(token, msg.sender, curve, splitter, p.creatorTaxBps, pBps, firstBuy, tokensOut);
    }

    /// @dev Robinhood Chain is an Arbitrum chain, where `block.number` is the parent chain's block
    ///      number; the chain's own (the one its logs are indexed by) comes from ArbSys. Chains without
    ///      ArbSys (local test chains) use `block.number`, which is their own. The call gets a fixed
    ///      stipend: on a local fork of Robinhood Chain, 0x64 holds Arbitrum's placeholder `0xfe` code,
    ///      which would otherwise burn 63/64 of the launch's gas.
    function _blockNumber() private view returns (uint256) {
        (bool ok, bytes memory ret) =
            address(0x64).staticcall{gas: 20_000}(abi.encodeWithSignature("arbBlockNumber()"));
        return ok && ret.length == 32 ? abi.decode(ret, (uint256)) : block.number;
    }

    /// @notice The fraction of every payout (in bps) that PonsEarn's share of the standard creator fee
    ///         amounts to, for a coin with these Pons terms.
    function platformBpsFor(uint256 feeBps, uint256 protocolFeeShareBps, uint16 creatorTaxBps)
        public
        view
        returns (uint16)
    {
        // Both legs in bps² of trade volume: the creator's part of the base fee, and the creator tax.
        uint256 creatorBase = feeBps * (BPS - protocolFeeShareBps);
        uint256 total = creatorBase + uint256(creatorTaxBps) * BPS;
        if (total == 0) return 0;
        return uint16((uint256(platformShareBps) * creatorBase) / total);
    }

    /// @dev Buys for the caller on the new curve. A buy that would run past the curve's allocation is
    ///      filled to the edge and the rest refunded to this contract, which passes it on.
    // The curve is the one Pons just created for this launch, and a refund only goes back to the caller.
    // slither-disable-next-line arbitrary-send-eth
    function _firstBuy(address curve, uint256 amount, uint256 minTokensOut) private returns (uint256 tokensOut) {
        uint256 before = address(this).balance - amount;
        bytes32 slot = REFUNDER_SLOT;
        assembly {
            tstore(slot, curve)
        }
        tokensOut = IPonsCurve(curve).buy{value: amount}(amount, minTokensOut, msg.sender);
        assembly {
            tstore(slot, 0)
        }
        uint256 refund = address(this).balance - before;
        if (refund != 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// @dev Only a refund from the curve of the buy in progress is accepted.
    receive() external payable {
        bytes32 slot = REFUNDER_SLOT;
        address refunder;
        assembly {
            refunder := tload(slot)
        }
        if (refunder == address(0) || msg.sender != refunder) revert UnexpectedEth();
    }

    // ------------------------------------------------------------------- fees

    /// @notice Where each coin's FeeSplitter sends PonsEarn's share.
    function platformFeeIn(address token) external payable {
        if (!isSplitter[msg.sender]) revert NotSplitter();
        platformFees += msg.value;
        totalPlatformFees += msg.value;
        emit PlatformFee(token, msg.value);
    }

    /// @notice Collects several coins' fees in one transaction (see FeeSplitter.collect). A coin
    ///         whose collection fails is skipped rather than failing the rest.
    function collectMany(address[] calldata tokens) public returns (uint256 total) {
        for (uint256 i; i < tokens.length; ++i) {
            uint256 index = _indexOf[tokens[i]];
            // slither-disable-next-line incorrect-equality
            if (index == 0) continue;
            try FeeSplitter(payable(_launches[index - 1].splitter)).collect() returns (uint256 amount) {
                total += amount;
            } catch {}
        }
    }

    /// @notice Collects the coins' latest fees, then claims X account `xId`'s whole balance to `to`
    ///         with the signer's claim signature, in one transaction.
    /// @dev FeeVault.claim is open to any caller: the signature binds the account, the destination,
    ///      the nonce and the deadline.
    function collectAndClaim(address[] calldata tokens, uint64 xId, address to, uint256 deadline, bytes calldata signature)
        external
        returns (uint256 amount)
    {
        collectMany(tokens);
        amount = feeVault.claim(xId, to, deadline, signature);
    }

    // ------------------------------------------------------------------ admin

    function withdrawPlatformFees(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = platformFees;
        platformFees = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit PlatformFeesWithdrawn(to, amount);
    }

    /// @notice Applies to coins launched from now on; every existing coin keeps its snapshot.
    function setPlatformShareBps(uint16 bps) external onlyOwner {
        if (bps > MAX_PLATFORM_SHARE_BPS) revert ShareTooHigh();
        platformShareBps = bps;
        termsVersion++;
        emit PlatformShareSet(bps);
    }

    /// @notice Which Pons launch config (an ETH-paired one) new coins use.
    function setLaunchConfigId(uint256 id) external onlyOwner {
        launchConfigId = id;
        termsVersion++;
        emit LaunchConfigSet(id);
    }

    function setLaunchesPaused(bool paused) external onlyOwner {
        launchesPaused = paused;
        emit LaunchesPausedSet(paused);
    }

    // ------------------------------------------------------------------ views

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    /// @notice The registry record of a PonsEarn coin (all zero for any other token).
    function launchOf(address token) public view returns (Launch memory l) {
        uint256 index = _indexOf[token];
        if (index != 0) l = _launches[index - 1];
    }

    /// @notice Everything that prices a new launch, read in one call.
    function launchTerms()
        external
        view
        returns (
            uint256 version,
            uint16 platformShare,
            uint256 configId,
            uint256 ponsLaunchFee,
            bytes32 economics,
            uint256 maxCreatorTaxBps,
            bool canLaunch,
            bool paused
        )
    {
        version = termsVersion;
        platformShare = platformShareBps;
        configId = launchConfigId;
        ponsLaunchFee = ponsFactory.launchFee();
        economics = ponsFactory.previewLaunchEconomics(configId, address(0));
        maxCreatorTaxBps = ponsFactory.maxCreatorTaxBps();
        canLaunch = ponsFactory.canLaunch(address(this));
        paused = launchesPaused;
    }

    /// @notice Newest-first page of coins with their live Pons state.
    function getLaunches(uint256 offset, uint256 limit) external view returns (LaunchView[] memory page) {
        uint256 total = _launches.length;
        if (offset >= total) return new LaunchView[](0);
        uint256 n = total - offset < limit ? total - offset : limit;
        page = new LaunchView[](n);
        for (uint256 i; i < n; ++i) {
            page[i] = _view(_launches[total - 1 - offset - i]);
        }
    }

    function getLaunch(address token) external view returns (LaunchView memory v) {
        uint256 index = _indexOf[token];
        if (index != 0) v = _view(_launches[index - 1]);
    }

    function _view(Launch memory l) private view returns (LaunchView memory v) {
        v.launch = l;
        v.name = IERC20Metadata(l.token).name();
        v.symbol = IERC20Metadata(l.token).symbol();
        v.logo = IPonsToken(l.token).logo();
        PonsLaunchedToken memory rec = ponsFactory.getLaunchedToken(l.token);
        v.phase = rec.phase;
        v.feeRecipient = rec.creatorFeeRecipient;
        v.threshold = rec.graduationThreshold;
        v.phantomQuote = IPonsCurve(l.curve).phantomQuote();
        v.reservedTokens = IPonsCurve(l.curve).reservedTokens();
        // slither-disable-next-line incorrect-equality
        if (rec.phase == 0) {
            IPonsCurve curve = IPonsCurve(l.curve);
            (v.quoteReserve, v.tokenReserve) = curve.getReserves();
            v.raised = curve.realQuoteReserve();
            v.sellable = curve.sellableTokens();
            // slither-disable-next-line incorrect-equality
        } else if (rec.phase == 2) {
            (v.sqrtPriceX96, v.liquidity) = router.poolState(l.poolId);
        }
        v.feesSplit = feeVault.tokenFees(l.token);
        v.feesPending = FeeSplitter(payable(l.splitter)).pendingFees();
        FeeVault.Recipient[] memory split = feeVault.getSplit(l.token);
        v.xIds = new uint64[](split.length);
        v.bps = new uint16[](split.length);
        for (uint256 i; i < split.length; ++i) {
            v.xIds[i] = split[i].xId;
            v.bps[i] = split[i].bps;
        }
        v.handles = _handlesOf[l.token];
    }
}
