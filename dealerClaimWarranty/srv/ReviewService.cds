
using { dc } from '../db/schema';

service ReviewService {

    @readonly
    entity Dealers as projection on dc.Dealers;

    @readonly
    entity Vehicles as projection on dc.Vehicles;

    @readonly
    entity WarrantyPolicies as projection on dc.WarrantyPolicies;

    @readonly
    entity ClaimCategories as projection on dc.ClaimCategories;

    entity WarrantyClaims as projection on dc.WarrantyClaims actions {

    action acceptClaim() returns String;
    action requestInformation(reason: String) returns String;
    action rejectClaim(reason: String) returns String;

    action approveTechnicalClaim() returns String;
    action rejectTechnicalClaim(reason: String) returns String;

    action approveFinanceClaim(financeApprovedAmount: Decimal,financeAdjustmentReason: String) returns String;
    action rejectFinanceClaim(reason: String) returns String;
    action settleClaim() returns String;
    };
    entity ClaimParts as projection on dc.ClaimParts;

    entity ClaimLabour as projection on dc.ClaimLabour;

    @readonly
    entity PartMasters as projection on dc.PartMasters;

    @readonly
    entity LabourOperationMasters as projection on dc.LabourOperationMasters;

    entity ClaimReviewTasks as projection on dc.ClaimReviewTasks;

    entity ClaimDecisions as projection on dc.ClaimDecisions;

    entity ClaimStatusHistory as projection on dc.ClaimStatusHistory;

    entity EligibilityChecks as projection on dc.EligibilityChecks;
    entity SettlementRecords as projection on dc.SettlementRecords;
    entity WarrantyPolicyCoverages as projection on dc.WarrantyPolicyCoverages;
}
