using { vendorrisk as db } from '../db/schema';

@path: '/vendor-risk'
service VendorRiskService {

    entity Deliveries
        as projection on db.Deliveries;

    entity Vendors
        as projection on db.Vendors;

    entity PurchaseOrders
        as projection on db.PurchaseOrders;

    entity QualityComplaints
    as projection on db.QualityComplaints;
    entity Invoices
    as projection on db.Invoices;

    entity RiskAssessments
    as projection on db.RiskAssessments;
    action calculateDeliveryRisk(
        vendorID : UUID
    ) returns DeliveryRiskResult;

action calculateQualityRisk(
    vendorID : UUID
) returns QualityRiskResult;

action calculatePriceDeviationRisk(
    vendorID : UUID
) returns PriceRiskResult;

action calculateOverallVendorRisk(
    vendorID : UUID
) returns OverallRiskResult;

    type DeliveryRiskResult {
        vendorID              : UUID;
        totalDeliveries       : Integer;
        delayedDeliveries     : Integer;
        partialDeliveries     : Integer;

        averageDelayDays      : Decimal(10,2);
        delayedPercentage     : Decimal(5,2);
        partialPercentage     : Decimal(5,2);
        averageDeliveryPercentage : Decimal(5,2);

        delayScore            : Decimal(5,2);
        delayedDeliveryScore  : Decimal(5,2);
        partialDeliveryScore  : Decimal(5,2);
        completionScore       : Decimal(5,2);

        deliveryRiskScore     : Decimal(5,2);
        riskLevel             : String(20);
    };

type OverallRiskResult {

    vendorID : UUID;

    deliveryRisk : Decimal(5,2);

    qualityRisk : Decimal(5,2);

    priceRisk : Decimal(5,2);

    overallRiskScore : Decimal(5,2);

    riskLevel : String(20);

    calculationStatus : String(30);
};

    type QualityRiskResult {

    vendorID : UUID;

    totalComplaints : Integer;

    totalInspectedQuantity : Decimal(15,3);

    totalRejectedQuantity : Decimal(15,3);

    averageDefectPercentage : Decimal(5,2);

    defectScore : Decimal(5,2);

    severityScore : Decimal(5,2);

    qualityRiskScore : Decimal(5,2);

    riskLevel : String(20);
};
type PriceRiskResult {

    vendorID : UUID;

    totalInvoices : Integer;

    totalPriceIncrease : Decimal(15,2);

    averagePriceDeviationPercent : Decimal(5,2);

    priceDeviationScore : Decimal(5,2);

    priceRiskScore : Decimal(5,2);

    riskLevel : String(20);
};
}