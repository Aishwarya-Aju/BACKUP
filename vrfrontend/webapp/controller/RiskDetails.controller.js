sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/format/NumberFormat",
    "sap/m/MessageToast",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Text",
    "sap/m/VBox",
    "sap/m/ObjectStatus",
    "sap/m/ProgressIndicator",
    "vrfrontend/model/deliveryFormatter"
], function (
    Controller,
    JSONModel,
    NumberFormat,
    MessageToast,
    Table,
    Column,
    ColumnListItem,
    Text,
    VBox,
    ObjectStatus,
    ProgressIndicator,
    formatter
) {
    "use strict";

    // Column = [header, property, type]
    // types: text | date | qty | money | days | percent | risk
    var RISK_TYPES = {
        delivery: {
            title: "Delivery Risk",
            icon: "sap-icon://shipping-status",
            subtitle: "Delivery risk = quantity shortfall and delay, calculated per item, order and vendor.",
            action: "calculateDeliveryRisk",
            scoreField: "deliveryRiskScore",
            cards: [
                ["Total Orders", "totalOrders", "days"],
                ["On-Time Orders", "onTimeOrders", "days"],
                ["Delayed Orders", "delayedOrders", "days"]
            ],
            orderColumns: [
                ["PO Number", "poNumber", "text"],
                ["Invoice", "invoiceNumber", "text"],
                ["Expected Delivery", "expectedDeliveryDate", "date"],
                ["Actual Delivery", "actualDeliveryDate", "date"],
                ["Delay Checked On", "delayCheckDate", "date"],
                ["Timing", "timingStatus", "timing"],
                ["Committed Qty", "committedQuantity", "qty"],
                ["Received Qty", "receivedQuantity", "qty"],
                ["Delay Days", "delayDays", "days"],
                ["Quantity Risk", "quantityRisk", "percent"],
                ["Delay Risk", "delayRisk", "percent"],
                ["Delivery Risk", "deliveryRisk", "risk"]
            ],
            itemColumns: [
                ["Material Code", "materialCode", "text"],
                ["Description", "materialDescription", "text"],
                ["Ordered Qty", "orderedQuantity", "qty"],
                ["Committed Qty", "committedQuantity", "qty"],
                ["Received Qty", "receivedQuantity", "qty"],
                ["Shortfall", "shortfallQuantity", "qty"],
                ["Expected Delivery", "expectedDeliveryDate", "date"],
                ["Actual Delivery", "actualDeliveryDate", "date"],
                ["Delay Checked On", "delayCheckDate", "date"],
                ["Timing", "timingStatus", "timing"],
                ["Delay Days", "delayDays", "days"],
                ["Quantity Risk", "quantityRisk", "percent"],
                ["Delay Risk", "delayRisk", "percent"],
                ["Delivery Risk", "deliveryRisk", "risk"]
            ]
        },
        quality: {
            title: "Quality Risk",
            icon: "sap-icon://quality-issue",
            subtitle: "Quality risk = rejected quantity / inspected quantity, calculated per item, order and vendor.",
            action: "calculateQualityRisk",
            scoreField: "qualityRiskScore",
            cards: [
                ["Total Orders", "totalOrders", "days"],
                ["Received Qty", "receivedQuantity", "qty"],
                ["Accepted Qty", "acceptedQuantity", "qty"],
                ["Rejected Qty", "rejectedQuantity", "qty"]
            ],
            orderColumns: [
                ["PO Number", "poNumber", "text"],
                ["Invoice", "invoiceNumber", "text"],
                ["Received Qty", "receivedQuantity", "qty"],
                ["Inspected Qty", "inspectedQuantity", "qty"],
                ["Accepted Qty", "acceptedQuantity", "qty"],
                ["Rejected Qty", "rejectedQuantity", "qty"],
                ["Quality Risk", "qualityRisk", "risk"]
            ],
            itemColumns: [
                ["Material Code", "materialCode", "text"],
                ["Description", "materialDescription", "text"],
                ["Received Qty", "receivedQuantity", "qty"],
                ["Inspected Qty", "inspectedQuantity", "qty"],
                ["Accepted Qty", "acceptedQuantity", "qty"],
                ["Rejected Qty", "rejectedQuantity", "qty"],
                ["Quality Risk", "qualityRisk", "risk"]
            ]
        },
        price: {
            title: "Price Deviation Risk",
            icon: "sap-icon://money-bills",
            subtitle: "Price risk = invoice price increase / PO value. A lower invoice price is shown as saving, not risk.",
            action: "calculatePriceDeviationRisk",
            scoreField: "priceRiskScore",
            cards: [
                ["Total Orders", "totalOrders", "days"],
                ["PO Value", "poValue", "money"],
                ["Invoice Value", "invoiceValue", "money"],
                ["Price Difference", "priceDifference", "money"]
            ],
            orderColumns: [
                ["PO Number", "poNumber", "text"],
                ["Invoice", "invoiceNumber", "text"],
                ["PO Value", "poValue", "money"],
                ["Invoice Value", "invoiceValue", "money"],
                ["Difference", "priceDifference", "money"],
                ["Saving", "savingAmount", "money"],
                ["Price Risk", "priceRisk", "risk"]
            ],
            itemColumns: [
                ["Material Code", "materialCode", "text"],
                ["Description", "materialDescription", "text"],
                ["PO Unit Price", "poUnitPrice", "money"],
                ["Invoice Unit Price", "invoiceUnitPrice", "money"],
                ["Difference", "priceDifference", "money"],
                ["Deviation %", "priceDeviation", "percent"],
                ["Saving", "savingAmount", "money"],
                ["Price Risk", "priceRisk", "risk"]
            ]
        }
    };

    var oMoneyFormat = NumberFormat.getFloatInstance({
        minFractionDigits: 2,
        maxFractionDigits: 2,
        groupingEnabled: true
    });

    function isEmpty(vValue) {
        return vValue === null || vValue === undefined || vValue === "";
    }

    function riskState(sLevel) {
        if (sLevel === "Low") { return "Success"; }
        if (sLevel === "Medium") { return "Warning"; }
        if (sLevel === "High") { return "Error"; }
        return "None";
    }

        // Colour of the timing text (late / overdue = red, delivered on time = green)
    function timingState(sText) {
        var sValue = String(sText || "");
        if (sValue.indexOf("late") !== -1 || sValue.indexOf("Overdue") !== -1) { return "Error"; }
        if (sValue.indexOf("on time") !== -1) { return "Success"; }
        return "None";
    }

    // Text shown in a table cell for the given column type
    function formatValue(vValue, sType) {
        if (isEmpty(vValue)) { return "–"; }
        if (sType === "date") { return formatter.date(vValue); }
        if (sType === "qty") { return formatter.qty(vValue); }
        if (sType === "money") { return oMoneyFormat.format(Number(vValue)); }
        if (sType === "percent") { return Number(vValue).toFixed(2) + " %"; }
        return String(vValue);
    }

    return Controller.extend("vrfrontend.controller.RiskDetails", {

        // ==========================================
        // INITIALIZATION
        // ==========================================
        onInit: function () {
            this._oConfig = null;
            this._sVendorId = "";

            this._oState = new JSONModel({
                busy: false,
                error: "",
                level: "orders",
                title: "",
                icon: "",
                subtitle: "",
                vendorName: "",
                cards: [],
                orders: [],
                filteredOrders: [],
                orderCount: 0,
                items: [],
                selectedPO: "",
                filters: { search: "", status: "ALL" }
            });
            this.getView().setModel(this._oState, "risk");

            this.getOwnerComponent()
                .getRouter()
                .getRoute("RiskDetails")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var oArgs = oEvent.getParameter("arguments");
            var oConfig = RISK_TYPES[oArgs.riskType];

            if (!oConfig) {
                this._oState.setProperty("/error", "Unknown risk type: " + oArgs.riskType);
                return;
            }

            this._oConfig = oConfig;
            this._sVendorId = oArgs.vendorId;

            this._oState.setProperty("/title", oConfig.title);
            this._oState.setProperty("/icon", oConfig.icon);
            this._oState.setProperty("/subtitle", oConfig.subtitle);
            this._oState.setProperty("/level", "orders");
            this._oState.setProperty("/filters", { search: "", status: "ALL" });

            this._buildTables();
            this._load();
        },

        // ==========================================
        // TABLES (columns come from RISK_TYPES)
        // ==========================================
        _buildTables: function () {
            var oOrders = this.byId("ordersHolder");
            var oItems = this.byId("itemsHolder");

            oOrders.destroyItems();
            oItems.destroyItems();

            oOrders.addItem(this._createTable(
                this._oConfig.orderColumns,
                "/filteredOrders",
                true,
                "No purchase orders with an invoice were found for this vendor."
            ));
            oItems.addItem(this._createTable(
                this._oConfig.itemColumns,
                "/items",
                false,
                "This order has no items."
            ));
        },

        _createTable: function (aColumns, sPath, bClickable, sNoData) {
            var oTable = new Table({
                growing: true,
                growingThreshold: 20,
                popinLayout: "GridSmall",
                noDataText: sNoData,
                columns: aColumns.map(function (aColumn, iIndex) {
                    var bImportant = iIndex < 2 || aColumn[2] === "risk";
                    return new Column({
                        header: new Text({ text: aColumn[0] }),
                        minScreenWidth: bImportant ? "" : "Tablet",
                        demandPopin: !bImportant
                    });
                })
            });

            var oTemplate = new ColumnListItem({
                vAlign: "Middle",
                type: bClickable ? "Navigation" : "Inactive",
                highlight: { path: "risk>riskLevel", formatter: riskState },
                cells: aColumns.map(this._createCell, this)
            });
            if (bClickable) {
                oTemplate.attachPress(this.onOrderPress, this);
            }

            oTable.bindItems({ path: sPath, model: "risk", template: oTemplate });
            return oTable;
        },

        _createCell: function (aColumn) {
            var sPath = "risk>" + aColumn[1];
            var sType = aColumn[2];

            if (sType === "timing") {
                return new ObjectStatus({
                    text: "{" + sPath + "}",
                    state: { path: sPath, formatter: timingState }
                });
            }

            if (sType !== "risk") {
                return new Text({
                    text: {
                        path: sPath,
                        formatter: function (vValue) { return formatValue(vValue, sType); }
                    }
                });
            }

            // Risk column: bar when the risk is calculated, otherwise the status text (e.g. Pending Delivery)
            var fnHasValue = function (vValue) { return !isEmpty(vValue); };
            var fnNoValue = function (vValue) { return isEmpty(vValue); };

            return new VBox({
                items: [
                    new ProgressIndicator({
                        width: "8rem",
                        visible: { path: sPath, formatter: fnHasValue },
                        percentValue: {
                            path: sPath,
                            formatter: function (vValue) { return Number(vValue) || 0; }
                        },
                        displayValue: {
                            parts: [{ path: sPath }, { path: "risk>riskLevel" }],
                            formatter: function (vValue, sLevel) {
                                return isEmpty(vValue) ? "" : Number(vValue).toFixed(2) + " % · " + sLevel;
                            }
                        },
                        state: { path: "risk>riskLevel", formatter: riskState }
                    }),
                    new ObjectStatus({
                        visible: { path: sPath, formatter: fnNoValue },
                        text: "{risk>riskStatus}",
                        state: "None"
                    })
                ]
            });
        },

        // ==========================================
        // LOAD DATA  (OData V4 action of the existing service)
        // ==========================================
        onRefresh: function () {
            this._load();
        },

        _load: async function () {
            var oOperation = this.getOwnerComponent()
                .getModel()
                .bindContext("/" + this._oConfig.action + "(...)");

            this._oState.setProperty("/busy", true);
            this._oState.setProperty("/error", "");

            try {
                oOperation.setParameter("vendorID", this._sVendorId);
                await oOperation.execute();

                var oResult = JSON.parse(JSON.stringify(oOperation.getBoundContext().getObject()));
                this._showResult(oResult);
            } catch (oError) {
                this._oState.setProperty("/orders", []);
                this._oState.setProperty("/filteredOrders", []);
                this._oState.setProperty("/cards", []);
                this._oState.setProperty("/error",
                    "Unable to calculate the risk. " + ((oError && oError.message) || ""));
            } finally {
                oOperation.destroy();
                this._oState.setProperty("/busy", false);
            }
        },

        _showResult: function (oResult) {
            var oConfig = this._oConfig;
            var vScore = oResult[oConfig.scoreField];

            // First card: vendor risk. Other cards come from the configuration.
            var aCards = [{
                value: isEmpty(vScore) ? "–" : Number(vScore).toFixed(2) + " %",
                label: isEmpty(vScore)
                    ? oResult.calculationStatus
                    : oResult.riskLevel + " Risk",
                state: riskState(oResult.riskLevel)
            }];

            oConfig.cards.forEach(function (aCard) {
                aCards.push({
                    value: formatValue(oResult[aCard[1]], aCard[2]),
                    label: aCard[0],
                    state: "None"
                });
            });

            this._oState.setProperty("/vendorName", oResult.vendorName);
            this._oState.setProperty("/cards", aCards);
            this._oState.setProperty("/orders", oResult.orders || []);
            this._oState.setProperty("/level", "orders");
            this._applyFilters();
        },

        // ==========================================
        // FILTERS AND NAVIGATION
        // ==========================================
        onSearch: function (oEvent) {
            var sValue = oEvent.getParameter("newValue");
            if (sValue === undefined) { sValue = oEvent.getParameter("query"); }
            this._oState.setProperty("/filters/search", sValue || "");
            this._applyFilters();
        },

        onStatusFilter: function (oEvent) {
            this._oState.setProperty("/filters/status", oEvent.getSource().getSelectedKey());
            this._applyFilters();
        },

        _applyFilters: function () {
            var oFilters = this._oState.getProperty("/filters");
            var sSearch = (oFilters.search || "").trim().toLowerCase();

            var aRows = this._oState.getProperty("/orders").filter(function (oOrder) {
                if (oFilters.status !== "ALL" && oOrder.riskLevel !== oFilters.status) {
                    return false;
                }
                if (!sSearch) { return true; }
                return String(oOrder.poNumber || "").toLowerCase().indexOf(sSearch) !== -1 ||
                    String(oOrder.invoiceNumber || "").toLowerCase().indexOf(sSearch) !== -1;
            });

            this._oState.setProperty("/filteredOrders", aRows);
            this._oState.setProperty("/orderCount", aRows.length);
        },

        // Click on an order: show its items
        onOrderPress: function (oEvent) {
            var oOrder = oEvent.getSource().getBindingContext("risk").getObject();

            this._oState.setProperty("/items", oOrder.items || []);
            this._oState.setProperty("/selectedPO", oOrder.poNumber);
            this._oState.setProperty("/level", "items");
        },

        onBackToOrders: function () {
            this._oState.setProperty("/level", "orders");
        },

        onNavBack: function () {
            if (this._oState.getProperty("/level") === "items") {
                this._oState.setProperty("/level", "orders");
                return;
            }
            this.getOwnerComponent().getRouter().navTo("VendorDashboard");
        }
    });
});