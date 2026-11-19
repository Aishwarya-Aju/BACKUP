sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "vendormodulee/model/VendorConfig"
], function (
    Controller,
    Filter,
    FilterOperator,
    MessageToast,
    VendorConfig
) {
    "use strict";

    // Keys offered by the status filter in the view
    var VALID_STATUSES = [
        "ALL",
        "SENT_TO_VENDOR",
        "ACCEPTED",
        "REJECTED",
        "PARTIALLY_DELIVERED",
        "FULLY_DELIVERED",
        "CLOSED",
        "CANCELLED"
    ];

    return Controller.extend("vendormodulee.controller.PurchaseOrders", {

        onInit: function () {
            // The list binding in the view starts suspended. It is resumed in
            // _applyFilters, after the vendor filter has been set, so that
            // orders of other vendors are never requested.
            this.getOwnerComponent()
                .getRouter()
                .getRoute("RoutePurchaseOrders")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var mArguments = oEvent.getParameter("arguments") || {};
            var mQuery = mArguments["?query"] || {};

            // Opened from a dashboard card: show that status and clear the search
            if (mQuery.status) {
                var sStatus = VALID_STATUSES.indexOf(mQuery.status) >= 0
                    ? mQuery.status
                    : "ALL";

                this.byId("statusFilter").setSelectedKey(sStatus);
                this.byId("purchaseOrderSearch").setValue("");
            }

            // Applying the filters also reloads the list, so changes made on
            // the details page (accept, reject, new date) show up here
            this._applyFilters();
        },

        _applyFilters: function () {
            var oBinding = this.byId("purchaseOrdersTable").getBinding("items");

            if (!oBinding) {
                return;
            }

            var aFilters = VendorConfig.getBaseFilters();

            var sStatus = this.byId("statusFilter").getSelectedKey();

            if (sStatus && sStatus !== "ALL") {
                aFilters.push(new Filter("poStatus", FilterOperator.EQ, sStatus));
            }

            var sQuery = this.byId("purchaseOrderSearch").getValue().trim();

            if (sQuery) {
                aFilters.push(new Filter("poNumber", FilterOperator.Contains, sQuery));
            }

            // One AND filter: separate filters on the same path (poStatus)
            // would otherwise be combined with OR
            oBinding.filter(new Filter({ filters: aFilters, and: true }));

            if (oBinding.isSuspended()) {
                oBinding.resume();
            }
        },

        // Fires on Enter, on the search icon and on the clear icon
        onSearch: function () {
            this._applyFilters();
        },

        onStatusFilterChange: function () {
            this._applyFilters();
        },

        onRefresh: function () {
            var oBinding = this.byId("purchaseOrdersTable").getBinding("items");

            if (oBinding && !oBinding.isSuspended()) {
                oBinding.refresh();
                MessageToast.show("Purchase orders refreshed.");
            }
        },

        onUpdateFinished: function (oEvent) {
            var iTotal = oEvent.getParameter("total");

            this.byId("purchaseOrdersTitle").setText(
                typeof iTotal === "number" && iTotal >= 0
                    ? "My Purchase Orders (" + iTotal + ")"
                    : "My Purchase Orders"
            );
        },

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("RouteVendorHome");
        },

        // Header navigation (the view already binds these two buttons)
        onOpenRisk: function () {
            this.getOwnerComponent().getRouter().navTo("RouteVendorRisk");
        },

        onOpenInvoices: function () {
            this.getOwnerComponent().getRouter().navTo("RouteInvoices");
        },

        onPurchaseOrderPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext();

            if (!oContext) {
                MessageToast.show("Purchase order data is unavailable.");
                return;
            }

            var sId = oContext.getProperty("ID");

            if (!sId) {
                MessageToast.show("Purchase order ID is unavailable.");
                return;
            }

            this.getOwnerComponent().getRouter().navTo(
                "RoutePurchaseOrderObjectPage",
                { purchaseOrderId: encodeURIComponent(sId) }
            );
        }
    });
});