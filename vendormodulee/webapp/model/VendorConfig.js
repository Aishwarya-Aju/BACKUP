sap.ui.define([
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Filter, FilterOperator) {
    "use strict";

    /**
     * PHASE 1 ONLY - TEMPORARY SINGLE-VENDOR SETUP
     *
     * This file is the ONE place where the vendor shown in the portal is chosen.
     * It exists only so the vendor UI can be built and tested against real data.
     *
     * It is NOT security. Every browser can still call the OData service and read
     * every vendor's data. Real vendor identification and data restriction
     * (login, authorization, server-side filtering in CAP) belongs to Phase 2.
     */
    return {

        // Vendors.vendorCode of the vendor to show (checked against
        // /odata/v4/vendor-risk/Vendors: V002 = Beta Components, ACTIVE)
        vendorCode: "V002",

        // Purchase order statuses a vendor must never see.
        // These orders have not been sent to the vendor yet:
        // DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT_TO_VENDOR
        hiddenStatuses: ["DRAFT", "PENDING_APPROVAL", "APPROVED"],

        // Dashboard list sizes
        recentOrdersLimit: 5,
        upcomingDeliveriesLimit: 5,

        /**
         * Filters that restrict any PurchaseOrders query to the configured vendor.
         * Combine them with AND, for example:
         * new Filter({ filters: aBaseFilters.concat(aOtherFilters), and: true })
         *
         * @returns {sap.ui.model.Filter[]} base filters
         */
        getBaseFilters: function () {
            var aFilters = [
                new Filter("vendor/vendorCode", FilterOperator.EQ, this.vendorCode)
            ];

            this.hiddenStatuses.forEach(function (sStatus) {
                aFilters.push(new Filter("poStatus", FilterOperator.NE, sStatus));
            });

            return aFilters;
        }
    };
});