const cds = require('@sap/cds');

module.exports = cds.service.impl(function () {

    const {
        Vendors,
        Deliveries,
        QualityComplaints,
        Invoices,
        RiskAssessments
    } = cds.entities('vendorrisk');

    this.before('CREATE', 'Deliveries', async (req) => {
        calculateDeliveryFields(req.data);
    });

    this.before('UPDATE', 'Deliveries', async (req) => {

        const delivery = await SELECT.one
            .from(Deliveries)
            .where({ ID: req.data.ID });

        if (!delivery) {
            return req.error(404, 'Delivery not found');
        }

        const data = {
            ...delivery,
            ...req.data
        };

        calculateDeliveryFields(data);

        req.data.deliveryPercentage = data.deliveryPercentage;
        req.data.partialDelivery = data.partialDelivery;
        req.data.delayDays = data.delayDays;
        req.data.deliveryStatus = data.deliveryStatus;
    });

   
    this.on('calculateDeliveryRisk', async (req) => {

        const { vendorID } = req.data;

        if (!vendorID) {
            return req.error(400, 'vendorID is required');
        }

        return await calculateDeliveryRiskScore(vendorID);
    });


    // =========================================================
    // QUALITY RISK ACTION
    // =========================================================

    this.on('calculateQualityRisk', async (req) => {

        const { vendorID } = req.data;

        if (!vendorID) {
            return req.error(400, 'vendorID is required');
        }

        return await calculateQualityRiskScore(vendorID);
    });


    // =========================================================
    // PRICE RISK ACTION
    // =========================================================

    this.on('calculatePriceDeviationRisk', async (req) => {

        const { vendorID } = req.data;

        if (!vendorID) {
            return req.error(400, 'vendorID is required');
        }

        return await calculatePriceRiskScore(vendorID);
    });


    // =========================================================
    // OVERALL VENDOR RISK
    // =========================================================

    this.on('calculateOverallVendorRisk', async (req) => {

        const { vendorID } = req.data;

        if (!vendorID) {
            return req.error(400, 'vendorID is required');
        }

        // Get already-defined calculations
        const delivery = await calculateDeliveryRiskScore(vendorID);

        const quality = await calculateQualityRiskScore(vendorID);

        const price = await calculatePriceRiskScore(vendorID);


        // -----------------------------------------------------
        // Overall Risk Calculation
        // -----------------------------------------------------

        const overallRiskScore =
            (delivery.deliveryRiskScore * 0.40) +
            (quality.qualityRiskScore * 0.35) +
            (price.priceRiskScore * 0.25);

        const finalScore =
            Number(overallRiskScore.toFixed(2));


        // -----------------------------------------------------
        // Overall Risk Level
        // -----------------------------------------------------

        let riskLevel;

        if (finalScore <= 20) {
            riskLevel = 'Low';
        }
        else if (finalScore <= 60) {
            riskLevel = 'Medium';
        }
        else if (finalScore <= 70) {
            riskLevel = 'High';
        }
        else {
            riskLevel = 'Critical';
        }


        // -----------------------------------------------------
        // Save Risk Assessment
        // -----------------------------------------------------

        const existing = await SELECT.one
            .from(RiskAssessments)
            .where({ vendor_ID: vendorID });
        const existingVendor = await SELECT.one.from(Vendors).where({ID: vendorID });
         
         if (existingVendor) {

            await UPDATE(Vendors)
                .set({
                    currentRiskScore:finalScore,
                    riskLevel:riskLevel,
                    lastRiskCalculation:new Date()
                                  })
                .where({
                    ID: existingVendor.ID
                });
        

        }
        if (existing) {

            await UPDATE(RiskAssessments)
                .set({
                    assessmentDate: new Date(),
                    deliveryRisk: delivery.deliveryRiskScore,
                    qualityRisk: quality.qualityRiskScore,
                    priceRisk: price.priceRiskScore,
                    overallRiskScore: finalScore,
                    riskLevel: riskLevel,
                    calculationStatus: 'Completed'
                })
                .where({
                    ID: existing.ID
                });
        

        }
        else {

            await INSERT.into(RiskAssessments).entries({

                vendor_ID: vendorID,

                assessmentDate: new Date(),

                deliveryRisk:
                    delivery.deliveryRiskScore,

                qualityRisk:
                    quality.qualityRiskScore,

                priceRisk:
                    price.priceRiskScore,

                overallRiskScore:
                    finalScore,

                riskLevel:
                    riskLevel,

                calculationStatus:
                    'Completed'
            });
        }


        // -----------------------------------------------------
        // Return Result
        // -----------------------------------------------------

        return {

            vendorID: vendorID,

            deliveryRisk:
                delivery.deliveryRiskScore,

            qualityRisk:
                quality.qualityRiskScore,

            priceRisk:
                price.priceRiskScore,

            overallRiskScore:
                finalScore,

            riskLevel:
                riskLevel,

            calculationStatus:
                'Completed'
        };
    });


   
    // DELIVERY RISK CALCULATION
    async function calculateDeliveryRiskScore(vendorID) {

        const deliveries = await SELECT.from(Deliveries).where({
                vendor_ID: vendorID
            });


        if (!deliveries.length) {
            return {
                vendorID: vendorID,
                deliveryRiskScore: 0,
                riskLevel: 'No Data'
            };
        }


        // Calculate delivery fields for all the delivery made by particular vendor
        const calculatedDeliveries =
            deliveries.map(delivery => {
                const data = {
                    ...delivery
                };

                calculateDeliveryFields(data);

                return data;
            });

        // Save calculated delivery fields
        for (const delivery of calculatedDeliveries) {

            await UPDATE(Deliveries)
                .set({

                    deliveryPercentage:
                        delivery.deliveryPercentage,

                    partialDelivery:
                        delivery.partialDelivery,

                    delayDays:
                        delivery.delayDays,

                    deliveryStatus:
                        delivery.deliveryStatus
                })
                .where({
                    ID: delivery.ID
                });
        }


        const totalDeliveries =calculatedDeliveries.length;  ///t/t/t/p/p/


        const delayedDeliveries =
            calculatedDeliveries.filter(
                d => d.deliveryStatus === 'Delayed'
            ).length;


        const partialDeliveries =
            calculatedDeliveries.filter(
                d => d.partialDelivery === true
            ).length;


        const totalDelayDays =
            calculatedDeliveries.reduce(
                (sum, d) =>
                    sum + (Number(d.delayDays) || 0),
                0
            );


        const averageDelayDays =
            totalDelayDays / totalDeliveries;


        const delayedPercentage =
            (delayedDeliveries / totalDeliveries) * 100;


        const partialPercentage =
            (partialDeliveries / totalDeliveries) * 100;


        const totalDeliveryPercentage =
            calculatedDeliveries.reduce(
                (sum, d) =>
                    sum +
                    (Number(d.deliveryPercentage) || 0),
                0
            );


        const averageDeliveryPercentage =
            totalDeliveryPercentage /
            totalDeliveries;

//delay score calculation based on avg delay days 
        let delayScore = 0;

        if (averageDelayDays <= 0)
            delayScore = 0;

        else if (averageDelayDays <= 2)
            delayScore = 20;

        else if (averageDelayDays <= 5)
            delayScore = 40;

        else if (averageDelayDays <= 10)
            delayScore = 70;

        else
            delayScore = 100;

//delay delivery score based on delaypercent 

        let delayedDeliveryScore = 0;

        if (delayedPercentage <= 10)
            delayedDeliveryScore = 10;

        else if (delayedPercentage <= 25)
            delayedDeliveryScore = 30;

        else if (delayedPercentage <= 50)
            delayedDeliveryScore = 60;

        else if (delayedPercentage <= 75)
            delayedDeliveryScore = 80;

        else
            delayedDeliveryScore = 100;
//partial de score based on Par del score

        let partialDeliveryScore = 0;

        if (partialPercentage <= 10)
            partialDeliveryScore = 10;

        else if (partialPercentage <= 25)
            partialDeliveryScore = 30;

        else if (partialPercentage <= 50)
            partialDeliveryScore = 60;

        else if (partialPercentage <= 75)
            partialDeliveryScore = 80;

        else
            partialDeliveryScore = 100;

//completionscore risk score
        let completionScore = 0;

        if (averageDeliveryPercentage >= 95)
            completionScore = 0;

        else if (averageDeliveryPercentage >= 80)
            completionScore = 30;

        else if (averageDeliveryPercentage >= 60)
            completionScore = 60;

        else if (averageDeliveryPercentage >= 40)
            completionScore = 80;

        else
            completionScore = 100;
// delivery risk score  weightage delay = 50% , dds 25% pds 15% cs 10%

        const deliveryRiskScore =
            (delayScore * 0.50) +
            (delayedDeliveryScore * 0.25) +
            (partialDeliveryScore * 0.15) +
            (completionScore * 0.10);


        const finalScore =
            Number(deliveryRiskScore.toFixed(2));


        let riskLevel;

        if (finalScore <= 20)
            riskLevel = 'Low';

        else if (finalScore <= 40)
            riskLevel = 'Medium';

        else if (finalScore <= 70)
            riskLevel = 'High';

        else
            riskLevel = 'Critical';


        return {

            vendorID: vendorID,

            totalDeliveries:
                totalDeliveries,

            delayedDeliveries:
                delayedDeliveries,

            partialDeliveries:
                partialDeliveries,

            averageDelayDays:
                Number(averageDelayDays.toFixed(2)),

            delayedPercentage:
                Number(delayedPercentage.toFixed(2)),

            partialPercentage:
                Number(partialPercentage.toFixed(2)),

            averageDeliveryPercentage:
                Number(averageDeliveryPercentage.toFixed(2)),

            delayScore:
                delayScore,

            delayedDeliveryScore:
                delayedDeliveryScore,

            partialDeliveryScore:
                partialDeliveryScore,

            completionScore:
                completionScore,

            deliveryRiskScore:
                finalScore,

            riskLevel:
                riskLevel
        };
    }


//Quality Risk Calculation 

    async function calculateQualityRiskScore(vendorID) {

        const complaints = await SELECT
            .from(QualityComplaints)
            .where({
                vendor_ID: vendorID
            });


        if (!complaints.length) {

            return {

                vendorID: vendorID,

                totalComplaints: 0,

                qualityRiskScore: 0,

                riskLevel: 'No Data'
            };
        }


        let totalInspectedQuantity = 0;

        let totalRejectedQuantity = 0;

        let totalDefectPercentage = 0;

        let totalSeverityScore = 0;


        for (const complaint of complaints) {

            const inspected =
                Number(
                    complaint.inspectedQuantity
                ) || 0;


            const rejected =
                Number(
                    complaint.rejectedQuantity
                ) || 0;


            totalInspectedQuantity +=inspected;


            totalRejectedQuantity +=rejected;


            let defectPercentage = 0;


            if (inspected > 0) {

                defectPercentage =(rejected / inspected) * 100;

                defectPercentage =Math.min(
                        defectPercentage,
                        100
                    );
            }


            totalDefectPercentage +=defectPercentage;


            // Save calculated defect percentage

            await UPDATE(QualityComplaints)
                .set({

                    defectPercentage:
                        Number(
                            defectPercentage.toFixed(2)
                        )
                })
                .where({
                    ID: complaint.ID
                });


            // Severity score

            const severity =
                String(
                    complaint.severity || ''
                ).toLowerCase();


            let severityScore = 0;


            if (severity === 'low')
                severityScore = 10;

            else if (severity === 'medium')
                severityScore = 40;

            else if (severity === 'high')
                severityScore = 70;

            else if (severity === 'critical')
                severityScore = 100;


            totalSeverityScore +=
                severityScore;
        }


        const totalComplaints =
            complaints.length;


        const averageDefectPercentage =
            totalDefectPercentage /
            totalComplaints;


        const averageSeverityScore =
            totalSeverityScore /
            totalComplaints;


        // -----------------------------------------------------
        // Defect Score
        // -----------------------------------------------------

        let defectScore = 0;

        if (averageDefectPercentage <= 0)
            defectScore = 0;

        else if (averageDefectPercentage <= 1)
            defectScore = 10;

        else if (averageDefectPercentage <= 3)
            defectScore = 30;

        else if (averageDefectPercentage <= 5)
            defectScore = 50;

        else if (averageDefectPercentage <= 10)
            defectScore = 75;

        else
            defectScore = 100;


        // -----------------------------------------------------
        // Quality Risk
        // -----------------------------------------------------

        const qualityRiskScore =
            (defectScore * 0.70) +
            (averageSeverityScore * 0.30);


        const finalScore =Number(qualityRiskScore.toFixed(2));


        let riskLevel;

        if (finalScore <= 20)
            riskLevel = 'Low';

        else if (finalScore <= 40)
            riskLevel = 'Medium';

        else if (finalScore <= 70)
            riskLevel = 'High';

        else
            riskLevel = 'Critical';


        return {

            vendorID: vendorID,

            totalComplaints:
                totalComplaints,

            totalInspectedQuantity:
                totalInspectedQuantity,

            totalRejectedQuantity:
                totalRejectedQuantity,

            averageDefectPercentage:
                Number(
                    averageDefectPercentage.toFixed(2)
                ),

            defectScore:
                defectScore,

            severityScore:
                Number(
                    averageSeverityScore.toFixed(2)
                ),

            qualityRiskScore:
                finalScore,

            riskLevel:
                riskLevel
        };
    }


   // PRICE RISK CALCULATION  

    async function calculatePriceRiskScore(vendorID) {

        const invoices = await SELECT
            .from(Invoices)
            .where({
                vendor_ID: vendorID
            });


        if (!invoices.length) {

            return {

                vendorID: vendorID,

                totalInvoices: 0,

                priceRiskScore: 0,

                riskLevel: 'No Data'
            };
        }


        let totalPriceIncrease = 0;

        let totalDeviation = 0;


        for (const invoice of invoices) {

            const oldPrice =
                Number(invoice.oldPrice) || 0;


            const currentPrice =
                Number(invoice.currentPrice) || 0;


            let priceDifference =
                currentPrice - oldPrice;


            let priceDeviation = 0;


            if (oldPrice > 0) {

                priceDeviation =
                    (priceDifference / oldPrice) * 100;
            }


            // Negative price changes are not considered risk

            const riskDeviation =
                Math.max(
                    priceDeviation,
                    0
                );


            if (riskDeviation > 0) {

                totalPriceIncrease +=
                    priceDifference;
            }


            totalDeviation +=
                riskDeviation;


            // Save calculated values

            await UPDATE(Invoices)
                .set({

                    priceDifference:
                        Number(
                            priceDifference.toFixed(2)
                        ),

                    priceDeviationPercent:
                        Number(
                            priceDeviation.toFixed(2)
                        )
                })
                .where({
                    ID: invoice.ID
                });
        }


        const totalInvoices =
            invoices.length;


        const averagePriceDeviationPercent =
            totalDeviation /
            totalInvoices;


        // -----------------------------------------------------
        // Price Deviation Score
        // -----------------------------------------------------

        let priceDeviationScore = 0;

        if (averagePriceDeviationPercent <= 0)
            priceDeviationScore = 0;

        else if (averagePriceDeviationPercent <= 2)
            priceDeviationScore = 10;

        else if (averagePriceDeviationPercent <= 5)
            priceDeviationScore = 30;

        else if (averagePriceDeviationPercent <= 10)
            priceDeviationScore = 50;

        else if (averagePriceDeviationPercent <= 20)
            priceDeviationScore = 75;

        else
            priceDeviationScore = 100;


        const finalScore =
            Number(
                priceDeviationScore.toFixed(2)
            );


        let riskLevel;

        if (finalScore <= 20)
            riskLevel = 'Low';

        else if (finalScore <= 40)
            riskLevel = 'Medium';

        else if (finalScore <= 70)
            riskLevel = 'High';

        else
            riskLevel = 'Critical';


        return {

            vendorID: vendorID,

            totalInvoices:
                totalInvoices,

            totalPriceIncrease:
                Number(
                    totalPriceIncrease.toFixed(2)
                ),

            averagePriceDeviationPercent:
                Number(
                    averagePriceDeviationPercent.toFixed(2)
                ),

            priceDeviationScore:
                priceDeviationScore,

            priceRiskScore:
                finalScore,

            riskLevel:
                riskLevel
        };
    }



    // =========================================================
    // COMMON DELIVERY FIELD CALCULATION
    // =========================================================

    function calculateDeliveryFields(data) {

        const ordered =
            Number(data.orderedQuantity) || 0;

        const delivered =
            Number(data.deliveredQuantity) || 0;


        // Delivery percentage

        if (ordered > 0) {

            let percentage =
                (delivered / ordered) * 100;

            percentage =
                Math.min(
                    percentage,
                    100
                );

            data.deliveryPercentage =
                Number(
                    percentage.toFixed(2)
                );

        }
        else {

            data.deliveryPercentage = 0;
        }


        // Partial delivery

        if (
            delivered > 0 &&
            delivered < ordered
        ) {

            data.partialDelivery = true;

        }
        else {

            data.partialDelivery = false;
        }


        // No expected date

        if (!data.expectedDeliveryDate) {

            data.delayDays = 0;

            data.deliveryStatus =
                'Pending';

            return;
        }


        const expected =
            new Date(
                data.expectedDeliveryDate
            );


        const comparisonDate =
            data.actualDeliveryDate
                ? new Date(
                    data.actualDeliveryDate
                )
                : new Date();


        expected.setHours(0, 0, 0, 0);

        comparisonDate.setHours(0, 0, 0, 0);


        const difference =
            Math.floor(
                (
                    comparisonDate -
                    expected
                ) /
                (1000 * 60 * 60 * 24)
            );


        if (data.actualDeliveryDate) {

            if (difference > 0) {

                data.delayDays =
                    difference;

                data.deliveryStatus =
                    'Delayed';

            }
            else {

                data.delayDays = 0;

                data.deliveryStatus =
                    'On Time';
            }

        }
        else {

            if (difference > 0) {

                data.delayDays =
                    difference;

                data.deliveryStatus =
                    'Delayed';

            }
            else {

                data.delayDays = 0;

                data.deliveryStatus =
                    'Pending';
            }
        }
    }

});
