using {db} from '../db/schema';

service VendorRiskService {
    entity Vendors                as projection on db.Vendors;
    function totalVendor()                                              returns Integer;
    function totalPO()                                                  returns Integer;
    function totalInvoice()                                             returns Integer;

    function getPOStatusCounts()                                        returns array of {
        status : String;
        count  : Integer;
    };


    entity PurchaseOrders         as
        projection on db.PurchaseOrders {
            *,
            // Numeric part of the PO number (PO801 -> 801, PONO012 -> 12).
            // Read-only; used only so the UI can sort POs numerically.
            cast(
                replace(
                    replace(
                        poNumber, 'PONO', ''
                    ), 'PO', ''
                ) as Integer
            ) as poSeq
        }
        actions {
            action poAccept()                               returns PurchaseOrders;
            action poReject()                               returns PurchaseOrders;
            action poSentVendor()                           returns PurchaseOrders;

            action vendorAccept(expectedDeliveryDate: Date) returns PurchaseOrders;
            action vendorReject(reason: String(500))        returns PurchaseOrders;
        };

    entity InvoiceNumberSequences as projection on db.InvoiceNumberSequences;


    entity PurchaseOrderItems     as projection on db.PurchaseOrderItems;
    entity Materials              as projection on db.Materials;

    //----------------------delivery ---------------------------------------------
    entity Deliveries             as projection on db.Deliveries;
    entity DeliveryItems          as projection on db.DeliveryItems;

    type DeliveryPreviewItem {
        invoiceItemID       : UUID;
        materialCode        : String(40);
        materialDescription : String(200);
        unit                : String(10);
        acceptedQuantity    : Decimal(15, 3);
        deliveredSoFar      : Decimal(15, 3);
        remainingQuantity   : Decimal(15, 3);
    }

    type DeliveryPreview {
        purchaseOrderID      : UUID;
        poNumber             : String(30);
        invoiceID            : UUID;
        invoiceNumber        : String(40);
        expectedDeliveryDate : Date;
        items                : many DeliveryPreviewItem;
    }

    function getDeliveryDetails(vendorID: UUID, purchaseOrderID: UUID)  returns DeliveryPreview;

    // type DeliveryRiskResult { // REPLACES the old type
    //     vendorID                   : UUID;
    //     totalOrders                : Integer;
    //     delayedOrders              : Integer;
    //     incompleteOrders           : Integer;
    //     averageDeliveryPercentage  : Decimal(5, 2);
    //     averageShortfallPercentage : Decimal(5, 2);
    //     averageDelayDays           : Decimal(10, 2);
    //     shortfallPoints            : Decimal(5, 2); // max 14
    //     delayPoints                : Decimal(5, 2); // max 6
    //     deliveryRiskScore          : Decimal(5, 2); // max 20
    //     maxScore                   : Integer;
    //     riskLevel                  : String(20);
    // }

    //----------------------delivery ---------------------------------------------

    entity Invoices               as projection on db.Invoices
        actions {
            action updateInvoice(invoiceDate: Date,
                                 deliveryDate: Date,
                                 items: array of InvoiceItemUpdate) returns Invoices;
        };

    entity InvoiceItems           as projection on db.InvoiceItems;
    entity QualityComplaints      as projection on db.QualityComplaints;
    entity ComplianceCertificates as projection on db.ComplianceCertificates;
    entity RiskAssessments        as projection on db.RiskAssessments;
    entity RiskAlerts             as projection on db.RiskAlerts;
    entity RiskRules              as projection on db.RiskRules;
    entity Employee               as projection on db.Employee;

    action   calculateDeliveryRisk(vendorID: UUID)                      returns DeliveryRiskResult;

    action   calculateQualityRisk(vendorID: UUID)                       returns QualityRiskResult;

    action   calculatePriceDeviationRisk(vendorID: UUID)                returns PriceRiskResult;

    action   calculateOverallVendorRisk(vendorID: UUID)                 returns OverallRiskResult;

    action   checkDatabase()                                            returns {
        database                 : String;
        primaryDatabaseConnected : Boolean;
    };

    action   runRiskAssessment() returns Vendors;
    action   blockVendor(vendorId: UUID, reason: String) returns String;
    
    // type DeliveryRiskResult {
    //     vendorID                  : UUID;
    //     totalDeliveries           : Integer;
    //     delayedDeliveries         : Integer;
    //     partialDeliveries         : Integer;
    //     averageDelayDays          : Decimal(10, 2);
    //     delayedPercentage         : Decimal(5, 2);
    //     partialPercentage         : Decimal(5, 2);
    //     averageDeliveryPercentage : Decimal(5, 2);
    //     delayScore                : Decimal(5, 2);
    //     delayedDeliveryScore      : Decimal(5, 2);
    //     partialDeliveryScore      : Decimal(5, 2);
    //     completionScore           : Decimal(5, 2);
    //     deliveryRiskScore         : Decimal(5, 2);
    //     riskLevel                 : String(20);
    // };

    type OverallRiskResult {

        vendorID          : UUID;
        deliveryRisk      : Decimal(5, 2);
        qualityRisk       : Decimal(5, 2);
        priceRisk         : Decimal(5, 2);
        overallRiskScore  : Decimal(5, 2);
        riskLevel         : String(20);
        calculationStatus : String(30);
    };

    // type QualityRiskResult {

    //     vendorID                : UUID;
    //     totalComplaints         : Integer;
    //     totalInspectedQuantity  : Decimal(15, 3);
    //     totalRejectedQuantity   : Decimal(15, 3);
    //     averageDefectPercentage : Decimal(5, 2);
    //     defectScore             : Decimal(5, 2);
    //     severityScore           : Decimal(5, 2);
    //     qualityRiskScore        : Decimal(5, 2);
    //     riskLevel               : String(20);
    // };

    // type PriceRiskResult {

    //     vendorID                     : UUID;
    //     totalInvoices                : Integer;
    //     totalPriceIncrease           : Decimal(15, 2);
    //     averagePriceDeviationPercent : Decimal(5, 2);
    //     priceDeviationScore          : Decimal(5, 2);
    //     priceRiskScore               : Decimal(5, 2);
    //     riskLevel                    : String(20);
    // };

    type InvoiceItemUpdate : {
        purchaseOrderItem_ID : UUID;
        quantity             : Decimal(15, 3);
        unitPrice            : Decimal(15, 2);
    };


    //[===================Risk type fields========================================]

    // ---------- DELIVERY RISK ----------
    type DeliveryItemRisk {
        materialCode         : String(40);
        materialDescription  : String(200);
        orderedQuantity      : Decimal(15, 3);
        committedQuantity    : Decimal(15, 3);
        receivedQuantity     : Decimal(15, 3);
        shortfallQuantity    : Decimal(15, 3);
        expectedDeliveryDate : Date;
        actualDeliveryDate   : Date;
        delayCheckDate       : Date;
        timingStatus         : String(40);
        delayDays            : Integer;
        quantityRisk         : Decimal(5, 2);
        delayRisk            : Decimal(5, 2);
        deliveryRisk         : Decimal(5, 2);
        riskLevel            : String(20);
        riskStatus           : String(30);
    }

    type DeliveryOrderRisk {
        purchaseOrderID      : UUID;
        poNumber             : String(30);
        invoiceNumber        : String(40);
        expectedDeliveryDate : Date;
        actualDeliveryDate   : Date;
        delayCheckDate       : Date;
        timingStatus         : String(40);
        committedQuantity    : Decimal(15, 3);
        receivedQuantity     : Decimal(15, 3);
        shortfallQuantity    : Decimal(15, 3);
        delayDays            : Integer;
        quantityRisk         : Decimal(5, 2);
        delayRisk            : Decimal(5, 2);
        deliveryRisk         : Decimal(5, 2);
        riskLevel            : String(20);
        riskStatus           : String(30);
        items                : many DeliveryItemRisk;
    }

    type DeliveryRiskResult {
        vendorID          : UUID;
        vendorName        : String(100);
        totalOrders       : Integer;
        onTimeOrders      : Integer;
        delayedOrders     : Integer;
        quantityRisk      : Decimal(5, 2);
        delayRisk         : Decimal(5, 2);
        deliveryRiskScore : Decimal(5, 2);
        riskLevel         : String(20);
        calculationStatus : String(30);
        orders            : many DeliveryOrderRisk;
    }

    // ---------- QUALITY RISK ----------
    type QualityItemRisk {
        materialCode        : String(40);
        materialDescription : String(200);
        receivedQuantity    : Decimal(15, 3);
        inspectedQuantity   : Decimal(15, 3);
        acceptedQuantity    : Decimal(15, 3);
        rejectedQuantity    : Decimal(15, 3);
        qualityRisk         : Decimal(5, 2);
        riskLevel           : String(20);
        riskStatus          : String(30);
    }

    type QualityOrderRisk {
        purchaseOrderID   : UUID;
        poNumber          : String(30);
        invoiceNumber     : String(40);
        receivedQuantity  : Decimal(15, 3);
        inspectedQuantity : Decimal(15, 3);
        acceptedQuantity  : Decimal(15, 3);
        rejectedQuantity  : Decimal(15, 3);
        qualityRisk       : Decimal(5, 2);
        riskLevel         : String(20);
        riskStatus        : String(30);
        items             : many QualityItemRisk;
    }

    type QualityRiskResult {
        vendorID          : UUID;
        vendorName        : String(100);
        totalOrders       : Integer;
        receivedQuantity  : Decimal(15, 3);
        inspectedQuantity : Decimal(15, 3);
        acceptedQuantity  : Decimal(15, 3);
        rejectedQuantity  : Decimal(15, 3);
        qualityRiskScore  : Decimal(5, 2);
        riskLevel         : String(20);
        calculationStatus : String(30);
        orders            : many QualityOrderRisk;
    }

    // ---------- PRICE RISK ----------
    type PriceItemRisk {
        materialCode        : String(40);
        materialDescription : String(200);
        quantity            : Decimal(15, 3);
        poUnitPrice         : Decimal(15, 2);
        invoiceUnitPrice    : Decimal(15, 2);
        priceDifference     : Decimal(15, 2);
        priceDeviation      : Decimal(9, 2);
        priceRisk           : Decimal(5, 2);
        savingAmount        : Decimal(15, 2);
        riskLevel           : String(20);
        riskStatus          : String(30);
    }

    type PriceOrderRisk {
        purchaseOrderID : UUID;
        poNumber        : String(30);
        invoiceNumber   : String(40);
        poValue         : Decimal(15, 2);
        invoiceValue    : Decimal(15, 2);
        priceDifference : Decimal(15, 2);
        savingAmount    : Decimal(15, 2);
        priceRisk       : Decimal(5, 2);
        riskLevel       : String(20);
        riskStatus      : String(30);
        items           : many PriceItemRisk;
    }

    type PriceRiskResult {
        vendorID          : UUID;
        vendorName        : String(100);
        totalOrders       : Integer;
        poValue           : Decimal(15, 2);
        invoiceValue      : Decimal(15, 2);
        priceDifference   : Decimal(15, 2);
        savingAmount      : Decimal(15, 2);
        priceRiskScore    : Decimal(5, 2);
        riskLevel         : String(20);
        calculationStatus : String(30);
        orders            : many PriceOrderRisk;
    }

}
