// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FeeVault} from "../FeeVault.sol";
import {SplitLaunchpad} from "../SplitLaunchpad.sol";
import {SplitToken} from "../SplitToken.sol";

/// @dev Runs the whole PonSplit lifecycle inside one constructor so it can be executed against a
///      live chain with a single eth_call (no transaction, nothing spent, nothing persisted).
///      Signatures are produced off-chain for the addresses this constructor will create:
///      vault = CREATE(this, 1), launchpad = CREATE(this, 2). The constructor returns an
///      ABI-encoded Result instead of runtime code.
contract ChainSimulator {
    struct Result {
        address vault;
        address launchpad;
        address token;
        uint256 curveTokensBought;
        uint256 curveSellEth;
        bool graduated;
        uint256 poolEth;
        uint256 poolTokens;
        uint256 poolTokensBought;
        uint256 poolSellEth;
        uint256 creatorFees;
        uint256 claimed;
        uint256 tradeCount;
        bool solvent;
    }

    constructor(
        address signer,
        uint64 xId,
        string memory handle,
        uint256 attestDeadline,
        bytes memory attestation,
        uint256 claimDeadline,
        bytes memory claimSig
    ) payable {
        Result memory r;

        FeeVault vault = new FeeVault(address(this), signer);
        SplitLaunchpad launchpad = new SplitLaunchpad(
            address(this),
            vault,
            SplitLaunchpad.CurveConfig({
                virtualEth: 1.5 ether,
                virtualToken: 1_073_000_000 ether,
                curveSupply: 793_100_000 ether,
                lpSupply: 206_900_000 ether
            })
        );
        vault.setLaunchpad(address(launchpad));
        r.vault = address(vault);
        r.launchpad = address(launchpad);

        uint64[] memory xIds = new uint64[](1);
        xIds[0] = xId;
        string[] memory handles = new string[](1);
        handles[0] = handle;
        uint16[] memory bps = new uint16[](1);
        bps[0] = 10_000;

        // Launch with a first buy.
        address token = launchpad.createToken{value: 0.01 ether}(
            "Chain Simulation",
            "SIM",
            "{}",
            SplitLaunchpad.Split(xIds, handles, bps, attestDeadline, attestation),
            0,
            launchpad.termsVersion()
        );
        r.token = token;
        SplitToken t = SplitToken(token);

        // Curve: buy, then sell half back.
        r.curveTokensBought = launchpad.buy{value: 1 ether}(token, 0);
        r.curveSellEth = launchpad.sell(token, t.balanceOf(address(this)) / 2, 0);

        // Sell out the curve (excess refunded) and trade in the pool.
        launchpad.buy{value: 10 ether}(token, 0);
        (,,,,,,, , bool graduated,,,) = launchpad.markets(token);
        r.graduated = graduated;
        (, , r.poolEth, r.poolTokens,,,,,,,,) = launchpad.markets(token);
        r.poolTokensBought = launchpad.buy{value: 0.5 ether}(token, 0);
        r.poolSellEth = launchpad.sell(token, r.poolTokensBought / 2, 0);

        r.creatorFees = vault.tokenFees(token);
        r.claimed = vault.claim(xId, address(this), claimDeadline, claimSig);
        r.tradeCount = launchpad.tradeCount(token);

        (, , uint256 realEth,,,,,,,,,) = launchpad.markets(token);
        r.solvent = address(launchpad).balance == realEth + launchpad.protocolFees()
            && address(vault).balance == 0
            && t.balanceOf(address(launchpad)) + t.balanceOf(address(this)) == t.totalSupply();

        bytes memory out = abi.encode(r);
        assembly {
            return(add(out, 32), mload(out))
        }
    }
}
