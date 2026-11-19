sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/ui/core/mvc/XMLView",
    "sap/m/MessageToast"
], function (Controller, JSONModel,MessageBox,XMLView,MessageToast) {
    "use strict";

    return Controller.extend("score.dashboard.controller.App", {

        
        // Get the currently selected vendor UUID
        getSelectedVendorId: function () {
            return this.byId("vendorSelect").getSelectedKey();
        },

        // Call a CAP action
        executeRiskAction: function (sActionName, sVendorId) {
            const oModel = this.getView().getModel();

            if (!sVendorId) {
                sap.m.MessageToast.show("Please select a vendor.");
                return Promise.resolve();
            }

            // Create an OData V4 operation binding
            const oOperation = oModel.bindContext(
                "/" + sActionName + "(...)"
            );

            // Send the selected vendor UUID to CAP
            oOperation.setParameter("vendorID", sVendorId);

            // Execute the backend action
            return oOperation.execute()
                .then(function () {
                    const oResult =
                        oOperation.getBoundContext().getObject();

                    console.log(
                        sActionName + " result:",
                        oResult
                    );

                    return oResult;
                })
                .catch(function (oError) {
                    console.error(
                        sActionName + " failed:",
                        oError
                    );

                    sap.m.MessageBox.error(
                        "Risk calculation failed. Check the browser console and CAP server logs."
                    );

                    throw oError;
                });
        },

        // Delivery Risk button
        
onCalculateDeliveryRisk: function () {

    const sVendorId = this.getSelectedVendorId();

    this.executeRiskAction(
        "calculateDeliveryRisk",
        sVendorId
    ).then(function (oResult) {

        if (!oResult) {
            return;
        }

        // Update the dashboard risk card
        this.byId("deliveryRisk").setNumber(Number(oResult.deliveryRiskScore || 0)
        );

        this.setRiskStatus(
            this.byId("deliveryStatus"),
            oResult.deliveryRiskScore
        );

        // Display the actual action response
        const sMessage =
            "Delivery Risk Calculation Result\n\n" +
            "Vendor ID: " + (oResult.vendorID || "-") + "\n" +
            "Total Deliveries: " + (oResult.totalDeliveries ?? 0) + "\n" +
            "Delayed Deliveries: " + (oResult.delayedDeliveries ?? 0) + "\n" +
            "Partial Deliveries: " + (oResult.partialDeliveries ?? 0) + "\n" +
            "Average Delay Days: " + (oResult.averageDelayDays ?? 0) + "\n" +
            "Delayed Percentage: " + (oResult.delayedPercentage ?? 0) + "%\n" +
            "Partial Percentage: " + (oResult.partialPercentage ?? 0) + "%\n" +
            "Average Delivery Percentage: " +
                (oResult.averageDeliveryPercentage ?? 0) + "%\n\n" +
            "Delay Score: " + (oResult.delayScore ?? 0) + "\n" +
            "Delayed Delivery Score: " +
                (oResult.delayedDeliveryScore ?? 0) + "\n" +
            "Partial Delivery Score: " +
                (oResult.partialDeliveryScore ?? 0) + "\n" +
            "Completion Score: " + (oResult.completionScore ?? 0) + "\n\n" +
            "Final Delivery Risk Score: " +
                (oResult.deliveryRiskScore ?? 0) + " / 100\n" +
            "Risk Level: " + (oResult.riskLevel || "-");

        sap.m.MessageBox.show(sMessage, {
            title: "Delivery Risk Assessment",
            actions: [sap.m.MessageBox.Action.OK],
            icon: sap.m.MessageBox.Icon.INFORMATION
        });

    }.bind(this)).catch(function () {
        // The error is already handled by executeRiskAction()
    });
},

        // Quality Risk button
        onCalculateQualityRisk: function () {

    const sVendorId = this.getSelectedVendorId();

    this.executeRiskAction(
        "calculateQualityRisk",
        sVendorId
    ).then(function (oResult) {

        if (!oResult) {
            return;
        }

        // Update Quality Risk dashboard card
        this.byId("qualityRisk").setNumber(
            Number(oResult.qualityRiskScore ?? 0)
        );

        this.setRiskStatus(
            this.byId("qualityStatus"),
            oResult.qualityRiskScore
        );

        // Prepare the message box
        const sMessage =
            "QUALITY RISK CALCULATION RESULT\n\n" +

            "Vendor ID: " +
            (oResult.vendorID || "-") + "\n\n" +

            "Total Complaints: " +
            (oResult.totalComplaints ?? 0) + "\n" +

            "Total Inspected Quantity: " +
            (oResult.totalInspectedQuantity ?? 0) + "\n" +

            "Total Rejected Quantity: " +
            (oResult.totalRejectedQuantity ?? 0) + "\n" +

            "Average Defect Percentage: " +
            (oResult.averageDefectPercentage ?? 0) + "%\n\n" +

            "Defect Score: " +
            (oResult.defectScore ?? 0) + " / 100\n" +

            "Average Severity Score: " +
            (oResult.severityScore ?? 0) + " / 100\n\n" +

            "FINAL QUALITY RISK SCORE: " +
            (oResult.qualityRiskScore ?? 0) + " / 100\n" +

            "Risk Level: " +
            (oResult.riskLevel || "No Data");

        MessageBox.show(sMessage, {
            title: "Quality Risk Assessment",
            actions: [MessageBox.Action.OK],
            icon: MessageBox.Icon.INFORMATION
        });

    }.bind(this)).catch(function (oError) {
        // Error is already handled by executeRiskAction
        console.error("Quality risk calculation failed:", oError);
    });
},

        // Price Risk button

onCalculatePriceRisk: function () {
    const sVendorId = this.getSelectedVendorId();

    this.executeRiskAction(
        "calculatePriceDeviationRisk",
        sVendorId
    ).then(function (oResult) {

        if (!oResult) {
            return;
        }

        // Update Price Risk dashboard card
        this.byId("priceRisk").setNumber(
            Number(oResult.priceRiskScore ?? 0)
        );

        this.setRiskStatus(
            this.byId("priceStatus"),
            oResult.priceRiskScore
        );

        // Prepare the message box
        const sMessage =
            "PRICE DEVIATION RISK CALCULATION RESULT\n\n" +

            "Vendor ID: " +
            (oResult.vendorID || "-") + "\n\n" +

            "Total Invoices: " +
            (oResult.totalInvoices ?? 0) + "\n" +

            "Total Price Increase: " +
            Number(oResult.totalPriceIncrease ?? 0).toFixed(2) + "\n" +

            "Average Price Deviation: " +
            Number(
                oResult.averagePriceDeviationPercent ?? 0
            ).toFixed(2) + "%\n\n" +

            "Price Deviation Score: " +
            (oResult.priceDeviationScore ?? 0) + " / 100\n\n" +

            "FINAL PRICE RISK SCORE: " +
            (oResult.priceRiskScore ?? 0) + " / 100\n" +

            "Risk Level: " +
            (oResult.riskLevel || "No Data");

        MessageBox.show(sMessage, {
            title: "Price Risk Assessment",
            actions: [MessageBox.Action.OK],
            icon: MessageBox.Icon.INFORMATION
        });

    }.bind(this)).catch(function (oError) {
        // Error is already handled by executeRiskAction
        console.error("Price risk calculation failed:", oError);
    });
},
       

        // Overall Risk button

onCalculateOverallRisk: function () {
    const sVendorId = this.getSelectedVendorId();

    this.executeRiskAction(
        "calculateOverallVendorRisk",
        sVendorId
    ).then(function (oResult) {

        if (!oResult) {
            return;
        }

        // Update Overall Risk card
        this.byId("overallRisk").setNumber(
            Number(oResult.overallRiskScore ?? 0)
        );

        this.setRiskStatus(
            this.byId("overallLevel"),
            oResult.overallRiskScore
        );

        // Update Delivery Risk card
        this.byId("deliveryRisk").setNumber(
            Number(oResult.deliveryRisk ?? 0)
        );

        this.setRiskStatus(
            this.byId("deliveryStatus"),
            oResult.deliveryRisk
        );

        // Update Quality Risk card
        this.byId("qualityRisk").setNumber(
            Number(oResult.qualityRisk ?? 0)
        );

        this.setRiskStatus(
            this.byId("qualityStatus"),
            oResult.qualityRisk
        );

        // Update Price Risk card
        this.byId("priceRisk").setNumber(
            Number(oResult.priceRisk ?? 0)
        );

        this.setRiskStatus(
            this.byId("priceStatus"),
            oResult.priceRisk
        );

        // Build Overall Risk message
        const sMessage =
            "OVERALL VENDOR RISK ASSESSMENT\n\n" +

            "Vendor ID: " +
            (oResult.vendorID || "-") + "\n\n" +

            "INDIVIDUAL RISK SCORES\n\n" +

            "Delivery Risk: " +
            Number(oResult.deliveryRisk ?? 0).toFixed(2) +
            " / 100  (Weight: 40%)\n" +

            "Quality Risk: " +
            Number(oResult.qualityRisk ?? 0).toFixed(2) +
            " / 100  (Weight: 35%)\n" +

            "Price Risk: " +
            Number(oResult.priceRisk ?? 0).toFixed(2) +
            " / 100  (Weight: 25%)\n\n" +

            "FINAL OVERALL RISK SCORE: " +
            Number(oResult.overallRiskScore ?? 0).toFixed(2) +
            " / 100\n\n" +

            "Risk Level: " +
            (oResult.riskLevel || "No Data") + "\n\n" +

            "Calculation Status: " +
            (oResult.calculationStatus || "-");

        MessageBox.show(sMessage, {
            title: "Overall Vendor Risk Assessment",
            actions: [MessageBox.Action.OK],
            icon: MessageBox.Icon.INFORMATION
        });

    }.bind(this)).catch(function (oError) {
        // Error is already handled by executeRiskAction
        console.error(
            "Overall risk calculation failed:",
            oError
        );
    });
},


// ---------------------------------------
        // Init: load vendor list, select first vendor
        // ---------------------------------------

        onInit: function () {

            console.log("Controller loaded");

            const oView = this.getView();
            const oModel = oView.getModel();

            console.log("MODEL EXISTS =", !!oModel);

            oView.setModel(new JSONModel({ list: [] }), "vendors");

            oModel.bindList("/Vendors")
                .requestContexts(0, 200)
                .then(function (aContexts) {

                    const aVendors = aContexts.map(function (oContext) {
                        const oVendor = oContext.getObject();
        return {
            ID: oVendor.ID,
            label: oVendor.vendorCode + " - " + oVendor.vendorName
        };
                    });

                    console.log("VENDORS =", aVendors);

                    oView.getModel("vendors").setProperty("/list", aVendors);

                    if (aVendors.length) {
                        this.byId("vendorSelect").setSelectedKey(aVendors[0].ID);
                        this.loadDashboard(aVendors[0].ID);
                    }

                }.bind(this))
                .catch(function (oError) {
                    console.error("VENDORS ERROR =", oError);
                });
                this.loadVendorSummary();

        },


loadDeliveries: async function (sVendorId) {

    const oView = this.getView();
    const oModel = oView.getModel();

    oView.setModel(
        new JSONModel({ list: [] }),
        "deliveries"
    );

    try {
        const oBinding = oModel.bindList(
            "/Deliveries",
            null,
            [],
            [],
            {
                $filter: "vendor_ID eq " + sVendorId,
                $expand: "purchaseOrder"
            }
        );

        const aContexts = await oBinding.requestContexts(0, 1000);

        const aDeliveries = aContexts.map(function (oContext) {

            const oDelivery = oContext.getObject();

            return {
                ID: oDelivery.ID,
                poNumber: oDelivery.purchaseOrder?.poNumber || "-",
                poItemNumber: oDelivery.poItemNumber ?? "-",
                materialCode: oDelivery.materialCode || "-",
                expectedDeliveryDate:
                    oDelivery.expectedDeliveryDate || "-",
                actualDeliveryDate:
                    oDelivery.actualDeliveryDate || "-",
                orderedQuantity: oDelivery.orderedQuantity ?? 0,
                deliveredQuantity: oDelivery.deliveredQuantity ?? 0,
                shipmentStatus: oDelivery.shipmentStatus || "Unknown",
                remarks: oDelivery.remarks || "-"
            };
        });

        oView.getModel("deliveries").setProperty(
            "/list",
            aDeliveries
        );

        console.log("Deliveries loaded:", aDeliveries);

    } catch (oError) {
        console.error("Failed to load deliveries:", oError);
    }
},
        // ---------------------------------------
        // User picks a vendor
        // ---------------------------------------

        onVendorChange: function (oEvent) {

            const sVendorId = oEvent.getParameter("selectedItem").getKey();

            this.loadDashboard(sVendorId);
             this.loadDeliveries(sVendorId);

        },
onVendorDetails: async function () {
    const sVendorId = this.getSelectedVendorId();

    if (!sVendorId) {
        MessageToast.show("Please select a vendor first.");
        return;
    }

    const oModel = this.getView().getModel();
    const oApp = this.byId("vendorRiskApp");

    if (!oApp) {
        MessageBox.error("Vendor Risk App was not found.");
        return;
    }

    try {
        const oVendor = await oModel
            .bindContext("/Vendors(" + sVendorId + ")")
            .requestObject();

        const oDetails = Object.assign({}, oVendor);

        const nScore = Number(oVendor.currentRiskScore || 0);
        const sRiskLevel = oVendor.riskLevel || "";
        
        if (sRiskLevel === "Critical" || sRiskLevel === "High" ||
            (!sRiskLevel && nScore > 60)) {
            oDetails.riskState = "Error";
            
        } else if (sRiskLevel === "Medium" ||
                   (!sRiskLevel && nScore > 30)) {
            oDetails.riskState = "Warning";
        } else {
            oDetails.riskState = "Success";
        }

        if (!this._oVendorDetailsView) {
            this._oVendorDetailsView = await XMLView.create({
                viewName: "score.dashboard.view.VendorDetails"
            });

            oApp.addPage(this._oVendorDetailsView);
        }

        this._oVendorDetailsView.setModel(
            new JSONModel(oDetails),
            "selectedVendor"
        );

        oApp.to(this._oVendorDetailsView.getId());

    } catch (oError) {
        console.error("Vendor details error:", oError);
        MessageBox.error(
            "Unable to load vendor details. Check the browser console."
        );
    }
},

        // ---------------------------------------
        // Load everything for one vendor
        // ---------------------------------------

        loadDashboard: function (sVendorId) {

            const oModel = this.getView().getModel();

            this.loadVendor(oModel, sVendorId);
            this.loadRisk(oModel, sVendorId);

        },


        // ---------------------------------------
        // Vendor details
        // ---------------------------------------

loadVendorSummary: async function () {

    const oModel = this.getView().getModel();

    try {
        // 1. Fetch all vendors
        const aVendorContexts = await oModel
            .bindList("/Vendors")
            .requestContexts(0, 1000);

        const aVendors = aVendorContexts.map(function (oContext) {
            return oContext.getObject();
        });

        // Total vendor count
        this.byId("totalVendorsCount").setNumber(
            String(aVendors.length)
        );

        // 2. Fetch risk assessments
        const aRiskContexts = await oModel
            .bindList("/RiskAssessments")
            .requestContexts(0, 5000);

        const aAssessments = aRiskContexts.map(function (oContext) {
            return oContext.getObject();
        });

        // Keep the latest assessment for each vendor
        const mLatestByVendor = new Map();

        aAssessments.forEach(function (oAssessment) {
            const sVendorId = oAssessment.vendor_ID;

            if (!sVendorId) {
                return;
            }

            const oExisting = mLatestByVendor.get(sVendorId);

            if (
                !oExisting ||
                new Date(oAssessment.assessmentDate || 0) >
                new Date(oExisting.assessmentDate || 0)
            ) {
                mLatestByVendor.set(sVendorId, oAssessment);
            }
        });

        let iHighRisk = 0;
        let iMediumRisk = 0;
        let iLowRisk = 0;

        mLatestByVendor.forEach(function (oAssessment) {
            const nScore = Number(oAssessment.overallRiskScore);

            if (!Number.isFinite(nScore)) {
                return;
            }
            if (nScore >=80) {
                iHighRisk++;
            }else if(nScore>31 && nScore<80){
                iMediumRisk++;
            }else
            {
                iLowRisk++;
            }
        });

        this.byId("highRiskVendorsCount").setNumber(String(iHighRisk));
        this.byId("MediumRiskVendorsCount").setNumber(String(iMediumRisk));
        this.byId("lowRiskVendorsCount").setNumber(String(iLowRisk));

    } catch (oError) {
        console.error("Vendor summary loading failed:", oError);
    }
},

        loadVendor: function (oModel, sVendorId) {

            oModel.bindContext("/Vendors(" + sVendorId + ")")
                .requestObject()
                .then(function (oVendor) {

                    this.byId("vendorCode").setText(oVendor.vendorCode || "-");
                    this.byId("vendorName").setText(oVendor.vendorName || "-");

                }.bind(this))
                .catch(function (oError) {
                    console.error("VENDOR ERROR =", oError);
                });

        },

        // Latest risk assessment for the vendor

        loadRisk: function (oModel, sVendorId) {

            const oBinding = oModel.bindList(
                "/RiskAssessments",
                null,
                [],
                [],
                {
                    $filter: "vendor_ID eq " + sVendorId,
                    $orderby: "assessmentDate desc"
                }
            );

            oBinding.requestContexts(0, 1)
                .then(function (aContexts) {

                    if (aContexts.length === 0) {
                        console.log("No RiskAssessments for vendor", sVendorId);
                        this.resetRisk();
                        return;
                    }

                    const oData = aContexts[0].getObject();

                    console.log("RISK DATA =", oData);

                    this.byId("overallRisk").setNumber(oData.overallRiskScore);
                    this.setRiskStatus(this.byId("overallLevel"), oData.overallRiskScore);
                    this.byId("deliveryRisk").setNumber(oData.deliveryRisk);
                    this.setRiskStatus(this.byId("deliveryStatus"), oData.deliveryRisk);

                    this.byId("qualityRisk").setNumber(oData.qualityRisk);
                    this.setRiskStatus(this.byId("qualityStatus"), oData.qualityRisk);

                    this.byId("priceRisk").setNumber(oData.priceRisk);
                    this.setRiskStatus(this.byId("priceStatus"), oData.priceRisk);

                }.bind(this))
                .catch(function (oError) {
                    console.error("RISK ERROR =", oError);
                });

        },

        // Clear the cards when a vendor has no assessment
    
        resetRisk: function () {

            ["overallRisk", "deliveryRisk", "qualityRisk", "priceRisk"].forEach(function (sId) {
                this.byId(sId).setNumber("0");
            }.bind(this));

            ["overallLevel", "deliveryStatus", "qualityStatus", "priceStatus"].forEach(function (sId) {
                this.byId(sId).setText("No assessment");
                this.byId(sId).setState("None");
            }.bind(this));

        },

        // Set Risk Status based on Risk Score

        setRiskStatus: function (oStatusControl, vScore) {

            const nScore = Number(vScore);

            let sText;
            let sState;

            if (nScore <= 30) {
                sText = "Low Risk";
                sState = "Success";
            } else if (nScore <= 60) {
                sText = "Medium Risk";
                sState = "Warning";
            } else if (nScore <= 80) {
                sText = "High Risk";
                sState = "Error";
            } else {
                sText = "Critical Risk";
                sState = "Error";
            }

            oStatusControl.setText(sText);
            oStatusControl.setState(sState);

        }

    });

    
});