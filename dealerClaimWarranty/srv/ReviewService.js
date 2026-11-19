
const cds = require('@sap/cds');
const { notifySettlement } = require('./alertNotification');

module.exports = cds.service.impl(async function () {

    const {
        WarrantyClaims,
        ClaimDecisions,
        ClaimReviewTasks,
        ClaimStatusHistory,
        SettlementRecords
    } = this.entities;

this.on('acceptClaim', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;

    const claim = await SELECT.one.from(WarrantyClaims).where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'UnderWarrantyReview') {
        return req.error(400,
            'Only claims under Warranty Review can be accepted');
    }

    const warrantyTask = await SELECT.one.from(ClaimReviewTasks)
        .where({
            claim_ID: claimID,
            claimVersion: claim.claimVersion,
            reviewStage: 'WarrantyReview',
            taskStatus: 'Open'
        });

    if (!warrantyTask) {
        return req.error(404, 'Open Warranty Review task not found');
    }
    await INSERT.into(ClaimDecisions).entries({
        claimVersion: claim.claimVersion,
        decisionStage: 'WarrantyReview',
        decision: 'Accepted',
        comments: 'Claim accepted by Warranty Analyst',
        decidedBy: req.user.id || 'Analyst',
        decidedAt: new Date().toISOString(),
        claim_ID: claimID
    });
    await UPDATE(ClaimReviewTasks)
        .set({
            taskStatus: 'Completed',
            completedAt: new Date().toISOString()
        })
        .where({ ID: warrantyTask.ID });

    await INSERT.into(ClaimStatusHistory).entries({
        claimVersion: claim.claimVersion,
        previousStatus: 'UnderWarrantyReview',
        newStatus: 'UnderTechnicalReview',
        changeReason: 'Claim accepted by Warranty Analyst',
        changedBy: req.user.id || 'Analyst',
        changedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    await UPDATE(WarrantyClaims)
        .set({
            status: 'UnderTechnicalReview'
        })
        .where({ ID: claimID });

        await INSERT.into(ClaimReviewTasks).entries({
        claimVersion: claim.claimVersion,
        reviewStage: 'TechnicalReview',
        assignedRole: 'TechnicalApprover',
        taskStatus: 'Open',
        assignedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    return 'Claim accepted successfully and forwarded to Technical Review';

});

this.on('requestInformation', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;
    const reason = req.data.reason;

    const claim = await SELECT.one.from(WarrantyClaims).where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'UnderWarrantyReview') {
        return req.error(400, 'Only claims under Warranty Review can request information');
    }

    if (!reason || !reason.trim()) {
        return req.error(400, 'Reason is mandatory');
    }

    const warrantyTask = await SELECT.one.from(ClaimReviewTasks).where({
        claim_ID: claimID,
        claimVersion: claim.claimVersion,
        reviewStage: 'WarrantyReview',
        taskStatus: 'Open'
    });

if (!warrantyTask) {
    return req.error(404, 'Open Warranty Review task not found');
}

await INSERT.into(ClaimDecisions).entries({
    claimVersion: claim.claimVersion,
    decisionStage: 'WarrantyReview',
    decision: 'InformationRequested',
    comments: reason,
    decidedBy: req.user.id,
    decidedAt: new Date().toISOString(),
    claim_ID: claimID
});

await UPDATE(ClaimReviewTasks).set({
    taskStatus: 'Completed',
    completedAt: new Date().toISOString()
}).where({ ID: warrantyTask.ID });

await INSERT.into(ClaimStatusHistory).entries({
    claimVersion: claim.claimVersion,
    previousStatus: 'UnderWarrantyReview',
    newStatus: 'InformationRequested',
    changeReason: reason,
    changedBy: req.user.id,
    changedAt: new Date().toISOString(),
    claim_ID: claimID
});
await UPDATE(WarrantyClaims).set({
    status: 'InformationRequested'
}).where({ ID: claimID });

return 'Additional information requested successfully';
   });

   this.on('rejectClaim', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;
    const reason = req.data.reason;

    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'UnderWarrantyReview') {
        return req.error(400,
            'Only claims under Warranty Review can be rejected');
    }

    if (!reason || !reason.trim()) {
        return req.error(400, 'Rejection reason is mandatory');
    }

    const warrantyTask = await SELECT.one.from(ClaimReviewTasks)
        .where({
            claim_ID: claimID,
            claimVersion: claim.claimVersion,
            reviewStage: 'WarrantyReview',
            taskStatus: 'Open'
        });

    if (!warrantyTask) {
        return req.error(404, 'Open Warranty Review task not found');
    }

    // 1. Record rejection decision
    await INSERT.into(ClaimDecisions).entries({
        claimVersion: claim.claimVersion,
        decisionStage: 'WarrantyReview',
        decision: 'Rejected',
        comments: reason,
        decidedBy: req.user.id,
        decidedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    // 2. Complete Warranty Review task
    await UPDATE(ClaimReviewTasks).set({
        taskStatus: 'Completed',
        completedAt: new Date().toISOString()
    }).where({ ID: warrantyTask.ID });

    // 3. Record status history
    await INSERT.into(ClaimStatusHistory).entries({
        claimVersion: claim.claimVersion,
        previousStatus: 'UnderWarrantyReview',
        newStatus: 'Rejected',
        changeReason: reason,
        changedBy: req.user.id,
        changedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    // 4. Update claim status
    await UPDATE(WarrantyClaims).set({
        status: 'Rejected',
        rejectionReason: reason,
        closedAt: new Date().toISOString()
    }).where({ ID: claimID });

    return 'Warranty claim rejected successfully';

});

this.on('approveTechnicalClaim', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;

    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'UnderTechnicalReview') {
        return req.error(400,
            'Only claims under Technical Review can be approved');
    }

    const technicalTask = await SELECT.one.from(ClaimReviewTasks)
        .where({
            claim_ID: claimID,
            claimVersion: claim.claimVersion,
            reviewStage: 'TechnicalReview',
            taskStatus: 'Open'
        });

    if (!technicalTask) {
        return req.error(404, 'Open Technical Review task not found');
    }

    // 1. Record technical approval
    await INSERT.into(ClaimDecisions).entries({
        claimVersion: claim.claimVersion,
        decisionStage: 'TechnicalReview',
        decision: 'Approved',
        comments: 'Claim approved by Technical Approver',
        decidedBy: req.user.id,
        decidedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    // 2. Complete Technical Review task
    await UPDATE(ClaimReviewTasks).set({
        taskStatus: 'Completed',
        completedAt: new Date().toISOString()
    }).where({ ID: technicalTask.ID });

    // 3. Record status history
    await INSERT.into(ClaimStatusHistory).entries({
        claimVersion: claim.claimVersion,
        previousStatus: 'UnderTechnicalReview',
        newStatus: 'UnderFinanceReview',
        changeReason: 'Claim approved by Technical Approver',
        changedBy: req.user.id,
        changedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    // 4. Update claim status
    await UPDATE(WarrantyClaims).set({
        status: 'UnderFinanceReview'
    }).where({ ID: claimID });

    // 5. Create Finance Review task
    await INSERT.into(ClaimReviewTasks).entries({
        claimVersion: claim.claimVersion,
        reviewStage: 'FinanceReview',
        assignedRole: 'FinanceUser',
        taskStatus: 'Open',
        assignedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    return 'Technical approval successful. Claim forwarded to Finance Review';

});

this.on('rejectTechnicalClaim', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;
    const reason = req.data.reason;

    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'UnderTechnicalReview') {
        return req.error(400,
            'Only claims under Technical Review can be rejected');
    }

    if (!reason || !reason.trim()) {
        return req.error(400, 'Rejection reason is mandatory');
    }

    const technicalTask = await SELECT.one.from(ClaimReviewTasks)
        .where({
            claim_ID: claimID,
            claimVersion: claim.claimVersion,
            reviewStage: 'TechnicalReview',
            taskStatus: 'Open'
        });

    if (!technicalTask) {
        return req.error(404, 'Open Technical Review task not found');
    }

    // 1. Record rejection decision
    await INSERT.into(ClaimDecisions).entries({
        claimVersion: claim.claimVersion,
        decisionStage: 'TechnicalReview',
        decision: 'Rejected',
        comments: reason,
        decidedBy: req.user.id,
        decidedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    // 2. Complete Technical Review task
    await UPDATE(ClaimReviewTasks).set({
        taskStatus: 'Completed',
        completedAt: new Date().toISOString()
    }).where({ ID: technicalTask.ID });

    // 3. Record status history
    await INSERT.into(ClaimStatusHistory).entries({
        claimVersion: claim.claimVersion,
        previousStatus: 'UnderTechnicalReview',
        newStatus: 'Rejected',
        changeReason: reason,
        changedBy: req.user.id,
        changedAt: new Date().toISOString(),
        claim_ID: claimID
    });

    // 4. Update claim status
    await UPDATE(WarrantyClaims).set({
        status: 'Rejected',
        rejectionReason: reason,
        closedAt: new Date().toISOString()
    }).where({ ID: claimID });

    return 'Claim rejected by Technical Approver';

});



this.on('approveFinanceClaim', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;

    const {
        financeApprovedAmount,
        financeAdjustmentReason
    } = req.data;

    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'UnderFinanceReview') {
        return req.error(400,
            'Only claims under Finance Review can be approved');
    }

    const financeTask = await SELECT.one.from(ClaimReviewTasks)
        .where({
            claim_ID: claimID,
            claimVersion: claim.claimVersion,
            reviewStage: 'FinanceReview',
            taskStatus: 'Open'
        });

    if (!financeTask) {
        return req.error(404, 'Open Finance Review task not found');
    }

    const finalAmount = Number(financeApprovedAmount);

    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
        return req.error(400,
            'Finance-approved amount must be greater than zero');
    }

    if (claim.requestedAmount === null ||
        claim.requestedAmount === undefined) {
        return req.error(400,
            'Requested amount is missing from the warranty claim');
    }

    if (finalAmount > claim.requestedAmount)
    {
        return req.error(400,
            'final amount should not be greater than requested amount');
    }
    // 2. Check whether Finance has changed the approved amount

    const amountChanged =
        finalAmount.toFixed(2) !==
        Number(claim.requestedAmount).toFixed(2);

    const adjustmentReason =
        financeAdjustmentReason?.trim();

    if (amountChanged && !adjustmentReason) {
        return req.error(400,
            'Adjustment reason is mandatory when Finance changes the approved amount');
    }

    // 3. Check existing settlement BEFORE making changes

    const existingSettlement = await SELECT.one.from(SettlementRecords)
        .where({ claim_ID: claimID });

    if (existingSettlement) {
        return req.error(400,
            'Settlement record already exists for this claim');
    }

    const now = new Date().toISOString();

    // 4. Update WarrantyClaims with Finance approval details

    await UPDATE(WarrantyClaims).set({
        approvedAmount:finalAmount,
        financeApprovedAmount: finalAmount,
        financeAdjustmentReason: amountChanged
            ? adjustmentReason
            : null,
        status: 'Approved'
    }).where({ ID: claimID });

    await INSERT.into(ClaimDecisions).entries({
        claimVersion: claim.claimVersion,
        decisionStage: 'FinanceReview',
        decision: 'Approved',
        comments: amountChanged
            ? adjustmentReason
            : 'Claim approved without financial adjustment',
        approvedAmount: finalAmount,
        decidedBy: req.user.id,
        decidedAt: now,
        claim_ID: claimID
    });

    // 6. Complete Finance Review task

    await UPDATE(ClaimReviewTasks).set({
        taskStatus: 'Completed',
        completedAt: now
    }).where({ ID: financeTask.ID });

    // 7. Record status history

    await INSERT.into(ClaimStatusHistory).entries({
        claimVersion: claim.claimVersion,
        previousStatus: 'UnderFinanceReview',
        newStatus: 'Approved',
        changeReason: 'Claim approved by Finance User',
        changedBy: req.user.id,
        changedAt: now,
        claim_ID: claimID
    });

    const crypto = require('crypto');

    const year = new Date().getFullYear();

    const randomNumber = crypto.randomBytes(3)
        .toString('hex')
        .toUpperCase();

    const settlementNumber = `SET-${year}-${randomNumber}`;

    await INSERT.into(SettlementRecords).entries({
        settlementNumber: settlementNumber,
        approvedAmount: finalAmount,
        paidAmount: 0,
        currency: claim.currency,
        paymentStatus: 'Pending',
        remarks: 'Settlement initiated by Finance User',
        claim_ID: claimID
    });

    return 'Finance approval completed and settlement record created successfully';

});


this.on('rejectFinanceClaim', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;
    const reason = req.data.reason;

    const claim = await SELECT.one.from(WarrantyClaims)
        .where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'UnderFinanceReview') {
        return req.error(400,
            'Only claims under Finance Review can be rejected');
    }

    if (!reason || !reason.trim()) {
        return req.error(400, 'Rejection reason is mandatory');
    }

    const financeTask = await SELECT.one.from(ClaimReviewTasks)
        .where({
            claim_ID: claimID,
            claimVersion: claim.claimVersion,
            reviewStage: 'FinanceReview',
            taskStatus: 'Open'
        });

    if (!financeTask) {
        return req.error(404, 'Open Finance Review task not found');
    }
    await INSERT.into(ClaimDecisions).entries({
        claimVersion: claim.claimVersion,
        decisionStage: 'FinanceReview',
        decision: 'Rejected',
        comments: reason,
        decidedBy: req.user.id,
        decidedAt: new Date().toISOString(),
        claim_ID: claimID
    });
    await UPDATE(ClaimReviewTasks).set({
        taskStatus: 'Completed',
        completedAt: new Date().toISOString()
    }).where({ ID: financeTask.ID });

    await INSERT.into(ClaimStatusHistory).entries({
        claimVersion: claim.claimVersion,
        previousStatus: 'UnderFinanceReview',
        newStatus: 'Rejected',
        changeReason: reason,
        changedBy: req.user.id,
        changedAt: new Date().toISOString(),
        claim_ID: claimID
    });
    await UPDATE(WarrantyClaims).set({
        status: 'Rejected',
        rejectionReason: reason,
        closedAt: new Date().toISOString()
    }).where({ ID: claimID });

    return 'Claim rejected successfully by Finance';

});


this.on('settleClaim', 'WarrantyClaims', async (req) => {

    const claimID = req.params[0].ID;

    const claim = await SELECT.one.from(WarrantyClaims).where({ ID: claimID });

    if (!claim) {
        return req.error(404, 'Warranty claim not found');
    }

    if (claim.status !== 'Approved') {
        return req.error(400,'Only approved claims can be settled');
    }

    const settlement = await SELECT.one.from(SettlementRecords).where({ claim_ID: claimID });

    if (!settlement) {
        return req.error(404,'Settlement record not found for this claim');
    }

    if (settlement.paymentStatus === 'Completed') {
        return req.error(400,'This claim has already been settled');
    }

    await UPDATE(SettlementRecords).set({
        paidAmount: settlement.approvedAmount,
        paymentStatus: 'Completed',
        paymentDate: new Date().toISOString().slice(0, 10),
        remarks: 'Payment completed by Finance User'
    }).where({ ID: settlement.ID });

    await INSERT.into(ClaimStatusHistory).entries({
    claimVersion: claim.claimVersion,
    previousStatus: 'Approved',
    newStatus: 'Settled',
    changeReason: 'Payment completed by Finance User',
    changedBy: req.user.id,
    changedAt: new Date().toISOString(),
    claim_ID: claimID
});

    await UPDATE(WarrantyClaims).set({
        status: 'Settled',
        closedAt: new Date().toISOString()
    }).where({ ID: claimID });

     try {
        await notifySettlement(claim, settlement);
    } catch (error) {
        console.error(
            'Settlement notification failed:',
            error.message
        );
    }
    return 'Claim settled successfully';

});

});
