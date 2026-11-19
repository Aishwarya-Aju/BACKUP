
namespace dc;

using { cuid, managed } from '@sap/cds/common';

type ClaimStatus : String(30) enum {
    Draft;
    Submitted;
    UnderWarrantyReview;
    InformationRequested;
    UnderTechnicalReview;
    UnderFinanceReview;
    Approved;
    Rejected;
    Settled;
    Cancelled;
}

type LineStatus : String(10) enum {
    Pending;
    Approved;
    Rejected;
}

type ReviewStage : String(20) enum {
    WarrantyReview;
    TechnicalReview;
    FinanceReview;
}

type TaskStatus : String(15) enum {
    Open;
    Completed;
    Cancelled;
}

type DecisionType : String(25) enum {
    Accepted;
    Approved;
    Rejected;
    InformationRequested;
}

type DocumentType : String(20) enum {
    RepairInvoice;
    Photo;
    DiagnosticReport;
    RepairOrder;
    Other;
}

type VerificationStatus : String(10) enum {
    Pending;
    Verified;
    Rejected;
}

type PaymentStatus : String(10) enum {
    Pending;
    Paid;
    Failed;
}

type CoverageType : String(10) enum {
    Part;
    Labour;
    Category;
}

@assert.unique: { dealerCode: [dealerCode] }
entity Dealers : cuid, managed {
    dealerCode : String(20) @mandatory;
    dealerName : String(100) @mandatory;
    email      : String(100) @assert.format: '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$';
    phone      : String(20);
    address    : String(300);
    city       : String(50);
    isActive   : Boolean default true;
}

@assert.unique: { policyCode: [policyCode] }
entity WarrantyPolicies : cuid, managed {
    policyCode          : String(20) @mandatory;
    policyName          : String(100);

    coverageMonths      : Integer @mandatory;
    maxKilometers       : Integer @mandatory;
    claimSubmissionDays : Integer @mandatory;

    labourRate          : Decimal(10,2);
    maxClaimAmount      : Decimal(12,2);

    currency            : String(3) default 'INR';
    isActive            : Boolean default true;

    coverages : Composition of many WarrantyPolicyCoverages
        on coverages.policy = $self;
}

@assert.unique: { vin: [VIN] }
entity Vehicles : cuid, managed {
    VIN             : String(17) @mandatory;
    registrationNo  : String(20);

    make            : String(50);
    model           : String(50);

    saleDate        : Date @mandatory;
    currentOdometer : Integer;

    dealer          : Association to Dealers @mandatory;
    warrantyPolicy  : Association to WarrantyPolicies;

    isActive        : Boolean default true;
}

@assert.unique: { partNumber: [partNumber] }
entity PartMasters : cuid, managed {
    partNumber        : String(50) @mandatory;
    partDescription   : String(300);

    category          : Association to ClaimCategories;

    standardUnitPrice : Decimal(10,2);
    currency          : String(3) default 'INR';

    validFrom         : Date;
    validTo           : Date;

    isActive          : Boolean default true;
}


@assert.unique: { operationCode: [operationCode] }
entity LabourOperationMasters : cuid, managed {
    operationCode        : String(30) @mandatory;
    operationDescription : String(300);
    category             : Association to ClaimCategories;
    standardHours        : Decimal(6,2);
    standardHourlyRate   : Decimal(10,2);
    isActive             : Boolean default true;
}

entity WarrantyPolicyCoverages : cuid, managed {
    policy            : Association to WarrantyPolicies;
    @assert.range
    coverageType      : CoverageType;
    category          : Association to ClaimCategories;
    partMaster        : Association to PartMasters;
    labourOperation   : Association to LabourOperationMasters;
    isCovered         : Boolean default true;
    maxCoverageAmount : Decimal(12,2);
    exclusions        : String(1000);
}


@assert.unique: { claimNumber: [claimNumber],repairReference:[repairReference]}
entity WarrantyClaims : cuid, managed {

    claimNumber       : String(30) @readonly;
    repairReference   : String(50) @mandatory;
    failureDate       : Date @mandatory;
    repairDate        : Date;
    claimDate         : Date;
    submittedAt       : Timestamp;
    mileageAtFailure  : Integer @mandatory;
    claimCategory     : Association to ClaimCategories;
    complaint         : String(1000);
    requestedAmount   : Decimal(12,2);
    eligibleAmount    : Decimal(12,2);
    approvedAmount    : Decimal(12,2);
    overrideAmount    : Decimal(12,2);
    overrideReason    : String(500);
    isOutOfPolicy     : Boolean default false;
    financeApprovedAmount   : Decimal(12,2);
    financeAdjustmentReason : String(1000);

    currency          : String(3) default 'INR';
    @assert.range
    status            : ClaimStatus default #Draft;
    claimVersion      : Integer default 1;
    rejectionReason   : String(1000);
    cancellationReason: String(1000);
    closedAt          : Timestamp;
    dealer            : Association to Dealers @mandatory;
    vehicle           : Association to Vehicles @mandatory;
    warrantyPolicy    : Association to WarrantyPolicies;

    labours : Composition of many ClaimLabour
        on labours.claim = $self;

    parts : Composition of many ClaimParts
        on parts.claim = $self;

    documents : Composition of many ClaimDocuments
        on documents.claim = $self;

    eligibilityChecks : Composition of many EligibilityChecks
        on eligibilityChecks.claim = $self;

    reviewTasks : Composition of many ClaimReviewTasks
        on reviewTasks.claim = $self;

    decisions : Composition of many ClaimDecisions
        on decisions.claim = $self;

    statusHistory : Composition of many ClaimStatusHistory
        on statusHistory.claim = $self;

    settlements : Composition of many SettlementRecords
        on settlements.claim = $self;
}

entity ClaimParts : cuid, managed {

    partMaster        : Association to PartMasters;

    partNumber        : String(50);
    partDescription   : String(300);
    standardUnitPrice : Decimal(10,2);

    quantity          : Integer;
    unitPrice         : Decimal(10,2);
    totalAmount       : Decimal(12,2);

    hasPriceVariance  : Boolean default false;
    priceVarianceReason : String(1000);

    approvedQuantity  : Integer;
    approvedUnitPrice : Decimal(10,2);
    approvedAmount    : Decimal(12,2);
    @assert.range
    lineStatus        : LineStatus default #Pending;

    approvalComments  : String(1000);
    rejectionReason   : String(500);

    isWarrantyPart    : Boolean default true;
    isOutOfPolicy     : Boolean default false;

    flagReason        : String(300);

    claim             : Association to WarrantyClaims;
}

entity ClaimLabour : cuid, managed {

    labourOperation : Association to LabourOperationMasters;

    operationCode        : String(30);
    description          : String(300);
    standardHours        : Decimal(6,2);
    standardHourlyRate   : Decimal(10,2);

    technicianName       : String(100);
    labourHours          : Decimal(6,2);
    hourlyRate           : Decimal(10,2);
    totalAmount          : Decimal(12,2);

    hasRateVariance      : Boolean default false;
    rateVarianceReason   : String(1000);
    
    approvedHours        : Decimal(6,2);
    approvedHourlyRate   : Decimal(10,2);
    approvedAmount       : Decimal(12,2);
    @assert.range
    lineStatus           : LineStatus default #Pending;

    approvalComments     : String(1000);
    rejectionReason      : String(500);

    isOutOfPolicy        : Boolean default false;

    flagReason           : String(300);

    claim                : Association to WarrantyClaims;
    hasHoursVariance    : Boolean default false;
    hoursVarianceReason : String(500);
}

entity ClaimDocuments : cuid, managed {

    fileName             : String(255);
    mimeType             : String(100) @Core.IsMediaType;
    fileSize             : Integer;
    @assert.range
    documentType         : DocumentType;

   content              : LargeBinary
                           @Core.MediaType: mimeType
                           @Core.ContentDisposition.Filename: fileName;

    uploadedBy           : String(100);
    uploadedAt           : Timestamp;
    @assert.range
    verificationStatus   : VerificationStatus default #Pending;

    verifiedBy           : String(100);
    verifiedAt           : Timestamp;
    verificationComments : String(1000);

    claim                : Association to WarrantyClaims;
}

entity EligibilityChecks : cuid, managed {

    claimVersion     : Integer;
    checkDate        : Timestamp;

    isEligible       : Boolean;

    dealerValid      : Boolean;
    vehicleValid     : Boolean;
    policyValid      : Boolean;

    warrantyValid    : Boolean;
    mileageValid     : Boolean;
    submissionValid  : Boolean;

    isDuplicate      : Boolean;

    partsEligible    : Boolean;
    labourEligible   : Boolean;

    withinClaimLimit : Boolean;

    failureReason    : String(1000);

    claim            : Association to WarrantyClaims;
}

entity ClaimReviewTasks : cuid, managed {

    claimVersion : Integer;
    @assert.range
    reviewStage  : ReviewStage;

    assignedTo   : String(100);
    assignedRole : String(50);
    @assert.range
    taskStatus   : TaskStatus default #Open;

    assignedAt   : Timestamp;
    completedAt  : Timestamp;
    dueAt        : Timestamp;

    claim        : Association to WarrantyClaims;
}

entity ClaimDecisions : cuid, managed {

    claimVersion   : Integer;
    @assert.range
    decisionStage  : ReviewStage;
    @assert.range
    decision       : DecisionType;

    comments       : String(1000);

    decidedBy      : String(100);
    decidedAt      : Timestamp;

    approvedAmount : Decimal(12,2);

    reviewTask     : Association to ClaimReviewTasks;
    claim          : Association to WarrantyClaims;
}

entity ClaimStatusHistory : cuid, managed {

    claimVersion   : Integer;
    @assert.range
    previousStatus : ClaimStatus;
    @assert.range
    newStatus      : ClaimStatus;

    changeReason   : String(1000);

    changedBy      : String(100);
    changedAt      : Timestamp;

    claim          : Association to WarrantyClaims;
}

entity SettlementRecords : cuid, managed {

    settlementNumber : String(30);
    approvedAmount   : Decimal(12,2);

    paidAmount       : Decimal(12,2);

    currency         : String(3) default 'INR';

    paymentReference : String(100);
    exportReference  : String(100);

    paymentDate      : Date;
    @assert.range
    paymentStatus    : PaymentStatus default #Pending;

    remarks          : String(500);

    claim            : Association to WarrantyClaims;
}

entity ClaimCategories : managed {
    key code    : String(30);
    description : String(100);
    isActive    : Boolean default true;
}
