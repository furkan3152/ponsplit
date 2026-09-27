// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title FeeVault
/// @notice Holds creator fees for X (Twitter) accounts until their owners claim them.
/// @dev Recipients are identified by `handleHash = keccak256(bytes(lowercaseHandle))`, where the
///      handle is stored without its leading at-sign. A claim needs an EIP-712 signature from `signer`, an off-chain
///      service that only signs after the caller proves ownership of the handle via X OAuth.
contract FeeVault is Ownable, ReentrancyGuard, EIP712 {
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_RECIPIENTS = 10;

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 handleHash,address to,uint256 nonce,uint256 deadline)");

    struct Recipient {
        bytes32 handleHash;
        uint16 bps;
    }

    address public launchpad;
    address public signer;

    mapping(address token => Recipient[]) private _splits;
    mapping(address token => uint256) public tokenFees;
    mapping(bytes32 handleHash => uint256) public claimable;
    mapping(bytes32 handleHash => uint256) public totalEarned;
    mapping(bytes32 handleHash => uint256) public nonces;

    event LaunchpadSet(address indexed launchpad);
    event SignerSet(address indexed signer);
    event SplitSet(address indexed token, bytes32[] handleHashes, uint16[] bps);
    event FeesDeposited(address indexed token, uint256 amount);
    event Claimed(bytes32 indexed handleHash, address indexed to, uint256 amount);

    error OnlyLaunchpad();
    error LaunchpadAlreadySet();
    error ZeroAddress();
    error InvalidSplit();
    error SplitExists();
    error NoSplit();
    error Expired();
    error BadSignature();
    error NothingToClaim();
    error TransferFailed();

    constructor(address owner_, address signer_) Ownable(owner_) EIP712("PonSplit FeeVault", "1") {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerSet(signer_);
    }

    modifier onlyLaunchpad() {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        _;
    }

    // ------------------------------------------------------------------ admin

    function setLaunchpad(address launchpad_) external onlyOwner {
        if (launchpad != address(0)) revert LaunchpadAlreadySet();
        if (launchpad_ == address(0)) revert ZeroAddress();
        launchpad = launchpad_;
        emit LaunchpadSet(launchpad_);
    }

    function setSigner(address signer_) external onlyOwner {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        emit SignerSet(signer_);
    }

    // ------------------------------------------------------------- launchpad

    function setSplit(address token, bytes32[] calldata handleHashes, uint16[] calldata bps) external onlyLaunchpad {
        uint256 n = handleHashes.length;
        if (n == 0 || n > MAX_RECIPIENTS || n != bps.length) revert InvalidSplit();
        if (_splits[token].length != 0) revert SplitExists();

        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (handleHashes[i] == bytes32(0) || bps[i] == 0) revert InvalidSplit();
            for (uint256 j; j < i; ++j) {
                if (handleHashes[j] == handleHashes[i]) revert InvalidSplit();
            }
            sum += bps[i];
            _splits[token].push(Recipient(handleHashes[i], bps[i]));
        }
        if (sum != BPS) revert InvalidSplit();

        emit SplitSet(token, handleHashes, bps);
    }

    /// @notice Credits `msg.value` to the token's recipients according to its split.
    /// @dev Open to anyone so fees from other sources (or tips) can be routed the same way.
    function deposit(address token) external payable {
        Recipient[] storage split = _splits[token];
        uint256 n = split.length;
        if (n == 0) revert NoSplit();
        if (msg.value == 0) return;

        uint256 remaining = msg.value;
        for (uint256 i; i < n; ++i) {
            // Last recipient takes the rounding remainder so no wei is stranded.
            uint256 share = i == n - 1 ? remaining : (msg.value * split[i].bps) / BPS;
            remaining -= share;
            claimable[split[i].handleHash] += share;
            totalEarned[split[i].handleHash] += share;
        }
        tokenFees[token] += msg.value;
        emit FeesDeposited(token, msg.value);
    }

    // ------------------------------------------------------------------ claim

    /// @notice Sends everything owed to `handleHash` to `to`.
    /// @dev Anyone may submit the transaction; the signature binds the destination.
    function claim(bytes32 handleHash, address to, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 amount)
    {
        if (to == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert Expired();

        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, handleHash, to, nonces[handleHash], deadline));
        if (ECDSA.recover(_hashTypedDataV4(structHash), signature) != signer) revert BadSignature();

        amount = claimable[handleHash];
        if (amount == 0) revert NothingToClaim();

        nonces[handleHash]++;
        claimable[handleHash] = 0;

        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(handleHash, to, amount);
    }

    // ------------------------------------------------------------------ views

    function getSplit(address token) external view returns (Recipient[] memory) {
        return _splits[token];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
