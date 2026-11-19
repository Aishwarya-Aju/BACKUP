sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast"
], function (Controller, History, JSONModel, MessageToast) {
    "use strict";

    // Invoice statuses that the backend lets the vendor edit:
    //  - DRAFT      : created by vendorAccept, to be completed by the vendor
    //  - SUBMITTED  : the backend action updateInvoice accepts only this status
    // Every other status (APPROVED, UNDER_REVIEW, BLOCKED ...) is read-only.
    var EDITABLE_STATUSES = ["DRAFT", "SUBMITTED"];

    return Controller.extend("vendormodulee.controller.InvoiceObjectPage", {

        onInit: function () {
            // View state only (busy flag and error text); invoice data is
            // bound from the default OData V4 model.
            this.getView().setModel(
                new JSONModel({ busy: false, errorText: "" }),
                "invoiceView"
            );

            this.getOwnerComponent()
                .getRouter()
                .getRoute("RouteInvoiceObjectPage")
                .attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched: function (oEvent) {
            var sInvoiceId = oEvent.getParameter("arguments").invoiceId;
            var oViewModel = this.getView().getModel("invoiceView");
            var sPath = "/Invoices(" + sInvoiceId + ")";
            var oBinding = this.getView().getElementBinding();

            oViewModel.setProperty("/errorText", "");
            oViewModel.setProperty("/busy", false);

            // Coming back after the invoice was saved: the same invoice is
            // already bound, so reload it instead of showing stale data
            if (oBinding && oBinding.getPath() === sPath) {
                oBinding.refresh();
                return;
            }

            // Header plus its items, loaded with $expand on the composition
            // "items" (VendorRiskService.Invoices -> InvoiceItems)
            this.getView().bindElement({
                path: sPath,
                parameters: {
                    $expand: "purchaseOrder($select=ID,poNumber,poStatus),vendor($select=vendorName,vendorCode),items"
                },
                events: {
                    dataRequested: function () {
                        oViewModel.setProperty("/busy", true);
                    },
                    dataReceived: function (oDataEvent) {
                        var oError = oDataEvent.getParameter("error");

                        // Always release the busy state, also after an error
                        oViewModel.setProperty("/busy", false);

                        if (oError) {
                            oViewModel.setProperty(
                                "/errorText",
                                "The invoice could not be loaded. " +
                                (oError.message ? oError.message + " " : "") +
                                "Go back to Invoices and try again."
                            );
                        }
                    }
                }
            });
        },

        onItemsUpdateFinished: function (oEvent) {
            var iTotal = oEvent.getParameter("total");

            this.byId("invoiceItemsTitle").setText(
                typeof iTotal === "number" && iTotal >= 0
                    ? "Invoice Items (" + iTotal + ")"
                    : "Invoice Items"
            );
        },

        // "Complete Draft Invoice" (DRAFT) and "Edit Invoice" (SUBMITTED)
        // both open the existing invoice in the invoice form. No invoice is
        // created: the form works on this invoice's ID.
        onEditInvoice: function () {
            var oContext = this.getView().getBindingContext();
            var sId = oContext && oContext.getProperty("ID");
            var sStatus = oContext && oContext.getProperty("invoiceStatus");

            if (!sId) {
                MessageToast.show("Invoice details are unavailable.");
                return;
            }

            if (EDITABLE_STATUSES.indexOf(sStatus) < 0) {
                MessageToast.show("This invoice can no longer be edited.");
                return;
            }

            this.getOwnerComponent().getRouter().navTo(
                "RouteInvoiceEdit",
                { invoiceId: encodeURIComponent(sId) }
            );
        },

        onPurchaseOrderPress: function () {
            var oContext = this.getView().getBindingContext();
            var sPoId = oContext && oContext.getProperty("purchaseOrder/ID");

            if (!sPoId) {
                MessageToast.show("Purchase order details are unavailable.");
                return;
            }

            this.getOwnerComponent().getRouter().navTo(
                "RoutePurchaseOrderObjectPage",
                { purchaseOrderId: encodeURIComponent(sPoId) }
            );
        },

        onNavBack: function () {
            if (History.getInstance().getPreviousHash() !== undefined) {
                window.history.back();
            } else {
                this.getOwnerComponent().getRouter().navTo("RouteInvoices", {}, true);
            }
        }
    });
});
