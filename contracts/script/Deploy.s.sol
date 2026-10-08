// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PayerAttestations} from "../src/PayerAttestations.sol";

/// forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_KEY
contract Deploy is Script {
    function run() external returns (PayerAttestations reg) {
        vm.startBroadcast();
        reg = new PayerAttestations();
        vm.stopBroadcast();
        console.log("PayerAttestations deployed at", address(reg), "on chain", block.chainid);
    }
}
