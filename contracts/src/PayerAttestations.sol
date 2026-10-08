// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PayerAttestations
/// @notice Registry of Argus verdicts about x402 payer wallets.
/// Verdicts are keyed by (wallet, attestor). Anyone can attest; consumers decide
/// which attestors they trust. No attestor can overwrite another attestor's verdict.
/// Tiers rise with how sure we are that the wallet is a separate customer:
/// 0 Unclear, 1 Linked, 2 Independent, 3 Verified. Consumers must check an explicit
/// set of allowed tiers (see ArgusGate), never "tier >= N".
contract PayerAttestations {
    uint8 public constant UNCLEAR = 0;
    uint8 public constant LINKED = 1;
    uint8 public constant INDEPENDENT = 2;
    uint8 public constant VERIFIED = 3;

    struct Verdict {
        bytes32 operatorId;
        uint8 tier;
        uint16 groupSize;
        uint64 issuedAt;
        uint64 expiresAt;
        bytes32 evidenceHash;
    }

    event Attested(
        address indexed wallet, address indexed attestor, bytes32 indexed operatorId, uint8 tier, uint64 expiresAt
    );

    error TierOutOfRange(uint8 tier);
    error OperatorIdMismatch(uint8 tier, bytes32 operatorId);
    error InvalidExpiry(uint64 issuedAt, uint64 expiresAt);
    error ZeroWallet();
    error LengthMismatch(uint256 wallets, uint256 verdicts);

    mapping(address wallet => mapping(address attestor => Verdict)) private _verdicts;

    /// @notice Record a verdict for `wallet`. msg.sender is the attestor.
    function attest(address wallet, Verdict calldata v) external {
        _attest(wallet, v);
    }

    /// @notice Record many verdicts in one transaction.
    function attestBatch(address[] calldata wallets, Verdict[] calldata v) external {
        if (wallets.length != v.length) revert LengthMismatch(wallets.length, v.length);
        for (uint256 i; i < wallets.length; ++i) {
            _attest(wallets[i], v[i]);
        }
    }

    /// @notice The stored verdict, including expired ones. Use tierOf for a policy decision.
    function verdictOf(address wallet, address attestor) external view returns (Verdict memory) {
        return _verdicts[wallet][attestor];
    }

    /// @notice The tier to act on. Missing or expired verdicts read as UNCLEAR.
    function tierOf(address wallet, address attestor) public view returns (uint8) {
        Verdict storage v = _verdicts[wallet][attestor];
        if (v.expiresAt <= block.timestamp) return UNCLEAR;
        return v.tier;
    }

    /// @notice True when both wallets hold fresh, non-Unclear verdicts from `attestor`
    /// with the same operatorId.
    function sameOperator(address a, address b, address attestor) external view returns (bool) {
        if (tierOf(a, attestor) == UNCLEAR || tierOf(b, attestor) == UNCLEAR) return false;
        return _verdicts[a][attestor].operatorId == _verdicts[b][attestor].operatorId;
    }

    function _attest(address wallet, Verdict calldata v) private {
        if (wallet == address(0)) revert ZeroWallet();
        if (v.tier > VERIFIED) revert TierOutOfRange(v.tier);
        // Unclear carries no operator; every other tier must name one.
        if ((v.tier == UNCLEAR) != (v.operatorId == bytes32(0))) revert OperatorIdMismatch(v.tier, v.operatorId);
        if (v.expiresAt <= v.issuedAt) revert InvalidExpiry(v.issuedAt, v.expiresAt);

        _verdicts[wallet][msg.sender] = v;
        emit Attested(wallet, msg.sender, v.operatorId, v.tier, v.expiresAt);
    }
}
