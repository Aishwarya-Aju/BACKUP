sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Sorter",
    "sap/ui/core/routing/History",
    "sap/ui/core/UIComponent",
    "sap/ui/core/format/DateFormat",
    "vrfrontend/model/formatter"
], function (Controller, MessageToast, JSONModel, Sorter, History, UIComponent, DateFormat, formatter) {
    "use strict";

    const HIGH_RISK_LEVELS = ["HIGH", "CRITICAL"];
    const VENDOR_ACTIVE = "ACTIVE";
    const VENDOR_BLOCKED = "BLOCKED";
    const PO_PENDING = "PENDING_APPROVAL";
    const PO_APPROVED = "APPROVED";
    const MAX_ROWS = 5000;
    const LIST_SIZE = 5;

    // "PENDING_APPROVAL" -> "Pending Approval"
    function prettify(sValue) {
        if (!sValue) {
            return "";
        }
        return String(sValue)
            .replace(/_/g, " ")
            .toLowerCase()
            .replace(/\b\w/g, function (sChar) { return sChar.toUpperCase(); });
    }

    function normalize(sValue) {
        return String(sValue || "").trim().toUpperCase();
    }

    // Counts rows per value of sField -> [{status, count}], biggest first
    function countBy(aRows, sField, sFallback) {
        const mCounts = {};
        aRows.forEach(function (oRow) {
            const sKey = prettify(oRow[sField]) || sFallback;
            mCounts[sKey] = (mCounts[sKey] || 0) + 1;
        });
        return Object.keys(mCounts)
            .map(function (sKey) {
                return { status: sKey, count: mCounts[sKey] };
            })
            .sort(function (a, b) { return b.count - a.count; });
    }

    function countWhere(aRows, fnTest) {
        return aRows.filter(fnTest).length;
    }

    return Controller.extend("vrfrontend.controller.View1", {

        formatter: formatter,

        onInit: function () {
            const oView = this.getView();

            oView.setModel(new JSONModel({
                busy: true,
                error: false,
                lastRefreshed: "",
                vendorsTotal: "\u2013",
                vendorsActive: "\u2013",
                vendorsHighRisk: "\u2013",
                vendorsBlocked: "\u2013",
                poTotal: "\u2013",
                poPending: "\u2013",
                poApproved: "\u2013",
                invoiceTotal: "\u2013"
            }), "kpi");

            oView.setModel(new JSONModel({ VendorStatus: [] }), "vendorChart");
            oView.setModel(new JSONModel({ poStatus: [] }), "poChart");
            oView.setModel(new JSONModel({ levels: [] }), "riskChart");
            oView.setModel(new JSONModel({ statuses: [] }), "invoiceChart");
            oView.setModel(new JSONModel({ purchaseOrders: [], highRiskVendors: [] }), "recent");

            this._configureCharts();
            this._loadDashboard();
            this.getView().setModel(
                new JSONModel({ levels: [] }),
                "riskChart"
            );

            this._loadVendorRiskChart();
        },



        _loadVendorRiskChart: async function () {
            var oModel = this.getOwnerComponent().getModel();

            if (!oModel) {
                console.error("OData V4 model not found.");
                return;
            }

            var oBinding = oModel.bindList("/Vendors");

            try {
                var aContexts = await oBinding.requestContexts(0, 1000);

                var aVendors = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                var mCounts = {
                    Low: 0,
                    Medium: 0,
                    High: 0,
                    Critical: 0
                };

                aVendors.forEach(function (oVendor) {
                    var sRiskLevel = String(
                        oVendor.riskLevel || ""
                    ).trim().toLowerCase();

                    if (sRiskLevel === "low") {
                        mCounts.Low++;
                    } else if (sRiskLevel === "medium") {
                        mCounts.Medium++;
                    } else if (sRiskLevel === "high") {
                        mCounts.High++;
                    } else if (sRiskLevel === "critical") {
                        mCounts.Critical++;
                    }
                });

                var aLevels = [
                    { status: "Low", count: mCounts.Low },
                    { status: "Medium", count: mCounts.Medium },
                    { status: "High", count: mCounts.High },
                    { status: "Critical", count: mCounts.Critical }
                ].filter(function (oLevel) {
                    return oLevel.count > 0;
                });

                this.getView()
                    .getModel("riskChart")
                    .setProperty("/levels", aLevels);

                console.log("Vendor risk counts:", aLevels);

            } catch (oError) {
                console.error("Failed to load vendor risk counts:", oError);
            } finally {
                oBinding.destroy();
            }
        },




        onNav: function () {
            const oHistory = History.getInstance();
            const sPreviousHash = oHistory.getPreviousHash();

            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                UIComponent.getRouterFor(this).navTo("Routehome", {}, true);
            }
        },

        onVendorPress: function () {
            this.getOwnerComponent().getRouter().navTo("Vendor");
        },

        onPurchaseOrderPress: function () {
            this.getOwnerComponent().getRouter().navTo("PurchaseOrder");
        },

        onInvoicePress: function () {
            this.getOwnerComponent().getRouter().navTo("Invoice");
        },

        onVendorRisk: function () {
            this.getOwnerComponent().getRouter().navTo("VendorDashboard");
        },

        // Opens the purchase order detail page (same route and parameter as the PO list uses)
        onRecentPOPress: function (oEvent) {
            const oRow = oEvent.getSource().getBindingContext("recent").getObject();
            this.getOwnerComponent().getRouter().navTo("POItem", {
                po: encodeURIComponent(oRow.path)
            });
        },

        // Opens the vendor detail page (same route and parameter as the vendor list uses)
        onHighRiskVendorPress: function (oEvent) {
            const oRow = oEvent.getSource().getBindingContext("recent").getObject();
            this.getOwnerComponent().getRouter().navTo("VendorObject", {
                ven: encodeURIComponent(oRow.path)
            });
        },

        onRefresh: function () {
            this._loadDashboard();
            MessageToast.show("Refreshing dashboard...");
        },

        // ------------------------------------------------------------
        // Data loading: each entity set is read ONCE
        // ------------------------------------------------------------

        _readAll: function (sPath, oSorter) {
            const oBinding = this.getOwnerComponent()
                .getModel()
                .bindList(sPath, null, oSorter || [], []);
            return oBinding.requestContexts(0, MAX_ROWS);
        },

        _loadDashboard: async function () {
            const oKpi = this.getView().getModel("kpi");
            const oModel = this.getOwnerComponent().getModel();

            oKpi.setProperty("/busy", true);
            oKpi.setProperty("/error", false);

            // Totals come from your existing backend functions
            this._loadTotalVendor(oModel);
            this._loadTotalPO(oModel);
            this._loadTotalInvoice(oModel);

            try {
                const aResults = await Promise.all([
                    this._readAll("/Vendors"),
                    this._readAll("/PurchaseOrders", new Sorter("poDate", true)),
                    this._readAll("/Invoices")
                ]);

                this._buildDashboard(aResults[0], aResults[1], aResults[2]);

                oKpi.setProperty(
                    "/lastRefreshed",
                    DateFormat.getTimeInstance({ style: "medium" }).format(new Date())
                );
            } catch (oError) {
                console.error("Failed to load dashboard data:", oError);
                oKpi.setProperty("/error", true);
                MessageToast.show("Unable to load dashboard data");
            } finally {
                oKpi.setProperty("/busy", false);
            }
        },

        _buildDashboard: function (aVendorCtx, aPOCtx, aInvoiceCtx) {
            const oView = this.getView();
            const oKpi = oView.getModel("kpi");

            const aVendors = aVendorCtx.map(function (oCtx) {
                return { path: oCtx.getPath(), data: oCtx.getObject() };
            });
            const aPOs = aPOCtx.map(function (oCtx) {
                return { path: oCtx.getPath(), data: oCtx.getObject() };
            });
            const aVendorData = aVendors.map(function (o) { return o.data; });
            const aPOData = aPOs.map(function (o) { return o.data; });
            const aInvoiceData = aInvoiceCtx.map(function (oCtx) { return oCtx.getObject(); });

            const fnHighRisk = function (oVendor) {
                return HIGH_RISK_LEVELS.indexOf(normalize(oVendor.riskLevel)) !== -1;
            };

            // KPI numbers
            oKpi.setProperty("/vendorsActive", countWhere(aVendorData, function (o) {
                return normalize(o.vendorStatus) === VENDOR_ACTIVE;
            }));
            oKpi.setProperty("/vendorsBlocked", countWhere(aVendorData, function (o) {
                return normalize(o.vendorStatus) === VENDOR_BLOCKED;
            }));
            oKpi.setProperty("/vendorsHighRisk", countWhere(aVendorData, fnHighRisk));
            oKpi.setProperty("/poPending", countWhere(aPOData, function (o) {
                return normalize(o.poStatus) === PO_PENDING;
            }));
            oKpi.setProperty("/poApproved", countWhere(aPOData, function (o) {
                return normalize(o.poStatus) === PO_APPROVED;
            }));

            // Charts
            oView.getModel("vendorChart").setProperty("/VendorStatus", countBy(aVendorData, "vendorStatus", "Unknown"));
            oView.getModel("riskChart").setProperty("/levels", countBy(aVendorData, "riskLevel", "Not Assessed"));
            oView.getModel("poChart").setProperty("/poStatus", countBy(aPOData, "poStatus", "Unknown"));
            oView.getModel("invoiceChart").setProperty("/statuses", countBy(aInvoiceData, "invoiceStatus", "Unknown"));

            // Lists
            const oDateFormat = DateFormat.getDateInstance({ style: "medium" });
            const aRecentPOs = aPOs.slice(0, LIST_SIZE).map(function (oRow) {
                const oPO = oRow.data;
                const oDate = new Date(oPO.poDate);
                return {
                    path: oRow.path,
                    poNumber: oPO.poNumber,
                    poStatus: oPO.poStatus,
                    statusText: prettify(oPO.poStatus),
                    totalAmount: oPO.totalAmount,
                    currency: oPO.currency,
                    poDateText: isNaN(oDate.getTime()) ? (oPO.poDate || "") : oDateFormat.format(oDate)
                };
            });

            const aHighRiskVendors = aVendors
                .filter(function (oRow) { return fnHighRisk(oRow.data); })
                .slice(0, LIST_SIZE)
                .map(function (oRow) {
                    return {
                        path: oRow.path,
                        vendorName: oRow.data.vendorName,
                        vendorCode: oRow.data.vendorCode,
                        statusText: prettify(oRow.data.vendorStatus),
                        riskText: prettify(oRow.data.riskLevel),
                        riskState: "Error"
                    };
                });

            oView.getModel("recent").setData({
                purchaseOrders: aRecentPOs,
                highRiskVendors: aHighRiskVendors
            });
        },

        // ------------------------------------------------------------
        // Existing total functions (kept), now writing into the "kpi" model
        // ------------------------------------------------------------

        _loadTotalVendor: function (oModel) {
            const oOperation = oModel.bindContext("/totalVendor(...)");
            oOperation.invoke().then(() => {
                const oResult = oOperation.getBoundContext().getObject();
                this.getView().getModel("kpi").setProperty("/vendorsTotal", oResult.value ?? oResult);
            }).catch((oError) => {
                console.error("Error getting vendor count:", oError);
                MessageToast.show("Unable to load vendor count");
            });
        },

        _loadTotalPO: function (oModel) {
            const oOperation = oModel.bindContext("/totalPO(...)");
            oOperation.invoke().then(() => {
                const oResult = oOperation.getBoundContext().getObject();
                this.getView().getModel("kpi").setProperty("/poTotal", oResult.value ?? oResult);
            }).catch((oError) => {
                console.error("Error getting PO count:", oError);
                MessageToast.show("Unable to load PO count");
            });
        },

        _loadTotalInvoice: function (oModel) {
            const oOperation = oModel.bindContext("/totalInvoice(...)");
            oOperation.invoke().then(() => {
                const oResult = oOperation.getBoundContext().getObject();
                this.getView().getModel("kpi").setProperty("/invoiceTotal", oResult.value ?? oResult);
            }).catch((oError) => {
                console.error("Error getting invoice count:", oError);
                MessageToast.show("Unable to load invoice count");
            });
        },

        // ------------------------------------------------------------
        // Chart styling (kept in JS so no fragile syntax inside the XML)
        // ------------------------------------------------------------

        _setViz: function (sId, oProperties) {
            const oViz = this.byId(sId);

            if (oViz) {
                oViz.setVizProperties(oProperties);
            }
        },

        _configureCharts: function () {
            const aPalette = [
                "#0F8B8D",
                "#0B2A4A",
                "#6A4C93",
                "#E9730C",
                "#2E7D32",
                "#8396A8"
            ];

            const fnDonut = function (oPlotArea) {
                return {
                    title: {
                        visible: false
                    },
                    legend: {
                        visible: true,
                        title: {
                            visible: false
                        }
                    },
                    legendGroup: {
                        layout: {
                            position: "bottom"
                        }
                    },
                    plotArea: oPlotArea
                };
            };

            const fnBar = function (sColor) {
                return {
                    title: {
                        visible: false
                    },
                    legend: {
                        visible: false
                    },
                    plotArea: {
                        colorPalette: [sColor],
                        dataLabel: {
                            visible: true
                        }
                    },
                    valueAxis: {
                        title: {
                            visible: false
                        }
                    },
                    categoryAxis: {
                        title: {
                            visible: false
                        }
                    }
                };
            };

            this._setViz(
                "idVizFrame",
                fnDonut({
                    colorPalette: aPalette,
                    dataLabel: {
                        visible: true
                    }
                })
            );

            // Vendor Risk Donut Chart

            this._setViz("riskViz", {
                title: {
                    visible: false
                },
                legend: {
                    visible: true,
                    title: {
                        visible: false
                    }
                },
                legendGroup: {
                    layout: {
                        position: "bottom"
                    }
                },
                plotArea: {
                    colorPalette: [
                        "#2E7D32",
                        "#E9730C",
                        "#BB0000",
                        "#7A0000"
                    ],
                    dataLabel: {
                        visible: true
                    }
                }
            });

   
this._setViz("riskViz", {
    title: {
        visible: false
    },

    legend: {
        visible: true,
        title: {
            visible: false
        }
    },

    legendGroup: {
        layout: {
            position: "bottom"
        }
    },

    plotArea: {
        colorPalette: [
            "#2E7D32",
            "#E9730C",
            "#BB0000",
            "#7A0000"
        ],

        dataLabel: {
            visible: true,
            type: "value",
            formatString: "#,##0"
        }
    },

    interaction: {
        selectability: {
            mode: "EXCLUSIVE"
        }
    }
});

            this._setViz("idVizFrames", fnBar("#0F8B8D"));
            this._setViz("invoiceViz", fnBar("#6A4C93"));
        }
    });
});