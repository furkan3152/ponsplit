// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title SplitToken
/// @notice Fixed-supply ERC20 launched through SplitLaunchpad.
/// @dev While the token is on its bonding curve, balances can only move to or from the
///      launchpad (buys and sells). This stops anyone from seeding a DEX pool before the
///      launchpad migrates liquidity, which would otherwise let them set the listing price.
///      The launchpad is also a trusted spender so selling needs no separate approve tx;
///      it only ever pulls tokens from `msg.sender` inside `sell`.
contract SplitToken is ERC20 {
    address public immutable launchpad;
    bool public tradingOpen;

    error TransfersLocked();
    error OnlyLaunchpad();

    constructor(string memory name_, string memory symbol_, uint256 supply_) ERC20(name_, symbol_) {
        launchpad = msg.sender;
        _mint(msg.sender, supply_);
    }

    /// @notice Called once by the launchpad when liquidity is migrated to the DEX.
    function openTrading() external {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        tradingOpen = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!tradingOpen && from != address(0) && from != launchpad && to != launchpad) {
            revert TransfersLocked();
        }
        super._update(from, to, value);
    }

    function _spendAllowance(address owner, address spender, uint256 value) internal override {
        if (spender == launchpad) return;
        super._spendAllowance(owner, spender, value);
    }
}
