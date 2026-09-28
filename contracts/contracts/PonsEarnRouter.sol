// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IPonsFactory, PonsLaunchedToken} from "./interfaces/IPons.sol";
import {IPoolManager, IUnlockCallback, PoolKey, SwapParams} from "./interfaces/IUniswapV4.sol";

/// @title PonsEarnRouter
/// @notice Trades a graduated, ETH-paired Pons coin in its Uniswap v4 pool (the one Pons created with
///         its fee hook), with a plain ERC-20 approval for sells. Quotes run the same swap and revert
///         it, so they include Pons's hook fee and creator tax exactly.
/// @dev Stateless and permissionless: it only ever moves the caller's own ETH or tokens, and only to
///      the recipient the caller names. Deployed by PonsEarnLauncher.
contract PonsEarnRouter is IUnlockCallback, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @dev TickMath.MIN_SQRT_PRICE + 1 and TickMath.MAX_SQRT_PRICE - 1: no price limit.
    uint160 internal constant MIN_PRICE_LIMIT = 4295128740;
    uint160 internal constant MAX_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341;
    /// @dev StateLibrary.POOLS_SLOT in v4-core: the PoolManager's `_pools` mapping.
    uint256 internal constant POOLS_SLOT = 6;
    uint256 internal constant LIQUIDITY_OFFSET = 3;

    IPoolManager public immutable poolManager;
    IPonsFactory public immutable ponsFactory;
    address public immutable ponsHook;

    struct Swap {
        PoolKey key;
        bool zeroForOne; // true: ETH in, coin out
        uint256 amountIn;
        uint256 minOut;
        address payer;
        address recipient;
        bool quote;
    }

    event PoolTrade(address indexed token, address indexed trader, address indexed recipient, bool isBuy, uint256 ethAmount, uint256 tokenAmount);

    error NotPoolManager();
    error NotOnPool();
    error Expired();
    error ZeroAmount();
    error SlippageExceeded(uint256 amountOut, uint256 minOut);
    error QuoteResult(uint256 amountOut, uint256 amountIn);
    error TransferFailed();

    constructor(IPoolManager poolManager_, IPonsFactory ponsFactory_) {
        poolManager = poolManager_;
        ponsFactory = ponsFactory_;
        ponsHook = ponsFactory_.memeHook();
    }

    // ----------------------------------------------------------------- trades

    /// @notice Buys `token` with all the ETH sent.
    function buy(address token, uint256 minTokensOut, address recipient, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (msg.value == 0) revert ZeroAmount();
        uint256 paid;
        (tokensOut, paid) = _swap(Swap(poolKeyOf(token), true, msg.value, minTokensOut, msg.sender, recipient, false));
        // A swap stops early only at the price limit; whatever it didn't use goes back.
        if (paid < msg.value) {
            (bool ok,) = msg.sender.call{value: msg.value - paid}("");
            if (!ok) revert TransferFailed();
        }
        emit PoolTrade(token, msg.sender, recipient, true, paid, tokensOut);
    }

    /// @notice Sells `tokensIn` of `token` for ETH. The router must be approved for the amount.
    function sell(address token, uint256 tokensIn, uint256 minEthOut, address recipient, uint256 deadline)
        external
        nonReentrant
        returns (uint256 ethOut)
    {
        if (block.timestamp > deadline) revert Expired();
        if (tokensIn == 0) revert ZeroAmount();
        uint256 paid;
        (ethOut, paid) = _swap(Swap(poolKeyOf(token), false, tokensIn, minEthOut, msg.sender, recipient, false));
        emit PoolTrade(token, msg.sender, recipient, false, ethOut, paid);
    }

    /// @notice What a trade would return right now, fees included. Meant for eth_call: the swap runs
    ///         and is reverted, so nothing changes (and no ETH or approval is needed).
    function quote(address token, bool isBuy, uint256 amountIn) external returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        bytes memory data = abi.encode(Swap(poolKeyOf(token), isBuy, amountIn, 0, address(0), address(0), true));
        // slither-disable-next-line unused-return
        try poolManager.unlock(data) {
            // unreachable: a quote always reverts with its result
        } catch (bytes memory reason) {
            if (reason.length != 68 || bytes4(reason) != QuoteResult.selector) {
                assembly {
                    revert(add(reason, 32), mload(reason))
                }
            }
            assembly {
                amountOut := mload(add(reason, 36))
            }
        }
    }

    function _swap(Swap memory s) private returns (uint256 amountOut, uint256 paid) {
        (amountOut, paid) = abi.decode(poolManager.unlock(abi.encode(s)), (uint256, uint256));
    }

    /// @dev Runs inside PoolManager.unlock: swap, then pay the input and take the output.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        Swap memory s = abi.decode(data, (Swap));

        int256 delta = poolManager.swap(
            s.key,
            SwapParams(s.zeroForOne, -int256(s.amountIn), s.zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT),
            ""
        );
        int128 amount0 = int128(delta >> 128);
        int128 amount1 = int128(delta);
        // Exact input: the input side is owed to the pool (negative), the output side to us.
        (int128 deltaIn, int128 deltaOut) = s.zeroForOne ? (amount0, amount1) : (amount1, amount0);
        uint256 paid = uint256(uint128(-deltaIn));
        uint256 amountOut = uint256(uint128(deltaOut));
        if (s.quote) revert QuoteResult(amountOut, paid);
        if (amountOut < s.minOut) revert SlippageExceeded(amountOut, s.minOut);

        if (s.zeroForOne) {
            // slither-disable-next-line unused-return
            poolManager.settle{value: paid}();
            poolManager.take(s.key.currency1, s.recipient, amountOut);
        } else {
            poolManager.sync(s.key.currency1);
            // `payer` is always the caller of sell(); this callback only runs inside this router's own unlock.
            // slither-disable-next-line arbitrary-send-erc20
            IERC20(s.key.currency1).safeTransferFrom(s.payer, address(poolManager), paid);
            // slither-disable-next-line unused-return
            poolManager.settle();
            poolManager.take(address(0), s.recipient, amountOut);
        }
        return abi.encode(amountOut, paid);
    }

    // ------------------------------------------------------------------ views

    /// @notice The Pons pool of an ETH-paired coin that has graduated; reverts for anything else.
    function poolKeyOf(address token) public view returns (PoolKey memory) {
        PonsLaunchedToken memory rec = ponsFactory.getLaunchedToken(token);
        if (!rec.exists || rec.phase != 2 || rec.pairToken != address(0)) revert NotOnPool();
        return PoolKey(address(0), token, rec.poolFee, rec.tickSpacing, ponsHook);
    }

    /// @notice A pool's current price and in-range liquidity, read from the PoolManager's storage.
    function poolState(bytes32 poolId) public view returns (uint160 sqrtPriceX96, uint128 liquidity) {
        bytes32 stateSlot = keccak256(abi.encode(poolId, POOLS_SLOT));
        sqrtPriceX96 = uint160(uint256(poolManager.extsload(stateSlot)));
        liquidity = uint128(uint256(poolManager.extsload(bytes32(uint256(stateSlot) + LIQUIDITY_OFFSET))));
    }
}
