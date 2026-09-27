// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Test-only stand-ins for WETH9 and a Uniswap V2 factory/pair. Only the pieces the
///      launchpad touches are implemented, with the same balance-minus-reserve mint logic.
contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }
}

contract MockPair is ERC20 {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public immutable token0;
    address public immutable token1;
    uint256 public reserve0;
    uint256 public reserve1;

    constructor(address a, address b) ERC20("LP", "LP") {
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function mint(address to) external returns (uint256 liquidity) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;
        uint256 supply = totalSupply();
        if (supply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min((amount0 * supply) / reserve0, (amount1 * supply) / reserve1);
        }
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);
        reserve0 = balance0;
        reserve1 = balance1;
    }

    function sync() external {
        reserve0 = IERC20(token0).balanceOf(address(this));
        reserve1 = IERC20(token1).balanceOf(address(this));
    }
}

contract MockFactory {
    mapping(address => mapping(address => address)) public getPair;

    function createPair(address a, address b) external returns (address pair) {
        require(getPair[a][b] == address(0), "PAIR_EXISTS");
        pair = address(new MockPair(a, b));
        getPair[a][b] = pair;
        getPair[b][a] = pair;
    }
}

/// @dev Rejects ETH so tests can check failed payouts revert cleanly.
contract RejectEth {
    receive() external payable {
        revert("no eth");
    }
}
