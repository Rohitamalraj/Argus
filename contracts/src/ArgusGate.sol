// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PayerAttestations} from "./PayerAttestations.sol";

/// @title ArgusGate
/// @notice Base contract for on-chain consumers of Argus verdicts.
/// A gate names an attestor and an explicit bitmask of allowed tiers: bit i allows tier i.
/// Example: allow Independent and Verified with `(1 << 2) | (1 << 3)`.
abstract contract ArgusGate {
    PayerAttestations public immutable registry;

    error TierNotAllowed(address wallet, uint8 tier, uint8 allowedMask);

    constructor(PayerAttestations registry_) {
        registry = registry_;
    }

    modifier onlyTiers(address attestor, uint8 allowedMask) {
        _checkTier(msg.sender, attestor, allowedMask);
        _;
    }

    function _tierAllowed(address wallet, address attestor, uint8 allowedMask) internal view returns (bool) {
        uint8 tier = registry.tierOf(wallet, attestor);
        return (allowedMask >> tier) & 1 == 1;
    }

    function _checkTier(address wallet, address attestor, uint8 allowedMask) internal view {
        if (!_tierAllowed(wallet, attestor, allowedMask)) {
            revert TierNotAllowed(wallet, registry.tierOf(wallet, attestor), allowedMask);
        }
    }
}
