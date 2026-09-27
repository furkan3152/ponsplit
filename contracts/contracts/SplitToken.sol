// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title SplitToken
/// @notice Fixed-supply ERC20 launched through SplitLaunchpad. The whole supply is minted to the
///         launchpad, which sells it on a bonding curve and then makes a market in its built-in AMM.
/// @dev The launchpad is a trusted spender so selling needs no separate approve transaction;
///      it only ever pulls tokens from `msg.sender` inside `sell`.
contract SplitToken is ERC20 {
    address public immutable launchpad;

    constructor(string memory name_, string memory symbol_, uint256 supply_) ERC20(name_, symbol_) {
        launchpad = msg.sender;
        _mint(msg.sender, supply_);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal override {
        if (spender == launchpad) return;
        super._spendAllowance(owner, spender, value);
    }
}
