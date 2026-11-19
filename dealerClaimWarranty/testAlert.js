
const { notifySettlement } = require('./srv/alertNotification');

async function testAlert() {
 
    const claim = {
        ID: 'TEST-CLAIM-001',
        currency: 'INR'
    };

    const settlement = {
        settlementNumber: 'SET-2026-TEST01',
        approvedAmount: 25000
    };

    try {

        await notifySettlement(claim, settlement);

        console.log('Alert notification test successful');

    } catch (error) {

        console.error('Alert notification test failed');
        console.error(error.message);

    }
}

testAlert();
