// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {FeeVault} from "./FeeVault.sol";
import {IPonsCurve, IPonsEscrow, IPonsHook} from "./interfaces/IPons.sol";

interface IPlatformFeeSink {
    function platformFeeIn(address token) external payable;
    function owner() external view returns (address);
}

/// @title FeeSplitter
/// @notice The Pons creator fee recipient of one PonsEarn coin. Pons pays creator fees by crediting
///         this address in its fee escrow; `collect()` pulls them in and splits them: `platformBps` to
///         PonsEarn, the rest to the coin's X accounts in the FeeVault.
/// @dev Deployed once as an implementation by PonsEarnLauncher and then cloned (EIP-1167) per coin, so
///      the immutables below are shared by every clone while `token`, `curve`, `poolId` and
///      `platformBps` are each clone's own storage. There is deliberately no way to hand the Pons
///      recipient role to another address: the split a coin launched with is the split it keeps.
contract FeeSplitter is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;

    address public immutable launcher;
    FeeVault public immutable feeVault;
    IPonsEscrow public immutable escrow;
    IPonsHook public immutable hook;

    address public token;
    address public curve;
    bytes32 public poolId;
    uint16 public platformBps;
    /// @notice Everything this splitter has paid out: to X accounts and to PonsEarn.
    uint256 public totalCollected;

    event Collected(uint256 amount, uint256 toPlatform, uint256 toRecipients);
    event TokenRecovered(address indexed erc20, address indexed to, uint256 amount);

    error OnlyLauncher();
    error OnlyOwner();
    error AlreadyInitialized();
    error NotInitialized();
    error OutOfGas();

    constructor(address launcher_, FeeVault feeVault_, IPonsEscrow escrow_, IPonsHook hook_) {
        launcher = launcher_;
        feeVault = feeVault_;
        escrow = escrow_;
        hook = hook_;
    }

    /// @dev Called by the launcher in the transaction that creates the clone and the coin.
    function initialize(address token_, address curve_, bytes32 poolId_, uint16 platformBps_) external {
        if (msg.sender != launcher) revert OnlyLauncher();
        if (token != address(0)) revert AlreadyInitialized();
        token = token_;
        curve = curve_;
        poolId = poolId_;
        platformBps = platformBps_;
    }

    /// @notice Pons's fee escrow pays claims here; anything else sent is split the same way.
    receive() external payable {}

    /// @notice Moves this coin's pending creator fees into the Pons escrow where this contract may
    ///         (the curve before graduation, the pool's ETH fees after), claims the escrow balance, and
    ///         splits everything held. Anyone may call it.
    /// @dev The sweeps are best effort: after graduation a sweep that needs a memecoin conversion is
    ///      reserved for Pons's own keeper, which sweeps pools regularly, and a coin in its graduation
    ///      gap has nothing to sweep. Neither may stop what is already claimable from being paid out.
    function collect() external nonReentrant returns (uint256 amount) {
        address token_ = token;
        if (token_ == address(0)) revert NotInitialized();

        IPonsCurve curve_ = IPonsCurve(curve);
        uint256 gasBefore = gasleft();
        if (!curve_.graduated()) {
            // slither-disable-next-line unused-return
            try curve_.sweepFees(0) {} catch (bytes memory reason) {
                _refusedNotStarved(reason, gasBefore);
            }
        } else {
            try hook.sweepPoolFees(poolId, 0, 0) {} catch (bytes memory reason) {
                _refusedNotStarved(reason, gasBefore);
            }
        }
        if (escrow.balanceOf(address(this)) != 0) {
            // slither-disable-next-line unused-return
            escrow.claim();
        }

        amount = address(this).balance;
        // slither-disable-next-line incorrect-equality
        if (amount == 0) return 0;
        uint256 toPlatform = (amount * platformBps) / BPS;
        uint256 toRecipients = amount - toPlatform;
        totalCollected += amount;

        feeVault.deposit{value: toRecipients}(token_);
        // The launcher is immutable: PonsEarn's share can go nowhere else.
        // slither-disable-next-line arbitrary-send-eth
        if (toPlatform != 0) IPlatformFeeSink(launcher).platformFeeIn{value: toPlatform}(token_);
        emit Collected(amount, toPlatform, toRecipients);
    }

    /// @dev A sweep that Pons refused is skipped; one that ran out of gas fails the whole call.
    ///      Otherwise gas estimation could settle on a limit at which the sweep silently runs dry
    ///      (EIP-150 leaves the caller 1/64 of its gas to carry on with), and collect would pay out
    ///      less than it could. Pons refuses with a custom error; running out of gas returns no
    ///      data (however deep it happened) and leaves this frame about 1/64 of its gas.
    function _refusedNotStarved(bytes memory reason, uint256 gasBefore) private view {
        if (reason.length == 0 || gasleft() < gasBefore / 63) revert OutOfGas();
    }

    /// @notice Creator fees this coin has earned but not yet split, in wei, before PonsEarn's share:
    ///         what sits in the curve's or the pool's ETH buckets, in the Pons escrow and here.
    /// @dev Pool fees taken in the coin itself are left out until Pons's keeper converts them to ETH.
    function pendingFees() public view returns (uint256 pending) {
        pending = escrow.balanceOf(address(this)) + address(this).balance;
        IPonsCurve curve_ = IPonsCurve(curve);
        if (address(curve_) == address(0)) return pending;
        uint256 protocolShare = curve_.protocolFeeShareBps();
        uint256 fees;
        uint256 tax;
        if (!curve_.graduated()) {
            fees = curve_.quoteFeeBalance();
            tax = curve_.creatorTaxBalance();
        } else {
            fees = hook.pendingFees(poolId, address(0));
            tax = hook.pendingCreatorTax(poolId, address(0));
        }
        pending += fees - (fees * protocolShare) / BPS + tax;
    }

    /// @notice Recovers an ERC-20 that ended up here (Pons's owner-only rescue can push a pool's
    ///         memecoin-denominated fees to the recipient). ETH is never recoverable this way: it is
    ///         always split by `collect()`.
    function recoverToken(address erc20, address to) external nonReentrant {
        if (msg.sender != IPlatformFeeSink(launcher).owner()) revert OnlyOwner();
        uint256 amount = IERC20(erc20).balanceOf(address(this));
        IERC20(erc20).safeTransfer(to, amount);
        emit TokenRecovered(erc20, to, amount);
    }
}
