sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "vendormodulee/model/VendorConfig",
    "sap/m/MessageBox"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    MessageToast,
    VendorConfig,
    MessageBox
) {
    "use strict";

    // Keys offered by the "Sort by" dropdown in the view. The list binding
    // also has a default $orderby, which is applied after these sorters.
    // Draft invoices have no invoice date yet, so they appear last when the
    // list is sorted by date; use the status filter "Draft" to find them.
    var SORTERS = {
        DATE_DESC: function () { return [new Sorter("invoiceDate", true)]; },
        DATE_ASC: function () { return [new Sorter("invoiceDate", false)]; },
        AMOUNT_DESC: function () { return [new Sorter("invoiceAmount", true)]; },
        AMOUNT_ASC: function () { return [new Sorter("invoiceAmount", false)]; },
        NUMBER_ASC: function () { return [new Sorter("invoiceNumber", false)]; },
        STATUS_ASC: function () { return [new Sorter("invoiceStatus", false)]; }
    };

    return Controller.extend("vendormodulee.controller.Invoices", {

        onInit: function () {
            // View state only (error text). Invoice data comes from the
            // default OData V4 model.
            this.getView().setModel(
                new JSONModel({ errorText: "" }),
                "invoicesView"
            );

            // The list binding in the view starts suspended; it is resumed
            // by _applyFilters once the vendor filter has been set.
            this.getOwnerComponent()
                .getRouter()
                .getRoute("RouteInvoices")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var oBinding = this._getBinding();

            if (!oBinding) {
                return;
            }

            // Watch the first load so that failures show an error state
            if (!this._bDataEventsAttached) {
                this._bDataEventsAttached = true;

                oBinding.attachDataRequested(function () {
                    this.getView().getModel("invoicesView").setProperty("/errorText", "");
                }, this);

                oBinding.attachDataReceived(function (oEvent) {
                    var oError = oEvent.getParameter("error");

                    if (oError) {
                        this.getView().getModel("invoicesView").setProperty(
                            "/errorText",
                            "The invoices could not be loaded. " +
                            (oError.message || "")
                        );
                    }
                }, this);
            }

            if (oBinding.isSuspended()) {
                this._applyFilters();
            } else {
                // Returning from the invoice form, the detail page or an
                // accepted purchase order: reload so that new drafts and
                // status changes show up
                oBinding.refresh();
            }
        },

        _getBinding: function () {
            return this.byId("invoicesTable").getBinding("items");
        },

        _applyFilters: function () {
            var oBinding = this._getBinding();

            if (!oBinding) {
                return;
            }

            // Phase 1: same single-vendor scope as the purchase order list.
            // This restricts by vendor only, never to individual invoices.
            var aFilters = [
                new Filter("vendor/vendorCode", FilterOperator.EQ, VendorConfig.vendorCode)
            ];

            var sStatus = this.byId("invoiceStatusFilter").getSelectedKey();

            if (sStatus && sStatus !== "ALL") {
                aFilters.push(new Filter("invoiceStatus", FilterOperator.EQ, sStatus));
            }

            var sQuery = this.byId("invoiceSearch").getValue().trim();

            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("invoiceNumber", FilterOperator.Contains, sQuery),
                        new Filter("purchaseOrder/poNumber", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }

            var sSort = this.byId("invoiceSort").getSelectedKey();
            var fnSorter = SORTERS[sSort] || SORTERS.DATE_DESC;

            oBinding.sort(fnSorter());
            oBinding.filter(new Filter({ filters: aFilters, and: true }));

            if (oBinding.isSuspended()) {
                oBinding.resume();
            }
        },

        onSearch: function () {
            this._applyFilters();
        },

        onStatusFilterChange: function () {
            this._applyFilters();
        },

        onSortChange: function () {
            this._applyFilters();
        },

        onRefresh: function () {
            var oBinding = this._getBinding();

            if (!oBinding) {
                return;
            }

            if (oBinding.isSuspended()) {
                this._applyFilters();
                return;
            }

            oBinding.refresh();
            MessageToast.show("Invoices refreshed.");
        },

        onUpdateFinished: function (oEvent) {
            var iTotal = oEvent.getParameter("total");

            this.byId("invoicesTitle").setText(
                typeof iTotal === "number" && iTotal >= 0
                    ? "Invoices (" + iTotal + ")"
                    : "Invoices"
            );
        },

        // Row press: always opens the invoice details of that invoice
        onInvoicePress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext();
            var sId = oContext && oContext.getProperty("ID");

            if (!sId) {
                MessageToast.show("Invoice ID is unavailable.");
                return;
            }

            this.getOwnerComponent().getRouter().navTo(
                "RouteInvoiceObjectPage",
                { invoiceId: encodeURIComponent(sId) }
            );
        },

        // "Complete Draft" button in a draft row: opens the existing draft
        // in the invoice form. Nothing is created here; the backend created
        // the draft when the purchase order was accepted.
        onCompleteDraftPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext();
            var sId = oContext && oContext.getProperty("ID");

            if (!sId) {
                MessageToast.show("Invoice ID is unavailable.");
                return;
            }

            this.getOwnerComponent().getRouter().navTo(
                "RouteInvoiceEdit",
                { invoiceId: encodeURIComponent(sId) }
            );
        },

        // Navigation

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("RouteVendorHome");
        },

        onOpenPurchaseOrders: function () {
            this.getOwnerComponent().getRouter().navTo("RoutePurchaseOrders");
        },

        onOpenRisk: function () {
            this.getOwnerComponent().getRouter().navTo("RouteVendorRisk");
        },

        //PDF Downloader
          onpdf: function () {
            var oTable = this.byId("invoicesTable"); // Replace with your table ID

            if (!oTable) {
                sap.m.MessageBox.error("Invoices table not found.");
                return;
            }

            var oSelectedItem = oTable.getSelectedItem();

            if (!oSelectedItem) {
                sap.m.MessageBox.warning("Please select one invoice record.");
                return;
            }

            var oContext = oSelectedItem.getBindingContext();

            if (!oContext) {
                sap.m.MessageBox.error("Unable to read the selected invoice record.");
                return;
            }

            var oRecord = oContext.getObject();

            var jsPDF = window.jspdf && window.jspdf.jsPDF;

            if (!jsPDF) {
                sap.m.MessageBox.error("jsPDF library is not loaded.");
                return;
            }

            var oDoc = new jsPDF({
                orientation: "portrait",
                unit: "mm",
                format: "a4"
            });

            var y = 20;
            var left = 15;
            var pageWidth = 180;

            oDoc.setFontSize(18);
            oDoc.text("Invoice Report", left, y);

            y += 12;
            oDoc.setFontSize(10);

            var aFields = [
                ["Invoice Number", oRecord.invoiceNumber],
                ["Invoice Date", oRecord.invoiceDate],
                ["Delivery Date", oRecord.deliveryDate],
                ["PO Number", oRecord.poNumber],
                ["Material Code", oRecord.materialCode],
                ["Invoice Amount", oRecord.invoiceAmount],
                ["Invoice Status", oRecord.invoiceStatus],
           
            ];

            aFields.forEach(function (aField) {
                var sValue = aField[1] == null || aField[1] === ""
                    ? "-"
                    : String(aField[1]);

                var aLines = oDoc.splitTextToSize(
                    aField[0] + ": " + sValue,
                    pageWidth
                );

                if (y + (aLines.length * 5) > 275) {
                    oDoc.setFontSize(8);
                }

                oDoc.text(aLines, left, y);
                y += aLines.length * 5 + 2;
            });

            var sFileName = "Invoices_" +
                String(oRecord.invoiceNumber || "Report").replace(/[\\/:*?"<>|]/g, "_") +
                ".pdf";

            oDoc.save(sFileName);
        }
    });
});
