sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/core/mvc/XMLView"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageBox,
    MessageToast,
    XMLView
) {
    "use strict";

    return Controller.extend("vrfrontend.controller.VendorDashboard", {

        // --------------------------------------------------
        // Get OData model and selected vendor
        // --------------------------------------------------

        getODataModel: function () {
            return this.getOwnerComponent().getModel();
        },

        getSelectedVendorId: function () {
            var oVendorSelect = this.byId("vendorSelect");
            return oVendorSelect ? oVendorSelect.getSelectedKey() : "";
        },

        // --------------------------------------------------
        // Initialize dashboard
        // --------------------------------------------------

        onInit: function () {
            var oView = this.getView();
            var oModel = this.getODataModel();

            if (!oModel) {
                MessageBox.error("OData model is not configured.");
                return;
            }

            oView.setModel(oModel);

            oView.setModel(
                new JSONModel({ list: [] }),
                "vendors"
            );

            oView.setModel(
                new JSONModel({ list: [] }),
                "deliveries"
            );

            // Wait until the view is rendered before loading vendors.
            oView.attachEventOnce("afterRendering", function () {
                this.loadVendors();
            }.bind(this));
        },

        // --------------------------------------------------
        // Load vendor dropdown
        // --------------------------------------------------

        loadVendors: async function () {
            var oModel = this.getODataModel();

            try {
                var oBinding = oModel.bindList("/Vendors");
                var aContexts = await oBinding.requestContexts(0, 200);

                var aVendors = aContexts.map(function (oContext) {
                    var oVendor = oContext.getObject();

                    return {
                        ID: oVendor.ID,
                        vendorCode: oVendor.vendorCode || "",
                        vendorName: oVendor.vendorName || "",
                        label:
                            (oVendor.vendorCode || "") +
                            " - " +
                            (oVendor.vendorName || "")
                    };
                });

                this.getView()
                    .getModel("vendors")
                    .setProperty("/list", aVendors);

                if (aVendors.length > 0) {
                    var sVendorId = aVendors[0].ID;

                    var oVendorSelect = this.byId("vendorSelect");

                    if (oVendorSelect) {
                        oVendorSelect.setSelectedKey(sVendorId);
                    } else {
                        console.warn(
                            "VendorDashboard: control 'vendorSelect' was not found. " +
                            "Verify the Select ID in VendorDashboard.view.xml."
                        );
                    }

                    await this.refreshDashboard(sVendorId);

                } else {
                    this.resetRisk();
                }

                console.log("Vendors loaded:", aVendors);

            } catch (oError) {
                console.error("Vendors loading failed:", oError);
                MessageBox.error("Unable to load vendors.");
            }
        },

        // --------------------------------------------------
        // Navigation
        // --------------------------------------------------

        onNavBack: function () {
            this.getOwnerComponent()
                .getRouter()
                .navTo("Routehome", {}, true);
        },

        // --------------------------------------------------
        // User changes selected vendor
        // --------------------------------------------------

        onVendorChange: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");

            var sVendorId = oItem
                ? oItem.getKey()
                : this.getSelectedVendorId();

            if (!sVendorId) {
                this.resetRisk();
                return;
            }

            this.refreshDashboard(sVendorId);
        },

        // --------------------------------------------------
        // Refresh dashboard data
        // --------------------------------------------------

        refreshDashboard: async function (sVendorId) {
            if (!sVendorId) {
                return;
            }

            try {
                await Promise.all([
                    this.loadVendor(sVendorId),
                    this.loadRisk(sVendorId),
                    this.loadDeliveries(sVendorId),
                    this.loadVendorSummary()
                ]);

                console.log(
                    "Dashboard refreshed for vendor:",
                    sVendorId
                );

            } catch (oError) {
                console.error("Dashboard refresh failed:", oError);
            }
        },

        // --------------------------------------------------
        // Call CAP action
        // --------------------------------------------------

        executeRiskAction: function (sActionName, sVendorId) {
            var oModel = this.getODataModel();

            if (!sVendorId) {
                MessageToast.show("Please select a vendor.");
                return Promise.resolve(null);
            }

            var oOperation = oModel.bindContext(
                "/" + sActionName + "(...)"
            );

            oOperation.setParameter("vendorID", sVendorId);

            return oOperation.execute()
                .then(function () {
                    var oContext = oOperation.getBoundContext();

                    var oResult = oContext
                        ? oContext.getObject()
                        : null;

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

                    MessageBox.error(
                        "Risk calculation failed. Check the browser console and CAP logs."
                    );

                    throw oError;
                });
        },

        // --------------------------------------------------
        // Set card number safely
        // --------------------------------------------------

        setRiskCard: function (
            sNumberId,
            sStatusId,
            vScore
        ) {
            var oNumber = this.byId(sNumberId);
            var oStatus = this.byId(sStatusId);

            if (
                vScore === null ||
                vScore === undefined ||
                vScore === "" ||
                !Number.isFinite(Number(vScore))
            ) {
                if (oNumber) {
                    oNumber.setNumber("0");
                }

                if (oStatus) {
                    oStatus.setText("No assessment");
                    oStatus.setState("None");
                }

                return;
            }

            var nScore = Number(vScore);

            if (oNumber) {
                oNumber.setNumber(nScore.toFixed(2));
            }

            if (oStatus) {
                this.setRiskStatus(oStatus, nScore);
            }
        },
        

                // --------------------------------------------------
        // OPEN RISK DETAIL SCREENS (vendor -> orders -> items)
        // --------------------------------------------------

        onOpenDeliveryRisk: function () {
            this.openRiskDetails("delivery");
            console.log("risk")
        },

        onOpenQualityRisk: function () {
            this.openRiskDetails("quality");
        },

        onOpenPriceRisk: function () {
            this.openRiskDetails("price");
        },

        openRiskDetails: function (sRiskType) {
            var sVendorId = this.getSelectedVendorId();

            if (!sVendorId) {
                MessageToast.show("Please select a vendor.");
                return;
            }

            this.getOwnerComponent().getRouter().navTo("RiskDetails", {
                riskType: sRiskType,
                vendorId: sVendorId
            });
        },
        // --------------------------------------------------
        // DELIVERY RISK
        // --------------------------------------------------

        onCalculateDeliveryRisk: function () {
            var sVendorId = this.getSelectedVendorId();

            this.executeRiskAction(
                "calculateDeliveryRisk",
                sVendorId
            ).then(function (oResult) {
                if (!oResult) {
                    return;
                }

                var nScore =
                    oResult.deliveryRiskScore ??
                    oResult.deliveryRisk;

                this.setRiskCard(
                    "deliveryRisk",
                    "deliveryStatus",
                    nScore
                );

                var sMessage =
                    "DELIVERY RISK CALCULATION RESULT\n\n" +
                    "Vendor ID: " + (oResult.vendorID || "-") + "\n" +
                    "Total Deliveries: " +
                    (oResult.totalDeliveries ?? 0) + "\n" +
                    "Delayed Deliveries: " +
                    (oResult.delayedDeliveries ?? 0) + "\n" +
                    "Partial Deliveries: " +
                    (oResult.partialDeliveries ?? 0) + "\n" +
                    "Average Delay Days: " +
                    (oResult.averageDelayDays ?? 0) + "\n" +
                    "Delayed Percentage: " +
                    (oResult.delayedPercentage ?? 0) + "%\n" +
                    "Partial Percentage: " +
                    (oResult.partialPercentage ?? 0) + "%\n" +
                    "Average Delivery Percentage: " +
                    (oResult.averageDeliveryPercentage ?? 0) + "%\n\n" +
                    "Delay Score: " + (oResult.delayScore ?? 0) + "\n" +
                    "Delayed Delivery Score: " +
                    (oResult.delayedDeliveryScore ?? 0) + "\n" +
                    "Partial Delivery Score: " +
                    (oResult.partialDeliveryScore ?? 0) + "\n" +
                    "Completion Score: " +
                    (oResult.completionScore ?? 0) + "\n\n" +
                    "FINAL DELIVERY RISK: " +
                    (nScore ?? 0) + " / 100\n" +
                    "Risk Level: " + (oResult.riskLevel || "-");

                MessageBox.show(sMessage, {
                    title: "Delivery Risk Assessment",
                    actions: [MessageBox.Action.OK],
                    icon: MessageBox.Icon.INFORMATION
                });

            }.bind(this)).catch(function () {
                // Error is handled by executeRiskAction
            });
        },

        // --------------------------------------------------
        // QUALITY RISK - Detailed assessment
        // --------------------------------------------------

        onCalculateQualityRisk: function () {
            var sVendorId = this.getSelectedVendorId();

            if (!sVendorId) {
                MessageToast.show("Please select a vendor first.");
                return;
            }

            this.executeRiskAction(
                "calculateQualityRisk",
                sVendorId
            ).then(async function (oResult) {
                if (!oResult) {
                    return;
                }

                var nScore =
                    oResult.qualityRiskScore ??
                    oResult.qualityRisk ??
                    0;

                this.setRiskCard(
                    "qualityRisk",
                    "qualityStatus",
                    nScore
                );

                var aVendors =
                    this.getView().getModel("vendors").getProperty("/list") || [];

                var oVendor = aVendors.find(function (oItem) {
                    return String(oItem.ID) === String(sVendorId);
                });

                var sVendorName = oVendor
                    ? oVendor.vendorName
                    : "";

                if (!sVendorName && oVendor) {
                    sVendorName = oVendor.label || "";
                }

                var oAssessment = Object.assign({}, oResult, {
                    vendorName: sVendorName || "Vendor name unavailable",
                    qualityRiskScore: nScore,
                    riskLevel: oResult.riskLevel || "No Data",
                    riskState:
                        oResult.riskLevel === "Low" ? "Success" :
                            oResult.riskLevel === "Medium" ? "Warning" :
                                oResult.riskLevel === "High" ||
                                    oResult.riskLevel === "Critical" ? "Error" :
                                    "None"
                });

                var oAssessmentModel =
                    this.getOwnerComponent().getModel("qualityAssessment");

                if (!oAssessmentModel) {
                    oAssessmentModel = new JSONModel();

                    this.getOwnerComponent().setModel(
                        oAssessmentModel,
                        "qualityAssessment"
                    );
                }

                oAssessmentModel.setData(oAssessment);

                await this.onOpenQualityRiskDialog();

            }.bind(this)).catch(function (oError) {
                console.error("Quality risk assessment failed:", oError);
            });
        },

        // --------------------------------------------------
        // QUALITY RISK - Result message
        // --------------------------------------------------

        onCalculateQualityRisk: function () {
            var sVendorId = this.getSelectedVendorId();

            this.executeRiskAction(
                "calculateQualityRisk",
                sVendorId
            ).then(function (oResult) {
                if (!oResult) {
                    return;
                }

                var nScore =
                    oResult.qualityRiskScore ??
                    oResult.qualityRisk;

                this.setRiskCard(
                    "qualityRisk",
                    "qualityStatus",
                    nScore
                );

                var sMessage =
                    "QUALITY RISK CALCULATION RESULT\n\n" +
                    "Vendor ID: " + (oResult.vendorID || "-") + "\n\n" +
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
                    "Severity Score: " +
                    (oResult.severityScore ?? 0) + " / 100\n\n" +
                    "FINAL QUALITY RISK: " +
                    (nScore ?? 0) + " / 100\n" +
                    "Risk Level: " + (oResult.riskLevel || "No Data");

                MessageBox.show(sMessage, {
                    title: "Quality Risk Assessment",
                    actions: [MessageBox.Action.OK],
                    icon: MessageBox.Icon.INFORMATION
                });

            }.bind(this)).catch(function () {
                // Error is handled by executeRiskAction
            });
        },

        // --------------------------------------------------
        // PRICE RISK
        // --------------------------------------------------

        onCalculatePriceRisk: function () {
            var sVendorId = this.getSelectedVendorId();

            this.executeRiskAction(
                "calculatePriceDeviationRisk",
                sVendorId
            ).then(function (oResult) {
                if (!oResult) {
                    return;
                }

                var nScore =
                    oResult.priceRiskScore ??
                    oResult.priceRisk;

                this.setRiskCard(
                    "priceRisk",
                    "priceStatus",
                    nScore
                );

                var sMessage =
                    "PRICE DEVIATION RISK RESULT\n\n" +
                    "Vendor ID: " + (oResult.vendorID || "-") + "\n\n" +
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
                    "FINAL PRICE RISK: " +
                    (nScore ?? 0) + " / 100\n" +
                    "Risk Level: " + (oResult.riskLevel || "No Data");

                MessageBox.show(sMessage, {
                    title: "Price Deviation Risk Assessment",
                    actions: [MessageBox.Action.OK],
                    icon: MessageBox.Icon.INFORMATION
                });

            }.bind(this)).catch(function () {
                // Error is handled by executeRiskAction
            });
        },

        // --------------------------------------------------
        // OVERALL RISK
        // --------------------------------------------------

        onCalculateOverallRisk: async function () {
            var sVendorId = this.getSelectedVendorId();

            try {
                var oResult = await this.executeRiskAction(
                    "calculateOverallVendorRisk",
                    sVendorId
                );

                if (!oResult) {
                    return;
                }

                this.setRiskCard(
                    "overallRisk",
                    "overallLevel",
                    oResult.overallRiskScore
                );

                this.setRiskCard(
                    "deliveryRisk",
                    "deliveryStatus",
                    oResult.deliveryRisk
                );

                this.setRiskCard(
                    "qualityRisk",
                    "qualityStatus",
                    oResult.qualityRisk
                );

                this.setRiskCard(
                    "priceRisk",
                    "priceStatus",
                    oResult.priceRisk
                );

                await Promise.all([
                    this.loadRisk(sVendorId),
                    this.loadVendorSummary()
                ]);

                this.setRiskCard(
                    "overallRisk",
                    "overallLevel",
                    oResult.overallRiskScore
                );

                this.setRiskCard(
                    "deliveryRisk",
                    "deliveryStatus",
                    oResult.deliveryRisk
                );

                this.setRiskCard(
                    "qualityRisk",
                    "qualityStatus",
                    oResult.qualityRisk
                );

                this.setRiskCard(
                    "priceRisk",
                    "priceStatus",
                    oResult.priceRisk
                );

                var sMessage =
                    "OVERALL VENDOR RISK ASSESSMENT\n\n" +
                    "Vendor ID: " + (oResult.vendorID || "-") + "\n\n" +
                    "INDIVIDUAL RISK SCORES\n\n" +
                    "Delivery Risk: " +
                    Number(oResult.deliveryRisk ?? 0).toFixed(2) +
                    " / 100 (Weight: 40%)\n" +
                    "Quality Risk: " +
                    Number(oResult.qualityRisk ?? 0).toFixed(2) +
                    " / 100 (Weight: 35%)\n" +
                    "Price Risk: " +
                    Number(oResult.priceRisk ?? 0).toFixed(2) +
                    " / 100 (Weight: 25%)\n\n" +
                    "FINAL OVERALL RISK: " +
                    Number(oResult.overallRiskScore ?? 0).toFixed(2) +
                    " / 100\n\n" +
                    "Risk Level: " + (oResult.riskLevel || "No Data") + "\n" +
                    "Calculation Status: " +
                    (oResult.calculationStatus || "-");

                MessageBox.show(sMessage, {
                    title: "Overall Vendor Risk Assessment",
                    actions: [MessageBox.Action.OK],
                    icon: MessageBox.Icon.INFORMATION
                });

            } catch (oError) {
                console.error("Overall risk calculation failed:", oError);
            }
        },

        // --------------------------------------------------
        // Load vendor details shown on dashboard
        // --------------------------------------------------

        loadVendor: async function (sVendorId) {
            var oModel = this.getODataModel();

            try {
                var oVendor = await oModel
                    .bindContext("/Vendors(" + sVendorId + ")")
                    .requestObject();

                var oVendorCode = this.byId("vendorCode");
                var oVendorName = this.byId("vendorName");

                if (oVendorCode) {
                    oVendorCode.setText(oVendor.vendorCode || "-");
                }

                if (oVendorName) {
                    oVendorName.setText(oVendor.vendorName || "-");
                }

            } catch (oError) {
                console.error("Vendor loading failed:", oError);
            }
        },

        // --------------------------------------------------
        // Load latest saved risk assessment for one vendor
        // --------------------------------------------------

        loadRisk: async function (sVendorId) {
            var oModel = this.getODataModel();

            try {
                var oFilter = new Filter(
                    "vendor_ID",
                    FilterOperator.EQ,
                    sVendorId
                );

                var oBinding = oModel.bindList(
                    "/RiskAssessments",
                    null,
                    [],
                    [oFilter],
                    {
                        $orderby: "assessmentDate desc"
                    }
                );

                var aContexts = await oBinding.requestContexts(0, 1);

                if (aContexts.length === 0) {
                    console.log(
                        "No RiskAssessments for vendor:",
                        sVendorId
                    );

                    this.resetRisk();
                    return;
                }

                var oData = aContexts[0].getObject();

                console.log("LATEST RISK DATA =", oData);
                console.log("RISK DATA FIELDS =", Object.keys(oData));

                this.setRiskCard(
                    "overallRisk",
                    "overallLevel",
                    oData.overallRiskScore ?? oData.overallRisk
                );

                this.setRiskCard(
                    "deliveryRisk",
                    "deliveryStatus",
                    oData.deliveryRisk ?? oData.deliveryRiskScore
                );

                this.setRiskCard(
                    "qualityRisk",
                    "qualityStatus",
                    oData.qualityRisk ?? oData.qualityRiskScore
                );

                this.setRiskCard(
                    "priceRisk",
                    "priceStatus",
                    oData.priceRisk ?? oData.priceRiskScore
                );

            } catch (oError) {
                console.error("Risk assessment loading failed:", oError);
            }
        },

        // --------------------------------------------------
        // Quality risk dialog
        // --------------------------------------------------

        onOpenQualityRiskDialog: async function () {
            if (!this._oQualityRiskDialog) {
                this._oQualityRiskDialog = await this.loadFragment({
                    name: "vrfrontend.view.fragments.QualityRiskAssessment"
                });
            }

            this._oQualityRiskDialog.open();
        },

        onCloseQualityRisk: function () {
            if (this._oQualityRiskDialog) {
                this._oQualityRiskDialog.close();
            }
        },

        // --------------------------------------------------
        // Load delivery table
        // --------------------------------------------------

        loadDeliveries: async function (sVendorId) {
            var oView = this.getView();
            var oModel = this.getODataModel();

            oView.getModel("deliveries").setProperty("/list", []);

            if (!sVendorId) {
                return;
            }

            try {
                var oBinding = oModel.bindList(
                    "/Deliveries",
                    null,
                    [],
                    [],
                    {
                        $filter: "vendor_ID eq " + sVendorId,
                        $expand: "purchaseOrder($select=poNumber),items"
                    }
                );

                var aContexts =
                    await oBinding.requestContexts(0, 1000);

                var aDeliveryRows = [];

                aContexts.forEach(function (oContext) {
                    var oDelivery = oContext.getObject();

                    var oPurchaseOrder =
                        oDelivery.purchaseOrder || {};

                    var aItems = oDelivery.items || [];

                    aItems.forEach(function (oItem) {
                        var sItemStatus =
                            oItem.itemStatus || "Unknown";

                        var sDeliveryStatus =
                            oDelivery.deliveryStatus || "Pending";

                        aDeliveryRows.push({
                            ID: oItem.ID,

                            deliveryID: oDelivery.ID,

                            poNumber:
                                oPurchaseOrder.poNumber || "-",

                            shipmentDate:
                                oDelivery.shipmentDate || "-",

                            expectedDeliveryDate:
                                oDelivery.expectedDeliveryDate || "-",

                            actualDeliveryDate:
                                oDelivery.actualDeliveryDate || "-",

                            deliveryStatus: sDeliveryStatus,

                            deliveryStatusState:
                                this.getDeliveryStatusState(
                                    sDeliveryStatus
                                ),

                            delayDays:
                                oDelivery.delayDays ?? 0,

                            partialDelivery:
                                oDelivery.partialDelivery ?? false,

                            deliveryPercentage:
                                oDelivery.deliveryPercentage ?? 0,

                            shipmentStatus:
                                oDelivery.shipmentStatus || "Unknown",

                            remarks:
                                oDelivery.remarks || "-",

                            materialCode:
                                oItem.materialCode || "-",

                            orderedQuantity:
                                oItem.orderedQuantity ?? 0,

                            acceptedQuantity:
                                oItem.acceptedQuantity ?? 0,

                            deliveredQuantity:
                                oItem.deliveredQuantity ?? 0,

                            cumulativeDeliveredQuantity:
                                oItem.cumulativeDeliveredQuantity ?? 0,

                            itemDeliveryPercentage:
                                oItem.itemDeliveryPercentage ?? 0,

                            partialItemDelivery:
                                oItem.partialDelivery ?? false,

                            itemStatus: sItemStatus,

                            itemStatusState:
                                this.getItemStatusState(
                                    sItemStatus
                                ),

                            itemDelayDays:
                                oItem.itemDelayDays ?? 0,

                            completionDate:
                                oItem.completionDate || "-"
                        });
                    }.bind(this));
                }.bind(this));

                oView.getModel("deliveries").setProperty(
                    "/list",
                    aDeliveryRows
                );

                console.log(
                    "Delivery history loaded:",
                    aDeliveryRows
                );

            } catch (oError) {
                console.error(
                    "Failed to load delivery history:",
                    oError
                );

                MessageBox.error(
                    "Unable to load delivery history. " +
                    "Please check the OData response and CAP logs."
                );
            }
        },

        // --------------------------------------------------
        // Map delivery status to UI5 semantic colors
        // --------------------------------------------------

        getDeliveryStatusState: function (sStatus) {
            switch ((sStatus || "").toLowerCase()) {
                case "completed":
                case "on time":
                    return "Success";

                case "completed late":
                case "delayed":
                    return "Error";

                case "partially delivered":
                    return "Warning";

                case "pending":
                    return "Information";

                default:
                    return "None";
            }
        },

        // --------------------------------------------------
        // Map item status to UI5 semantic colors
        // --------------------------------------------------

        getItemStatusState: function (sStatus) {
            switch ((sStatus || "").toLowerCase()) {
                case "completed":
                case "delivered":
                    return "Success";

                case "delayed":
                case "rejected":
                    return "Error";

                case "partially delivered":
                case "partial":
                    return "Warning";

                case "pending":
                    return "Information";

                default:
                    return "None";
            }
        },

        // --------------------------------------------------
        // Refresh total, high, medium and low vendor counts
        // --------------------------------------------------

        loadVendorSummary: async function () {
            var oModel = this.getODataModel();

            if (!oModel) {
                console.error("OData model is not available.");
                return;
            }

            try {
                var aContexts = await oModel
                    .bindList("/RiskAssessments")
                    .requestContexts(0, 5000);

                var aAssessments = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                var iTotal = aAssessments.length;

                var oTotal = this.byId("totalVendorsCount");

                if (oTotal) {
                    oTotal.setNumber(String(iTotal));
                }

                var iHigh = 0;
                var iMedium = 0;
                var iLow = 0;

                aAssessments.forEach(function (oAssessment) {
                    var sRiskLevel = oAssessment.riskLevel;

                    if (
                        sRiskLevel === "High" ||
                        sRiskLevel === "Critical"
                    ) {
                        iHigh++;
                    } else if (sRiskLevel === "Medium") {
                        iMedium++;
                    } else if (sRiskLevel === "Low") {
                        iLow++;
                    }
                });

                var oHigh = this.byId("highRiskVendorsCount");
                var oMedium = this.byId("MediumRiskVendorsCount");
                var oLow = this.byId("lowRiskVendorsCount");

                if (oHigh) {
                    oHigh.setNumber(String(iHigh));
                }

                if (oMedium) {
                    oMedium.setNumber(String(iMedium));
                }

                if (oLow) {
                    oLow.setNumber(String(iLow));
                }

                console.log("Risk summary:", {
                    high: iHigh,
                    medium: iMedium,
                    low: iLow
                });

            } catch (oError) {
                console.error(
                    "Failed to load risk summary:",
                    oError
                );
            }
        },

        // --------------------------------------------------
        // Vendor Details navigation
        // --------------------------------------------------

        onVendorDetails: async function () {
            var sVendorId = this.getSelectedVendorId();

            if (!sVendorId) {
                MessageToast.show("Please select a vendor first.");
                return;
            }

            this.getOwnerComponent()
                .getRouter()
                .navTo("VendorDetails", {
                    vendorId: sVendorId
                });
        },

        // --------------------------------------------------
        // Reset risk cards when no assessment exists
        // --------------------------------------------------

        resetRisk: function () {
            [
                "overallRisk",
                "deliveryRisk",
                "qualityRisk",
                "priceRisk"
            ].forEach(function (sId) {
                var oControl = this.byId(sId);

                if (oControl) {
                    oControl.setNumber("0");
                }
            }.bind(this));

            [
                "overallLevel",
                "deliveryStatus",
                "qualityStatus",
                "priceStatus"
            ].forEach(function (sId) {
                var oControl = this.byId(sId);

                if (oControl) {
                    oControl.setText("No assessment");
                    oControl.setState("None");
                }
            }.bind(this));
        },

        // --------------------------------------------------
        // Set risk level and color
        // --------------------------------------------------

        setRiskStatus: function (oStatusControl, vScore) {
            if (
                vScore === null ||
                vScore === undefined ||
                vScore === "" ||
                !Number.isFinite(Number(vScore))
            ) {
                oStatusControl.setText("No assessment");
                oStatusControl.setState("None");
                return;
            }

            var nScore = Number(vScore);
            var sText;
            var sState;

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
        },

        // --------------------------------------------------
        // PRICE RISK DIALOG
        // --------------------------------------------------

        onCalculateQualityRisk: async function () {
            const oView = this.getView();

            if (!this._oPriceRiskDialog) {
                this._oPriceRiskDialog = await this.loadFragment({
                    name: "vrfrontend.view.fragments.PriceRisk"
                });
            }

            const oModel = oView.getModel("priceRisk");

            if (oModel) {
                oModel.setData({
                    vendorID: "",
                    hasResult: false,
                    priceRiskScore: 0,
                    riskLevel: "",
                    averagePriceDeviationPercent: 0,
                    totalPriceIncrease: 0,
                    totalInvoices: 0,
                    priceDeviationScore: 0,
                    riskState: "None"
                });
            }

            this._oPriceRiskDialog.open();
        },

        onOpenPriceRiskDialog: async function () {
            var oView = this.getView();
            var sVendorID = this.getSelectedVendorId();

            if (!sVendorID) {
                MessageBox.warning("Please select a vendor first.");
                return;
            }

            var oPriceRiskModel = oView.getModel("priceRisk");

            if (!oPriceRiskModel) {
                oPriceRiskModel = new JSONModel();
                oView.setModel(oPriceRiskModel, "priceRisk");
            }

            oPriceRiskModel.setData({
                vendorID: sVendorID,
                hasResult: false,
                priceRiskScore: 0,
                riskLevel: "",
                averagePriceDeviationPercent: 0,
                totalPriceIncrease: 0,
                totalInvoices: 0,
                priceDeviationScore: 0,
                riskState: "None"
            });

            if (!this._oPriceRiskDialog) {
                this._oPriceRiskDialog = await this.loadFragment({
                    name: "vrfrontend.view.fragments.PriceRisk"
                });
            }

            this._oPriceRiskDialog.open();
        },

        // --------------------------------------------------
        // PRICE RISK - Calculate using CAP action
        // --------------------------------------------------

        onOpenPriceRiskDialog: async function (oEvent) {
            var oView = this.getView();
            var oContext = oEvent.getSource().getBindingContext();
            var sVendorID = "";

            if (oContext) {
                sVendorID = oContext.getProperty("ID");
            }

            if (!sVendorID && this._selectedVendorID) {
                sVendorID = this._selectedVendorID;
            }

            if (!sVendorID) {
                sap.m.MessageBox.warning(
                    "Please select a vendor before opening Price Risk Assessment."
                );
                return;
            }

            if (!this._oPriceRiskDialog) {
                this._oPriceRiskDialog = await this.loadFragment({
                    name: "vrfrontend.view.fragments.PriceRisk"
                });
            }

            var oPriceRiskModel = oView.getModel("priceRisk");

            if (!oPriceRiskModel) {
                oPriceRiskModel = new sap.ui.model.json.JSONModel({});
                oView.setModel(oPriceRiskModel, "priceRisk");
            }

            oPriceRiskModel.setData({
                vendorID: sVendorID,
                totalInvoices: 0,
                totalPriceIncrease: 0,
                averagePriceDeviationPercent: 0,
                priceDeviationScore: 0,
                priceRiskScore: 0,
                riskLevel: "Not Calculated",
                riskState: "None"
            });

            this._oPriceRiskDialog.open();
        },

        onClosePriceRisk: function () {
            if (this._oPriceRiskDialog) {
                this._oPriceRiskDialog.close();
            }
        }
    });
});