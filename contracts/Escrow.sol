// SPDX-License-Identifier: MIT
pragma solidity >=0.7.0 <0.9.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Escrow is Ownable, AccessControl {
 
    struct ContractDetails {
        address requestor;
        address contractor;
        uint256 payoutPerMessage;
        uint256 canBeClosedAfterEpoch;
        uint16 contractedMessageCount;
        uint16 fulfilledMessageCount;
        uint8 partiesFinalized;
    }

    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER");

    mapping(address => bytes32[]) public activeContracts;
    mapping(bytes32 => ContractDetails) public contractLookup;
    mapping(address => uint256) public withdrawalAmount;
    mapping(bytes32 => mapping(bytes32 => uint16)) preApprovedMessages;

    uint32 constant contractClosingOffset = 604800;
    uint16 public platformFee;
    uint8 private maxOpenContracts;

    //the platform fee is in basis points so divide by 10k to get the percentage value
    //same way the max open contracts cannot be larger than 255
    constructor(uint16 _platformFee, uint8 _maxOpenContracts) {
        platformFee = _platformFee;
        maxOpenContracts = _maxOpenContracts;
    }

    function createContract(
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
            msg.value >=
                calculateRequiredPayment(
                    payoutPerMessage,
                    contractedMessageCount
                ),
            "Payment insufficient to cover contract costs!"
        );

        activeContracts[msg.sender].push(contractHash);
        
        contractLookup[contractHash] = ContractDetails({
            requestor: msg.sender,
            contractor: address(0),
            payoutPerMessage: payoutPerMessage,
            canBeClosedAfterEpoch: 0,
            contractedMessageCount: contractedMessageCount,
            fulfilledMessageCount: 0,
            partiesFinalized: 0
        });
    }

    function setContractor(bytes32 contractHash, address contractor) public {
        require(contractor != address(0) && contractor != msg.sender, "Invalid contractor address specified");
        ContractDetails storage details = getContractDetailsIfRequestor(contractHash);
        require(details.contractor == address(0), "Cannot assign a contract multiple times!");

        activeContracts[contractor].push(contractHash);
        details.contractor = contractor;
    }

    function setVerifier(address verifier) public onlyOwner {
        _grantRole(VERIFIER_ROLE, verifier);
    }

    function getActiveContracts(
        address userId
    ) public view returns (bytes32[] memory retval) {
        retval = activeContracts[userId];
    }

    function finalizeContract(bytes32 contractHash) public {
        ContractDetails storage details = getContractDetailsIfInvolved(contractHash);

        if (msg.sender == details.requestor) {
            details.partiesFinalized |= 1;
        } else {
            details.partiesFinalized |= 2;
        }
    }

    function closeContract(bytes32 contractHash) public {
        require(
            contractLookup[contractHash].requestor != address(0),
            "The contract requested doesn't exist"
        );

        ContractDetails storage details = getContractDetailsIfInvolved(contractHash);

        if(!canCloseContract(details))
            return;
  
        withdrawalAmount[details.requestor] +=
            (details.contractedMessageCount - details.fulfilledMessageCount) *
            details.payoutPerMessage;

        address requestor = details.requestor;

        if (details.contractor != address(0)) {
            withdrawalAmount[details.contractor] +=
                details.fulfilledMessageCount *
                details.payoutPerMessage;
            removeHash(contractHash, details.contractor);
        }

        removeHash(contractHash, requestor);
    }

    function canCloseContract(ContractDetails storage details) private returns(bool) {
        address contractor = details.contractor;
        bool isContractor = msg.sender == contractor;
        uint closingTime = details.canBeClosedAfterEpoch;

        if (details.partiesFinalized == 3 
            || contractor == address(0)
            || (isContractor && details.partiesFinalized & 1 == 1)
            || (!isContractor && details.partiesFinalized & 2 == 2)
            || (closingTime > 0 && closingTime <= block.timestamp))
            return true;


        details.canBeClosedAfterEpoch = block.timestamp + contractClosingOffset;
        return false;
    }

    function addPreApprovedMessages(bytes32 contractHash, bytes32[] memory msgHashes, uint16[] memory msgCounts) public {
        getContractDetailsIfRequestor(contractHash);
        require(msgHashes.length == msgCounts.length, "The two arrays need to be the same length");

        for (uint i = 0; i < msgHashes.length; i++) {
            preApprovedMessages[contractHash][msgHashes[i]] += msgCounts[i];
        }
    }

    function verifyMessages(bytes32 contractHash, bytes32[] memory msgHashes, uint16[] memory msgCounts) public onlyRole(VERIFIER_ROLE) {
        ContractDetails storage details = contractLookup[contractHash];
        require(msgHashes.length == msgCounts.length, "The two arrays need to be the same length");

        for (uint i = 0; i < msgHashes.length; i++) {
            uint16 outstandingMsgCnt = details.contractedMessageCount - details.fulfilledMessageCount;
            uint16 preApprCnt = preApprovedMessages[contractHash][msgHashes[i]];
            uint16 verifiedCnt = min(min(preApprCnt, outstandingMsgCnt), msgCounts[i]); 
            details.fulfilledMessageCount += verifiedCnt;
            preApprovedMessages[contractHash][msgHashes[i]] -= 
            details.fulfilledMessageCount == details.contractedMessageCount 
            ? preApprCnt 
            : verifiedCnt; 
        } 
    }

    function min(uint16 first, uint16 second) private pure returns(uint16) {
        return first <= second ? first : second;
    } 

    function getContractDetailsIfInvolved(bytes32 contractHash) private view returns(ContractDetails storage details) {
        details = contractLookup[contractHash];
        require(
            msg.sender == details.requestor || msg.sender == details.contractor,
            "The sender is not involved in this contract!"
        );
    }

     function getContractDetailsIfRequestor(bytes32 contractHash) private view returns(ContractDetails storage details) {
        details = contractLookup[contractHash];
        require(
            msg.sender == details.requestor,
            "Only the contract's requestor may run this operation!"
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

}
