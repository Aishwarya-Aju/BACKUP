sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "vendormodulee/model/VendorConfig"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    MessageToast,
    VendorConfig
) {
    "use strict";

    var MS_PER_DAY = 24 * 60 * 60 * 1000;

    return Controller.extend("vendormodulee.controller.VendorHome", {

        onInit: function () {
            this.getView().setModel(
                new JSONModel(this._getInitialData()),
                "dashboard"
            );

            // Reload every time the dashboard is shown, so that actions taken
            // on the details page (accept, reject, new date) are reflected here
            this.getOwnerComponent()
                .getRouter()
                .getRoute("RouteVendorHome")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            this._loadDashboard();
        },

        _getInitialData: function () {
            return {
                busy: false,
                errorText: "",
                welcomeTitle: "Welcome",
                welcomeText: "Review the purchase orders sent to you, respond to them, and keep your delivery dates up to date.",
                total: 0,
                pending: 0,
                accepted: 0,
                rejected: 0,
                recentOrders: [],
                upcomingDeliveries: []
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

        _loadDashboard: function () {
            var oModel = this._getODataModel();
            var oDashboard = this.getView().getModel("dashboard");

            if (!oModel) {
                oDashboard.setProperty(
                    "/errorText",
                    "The backend service is not available. Check the OData model in manifest.json."
                );
                return Promise.resolve(false);
            }

            oDashboard.setProperty("/busy", true);
            oDashboard.setProperty("/errorText", "");

            var oVendorFilter = new Filter(
                "vendorCode",
                FilterOperator.EQ,
                VendorConfig.vendorCode
            );

            var oOrderFilter = new Filter({
                filters: VendorConfig.getBaseFilters(),
                and: true
            });

            return Promise.all([
                this._requestList(
                    oModel,
                    "/Vendors",
                    null,
                    [oVendorFilter],
                    "ID,vendorCode,vendorName"
                ),
                this._requestList(
                    oModel,
                    "/PurchaseOrders",
                    [new Sorter("poDate", true), new Sorter("poNumber", true)],
                    [oOrderFilter],
                    "ID,poNumber,poDate,expectedDeliveryDate,poStatus,totalAmount,currency"
                )
            ])
                .then(function (aResults) {
                    this._applyData(aResults[0], aResults[1]);
                    return true;
                }.bind(this))
                .catch(function (oError) {
                    oDashboard.setProperty(
                        "/errorText",
                        "Your dashboard could not be loaded. " +
                        (oError && oError.message ? oError.message : "Please try again.")
                    );
                    return false;
                })
                .finally(function () {
                    oDashboard.setProperty("/busy", false);
                });
        },

        _applyData: function (aVendors, aOrders) {
            var oDashboard = this.getView().getModel("dashboard");
            var oVendor = aVendors[0];
            var sToday = this._getTodayIso();

            if (oVendor) {
                oDashboard.setProperty("/welcomeTitle", "Welcome, " + oVendor.vendorName);
            } else {
                oDashboard.setProperty("/welcomeTitle", "Welcome");
                oDashboard.setProperty(
                    "/errorText",
                    "Vendor \"" + VendorConfig.vendorCode + "\" was not found. " +
                    "Check vendorCode in webapp/model/VendorConfig.js."
                );
            }

            var fnCount = function (sStatus) {
                return aOrders.filter(function (oOrder) {
                    return oOrder.poStatus === sStatus;
                }).length;
            };

            oDashboard.setProperty("/total", aOrders.length);
            oDashboard.setProperty("/pending", fnCount("SENT_TO_VENDOR"));
            oDashboard.setProperty("/accepted", fnCount("ACCEPTED"));
            oDashboard.setProperty("/rejected", fnCount("REJECTED"));

            // Orders arrive newest first
            oDashboard.setProperty(
                "/recentOrders",
                aOrders.slice(0, VendorConfig.recentOrdersLimit)
            );

            var aUpcoming = aOrders
                .filter(function (oOrder) {
                    return oOrder.poStatus === "ACCEPTED" &&
                        oOrder.expectedDeliveryDate &&
                        oOrder.expectedDeliveryDate >= sToday;
                })
                .sort(function (oA, oB) {
                    return oA.expectedDeliveryDate.localeCompare(oB.expectedDeliveryDate);
                })
                .slice(0, VendorConfig.upcomingDeliveriesLimit)
                .map(function (oOrder) {
                    var iDays = Math.round(
                        (Date.parse(oOrder.expectedDeliveryDate) - Date.parse(sToday)) / MS_PER_DAY
                    );

                    return Object.assign({}, oOrder, {
                        daysText: iDays === 0 ? "Due today" :
                            iDays === 1 ? "Due tomorrow" :
                                "Due in " + iDays + " days",
                        daysState: iDays <= 2 ? "Warning" : "Information"
                    });
                });

            oDashboard.setProperty("/upcomingDeliveries", aUpcoming);


        },

                onOpenRisk: function () {
            this.getOwnerComponent().getRouter().navTo("RouteVendorRisk");
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

        // KPI card or button carrying the status in custom data ("ALL" = no filter)
        onKpiPress: function (oEvent) {
            var sStatus = oEvent.getSource().data("status");
            var oRouter = this.getOwnerComponent().getRouter();

            if (!sStatus || sStatus === "ALL") {
                oRouter.navTo("RoutePurchaseOrders");
                return;
            }

            oRouter.navTo("RoutePurchaseOrders", {
                query: { status: sStatus }
            });
        },

        onPurchaseOrderPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("dashboard");
            var sPurchaseOrderId = oContext && oContext.getProperty("ID");

            if (!sPurchaseOrderId) {
                MessageToast.show("Purchase order details are unavailable.");
                return;
            }

            this.getOwnerComponent().getRouter().navTo(
                "RoutePurchaseOrderObjectPage",
                { purchaseOrderId: encodeURIComponent(sPurchaseOrderId) }
            );
        },

        onRefreshDashboard: function () {
            this._loadDashboard().then(function (bSuccess) {
                if (bSuccess) {
                    MessageToast.show("Dashboard refreshed.");
                }
            });
        }
    });
});