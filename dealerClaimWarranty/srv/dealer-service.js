const cds = require('@sap/cds');
module.exports = cds.service.impl(async function() {
    const {WarrantyClaims,Dealers,Vehicles,WarrantyPolicies,EligibilityChecks,ClaimReviewTasks,PartMasters,LabourOperationMasters,ClaimParts,ClaimLabour,
WarrantyPolicyCoverages,ClaimStatusHistory,ClaimDocuments} = this.entities ;

const recalculateClaimAmount = async (claimID) => {
    const parts = await SELECT.from(ClaimParts).columns('totalAmount').where({ claim_ID: claimID });
    const labours = await SELECT.from(ClaimLabour).columns('totalAmount').where({ claim_ID: claimID });
    const partsTotal = parts.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    console.log(partsTotal);
    const labourTotal = labours.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
    console.log(labourTotal);
    const requestedAmount = Number((partsTotal + labourTotal).toFixed(2));
    console.log(requestedAmount);
    await UPDATE(WarrantyClaims).set({ requestedAmount }).where({ ID: claimID });
   };
  
this.before('CREATE', 'WarrantyClaims', async (req) => {
    const { repairReference,failureDate,dealer_ID,vehicle_ID,mileageAtFailure} = req.data;
    const mandatoryFields = ['repairReference','failureDate','dealer_ID','vehicle_ID','mileageAtFailure'];

mandatoryFields.forEach((field) => {
    if (!req.data[field]) {
        req.error(400, `${field} is mandatory`);
    }
});
    const dealer = await SELECT.one.from(Dealers).where({ ID: req.data.dealer_ID });

if (!dealer) {
    req.error(400, 'Dealer does not exist');
}

else if (!dealer.isActive) {
    req.error(400, 'Dealer is inactive. Cannot create warranty claim');
}

    const crypto = require('crypto');
    const year = new Date().getFullYear();
    const randomNumber = crypto.randomBytes(3).toString('hex').toUpperCase();

    req.data.claimNumber =`CLM-${year}-${randomNumber}`;
    req.data.claimDate = new Date().toISOString().slice(0, 10);
    // req.data.status = 'Draft';
    // req.data.claimVersion = 1;

    const existingClaim = await SELECT.one
    .from(WarrantyClaims).where({repairReference: req.data.repairReference});

if (existingClaim) {
    req.error(400,`A warranty claim already exists for repair reference ${req.data.repairReference}`);
}
});


this.before('CREATE', 'ClaimLabour', async (req) => {
    const {labourOperation_ID,claim_ID,labourHours,hourlyRate} = req.data;
    const mandatoryFields = ['labourOperation_ID','claim_ID','labourHours','hourlyRate'];
    mandatoryFields.forEach((field)=>{
        if(!req.data[field])
        {
            req.error(400,`${field} is required`);
        }
    });

    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: claim_ID });

    if (!claim) {
        return req.reject(404, 'Warranty claim not found');
    }
    if (!['Draft', 'InformationRequested'].includes(claim.status)) {
        return req.reject(400, 'Labour cannot be added at this claim stage');
    }

    const existingLabour = await SELECT.one.from(ClaimLabour)
    .where({
        claim_ID,
        labourOperation_ID
    });

if (existingLabour) {
    return req.reject(
        400,
        'This labour operation has already been added to the warranty claim'
    );
}

    const operation = await SELECT.one.from(LabourOperationMasters)
        .where({ ID: labourOperation_ID });

    if (!operation) {
        return req.reject(404, 'Labour operation not found');
    }

    if (!operation.isActive) {
        return req.reject(400, 'Selected labour operation is inactive');
    }
    const hours = Number(labourHours);
    const claimedRate = Number(hourlyRate);
    const standardHours = Number(operation.standardHours);
    const standardRate = Number(operation.standardHourlyRate);
    if (!Number.isFinite(hours) || hours <= 0) {
        return req.reject(400, 'Enter valid labour hours');
    }

    if (!Number.isFinite(claimedRate) || claimedRate <= 0) {
        return req.reject(400, 'Enter a valid claimed hourly rate');
    }

    if (!Number.isFinite(standardHours) || standardHours <= 0) {
        return req.reject(400, 'Standard labour hours are not configured');
    }

    if (!Number.isFinite(standardRate) || standardRate < 0) {
        return req.reject(400, 'Standard hourly rate is not configured');
    }

    const hasHoursVariance = hours > standardHours;

    const hoursVarianceReason =
        (req.data.hoursVarianceReason || '').trim();

    if (hasHoursVariance && !hoursVarianceReason) {
        return req.reject(
            400,
            'Justification is required when claimed hours exceed standard hours'
        );
    }
    const hasRateVariance = claimedRate > standardRate;

    const rateVarianceReason =
        (req.data.rateVarianceReason || '').trim();

    if (hasRateVariance && !rateVarianceReason) {
        return req.reject(
            400,
            'Justification is required when claimed rate exceeds standard rate'
        );
    }
    req.data.operationCode = operation.operationCode;
    req.data.operationDescription = operation.operationDescription;
    req.data.standardHours = standardHours;
    req.data.standardHourlyRate = standardRate;

    req.data.totalAmount = Number(
        (hours * claimedRate).toFixed(2)
    );

    req.data.hasHoursVariance = hasHoursVariance;
    req.data.hoursVarianceReason =
        hasHoursVariance ? hoursVarianceReason : null;

    req.data.hasRateVariance = hasRateVariance;
    req.data.rateVarianceReason =
        hasRateVariance ? rateVarianceReason : null;
    const flagReasons = [];

    if (hasHoursVariance) {
        flagReasons.push('Claimed labour hours exceed standard hours');
    }

    if (hasRateVariance) {
        flagReasons.push('Claimed labour rate exceeds standard hourly rate');
    }

    req.data.flagReason = flagReasons.length > 0
        ? flagReasons.join('; ')
        : null;
    req.data.lineStatus = 'Pending';
    req.data.approvedHours = null;
    req.data.approvedHourlyRate = null;
    req.data.approvedAmount = null;
    req.data.approvalComments = null;
    req.data.rejectionReason = null;
    req.data.isOutOfPolicy = false;

});

    this.before('CREATE', 'ClaimParts', async (req) => {
    const {partMaster_ID,claim_ID,quantity,unitPrice} = req.data;

    if (!claim_ID) {
        return req.reject(400, 'Warranty claim ID is required');
    }

    const claim = await SELECT.one.from(WarrantyClaims)
            .where({ ID: claim_ID });

    if (!claim) {
        return req.reject(404, 'Warranty claim not found');
    }
    if (!['Draft', 'InformationRequested'].includes(claim.status)) {
        return req.reject(400, 'Parts cannot be added at this claim stage');
    }
    const part = await SELECT.one.from(PartMasters)
            .where({ ID: partMaster_ID });

    if (!part) {
        return req.reject(404, 'Selected part not found');
    }

    if (!part.isActive) {
        return req.reject(400, 'Selected part is inactive');
    }

    
    const existingPart = await SELECT.one.from(ClaimParts)
    .where({
        claim_ID,
        partMaster_ID
    });

if (existingPart) {
    return req.reject(
        400,
        'This part has already been added to the warranty claim'
    );
}
    const qty = Number(quantity);
    const claimedPrice = Number(unitPrice);
    const standardPrice = Number(part.standardUnitPrice);

    if (!Number.isFinite(qty) || qty <= 0) {
        return req.reject(400, 'Enter a valid part quantity');
    }

    if (!Number.isFinite(standardPrice) || standardPrice < 0) {
        return req.reject(400, 'Standard part price is not configured');
    }

    if (!Number.isFinite(claimedPrice) || claimedPrice <= 0) {
        return req.reject(400, 'Enter a valid claimed unit price');
    }

    const hasPriceVariance = claimedPrice > standardPrice;

    const varianceReason =
        (req.data.priceVarianceReason || '').trim();

    if (hasPriceVariance && !varianceReason) {
        return req.reject(
            400,
            'Justification is required when claimed price exceeds standard price'
        );
    }

    req.data.partNumber = part.partNumber;
    req.data.partDescription = part.partDescription;
    req.data.standardUnitPrice = standardPrice;

    req.data.totalAmount = Number((qty * claimedPrice).toFixed(2));

    req.data.hasPriceVariance = hasPriceVariance;
    req.data.priceVarianceReason =
        hasPriceVariance ? varianceReason : null;

    req.data.flagReason = hasPriceVariance
        ? 'Claimed price exceeds standard part price'
        : null;

    req.data.lineStatus = 'Pending';
    req.data.approvedQuantity = null;
    req.data.approvedUnitPrice = null;
    req.data.approvedAmount = null;
    req.data.approvalComments = null;
    req.data.rejectionReason = null;
    req.data.isOutOfPolicy = false;
});

this.before('CREATE', 'ClaimDocuments', async (req) => {

    const { claim_ID, fileName, mimeType } = req.data;

    if (!claim_ID) {
        return req.error(400, 'Claim ID is mandatory for document upload');
    }
    const claim = await SELECT.one
        .from(WarrantyClaims)
        .where({ ID: claim_ID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }
    if (!['Draft', 'InformationRequested'].includes(claim.status)) {
        return req.error(400, 'Documents can only be uploaded for Draft or Information Requested claims');
    }
    if (!fileName) {
        return req.error(400, 'File name is mandatory');
    }

    if (!mimeType) {
        return req.error(400, 'File MIME type is mandatory');
    }

    req.data.uploadedBy = req.user.id || 'USER';
    req.data.uploadedAt = new Date();
    req.data.verificationStatus = 'Pending';

});

this.on('submitClaim', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;
    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: claimID });

    if (!claim) {
        return req.reject(404, 'Warranty claim not found');
    }
    if (claim.status !== 'Draft') {
        return req.reject(400, 'Only Draft claims can be submitted');
    }
    const part = await SELECT.one.from(ClaimParts)
        .where({ claim_ID: claimID });

    const labour = await SELECT.one.from(ClaimLabour)
        .where({ claim_ID: claimID });

    if (!part && !labour) {
        return req.reject(
            400,
            'Add at least one part or labour before submitting the claim'
        );
    }
    await recalculateClaimAmount(claimID);
    const currentDate = new Date().toISOString().slice(0,10);
    const claimVersion = claim.claimVersion || 1;
    await UPDATE(WarrantyClaims)
        .set({
            status: 'Submitted',
            submittedAt: currentDate
        })
        .where({ ID: claimID });
    await INSERT.into(ClaimStatusHistory).entries({
        claim_ID: claimID,
        claimVersion: claimVersion,
        previousStatus: 'Draft',
        newStatus: 'Submitted',
        changeReason: 'Dealer submitted the warranty claim',
        changedBy: req.user.id,
        changedAt: currentDate
    });
    return 'Warranty claim submitted successfully';
});

this.on('reSubmitClaim', 'WarrantyClaims', async (req) => {
    const claimID = req.params[0].ID;
    const claim = await  SELECT.one.from(this.entities.WarrantyClaims)
        .where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'InformationRequested') {
        return req.error(400, 'Claim cannot be resubmitted');
    }
//    if (!['Draft', 'InformationRequested'].includes(claim.status)) {
//       return req.error(400, 'Claim cannot be resubmitted');
//    }

    await UPDATE(WarrantyClaims)
        .set({
            status: 'Submitted',
            claimVersion: claim.claimVersion + 1,
            submittedAt: new Date().toISOString()
        })
        .where({ ID: claimID });
    await INSERT.into(ClaimStatusHistory).entries({
        claim_ID: claimID,
        claimVersion: claim.claimVersion + 1,
        previousStatus: claim.status,
        newStatus: 'Submitted',
        changeReason: 'Dealer provided the requested information and resubmitted the claim',
        changedBy: req.user.id,
        changedAt: new Date()
    });
    await recalculateClaimAmount(claimID);
    return 'Claim resubmitted successfully';

});

    this.on('checkEligibility', 'WarrantyClaims', async (req) => {
        const claimID = req.params[0].ID;
        const claim = await SELECT.one.from(WarrantyClaims).where({ ID: claimID });

        if (!claim) {
            return req.reject(404, 'Warranty claim not found');
        }

        const dealer = await SELECT.one.from(Dealers).where({ ID: claim.dealer_ID });
        const dealerValid = !!dealer && dealer.isActive === true;
        const vehicle =await SELECT.one.from(Vehicles).where({ ID: claim.vehicle_ID });
         const vehicleValid = !!vehicle && vehicle.isActive === true && vehicle.dealer_ID === claim.dealer_ID;
        const policyID = claim.warrantyPolicy_ID ||(vehicle && vehicle.warrantyPolicy_ID);
        const policy = policyID? await SELECT.one.from(WarrantyPolicies).where({ ID: policyID }): null;
        const policyValid = !!policy && policy.isActive === true;

        let warrantyValid = false;

        if (vehicle && policy && claim.failureDate && vehicle.saleDate) {

            const warrantyEndDate = new Date(vehicle.saleDate);

            warrantyEndDate.setMonth(
                warrantyEndDate.getMonth() + policy.coverageMonths
            );

            warrantyValid =
                new Date(claim.failureDate) <= warrantyEndDate;
        }

        let mileageValid = false;

        if (vehicle && policy) {
            const failureMileage = Number(claim.mileageAtFailure);
            const MileageAtSales = Number(vehicle.currentOdometer);
            const maxKilometers = Number(policy.maxKilometers);

     const usageAtFailure = failureMileage - MileageAtSales;
//  console.log("failureMileage",failureMileage);
//  console.log("mileageAtSales",MileageAtSales);
//  console.log("maxKilometers",maxKilometers);
//  console.log("usageAtFailure",usageAtFailure);

    mileageValid =
        Number.isFinite(failureMileage) &&
        Number.isFinite(MileageAtSales) &&
        Number.isFinite(maxKilometers) &&
        failureMileage >= MileageAtSales &&
        maxKilometers >= 0 &&
        usageAtFailure <= maxKilometers;
}
        

        let submissionValid = false;

        if (policy && claim.failureDate) {

            const failureDate = new Date(claim.failureDate);
            const submissionDate = new Date();

            const daysDifference = Math.floor((submissionDate - failureDate) /(1000 * 60 * 60 * 24));

            submissionValid =
                daysDifference >= 0 &&
                daysDifference <= policy.claimSubmissionDays;
        }

        const duplicate = await SELECT.one.from(WarrantyClaims).where`repairReference = ${claim.repairReference} and ID != ${claimID}`;

        const isDuplicate = !!duplicate;

        const withinClaimLimit =
            !!policy &&
            (
                policy.maxClaimAmount == null ||
                Number(claim.requestedAmount) <=
                    Number(policy.maxClaimAmount)
            );

       const isEligible =
            dealerValid &&
            vehicleValid &&
            policyValid &&
            warrantyValid &&
            mileageValid &&
            submissionValid &&
            !isDuplicate &&
            withinClaimLimit;

        
        const reasons = [];

        if (!dealerValid) reasons.push('Dealer is inactive or invalid');
        if (!vehicleValid) reasons.push('Vehicle is invalid or not assigned to dealer');
        if (!policyValid) reasons.push('Warranty policy is inactive or missing');
        if (!warrantyValid) reasons.push('Warranty period has expired');
        if (!mileageValid) reasons.push('Failure mileage exceeds permitted mileage');
        if (!submissionValid) reasons.push('Claim submitted outside permitted period');
        if (isDuplicate) reasons.push('Duplicate repair reference');
       // if (!withinClaimLimit) reasons.push('Claim amount exceeds policy limit');

        
        await 
            INSERT.into(EligibilityChecks).entries({
                claim_ID: claimID,
                claimVersion: claim.claimVersion,
                checkDate: new Date().toISOString(),
                dealerValid,
                vehicleValid,
                policyValid,
                warrantyValid,
                mileageValid,
                submissionValid,
                isDuplicate,
                partsEligible: true,
                labourEligible: true,
                withinClaimLimit,
                isEligible,
                failureReason: reasons.join('; ')
            });

    
        if (isEligible) {

            await UPDATE(WarrantyClaims)
                    .set({
                        warrantyPolicy_ID: policy.ID,
                        eligibleAmount:policy.maxClaimAmount,
                        claimDate: new Date().toISOString().slice(0, 10),
                        submittedAt: new Date().toISOString().slice(0,10),
                        status: 'UnderWarrantyReview'
                    })
                    .where({ ID: claimID });
const existingTask = await SELECT.one
    .from(ClaimReviewTasks)
    .where({
        claim_ID: claimID,
        claimVersion: claim.claimVersion,
        reviewStage: 'WarrantyReview',
        taskStatus: 'Open'
    });
    if (!existingTask) {
await INSERT.into(ClaimReviewTasks).entries({
    claimVersion: claim.claimVersion,
    reviewStage: 'WarrantyReview',
    assignedRole: 'WarrantyAnalyst',
    taskStatus: 'Open',
    assignedAt: new Date().toISOString().slice(0,10),
    assignedTo   : 'analyst',
   claim_ID: claimID
});
    }
        }

        return isEligible;
    });


this.before('UPDATE', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;
    const claim = await SELECT.one
        .from(WarrantyClaims)
        .where({ ID: claimID });

    if (!claim) {
        return req.reject(404, 'Warranty claim not found');
    }
    const restrictedFields = [
        'claimNumber',
        'status',
        'claimVersion',
        'submittedAt',
        'eligibleAmount',
        'approvedAmount',
        'overrideAmount',
        'financeApprovedAmount',
        'isOutOfPolicy',
        'rejectionReason',
        'cancellationReason',
        'closedAt'
    ];
    for (const field of restrictedFields) {

        if (req.data[field] !== undefined) {
            return req.reject(400,`${field} cannot be modified directly`);
        }
    }

});
this.before('UPDATE', 'ClaimParts', async (req) => {

    const partID = req.params[0].ID;
    const part = await SELECT.one
        .from(ClaimParts)
        .where({ ID: partID });

    if (!part) {
        return req.reject(404, 'Claim part not found');
    }
    const claim = await SELECT.one
        .from(WarrantyClaims)
        .where({ ID: part.claim_ID });

    if (!claim) {
        return req.reject(404, 'Warranty claim not found');
    }
    if (!['Draft', 'InformationRequested'].includes(claim.status)) {
        return req.reject(
            400,
            'The Claim is already submitted , you can modify the parts!!!'
        );
    }
    const restrictedFields = [
        'partNumber',
        'description',
        'standardUnitPrice',
        'totalAmount',
        'hasPriceVariance',
        'lineStatus',
        'approvedQuantity',
        'approvedUnitPrice',
        'approvedAmount',
        'isOutOfPolicy'
    ];

    for (const field of restrictedFields) {
        if (req.data[field] !== undefined) {
            return req.reject(
                400,
                `${field} cannot be modified directly`
            );
        }
    }
    const quantity = req.data.quantity ?? part.quantity;
    const unitPrice = req.data.unitPrice ?? part.unitPrice


    if (quantity <= 0) {
        return req.reject(400, 'Quantity must be greater than zero');
    }

    if (unitPrice <= 0) {
        return req.reject(400, 'unit price must be greater than zero');
    }

    const hasPriceVariance = unitPrice > part.standardUnitPrice;

    if (hasPriceVariance) {
        const reason = req.data.priceVarianceReason
            ?? part.priceVarianceReason;

        if (!reason || !reason.trim()) {
            return req.reject(
                400,
                'Price variance reason is mandatory'
            );
        }
    }
    req.data.totalAmount = quantity * unitPrice;
    req.data.hasPriceVariance = hasPriceVariance;
});

this.before('UPDATE', 'ClaimLabour', async (req) => {

    const labourID = req.params[0].ID;

    const labour = await SELECT.one.from(ClaimLabour).where({ ID: labourID });

    if (!labour) {
        return req.reject(404, 'Claim labour not found');
    }

    const claim = await SELECT.one.from(WarrantyClaims).where({ ID: labour.claim_ID });

    if (!claim) {
        return req.reject(404, 'Warranty claim not found');
    }

    if (!['Draft', 'InformationRequested'].includes(claim.status)) {
        return req.reject(400, 'Labour cannot be updated after claim submission');
    }

    const restrictedFields = [
        'claim_ID',
        'standardRate',
        'totalAmount',
        'isPriceAboveStandard',
        'createdAt',
        'createdBy'
    ];

    for (const field of restrictedFields) {
        if (req.data[field] !== undefined) {
            return req.reject(400, `${field} cannot be updated manually`);
        }
    }
    const hours = req.data.hours ?? labour.hours;

    if (!Number.isFinite(Number(hours)) || Number(hours) <= 0) {
        return req.reject(400, 'Hours must be greater than zero');
    }

    // Validate hourly rate
    const hourlyRate = req.data.hourlyRate ?? labour.hourlyRate;

    if (!Number.isFinite(Number(hourlyRate)) || Number(hourlyRate) <= 0) {
        return req.reject(400, 'Hourly rate must be greater than zero');
    }

    // Calculate updated amount
    const totalAmount = Number(hours) * Number(hourlyRate);

    req.data.totalAmount = totalAmount;

    // Check standard rate
    const standardRate = Number(labour.standardRate);

    req.data.isPriceAboveStandard = Number(hourlyRate) > standardRate;

    if (
        req.data.isPriceAboveStandard &&
        !(req.data.varianceReason ?? labour.varianceReason)
    ) {
        return req.reject(400, 'Variance reason is mandatory when hourly rate exceeds standard rate');
    }

    if (!req.data.isPriceAboveStandard) {
        req.data.varianceReason = null;
    }
});

this.before('DELETE', 'ClaimParts', async (req) => {

    const partID = req.params[0].ID;

    const part = await SELECT.one.from(ClaimParts)
        .where({ ID: partID });

    if (!part) {
        return req.reject(404, 'Claim part not found');
    }

    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: part.claim_ID });

    if (!claim) {
        return req.reject(404, 'Warranty claim not found');
    }

    if (!['Draft', 'InformationRequested'].includes(claim.status)) {
        return req.reject(
            400,
            'Parts cannot be deleted because the claim is already submitted'
        );
    }

    req._claimID = part.claim_ID;

});

this.before('DELETE', 'ClaimLabour', async (req) => {

    const labourID = req.params[0].ID;

    const labour = await SELECT.one.from(ClaimLabour)
        .where({ ID: labourID });

    if (!labour) {
        return req.reject(404, 'Claim labour not found');
    }

    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: labour.claim_ID });

    if (!claim) {
        return req.reject(404, 'Warranty claim not found');
    }

    if (!['Draft', 'InformationRequested'].includes(claim.status)) {
        return req.reject(400, 'Labour cannot be deleted, the claim is already submitted');
    }


    req._claimID = labour.claim_ID;
});

this.after('CREATE','WarrantyClaims',async (data,req)=>{
    console.log("after warrantyclaim calculation function executing");
    console.log(data.ID);
    console.log(req.data.ID);
     await recalculateClaimAmount(req.data.ID);
});

this.after('CREATE', 'ClaimParts', async (data, req) => {
     console.log("after adding parts  calculation function executing");
    await recalculateClaimAmount(req.data.claim_ID);
});

this.after('UPDATE', 'ClaimParts', async (data, req) => {
     console.log("after updating parts, calculation function executing");
    await recalculateClaimAmount(req.data.claim_ID);
});

this.after('DELETE', 'ClaimParts', async (data, req) => {
     console.log("after deleteing parts ,calculation function executing");
    await recalculateClaimAmount(req._claimID);
});

this.after('CREATE', 'ClaimLabour', async (data, req) => {
     console.log("after adding labour, calculation function executing");
    await recalculateClaimAmount(req.data.claim_ID);
});
this.after('UPDATE', 'ClaimLabour', async (data, req) => {
     console.log("after updating labour ,calculation function executing");
    await recalculateClaimAmount(req.data.claim_ID);
});
this.after('DELETE', 'ClaimLabour', async (data, req) => {
     console.log("after deleting labour ,calculation function executing");
    await recalculateClaimAmount(req._claimID);
});
});    


