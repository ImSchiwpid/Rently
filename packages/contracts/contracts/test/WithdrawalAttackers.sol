// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

interface IRentalVaultWithdraw {
    function withdraw(uint256 amount) external;
    function fund(uint256 id) external payable;
    function cancelBeforeFunding(uint256 id) external;
    function consentToFundedCancellation(uint256 id) external;
}

contract RejectingReceiver {
    function fund(address vault, uint256 id) external payable {
        IRentalVaultWithdraw(vault).fund{value: msg.value}(id);
    }

    function cancelBeforeFunding(address vault, uint256 id) external {
        IRentalVaultWithdraw(vault).cancelBeforeFunding(id);
    }

    function consentToFundedCancellation(address vault, uint256 id) external {
        IRentalVaultWithdraw(vault).consentToFundedCancellation(id);
    }

    function withdrawFrom(address vault, uint256 amount) external {
        IRentalVaultWithdraw(vault).withdraw(amount);
    }

    receive() external payable {
        revert("reject ether");
    }
}

contract ReenteringReceiver {
    address public vault;
    uint256 public amount;

    function fund(address target, uint256 id) external payable {
        IRentalVaultWithdraw(target).fund{value: msg.value}(id);
    }

    function cancelBeforeFunding(address target, uint256 id) external {
        IRentalVaultWithdraw(target).cancelBeforeFunding(id);
    }

    function consentToFundedCancellation(address target, uint256 id) external {
        IRentalVaultWithdraw(target).consentToFundedCancellation(id);
    }

    function withdrawFrom(address target, uint256 value) external {
        vault = target;
        amount = value;
        IRentalVaultWithdraw(target).withdraw(value);
    }

    receive() external payable {
        IRentalVaultWithdraw(vault).withdraw(amount);
    }
}
