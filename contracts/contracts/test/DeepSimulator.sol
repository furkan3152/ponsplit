// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FeeVault} from "../FeeVault.sol";
import {SplitLaunchpad} from "../SplitLaunchpad.sol";
import {SplitToken} from "../SplitToken.sol";

/// @dev A separate account that trades, so the simulation exercises many distinct traders.
contract SimTrader {
    constructor() payable {}

    /// @dev Spends `value` from this trader's own balance.
    function buy(SplitLaunchpad lp, address token, uint256 value) external returns (uint256) {
        return lp.buy{value: value}(token, 0);
    }

    function sell(SplitLaunchpad lp, address token, uint256 amount) external returns (uint256) {
        return lp.sell(token, amount, 0);
    }

    function sellMore(SplitLaunchpad lp, address token) external returns (bool reverted) {
        uint256 bal = SplitToken(token).balanceOf(address(this));
        try lp.sell(token, bal + 1, 0) {} catch { reverted = true; }
    }

    receive() external payable {}
}

/// @dev Deep, randomized lifecycle test executed inside one constructor so it can run against a
///      live chain via eth_call (nothing is sent or persisted). Deterministic for a given seed.
///      Addresses the caller must pre-sign for: vault = CREATE(this, 1), launchpad = CREATE(this, 2).
contract DeepSimulator {
    struct TokenPlan {
        uint64[] xIds;
        string[] handles;
        uint16[] bps;
        bytes attestation;
    }

    struct Claim {
        uint64 xId;
        address to;
        bytes sig;
    }

    struct Result {
        uint256 traders;
        uint256 tokens;
        uint256 trades;
        uint256 buys;
        uint256 sells;
        uint256 graduated;
        uint256 invariantChecks;
        uint256 creatorFees;
        uint256 claimed;
        uint256 claims;
        uint256 rejectedAttacks;
        uint256 protocolFees;
        bool ok;
        string failure;
    }

    SplitLaunchpad private lp;
    FeeVault private vault;
    address[] private tokens;
    SimTrader[] private traders;
    Result private r;
    uint256 private rng;

    constructor(
        address signer,
        uint256 seed,
        uint256 steps,
        uint256 traderCount,
        uint256 attestDeadline,
        TokenPlan[] memory plans,
        uint256 claimDeadline,
        Claim[] memory claims,
        bytes memory forgedSig
    ) payable {
        rng = seed;
        vault = new FeeVault(address(this), signer);
        lp = new SplitLaunchpad(
            address(this),
            vault,
            SplitLaunchpad.CurveConfig({
                virtualEth: 1.5 ether,
                virtualToken: 1_073_000_000 ether,
                curveSupply: 793_100_000 ether,
                lpSupply: 206_900_000 ether
            })
        );
        vault.setLaunchpad(address(lp));

        for (uint256 i; i < plans.length; ++i) {
            TokenPlan memory p = plans[i];
            tokens.push(
                lp.createToken{value: 0.005 ether}(
                    string.concat("Deep ", _u(i)),
                    string.concat("D", _u(i)),
                    "{}",
                    SplitLaunchpad.Split(p.xIds, p.handles, p.bps, attestDeadline, p.attestation),
                    0
                )
            );
        }
        r.tokens = tokens.length;
        _check("after launch");

        for (uint256 i; i < traderCount; ++i) {
            traders.push(new SimTrader{value: 3 ether}());
        }
        r.traders = traderCount;

        // Random trading storm across traders and tokens.
        for (uint256 s; s < steps; ++s) {
            SimTrader t = traders[_rand() % traders.length];
            address token = tokens[_rand() % tokens.length];
            uint256 bal = SplitToken(token).balanceOf(address(t));
            if (bal > 0 && _rand() % 3 == 0) {
                uint256 amount = (bal * (1 + (_rand() % 100))) / 100; // 1..100% of the bag
                t.sell(lp, token, amount);
                r.sells++;
            } else {
                // 0.0001 .. ~0.5 ETH, sometimes tiny dust buys.
                uint256 value = _rand() % 5 == 0 ? 1e12 + (_rand() % 1e12) : 1e14 + (_rand() % 5e17);
                if (address(t).balance < value) continue;
                t.buy(lp, token, value);
                r.buys++;
            }
            r.trades++;
            _check("during trading");
        }

        // Sell out the first token's curve from one trader, then keep trading in the pool.
        SimTrader whale = traders[0];
        payable(address(whale)).transfer(12 ether);
        whale.buy(lp, tokens[0], 12 ether);
        r.buys++;
        r.trades++;
        _check("after graduation");
        for (uint256 i; i < tokens.length; ++i) {
            (,,,,,,,, bool g,,,) = lp.markets(tokens[i]);
            if (g) r.graduated++;
        }
        for (uint256 i; i < traders.length; ++i) {
            SimTrader t = traders[i];
            uint256 bal = SplitToken(tokens[0]).balanceOf(address(t));
            if (bal > 0) {
                t.sell(lp, tokens[0], bal / 2);
                r.sells++;
                r.trades++;
            }
            _check("pool trading");
        }

        // Attacks that must fail.
        if (traders[1].sellMore(lp, tokens[1])) r.rejectedAttacks++;
        try lp.buy{value: 1 ether}(address(0xdead), 0) { r.failure = "bought unknown token"; } catch { r.rejectedAttacks++; }
        try lp.buy{value: 0.1 ether}(tokens[1], type(uint256).max) { r.failure = "slippage ignored"; } catch { r.rejectedAttacks++; }
        try vault.claim(claims[0].xId, address(this), claimDeadline, claims[0].sig) {
            r.failure = "claim redirected";
        } catch {
            r.rejectedAttacks++;
        }
        try vault.claim(claims[0].xId, claims[0].to, claimDeadline, forgedSig) { r.failure = "forged claim"; } catch { r.rejectedAttacks++; }

        // Every X account claims; together they must receive exactly what was split.
        for (uint256 i; i < tokens.length; ++i) r.creatorFees += vault.tokenFees(tokens[i]);
        for (uint256 i; i < claims.length; ++i) {
            r.claimed += vault.claim(claims[i].xId, claims[i].to, claimDeadline, claims[i].sig);
            r.claims++;
        }
        try vault.claim(claims[0].xId, claims[0].to, claimDeadline, claims[0].sig) { r.failure = "claim replayed"; } catch { r.rejectedAttacks++; }
        _check("after claims");

        r.protocolFees = lp.protocolFees();
        if (bytes(r.failure).length == 0 && r.claimed != r.creatorFees) r.failure = "claimed != split";
        if (bytes(r.failure).length == 0 && address(vault).balance != 0) r.failure = "vault not empty";
        r.ok = bytes(r.failure).length == 0;

        bytes memory out = abi.encode(r);
        assembly {
            return(add(out, 32), mload(out))
        }
    }

    /// @dev Solvency and supply invariants, checked after every step.
    function _check(string memory where) private {
        uint256 held;
        for (uint256 i; i < tokens.length; ++i) {
            address token = tokens[i];
            (,, uint256 realEth, uint256 realToken, uint256 lpSupply,,,,,,,) = lp.markets(token);
            held += realEth;
            SplitToken t = SplitToken(token);
            if (t.balanceOf(address(lp)) != realToken + lpSupply && bytes(r.failure).length == 0) {
                r.failure = string.concat("token reserves mismatch ", where);
            }
        }
        if (address(lp).balance != held + lp.protocolFees() && bytes(r.failure).length == 0) {
            r.failure = string.concat("ETH solvency broken ", where);
        }
        r.invariantChecks++;
    }

    function _rand() private returns (uint256) {
        rng = uint256(keccak256(abi.encode(rng)));
        return rng;
    }

    function _u(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory b;
        while (v > 0) {
            b = abi.encodePacked(bytes1(uint8(48 + (v % 10))), b);
            v /= 10;
        }
        return string(b);
    }

    receive() external payable {}
}
