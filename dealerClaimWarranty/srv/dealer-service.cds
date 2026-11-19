
using { dc } from '../db/schema';

service DealerService {
    @readonly
    entity Dealers as projection on dc.Dealers;
    @readonly
    entity Vehicles as projection on dc.Vehicles;
    @readonly
    entity WarrantyPolicies as projection on dc.WarrantyPolicies;
    @readonly
    entity ClaimCategories as projection on dc.ClaimCategories;
    @readonly
    entity PartMasters as projection on dc.PartMasters;
    @readonly
    entity LabourOperationMasters as projection on dc.LabourOperationMasters;
    @readonly
    entity WarrantyPolicyCoverages as projection on dc.WarrantyPolicyCoverages;

    entity WarrantyClaims as projection on dc.WarrantyClaims actions {
        action checkEligibility() returns Boolean;
        action reSubmitClaim() returns String;
        action submitClaim() returns String;
    };
    entity EligibilityChecks as projection on dc.EligibilityChecks;
    entity ClaimParts as projection on dc.ClaimParts;
    entity ClaimLabour as projection on dc.ClaimLabour;
    entity ClaimDocuments as projection on dc.ClaimDocuments;
    entity ClaimStatusHistory as projection on dc.ClaimStatusHistory;
    entity ClaimReviewTasks as projection on dc.ClaimReviewTasks;
}
