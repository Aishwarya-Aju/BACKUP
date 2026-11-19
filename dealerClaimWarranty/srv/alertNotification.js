const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

async function notifySettlement(claim, settlement) {

    await executeHttpRequest(
        {
            destinationName: 'alertDestination'
        },
        {
            method: 'POST',
            url: '/cf/producer/v1/resource-events',
            data: {
                eventType: 'custom.dealerclaim.warranty.settled',
                severity: 'INFO',
                subject: 'Warranty Claim Settled Successfully',
                 body: `Dear Dealer,

We are pleased to inform you that your warranty claim has been successfully settled.

Settlement Details:

Claim ID: ${claim.ID}
Settlement ID: ${settlement.settlementNumber}
Approved Amount: ${claim.currency} ${settlement.approvedAmount}

Thank you for your cooperation.

Regards,
Dealer Warranty Claim Management Team`,
                category: 'NOTIFICATION',
                resource: {
                    resourceName: 'DealerClaimWarranty',
                    resourceType: 'Application',
                    resourceInstance: claim.ID
                },
                tags: {
                    claimID: claim.ID,
                    settlementNumber: settlement.settlementNumber,
                    paymentStatus: 'Completed'
                }
            }
        }
    );

    console.log('Warranty settlement notification published');
}

module.exports = { notifySettlement };