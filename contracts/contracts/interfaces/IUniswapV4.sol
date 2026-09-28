// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// The parts of the Uniswap v4 PoolManager that a single-pool exact-input swap needs, matching
// v4-core's ABI (Currency and IHooks are plain addresses, BalanceDelta is a packed int256).

struct PoolKey {
    address currency0; // native ETH is address(0), which always sorts first
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified; // negative: exact input
    uint160 sqrtPriceLimitX96;
}

interface IPoolManager {
    function unlock(bytes calldata data) external returns (bytes memory);
    /// @return swapDelta amount0 in the upper 128 bits, amount1 in the lower; negative = owed to the pool
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256 swapDelta);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
    function extsload(bytes32 slot) external view returns (bytes32 value);
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}
