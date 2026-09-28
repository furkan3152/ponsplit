// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title FeeVault
/// @notice Holds the X (Twitter) accounts' share of PonsEarn coins' creator fees until their owners
///         claim it.
/// @dev Recipients are keyed by their numeric X user id, which never changes when an account is
///      renamed. `signer` is an off-chain service that
///        1. attests that a list of usernames maps to a list of X user ids when a coin is launched, and
///        2. signs a claim once the caller has proven ownership of an X account.
///      If the signer key ever leaks, the owner pauses claims, rotates the signer, and unpauses:
///      balances never move while paused, and signatures from the old signer stop working.
///      Launchers (PonsEarnLauncher) register splits; deposits are open to anyone, since they can
///      only add to what the recipients are owed.
contract FeeVault is Ownable2Step, ReentrancyGuard, EIP712 {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_RECIPIENTS = 10;

    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(uint64 xId,address to,uint256 nonce,uint256 deadline)");
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256("SplitAttestation(address creator,uint64[] xIds,string[] handles,uint256 deadline)");

    struct Recipient {
        uint64 xId;
        uint16 bps;
    }

    address public signer;
    bool public claimsPaused;
    mapping(address launcher => bool) public isLauncher;

    mapping(address token => Recipient[]) private _splits;
    mapping(uint64 xId => address[]) private _tokensOf;
    mapping(address token => uint256) public tokenFees;
    /// @notice All fees ever split to X accounts, across every coin.
    uint256 public totalDeposited;
    mapping(uint64 xId => uint256) public claimable;
    mapping(uint64 xId => uint256) public totalEarned;
    mapping(uint64 xId => uint256) public nonces;

    event LauncherSet(address indexed launcher, bool allowed);
    event SignerSet(address indexed signer);
    event SplitSet(address indexed token, uint64[] xIds, uint16[] bps);
    event FeesDeposited(address indexed token, uint256 amount);
    event Claimed(uint64 indexed xId, address indexed to, uint256 amount);
    event ClaimsPausedSet(bool paused);

    error OnlyLauncher();
    error ZeroAddress();
    error InvalidSplit();
    error SplitExists();
    error NoSplit();
    error Expired();
    error BadSignature();
    error NothingToClaim();
    error TransferFailed();
    error ClaimsPaused();

    constructor(address owner_, address signer_) Ownable(owner_) EIP712("PonsEarn FeeVault", "1") {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerSet(signer_);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Allows (or stops) a launcher registering splits. A launcher can only register splits
    ///         for new coins; it can never move a balance.
    function setLauncher(address launcher, bool allowed) external onlyOwner {
        if (launcher == address(0)) revert ZeroAddress();
        isLauncher[launcher] = allowed;
        emit LauncherSet(launcher, allowed);
    }

    function setClaimsPaused(bool paused) external onlyOwner {
        claimsPaused = paused;
        emit ClaimsPausedSet(paused);
    }

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerSet(signer_);
    }

    // --------------------------------------------------------------- launcher

    /// @notice Registers a coin's split after checking the signer's username → id attestation,
    ///         which is bound to the launching wallet.
    function setSplit(
        address token,
        address creator,
        uint64[] calldata xIds,
        string[] calldata handles,
        uint16[] calldata bps,
        uint256 deadline,
        bytes calldata attestation
    ) external {
        if (!isLauncher[msg.sender]) revert OnlyLauncher();
        uint256 n = xIds.length;
        if (n == 0 || n > MAX_RECIPIENTS || n != bps.length || n != handles.length) revert InvalidSplit();
        if (_splits[token].length != 0) revert SplitExists();
        if (block.timestamp > deadline) revert Expired();

        bytes32[] memory handleHashes = new bytes32[](n);
        uint256 sum = 0;
        for (uint256 i; i < n; ++i) {
            if (xIds[i] == 0 || bps[i] == 0) revert InvalidSplit();
            for (uint256 j; j < i; ++j) {
                if (xIds[j] == xIds[i]) revert InvalidSplit();
            }
            sum += bps[i];
            handleHashes[i] = keccak256(bytes(handles[i]));
            _splits[token].push(Recipient(xIds[i], bps[i]));
            _tokensOf[xIds[i]].push(token);
        }
        if (sum != BPS) revert InvalidSplit();

        bytes32 structHash = keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                creator,
                keccak256(abi.encodePacked(xIds)),
                keccak256(abi.encodePacked(handleHashes)),
                deadline
            )
        );
        if (ECDSA.recover(_hashTypedDataV4(structHash), attestation) != signer) revert BadSignature();

        emit SplitSet(token, xIds, bps);
    }

    /// @notice Credits `msg.value` to the coin's recipients according to its split.
    /// @dev Open to anyone: each coin's FeeSplitter deposits here, and tips can be routed the same way.
    function deposit(address token) external payable {
        Recipient[] storage split = _splits[token];
        uint256 n = split.length;
        if (n == 0) revert NoSplit();
        if (msg.value == 0) return;

        uint256 remaining = msg.value;
        for (uint256 i; i < n; ++i) {
            // Last recipient takes the rounding remainder so no wei is stranded.
            // msg.value is only divided up here, never spent more than once.
            // slither-disable-next-line msg-value-loop
            uint256 share = i == n - 1 ? remaining : (msg.value * split[i].bps) / BPS;
            remaining -= share;
            claimable[split[i].xId] += share;
            totalEarned[split[i].xId] += share;
        }
        tokenFees[token] += msg.value;
        totalDeposited += msg.value;
        emit FeesDeposited(token, msg.value);
    }

    // ------------------------------------------------------------------ claim

    /// @notice Sends everything owed to X account `xId` to `to`.
    /// @dev Anyone may submit the transaction; the signature binds the destination.
    function claim(uint64 xId, address to, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (claimsPaused) revert ClaimsPaused();
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert Expired();

        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, xId, to, nonces[xId], deadline));
        if (ECDSA.recover(_hashTypedDataV4(structHash), signature) != signer) revert BadSignature();

        amount = claimable[xId];
        if (amount == 0) revert NothingToClaim();

        nonces[xId]++;
        claimable[xId] = 0;

        // The destination is bound by the signer's EIP-712 signature, so it is not arbitrary.
        // slither-disable-next-line arbitrary-send-eth
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(xId, to, amount);
    }

    // ------------------------------------------------------------------ views

    function getSplit(address token) external view returns (Recipient[] memory) {
        return _splits[token];
    }

    /// @notice The coins that pay X account `xId`, oldest first.
    function tokensOf(uint64 xId) external view returns (address[] memory) {
        return _tokensOf[xId];
    }

    /// @notice Claimable and lifetime earnings for several accounts in one call.
    function earningsOf(uint64[] calldata xIds)
        external
        view
        returns (uint256[] memory claimable_, uint256[] memory earned_)
    {
        claimable_ = new uint256[](xIds.length);
        earned_ = new uint256[](xIds.length);
        for (uint256 i; i < xIds.length; ++i) {
            claimable_[i] = claimable[xIds[i]];
            earned_[i] = totalEarned[xIds[i]];
        }
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
