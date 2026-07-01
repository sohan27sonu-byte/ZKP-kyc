// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgeVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[6] calldata _pubSignals
    ) external view returns (bool);
}

interface IResidencyVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[3] calldata _pubSignals
    ) external view returns (bool);
}

contract PrivacyKYC {
    IAgeVerifier public immutable ageVerifier;
    IResidencyVerifier public immutable residencyVerifier;

    mapping(bytes32 => bool) public verifiedCommitments;
    mapping(bytes32 => uint256) public commitmentExpiry;
    mapping(address => bytes32) public ageCommitment;
    mapping(address => bytes32) public residencyCommitment;

    uint256 public constant KYC_VALIDITY = 365 days;

    event AgeKYCVerified(address indexed user, bytes32 indexed commitment, uint256 expiry);
    event ResidencyKYCVerified(address indexed user, bytes32 indexed commitment, uint256 expiry);
    event KYCRevoked(address indexed user);

    constructor(address _ageVerifier, address _residencyVerifier) {
        ageVerifier = IAgeVerifier(_ageVerifier);
        residencyVerifier = IResidencyVerifier(_residencyVerifier);
    }

    function verifyAgeProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[6] calldata input
    ) external returns (bool) {
        require(input[4] == 18, "Age threshold must be 18");
        require(ageVerifier.verifyProof(a, b, c, input), "Invalid age proof");

        bytes32 commitment = bytes32(input[5]);
        verifiedCommitments[commitment] = true;
        commitmentExpiry[commitment] = block.timestamp + KYC_VALIDITY;
        ageCommitment[msg.sender] = commitment;

        emit AgeKYCVerified(msg.sender, commitment, block.timestamp + KYC_VALIDITY);
        return true;
    }

    function verifyResidencyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[3] calldata input
    ) external returns (bool) {
        require(input[0] == 91, "Must be India country code");
        require(residencyVerifier.verifyProof(a, b, c, input), "Invalid residency proof");

        bytes32 commitment = bytes32(input[2]);
        verifiedCommitments[commitment] = true;
        commitmentExpiry[commitment] = block.timestamp + KYC_VALIDITY;
        residencyCommitment[msg.sender] = commitment;

        emit ResidencyKYCVerified(msg.sender, commitment, block.timestamp + KYC_VALIDITY);
        return true;
    }

    function isKYCVerified(address user) external view returns (bool) {
        bytes32 commit = ageCommitment[user];
        if (commit == bytes32(0)) return false;
        if (!verifiedCommitments[commit]) return false;
        return block.timestamp <= commitmentExpiry[commit];
    }

    function getKYCDetails(address user) external view returns (
        bool hasAge,
        bool hasResidency,
        uint256 expiry
    ) {
        bytes32 aCommit = ageCommitment[user];
        bytes32 rCommit = residencyCommitment[user];

        hasAge = aCommit != bytes32(0) &&
                 verifiedCommitments[aCommit] &&
                 block.timestamp <= commitmentExpiry[aCommit];

        hasResidency = rCommit != bytes32(0) &&
                       verifiedCommitments[rCommit] &&
                       block.timestamp <= commitmentExpiry[rCommit];

        expiry = aCommit != bytes32(0) ? commitmentExpiry[aCommit] : 0;
    }

    function revokeMyKYC() external {
        bytes32 aCommit = ageCommitment[msg.sender];
        bytes32 rCommit = residencyCommitment[msg.sender];

        if (aCommit != bytes32(0)) {
            verifiedCommitments[aCommit] = false;
            delete ageCommitment[msg.sender];
        }
        if (rCommit != bytes32(0)) {
            verifiedCommitments[rCommit] = false;
            delete residencyCommitment[msg.sender];
        }

        emit KYCRevoked(msg.sender);
    }
}