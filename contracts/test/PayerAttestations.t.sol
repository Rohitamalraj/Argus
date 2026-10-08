// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PayerAttestations} from "../src/PayerAttestations.sol";
import {ArgusGate} from "../src/ArgusGate.sol";

/// Example consumer: a promo vault that serves only Independent and Verified wallets.
contract PromoVault is ArgusGate {
    address public immutable attestor;
    uint8 public constant ALLOWED = (1 << 2) | (1 << 3);
    uint256 public claims;

    constructor(PayerAttestations r, address attestor_) ArgusGate(r) {
        attestor = attestor_;
    }

    function claim() external onlyTiers(attestor, ALLOWED) {
        claims++;
    }
}

contract PayerAttestationsTest is Test {
    event Attested(
        address indexed wallet, address indexed attestor, bytes32 indexed operatorId, uint8 tier, uint64 expiresAt
    );

    PayerAttestations reg;
    address analyzer = makeAddr("analyzer");
    address otherAttestor = makeAddr("other");
    address funder = makeAddr("funder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint64 constant TTL = 7 days;

    function setUp() public {
        vm.warp(1_760_000_000);
        reg = new PayerAttestations();
    }

    function _verdict(uint8 tier, bytes32 op) internal view returns (PayerAttestations.Verdict memory) {
        return PayerAttestations.Verdict({
            operatorId: op,
            tier: tier,
            groupSize: tier == 1 ? 10 : 1,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp) + TTL,
            evidenceHash: keccak256(abi.encode(tier, op))
        });
    }

    function _opOf(address who) internal pure returns (bytes32) {
        return keccak256(abi.encode(uint256(10143), who, bytes32("salt")));
    }

    // ---------- attest ----------

    function test_attest_storesVerdictAndEmits() public {
        PayerAttestations.Verdict memory v = _verdict(1, _opOf(funder));
        vm.expectEmit(true, true, true, true);
        emit Attested(alice, analyzer, v.operatorId, 1, v.expiresAt);
        vm.prank(analyzer);
        reg.attest(alice, v);

        PayerAttestations.Verdict memory got = reg.verdictOf(alice, analyzer);
        assertEq(got.operatorId, v.operatorId);
        assertEq(got.tier, 1);
        assertEq(got.groupSize, 10);
        assertEq(got.issuedAt, v.issuedAt);
        assertEq(got.expiresAt, v.expiresAt);
        assertEq(got.evidenceHash, v.evidenceHash);
        assertEq(reg.tierOf(alice, analyzer), 1);
    }

    function test_attest_overwritesOwnVerdict() public {
        vm.startPrank(analyzer);
        reg.attest(alice, _verdict(2, _opOf(alice)));
        reg.attest(alice, _verdict(1, _opOf(funder)));
        vm.stopPrank();
        assertEq(reg.tierOf(alice, analyzer), 1);
    }

    function test_attest_revertsTierAboveVerified() public {
        vm.prank(analyzer);
        vm.expectRevert(abi.encodeWithSelector(PayerAttestations.TierOutOfRange.selector, uint8(4)));
        reg.attest(alice, _verdict(4, _opOf(alice)));
    }

    function testFuzz_attest_tierBounds(uint8 tier) public {
        bytes32 op = tier == 0 ? bytes32(0) : _opOf(alice);
        vm.prank(analyzer);
        if (tier > 3) {
            vm.expectRevert(abi.encodeWithSelector(PayerAttestations.TierOutOfRange.selector, tier));
            reg.attest(alice, _verdict(tier, op));
        } else {
            reg.attest(alice, _verdict(tier, op));
            assertEq(reg.tierOf(alice, analyzer), tier);
        }
    }

    function test_attest_unclearMustHaveZeroOperator() public {
        vm.prank(analyzer);
        vm.expectRevert(abi.encodeWithSelector(PayerAttestations.OperatorIdMismatch.selector, uint8(0), _opOf(alice)));
        reg.attest(alice, _verdict(0, _opOf(alice)));
    }

    function test_attest_nonUnclearNeedsOperator() public {
        vm.prank(analyzer);
        vm.expectRevert(abi.encodeWithSelector(PayerAttestations.OperatorIdMismatch.selector, uint8(2), bytes32(0)));
        reg.attest(alice, _verdict(2, bytes32(0)));
    }

    function test_attest_revertsBadExpiry() public {
        PayerAttestations.Verdict memory v = _verdict(2, _opOf(alice));
        v.expiresAt = v.issuedAt;
        vm.prank(analyzer);
        vm.expectRevert(abi.encodeWithSelector(PayerAttestations.InvalidExpiry.selector, v.issuedAt, v.expiresAt));
        reg.attest(alice, v);
    }

    function test_attest_revertsZeroWallet() public {
        vm.prank(analyzer);
        vm.expectRevert(PayerAttestations.ZeroWallet.selector);
        reg.attest(address(0), _verdict(2, _opOf(alice)));
    }

    // ---------- reads ----------

    function test_tierOf_missingIsUnclear() public view {
        assertEq(reg.tierOf(alice, analyzer), 0);
    }

    function test_tierOf_expiredIsUnclear() public {
        vm.prank(analyzer);
        reg.attest(alice, _verdict(2, _opOf(alice)));
        vm.warp(block.timestamp + TTL - 1);
        assertEq(reg.tierOf(alice, analyzer), 2);
        vm.warp(block.timestamp + 1);
        assertEq(reg.tierOf(alice, analyzer), 0);
        // the raw verdict is still readable
        assertEq(reg.verdictOf(alice, analyzer).tier, 2);
    }

    function test_attestorIsolation() public {
        vm.prank(analyzer);
        reg.attest(alice, _verdict(1, _opOf(funder)));
        vm.prank(otherAttestor);
        reg.attest(alice, _verdict(2, _opOf(alice)));

        assertEq(reg.tierOf(alice, analyzer), 1);
        assertEq(reg.tierOf(alice, otherAttestor), 2);
        assertEq(reg.verdictOf(alice, analyzer).operatorId, _opOf(funder));
    }

    function test_sameOperator() public {
        vm.startPrank(analyzer);
        reg.attest(alice, _verdict(1, _opOf(funder)));
        reg.attest(bob, _verdict(1, _opOf(funder)));
        reg.attest(carol, _verdict(2, _opOf(carol)));
        vm.stopPrank();

        assertTrue(reg.sameOperator(alice, bob, analyzer));
        assertFalse(reg.sameOperator(alice, carol, analyzer));
        // another attestor has no verdicts, so nothing is the same operator there
        assertFalse(reg.sameOperator(alice, bob, otherAttestor));
    }

    function test_sameOperator_falseWhenExpiredOrUnclear() public {
        vm.startPrank(analyzer);
        reg.attest(alice, _verdict(1, _opOf(funder)));
        reg.attest(bob, _verdict(1, _opOf(funder)));
        reg.attest(carol, _verdict(0, bytes32(0)));
        vm.stopPrank();
        assertFalse(reg.sameOperator(carol, carol, analyzer));
        vm.warp(block.timestamp + TTL);
        assertFalse(reg.sameOperator(alice, bob, analyzer));
    }

    // ---------- batch ----------

    function test_attestBatch_thirteenWallets() public {
        address[] memory wallets = new address[](13);
        PayerAttestations.Verdict[] memory vs = new PayerAttestations.Verdict[](13);
        for (uint256 i; i < 13; ++i) {
            wallets[i] = address(uint160(0x1000 + i));
            vs[i] = i < 10 ? _verdict(1, _opOf(funder)) : _verdict(2, _opOf(wallets[i]));
        }
        vm.prank(analyzer);
        uint256 gasBefore = gasleft();
        reg.attestBatch(wallets, vs);
        emit log_named_uint("gas: attestBatch(13)", gasBefore - gasleft());

        for (uint256 i; i < 13; ++i) {
            assertEq(reg.tierOf(wallets[i], analyzer), i < 10 ? 1 : 2);
        }
        assertTrue(reg.sameOperator(wallets[0], wallets[9], analyzer));
        assertFalse(reg.sameOperator(wallets[10], wallets[11], analyzer));
    }

    function test_attestBatch_lengthMismatch() public {
        address[] memory wallets = new address[](2);
        PayerAttestations.Verdict[] memory vs = new PayerAttestations.Verdict[](1);
        vm.expectRevert(abi.encodeWithSelector(PayerAttestations.LengthMismatch.selector, 2, 1));
        reg.attestBatch(wallets, vs);
    }

    function test_attestBatch_atomicOnBadEntry() public {
        address[] memory wallets = new address[](2);
        PayerAttestations.Verdict[] memory vs = new PayerAttestations.Verdict[](2);
        wallets[0] = alice;
        wallets[1] = bob;
        vs[0] = _verdict(2, _opOf(alice));
        vs[1] = _verdict(9, _opOf(bob));
        vm.prank(analyzer);
        vm.expectRevert(abi.encodeWithSelector(PayerAttestations.TierOutOfRange.selector, uint8(9)));
        reg.attestBatch(wallets, vs);
        assertEq(reg.tierOf(alice, analyzer), 0);
    }

    // ---------- gate ----------

    function test_gate_rejectsLinkedAllowsIndependent() public {
        PromoVault vault = new PromoVault(reg, analyzer);
        uint8 mask = vault.ALLOWED();
        vm.startPrank(analyzer);
        reg.attest(alice, _verdict(1, _opOf(funder)));
        reg.attest(carol, _verdict(2, _opOf(carol)));
        vm.stopPrank();

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArgusGate.TierNotAllowed.selector, alice, uint8(1), mask));
        vault.claim();

        vm.prank(carol);
        vault.claim();
        assertEq(vault.claims(), 1);
    }

    function test_gate_rejectsUnknownAndExpired() public {
        PromoVault vault = new PromoVault(reg, analyzer);
        uint8 mask = vault.ALLOWED();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ArgusGate.TierNotAllowed.selector, bob, uint8(0), mask));
        vault.claim();

        vm.prank(analyzer);
        reg.attest(carol, _verdict(2, _opOf(carol)));
        vm.warp(block.timestamp + TTL);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(ArgusGate.TierNotAllowed.selector, carol, uint8(0), mask));
        vault.claim();
    }

    function test_gate_ignoresUntrustedAttestor() public {
        PromoVault vault = new PromoVault(reg, analyzer);
        uint8 mask = vault.ALLOWED();
        vm.prank(otherAttestor);
        reg.attest(alice, _verdict(2, _opOf(alice)));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ArgusGate.TierNotAllowed.selector, alice, uint8(0), mask));
        vault.claim();
    }
}
