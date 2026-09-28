// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// The slices of Pons v2 (ponsfamily.com) on Robinhood Chain that PonsEarn talks to, transcribed
// from the verified sources and the Pons v2 integration docs. PonsEarn is not affiliated with Pons.

struct PonsSocials {
    string twitter;
    string telegram;
    string discord;
    string website;
    string farcaster;
}

struct PonsTokenParams {
    string name;
    string symbol;
    string logo;
    string description;
    PonsSocials socials;
    address creatorFeeRecipient;
    uint16 creatorTaxBps;
    bool buybackEnabled;
    bytes32 expectedEconomics; // previewLaunchEconomics(configId, pairToken); zero skips the check
    bytes32 salt; // CREATE2 salt, namespaced by Pons per launching account
}

/// @dev phase: 0 on the curve, 1 swept (curve closed, pool not created yet), 2 trading on Uniswap v4,
///      3 rescued by the Pons owner.
struct PonsLaunchedToken {
    address token;
    address curve;
    address deployer;
    address creatorFeeRecipient;
    address pairToken;
    uint256 graduationThreshold;
    uint24 poolFee;
    int24 tickSpacing;
    uint16 creatorTaxBps;
    bool buybackEnabled;
    uint8 phase;
    uint256 sweptQuote;
    uint256 sweptTokens;
    uint256 sweptAt;
    bool exists;
}

struct PonsFeePolicy {
    address protocolFeeRecipient;
    uint16 protocolFeeShareBps;
    uint16 buybackBurnBps;
    uint16 hookFeeBps;
    uint16 maxInternalPriceImpactBps;
}

interface IPonsFactory {
    function launchToken(
        PonsTokenParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        address[] calldata snipeTaxExemptions
    ) external payable returns (address token, address curve);

    function createGraduatedPool(address token) external returns (uint256 positionId);

    function launchFee() external view returns (uint256);
    function canLaunch(address launcher) external view returns (bool);
    function maxCreatorTaxBps() external view returns (uint256);
    function previewLaunchEconomics(uint256 launchConfigId, address pairToken) external view returns (bytes32);
    function getLaunchedToken(address token) external view returns (PonsLaunchedToken memory);
    function getLaunchFeePolicy(address token) external view returns (PonsFeePolicy memory);
    function pendingCreatorFeeRecipient(address token)
        external
        view
        returns (address newRecipient, uint256 effectiveAt, uint256 expiresAt);
    function memeHook() external view returns (address);
    function feeEscrow() external view returns (address);
    function poolManager() external view returns (address);
}

interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
    /// @dev Callable by the creator fee recipient while no buyback is earmarked (PonsEarn launches
    ///      never enable buybacks). Reverts once the curve has graduated.
    function sweepFees(uint256 minBuybackTokensOut) external;

    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function realQuoteReserve() external view returns (uint256);
    function sellableTokens() external view returns (uint256);
    function graduationThreshold() external view returns (uint256);
    function graduated() external view returns (bool);
    function feeBps() external view returns (uint256);
    function creatorTaxBps() external view returns (uint256);
    function quoteFeeBalance() external view returns (uint256);
    function creatorTaxBalance() external view returns (uint256);
    function protocolFeeShareBps() external view returns (uint16);
}

interface IPonsHook {
    /// @dev Callable by the pool's creator fee recipient when no internal swap is needed, that is
    ///      while no memecoin-denominated fees are pending; Pons's keeper sweeps the rest.
    function sweepPoolFees(bytes32 poolId, uint256 minConversionQuoteOut, uint256 minBuybackTokensOut) external;
    function pendingFees(bytes32 poolId, address currency) external view returns (uint256);
    function pendingCreatorTax(bytes32 poolId, address currency) external view returns (uint256);
}

interface IPonsEscrow {
    /// @dev Pays the caller's whole native balance; reverts with NoBalance() when it is zero.
    function claim() external returns (uint256 amount);
    function balanceOf(address recipient) external view returns (uint256);
}

interface IPonsToken {
    function logo() external view returns (string memory);
}
