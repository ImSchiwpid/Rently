// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

/// @title RentalVault
/// @notice ETH rental escrow with mutual confirmations and binding arbitration.
/// @dev Prototype only. Dispute evidence is an off-chain reference hash.
contract RentalVault {
    uint64 public constant ARBITRATOR_WAIT = 7 days;

    enum State {
        Created,
        Funded,
        HandoverPending,
        Active,
        ReturnPending,
        Disputed,
        Completed,
        Cancelled,
        Expired,
        Resolved
    }

    struct Agreement {
        address owner;
        address renter;
        uint256 rent;
        uint256 deposit;
        uint256 escrowRemaining;
        uint64 fundingDeadline;
        uint64 handoverNotBefore;
        uint64 handoverDeadline;
        uint64 rentalDuration;
        uint64 returnGracePeriod;
        uint64 handoverAt;
        uint64 rentalEnd;
        uint64 returnDeadline;
        uint64 disputeOpenedAt;
        uint256 proposedDeduction;
        bytes32 disputeEvidenceHash;
        State state;
        bool ownerHandoverConfirmed;
        bool renterHandoverConfirmed;
        bool ownerReturnConfirmed;
        bool renterReturnConfirmed;
        bool renterAcceptedDeduction;
        bool ownerCancelConsent;
        bool renterCancelConsent;
    }

    address public immutable primaryArbitrator;
    address public immutable backupArbitrator;
    uint256 public nextAgreementId = 1;
    uint256 public totalEscrow;
    uint256 public totalCredits;
    mapping(uint256 => Agreement) private agreements;
    mapping(address => uint256) public credits;

    uint256 private entered = 1;

    event AgreementCreated(uint256 indexed agreementId, address indexed owner, address indexed renter, uint256 rent, uint256 deposit);
    event AgreementFunded(uint256 indexed agreementId, uint256 amount);
    event HandoverConfirmed(uint256 indexed agreementId, address indexed party, uint64 confirmedAt);
    event RentalActivated(uint256 indexed agreementId, uint64 rentalStart, uint64 rentalEnd, uint64 returnDeadline, uint256 ownerRentCredit);
    event ReturnConfirmed(uint256 indexed agreementId, address indexed party, uint256 proposedDeduction);
    event DeductionAccepted(uint256 indexed agreementId, uint256 amount);
    event DisputeOpened(uint256 indexed agreementId, address indexed party, bytes32 evidenceHash, uint64 openedAt);
    event AgreementCancelled(uint256 indexed agreementId, bool funded);
    event CancellationConsentRecorded(uint256 indexed agreementId, address indexed party);
    event AgreementExpired(uint256 indexed agreementId);
    event AgreementSettled(uint256 indexed agreementId, uint256 ownerAmount, uint256 renterAmount, State finalState);
    event CreditWithdrawn(address indexed account, uint256 amount);

    modifier nonReentrant() {
        require(entered == 1, "reentrant call");
        entered = 2;
        _;
        entered = 1;
    }

    constructor(address primary, address backup) {
        require(primary != address(0) && backup != address(0), "zero arbitrator");
        require(primary != backup, "arbitrators must differ");
        primaryArbitrator = primary;
        backupArbitrator = backup;
    }

    function createAgreement(
        address renter,
        uint256 rent,
        uint256 deposit,
        uint64 fundingDeadline,
        uint64 handoverNotBefore,
        uint64 handoverDeadline,
        uint64 rentalDuration,
        uint64 returnGracePeriod
    ) external returns (uint256 id) {
        require(renter != address(0) && renter != msg.sender, "invalid renter");
        require(renter != primaryArbitrator && renter != backupArbitrator, "arbitrator is party");
        require(msg.sender != primaryArbitrator && msg.sender != backupArbitrator, "arbitrator is party");
        require(rent > 0 && deposit > 0, "amounts must be positive");
        require(fundingDeadline > block.timestamp, "funding deadline passed");
        // Handover window must end after funding and start before or at deadline
        require(handoverDeadline > block.timestamp, "handover deadline passed");
        require(handoverDeadline >= handoverNotBefore && handoverDeadline >= fundingDeadline, "invalid handover window");
        require(rentalDuration > 0, "duration must be positive");
        require(uint256(block.timestamp) + rentalDuration + returnGracePeriod <= type(uint64).max, "duration overflow");

        id = nextAgreementId++;
        Agreement storage a = agreements[id];
        a.owner = msg.sender;
        a.renter = renter;
        a.rent = rent;
        a.deposit = deposit;
        a.fundingDeadline = fundingDeadline;
        a.handoverNotBefore = handoverNotBefore;
        a.handoverDeadline = handoverDeadline;
        a.rentalDuration = rentalDuration;
        a.returnGracePeriod = returnGracePeriod;
        a.state = State.Created;

        emit AgreementCreated(id, msg.sender, renter, rent, deposit);
    }

    function getAgreement(uint256 id) external view returns (Agreement memory) {
        require(agreements[id].owner != address(0), "unknown agreement");
        return agreements[id];
    }

    function fund(uint256 id) external payable {
        Agreement storage a = _agreement(id);
        require(msg.sender == a.renter, "only renter");
        require(a.state == State.Created, "invalid state");
        require(block.timestamp <= a.fundingDeadline, "funding deadline passed");
        require(msg.value == a.rent + a.deposit, "incorrect funding amount");
        a.escrowRemaining = msg.value;
        a.state = State.Funded;
        totalEscrow += msg.value;
        emit AgreementFunded(id, msg.value);
    }

    function confirmHandover(uint256 id) external {
        Agreement storage a = _agreement(id);
        require(msg.sender == a.owner || msg.sender == a.renter, "only participant");
        require(a.state == State.Funded || a.state == State.HandoverPending, "invalid state");
        require(block.timestamp >= a.handoverNotBefore && block.timestamp <= a.handoverDeadline, "outside handover window");

        if (msg.sender == a.owner) {
            require(!a.ownerHandoverConfirmed, "already confirmed");
            a.ownerHandoverConfirmed = true;
        } else {
            require(!a.renterHandoverConfirmed, "already confirmed");
            a.renterHandoverConfirmed = true;
        }
        emit HandoverConfirmed(id, msg.sender, uint64(block.timestamp));

        if (a.ownerHandoverConfirmed && a.renterHandoverConfirmed) {
            a.handoverAt = uint64(block.timestamp);
            a.rentalEnd = uint64(block.timestamp + a.rentalDuration);
            a.returnDeadline = uint64(uint256(a.rentalEnd) + a.returnGracePeriod);
            a.state = State.Active;
            a.escrowRemaining -= a.rent;
            totalEscrow -= a.rent;
            credits[a.owner] += a.rent;
            totalCredits += a.rent;
            emit RentalActivated(id, a.handoverAt, a.rentalEnd, a.returnDeadline, a.rent);
        } else {
            a.state = State.HandoverPending;
        }
    }

    function confirmReturn(uint256 id) external {
        Agreement storage a = _agreement(id);
        require(msg.sender == a.renter, "only renter");
        require(a.state == State.Active || a.state == State.ReturnPending, "invalid state");
        require(!a.renterReturnConfirmed, "already confirmed");
        a.renterReturnConfirmed = true;
        a.state = State.ReturnPending;
        emit ReturnConfirmed(id, msg.sender, a.proposedDeduction);
        _completeIfAgreed(id, a);
    }

    function confirmReturnAndProposeDeduction(uint256 id, uint256 deduction) external {
        Agreement storage a = _agreement(id);
        require(msg.sender == a.owner, "only owner");
        require(a.state == State.Active || a.state == State.ReturnPending, "invalid state");
        require(!a.ownerReturnConfirmed, "already confirmed");
        require(deduction <= a.deposit, "deduction exceeds deposit");
        a.ownerReturnConfirmed = true;
        a.proposedDeduction = deduction;
        a.renterAcceptedDeduction = false;
        a.state = State.ReturnPending;
        emit ReturnConfirmed(id, msg.sender, deduction);
        _completeIfAgreed(id, a);
    }

    function acceptDeduction(uint256 id, uint256 exactAmount) external {
        Agreement storage a = _agreement(id);
        require(msg.sender == a.renter, "only renter");
        require(a.state == State.ReturnPending && a.ownerReturnConfirmed && a.renterReturnConfirmed, "return not mutually confirmed");
        require(exactAmount == a.proposedDeduction, "amount mismatch");
        require(!a.renterAcceptedDeduction, "already accepted");
        a.renterAcceptedDeduction = true;
        emit DeductionAccepted(id, exactAmount);
        _completeIfAgreed(id, a);
    }

    function cancelBeforeFunding(uint256 id) external {
        Agreement storage a = _agreement(id);
        require(msg.sender == a.owner || msg.sender == a.renter, "only participant");
        require(a.state == State.Created, "invalid state");
        a.state = State.Cancelled;
        emit AgreementCancelled(id, false);
    }

    function consentToFundedCancellation(uint256 id) external {
        Agreement storage a = _agreement(id);
        require(msg.sender == a.owner || msg.sender == a.renter, "only participant");
        require(a.state == State.Funded || a.state == State.HandoverPending, "invalid state");
        require(!a.ownerHandoverConfirmed && !a.renterHandoverConfirmed, "handover already started");
        if (msg.sender == a.owner) {
            require(!a.ownerCancelConsent, "already consented");
            a.ownerCancelConsent = true;
        } else {
            require(!a.renterCancelConsent, "already consented");
            a.renterCancelConsent = true;
        }
        emit CancellationConsentRecorded(id, msg.sender);
        if (a.ownerCancelConsent && a.renterCancelConsent) {
            uint256 amount = a.escrowRemaining;
            a.escrowRemaining = 0;
            a.state = State.Cancelled;
            totalEscrow -= amount;
            credits[a.renter] += amount;
            totalCredits += amount;
            emit AgreementCancelled(id, true);
            emit AgreementSettled(id, 0, amount, State.Cancelled);
        }
    }

    function expireUnfunded(uint256 id) external {
        Agreement storage a = _agreement(id);
        require(a.state == State.Created, "invalid state");
        require(block.timestamp > a.fundingDeadline, "funding deadline not passed");
        a.state = State.Expired;
        emit AgreementExpired(id);
    }

    function openDispute(uint256 id, bytes32 evidenceHash) external {
        Agreement storage a = _agreement(id);
        require(msg.sender == a.owner || msg.sender == a.renter, "only participant");
        require(a.state == State.Funded || a.state == State.HandoverPending || a.state == State.Active || a.state == State.ReturnPending, "invalid state");
        require(evidenceHash != bytes32(0), "evidence hash required");
        if (a.state == State.Funded || a.state == State.HandoverPending) {
            require(
                block.timestamp > a.handoverDeadline ||
                    a.ownerHandoverConfirmed != a.renterHandoverConfirmed ||
                    a.ownerCancelConsent != a.renterCancelConsent,
                "no unresolved handover conflict"
            );
        } else {
            require(block.timestamp > a.returnDeadline || a.state == State.ReturnPending, "no unresolved return conflict");
        }
        a.state = State.Disputed;
        a.disputeOpenedAt = uint64(block.timestamp);
        a.disputeEvidenceHash = evidenceHash;
        emit DisputeOpened(id, msg.sender, evidenceHash, a.disputeOpenedAt);
    }

    function arbitrate(uint256 id, uint256 ownerAmount, uint256 renterAmount) external {
        Agreement storage a = _agreement(id);
        require(a.state == State.Disputed, "invalid state");
        bool primaryWindow = block.timestamp <= uint256(a.disputeOpenedAt) + ARBITRATOR_WAIT;
        require(primaryWindow ? msg.sender == primaryArbitrator : msg.sender == backupArbitrator, "not authorized arbitrator");
        require(ownerAmount + renterAmount == a.escrowRemaining, "allocation must equal escrow");
        uint256 total = a.escrowRemaining;
        a.escrowRemaining = 0;
        a.state = State.Resolved;
        totalEscrow -= total;
        credits[a.owner] += ownerAmount;
        credits[a.renter] += renterAmount;
        totalCredits += total;
        emit AgreementSettled(id, ownerAmount, renterAmount, State.Resolved);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0 && amount <= credits[msg.sender], "invalid withdrawal");
        credits[msg.sender] -= amount;
        totalCredits -= amount;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "withdrawal failed");
        emit CreditWithdrawn(msg.sender, amount);
    }

    function _completeIfAgreed(uint256 id, Agreement storage a) private {
        if (a.ownerReturnConfirmed && a.renterReturnConfirmed && a.renterAcceptedDeduction) {
            uint256 deduction = a.proposedDeduction;
            uint256 renterAmount = a.escrowRemaining - deduction;
            a.escrowRemaining = 0;
            a.state = State.Completed;
            totalEscrow -= a.deposit;
            credits[a.owner] += deduction;
            credits[a.renter] += renterAmount;
            totalCredits += a.deposit;
            emit AgreementSettled(id, deduction, renterAmount, State.Completed);
        }
    }

    function _agreement(uint256 id) private view returns (Agreement storage a) {
        a = agreements[id];
        require(a.owner != address(0), "unknown agreement");
    }

    receive() external payable {
        revert("use fund");
    }

    fallback() external payable {
        revert("unsupported call");
    }
}
