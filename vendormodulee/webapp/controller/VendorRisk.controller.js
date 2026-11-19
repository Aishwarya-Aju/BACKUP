sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "vendormodulee/model/VendorConfig",
    "vendormodulee/model/formatter"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    MessageToast,
    VendorConfig,
    formatter
) {
    "use strict";

    var MS_PER_DAY = 24 * 60 * 60 * 1000;

    // ----- Assumptions about the scores. Change them here if your data differs.
    // Highest possible risk score (the progress bars are drawn against it)
    var MAX_SCORE = 100;
    // From this score a risk bar turns orange, then red (higher = riskier)
    var WARNING_FROM = 40;
    var ERROR_FROM = 70;

    // Rows shown per tab (the counts on the tabs and tiles are always complete)
    var LIST_LIMIT = 20;

    // Certificates expiring within this many days need attention
    var EXPIRY_WARNING_DAYS = 30;

    // Risk areas in the latest assessment: label and OData property
    var DIMENSIONS = [
        { name: "Delivery", field: "deliveryRisk" },
        { name: "Price", field: "priceRisk" },
        { name: "Quality", field: "qualityRisk" },
        { name: "Compliance", field: "complianceRisk" },
        { name: "Financial", field: "financialRisk" }
    ];

    return Controller.extend("vendormodulee.controller.VendorRisk", {

        onInit: function () {
            this.getView().setModel(
                new JSONModel(this._getInitialData()),
                "risk"
            );

            // Reload every time the page is shown, so the numbers are current
            this.getOwnerComponent()
                .getRouter()
                .getRoute("RouteVendorRisk")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._loadRisk();
        },

        _getInitialData: function () {
            return {
                busy: false,
                errorText: "",
                pageTitle: "My Risk Profile",
                scoreText: "",
                riskLevel: "",
                riskLevelText: "",
                lastCalculated: "",
                criticalVendor: false,
                hasAssessment: false,
                assessmentDate: "",
                dimensions: [],
                openAlerts: 0,
                delayedCount: 0,
                unresolvedComplaints: 0,
                expiringCertificates: 0,
                historyCount: 0,
                alertCount: 0,
                complaintCount: 0,
                certificateCount: 0,
                history: [],
                alerts: [],
                delayedDeliveries: [],
                complaints: [],
                certificates: []
            };
        },

        _getODataModel: function () {
            return this.getView().getModel() ||
                this.getOwnerComponent().getModel();
        },

        // Today as "yyyy-MM-dd" in the browser's time zone
        _getTodayIso: function () {
            var oNow = new Date();
            var sMonth = String(oNow.getMonth() + 1).padStart(2, "0");
            var sDay = String(oNow.getDate()).padStart(2, "0");

            return oNow.getFullYear() + "-" + sMonth + "-" + sDay;
        },

        // Reads a list from the OData V4 service and returns plain objects
        _requestList: function (oModel, sPath, aSorters, aFilters, sSelect) {
            var oBinding = oModel.bindList(
                sPath,
                null,
                aSorters,
                aFilters,
                { $select: sSelect }
            );

            return oBinding.requestContexts(0, 1000)
                .then(function (aContexts) {
                    var aObjects = aContexts.map(function (oContext) {
                        return oContext.getObject();
                    });

                    oBinding.destroy();

                    return aObjects;
                })
                .catch(function (oError) {
                    oBinding.destroy();
                    throw oError;
                });
        },

        _loadRisk: function () {
            var oModel = this._getODataModel();
            var oRisk = this.getView().getModel("risk");

            if (!oModel) {
                oRisk.setProperty(
                    "/errorText",
                    "The backend service is not available. Check the OData model in manifest.json."
                );
                return Promise.resolve(false);
            }

            oRisk.setProperty("/busy", true);
            oRisk.setProperty("/errorText", "");

            // Every list is limited to the configured vendor
            var aVendorFilter = [
                new Filter("vendor/vendorCode", FilterOperator.EQ, VendorConfig.vendorCode)
            ];

            return Promise.all([
                this._requestList(
                    oModel,
                    "/Vendors",
                    null,
                    [new Filter("vendorCode", FilterOperator.EQ, VendorConfig.vendorCode)],
                    "ID,vendorCode,vendorName,criticalVendor,currentRiskScore,riskLevel,lastRiskCalculation"
                ),
                this._requestList(
                    oModel,
                    "/RiskAssessments",
                    [new Sorter("assessmentDate", true)],
                    aVendorFilter,
                    "ID,assessmentDate,deliveryRisk,priceRisk,qualityRisk,complianceRisk,financialRisk,totalRiskScore,riskLevel"
                ),
                this._requestList(
                    oModel,
                    "/RiskAlerts",
                    [new Sorter("createdAt", true)],
                    aVendorFilter,
                    "ID,alertNumber,alertType,severity,message,status,createdAt,acknowledgedAt"
                ),
                this._requestList(
                    oModel,
                    "/Deliveries",
                    [new Sorter("expectedDeliveryDate", true)],
                    aVendorFilter,
                    "ID,materialCode,expectedDeliveryDate,actualDeliveryDate,delayDays,deliveryPercentage,deliveryStatus,deliveryRiskLevel"
                ),
                this._requestList(
                    oModel,
                    "/QualityComplaints",
                    [new Sorter("complaintDate", true)],
                    aVendorFilter,
                    "ID,complaintNumber,complaintDate,materialCode,defectType,severity,defectPercentage,complaintStatus,resolvedDate"
                ),
                this._requestList(
                    oModel,
                    "/ComplianceCertificates",
                    [new Sorter("expiryDate", false)],
                    aVendorFilter,
                    "ID,certificateType,certificateNumber,issuingAuthority,expiryDate,mandatory,verificationStatus"
                )
            ])
                .then(function (aResults) {
                    this._applyData.apply(this, aResults);
                    return true;
                }.bind(this))
                .catch(function (oError) {
                    oRisk.setProperty(
                        "/errorText",
                        "Your risk profile could not be loaded. " +
                        (oError && oError.message ? oError.message : "Please try again.")
                    );
                    return false;
                })
                .finally(function () {
                    oRisk.setProperty("/busy", false);
                });
        },

        // Colour of one risk bar
        _scoreState: function (fScore) {
            return fScore >= ERROR_FROM ? "Error" :
                fScore >= WARNING_FROM ? "Warning" : "Success";
        },

        _applyData: function (aVendors, aAssessments, aAlerts, aDeliveries, aComplaints, aCertificates) {
            var oRisk = this.getView().getModel("risk");
            var oVendor = aVendors[0];
            var oLatest = aAssessments[0];
            var sToday = this._getTodayIso();

            if (!oVendor) {
                oRisk.setProperty(
                    "/errorText",
                    "Vendor \"" + VendorConfig.vendorCode + "\" was not found. " +
                    "Check vendorCode in webapp/model/VendorConfig.js."
                );
            }

            oRisk.setProperty(
                "/pageTitle",
                oVendor ? "My Risk Profile - " + oVendor.vendorName : "My Risk Profile"
            );

            // ----- Overall score: the vendor's own score, else the latest assessment
            var vScore = oVendor && oVendor.currentRiskScore !== null && oVendor.currentRiskScore !== undefined
                ? oVendor.currentRiskScore
                : (oLatest ? oLatest.totalRiskScore : null);

            var sLevel = (oVendor && oVendor.riskLevel) || (oLatest && oLatest.riskLevel) || "";
            var sCalculated = (oVendor && oVendor.lastRiskCalculation) ||
                (oLatest && oLatest.assessmentDate) || "";

            oRisk.setProperty("/scoreText", formatter.score(vScore));
            oRisk.setProperty("/riskLevel", sLevel);
            oRisk.setProperty("/riskLevelText", formatter.label(sLevel));
            oRisk.setProperty("/lastCalculated", formatter.dateTime(sCalculated));
            oRisk.setProperty("/criticalVendor", !!(oVendor && oVendor.criticalVendor));

            // ----- Breakdown bars from the latest assessment
            oRisk.setProperty("/hasAssessment", !!oLatest);
            oRisk.setProperty(
                "/assessmentDate",
                oLatest ? formatter.dateTime(oLatest.assessmentDate) : ""
            );

            oRisk.setProperty("/dimensions", DIMENSIONS.map(function (oDimension) {
                var vValue = oLatest ? oLatest[oDimension.field] : null;
                var fValue = (vValue === null || vValue === undefined || vValue === "")
                    ? NaN
                    : Number(vValue);
                var bValid = !isNaN(fValue);

                return {
                    name: oDimension.name,
                    percent: bValid ? Math.max(0, Math.min(100, fValue / MAX_SCORE * 100)) : 0,
                    displayValue: bValid ? formatter.score(fValue) : "n/a",
                    state: bValid ? this._scoreState(fValue) : "None"
                };
            }, this));

            // ----- Tiles (counted over all records, not only the rows shown)
            var aDelayed = aDeliveries
                .filter(function (oDelivery) {
                    return Number(oDelivery.delayDays) > 0;
                })
                .sort(function (oA, oB) {
                    return Number(oB.delayDays) - Number(oA.delayDays);
                });

            var aCertificatesWithDays = aCertificates.map(function (oCertificate) {
                var iDays = oCertificate.expiryDate
                    ? Math.round((Date.parse(oCertificate.expiryDate) - Date.parse(sToday)) / MS_PER_DAY)
                    : null;

                return Object.assign({}, oCertificate, { daysLeft: iDays });
            });

            oRisk.setProperty("/openAlerts", aAlerts.filter(function (oAlert) {
                return !oAlert.acknowledgedAt;
            }).length);

            oRisk.setProperty("/delayedCount", aDelayed.length);

            oRisk.setProperty("/unresolvedComplaints", aComplaints.filter(function (oComplaint) {
                return !oComplaint.resolvedDate;
            }).length);

            oRisk.setProperty("/expiringCertificates", aCertificatesWithDays.filter(function (oCertificate) {
                return oCertificate.daysLeft !== null && oCertificate.daysLeft <= EXPIRY_WARNING_DAYS;
            }).length);

            // ----- Tabs
            oRisk.setProperty("/historyCount", aAssessments.length);
            oRisk.setProperty("/alertCount", aAlerts.length);
            oRisk.setProperty("/complaintCount", aComplaints.length);
            oRisk.setProperty("/certificateCount", aCertificatesWithDays.length);

            oRisk.setProperty("/history", aAssessments.slice(0, LIST_LIMIT));
            oRisk.setProperty("/alerts", aAlerts.slice(0, LIST_LIMIT));
            oRisk.setProperty("/delayedDeliveries", aDelayed.slice(0, LIST_LIMIT));
            oRisk.setProperty("/complaints", aComplaints.slice(0, LIST_LIMIT));
            oRisk.setProperty("/certificates", aCertificatesWithDays.slice(0, LIST_LIMIT));
        },

        // Navigation

                onOpenInvoices: function () {
            this.getOwnerComponent().getRouter().navTo("RouteInvoices");
        },

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("RouteVendorHome");
        },

        onOpenPurchaseOrders: function () {
            this.getOwnerComponent().getRouter().navTo("RoutePurchaseOrders");
        },

        // A tile opens the tab named in its custom data
        onKpiPress: function (oEvent) {
            var sTab = oEvent.getSource().data("tab");

            if (sTab) {
                this.byId("riskTabs").setSelectedKey(sTab);
            }
        },

        onRefresh: function () {
            this._loadRisk().then(function (bSuccess) {
                if (bSuccess) {
                    MessageToast.show("Risk profile refreshed.");
                }
            });
        }
    });
});