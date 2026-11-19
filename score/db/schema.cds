namespace vendorrisk;

// entity Vendors {
//     key ID          : UUID;
//     vendorCode      : String(40);
//     vendorName      : String(100);
// }
type VendorStatus : String enum {
    ACTIVE;
    INACTIVE;
    BLOCKED;
    SUSPENDED;
    BLACKLISTED;
}
entity Vendors {
    key ID                  : UUID;
    vendorCode              : String(20);
    vendorName              : String(100);
    country                 : String(50);
    region                  : String(50);
    vendorCategory          : String(50);
    materialCategory        : String(100);

    contactPerson            : String(100);
    email                    : String(100);
    phone                    : String(30);

    vendorStatus            : VendorStatus default 'ACTIVE';
    currentRiskScore         : Decimal(5,2) default 0;
    riskLevel                : String(20);

    lastRiskCalculation      : Timestamp;

    purchaseOrders           : Association to many PurchaseOrders
                              on purchaseOrders.vendor = $self;
    deliveries               : Association to many Deliveries
                              on deliveries.vendor = $self;

    invoices                 : Association to many Invoices
                              on invoices.vendor = $self;

    qualityComplaints        : Association to many QualityComplaints
                              on qualityComplaints.vendor = $self;

    riskAssessments          : Association to many RiskAssessments
                              on riskAssessments.vendor = $self;
}

entity PurchaseOrders {
    key ID          : UUID;
    poNumber        : String(40);
    vendor          : Association to Vendors;
}

entity Deliveries {

    key ID                   : UUID;

    vendor                   : Association to Vendors;
    purchaseOrder            : Association to PurchaseOrders;

    poItemNumber             : Integer;
    materialCode             : String(40);

    expectedDeliveryDate     : Date;
    actualDeliveryDate       : Date;

    orderedQuantity          : Decimal(15,3);
    deliveredQuantity        : Decimal(15,3);

    deliveryStatus           : String(20);
    delayDays                : Integer;

    partialDelivery          : Boolean;
    shipmentStatus           : String(30);
    deliveryPercentage       : Decimal(5,2);

    remarks                  : String(500);

    // Delivery Risk
    deliveryRiskScore        : Decimal(5,2);
    deliveryRiskLevel        : String(20);
}

entity QualityComplaints {

    key ID : UUID;

    vendor : Association to Vendors;
    purchaseOrder : Association to PurchaseOrders;

    complaintNumber : String(40);
    materialCode : String(40);
    complaintDate : Date;
    defectType : String(100);
    severity : String(20);
    rejectedQuantity : Decimal(15,3);
    inspectedQuantity : Decimal(15,3);
    defectPercentage : Decimal(5,2);
    complaintStatus : String(30);
    qualityScore : Decimal(5,2);
    rootCause : String(500);
    correctiveAction : String(500);
    resolvedDate : Date;
}
entity Invoices {

    key ID : UUID;

    invoiceNumber : String(40);

    vendor : Association to Vendors;
    purchaseOrder : Association to PurchaseOrders;

    invoiceDate : Date;

    materialCode : String(40);

    quantity : Decimal(15,3);

    oldPrice : Decimal(15,2);
    currentPrice : Decimal(15,2);

    priceDifference : Decimal(15,2);
    priceDeviationPercent : Decimal(5,2);

    invoiceAmount : Decimal(15,2);
    currency : String(5);

    invoiceStatus : String(20);

    blocked : Boolean;

    mismatch : Boolean;
}
entity RiskAssessments {

    key ID : UUID;

    vendor : Association to Vendors;

    assessmentDate : Timestamp;

    deliveryRisk : Decimal(5,2);

    qualityRisk : Decimal(5,2);

    priceRisk : Decimal(5,2);
overallRiskScore 
    : Decimal(5,2);

    riskLevel : String(20);

    calculationStatus : String(30);
}