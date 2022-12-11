// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

contract Escrow {
    struct ContractDetails {
        address requestor;
        address contractor;
        uint256 payoutPerMessage;
        uint16 contractedMessageCount;
        uint16 fulfilledMessageCount;
    }

    mapping(address => bytes32[]) public activeContracts;
    mapping(bytes32 => ContractDetails) public contractLookup;
    mapping(address => uint256) public withdrawalAmount;
    address public owner;
    uint8 private maxOpenContracts;
    uint16 public platformFee;

    //the platform fee is in basis points so divide by 10k to get the percentage value
    //same way the max open contracts cannot be larger than 255
    constructor(uint16 _platformFee, uint8 _maxOpenContracts) {
        owner = msg.sender;
        platformFee = _platformFee;
        maxOpenContracts = _maxOpenContracts;
    }

    function createContract(
        address contractor,
        bytes32 contractHash,
        uint256 payoutPerMessage,
        uint16 contractedMessageCount
    ) public payable {
        require(
            contractLookup[contractHash].requestor == address(0),
            "A contract with the supplied Hash already exists!"
        );
        require(
            activeContracts[msg.sender].length < maxOpenContracts,
            "Too many active contracts for Requestor!"
        );
        require(
            activeContracts[contractor].length < maxOpenContracts,
            "Too many active contracts for Contractor!"
        );
        require(msg.sender != contractor, "Can't create a job for yourself");
        require(
            msg.value >=
                calculateRequiredPayment(
                    payoutPerMessage,
                    contractedMessageCount
                ),
            "Payment insufficient to cover contract costs!"
        );

        activeContracts[msg.sender].push(contractHash);
        activeContracts[contractor].push(contractHash);
        contractLookup[contractHash] = ContractDetails({
            requestor: msg.sender,
            contractor: contractor,
            payoutPerMessage: payoutPerMessage,
            contractedMessageCount: contractedMessageCount,
            fulfilledMessageCount: 0
        });
    }

    function getActiveContracts(
        address userId
    ) public view returns (bytes32[] memory retval) {
        retval = activeContracts[userId];
    }

    function finalizeContract(bytes32 contractHash) public {
        require(
            contractLookup[contractHash].requestor != address(0),
            "The contract requested doesn't exist"
        );

        ContractDetails memory details = getContractDetailsIfInvolved(contractHash);

        withdrawalAmount[details.requestor] +=
            (details.contractedMessageCount - details.fulfilledMessageCount) *
            details.payoutPerMessage;

        if (details.contractor != address(0)) {
            withdrawalAmount[details.contractor] +=
                details.fulfilledMessageCount *
                details.payoutPerMessage;
            removeHash(contractHash, details.contractor);
        }

        removeHash(contractHash, details.requestor);
    }

    //this function is a placeholder
    function verifyMessages(bytes32 contractHash, uint16 verifyCount) public  {
        ContractDetails storage details = getContractDetailsIfInvolved(contractHash);
        details.fulfilledMessageCount += verifyCount; //dangerous
    } 

     function getContractDetailsIfInvolved(bytes32 contractHash) private view returns(ContractDetails storage details) {
        details = contractLookup[contractHash];
        require(
            msg.sender == details.requestor || msg.sender == details.contractor,
            "The sender is not involved in this contract!"
        );
    }

    function removeHash(bytes32 contractId, address userId) private {
        bytes32[] storage list = activeContracts[userId];
        (bool found, uint8 idx) = findIdx(list, contractId);

        if (found) {
            uint8 lastIdx = uint8(list.length - 1);

            if (idx != lastIdx) {
                list[idx] = list[lastIdx];
            }

            list.pop();
        }

        if (list.length == 0) {
            delete activeContracts[userId];
        }

        delete contractLookup[contractId];
    }

    function findIdx(
        bytes32[] storage list,
        bytes32 searchTerm
    ) private view returns (bool, uint8) {
        for (uint8 i = 0; i < list.length; i++) {
            if (list[i] == searchTerm) {
                return (true, i);
            }
        }

        return (false, 0);
    }

    function calculateRequiredPayment(
        uint256 payoutPerMessage,
        uint16 contractedMessageCount
    ) public view returns (uint256) {
        uint256 contractCost = payoutPerMessage * contractedMessageCount;
        uint256 fee = (contractCost * platformFee) / 10000;
        return contractCost + fee;
    }

    function changePlatformFee(uint16 _platformFee) public onlyOwner {
        platformFee = _platformFee;
    }

    modifier onlyOwner() {
        require(
            msg.sender == owner,
            "Only the smart contract's owner is allowed run this operation"
        );
        _;
    }
}
