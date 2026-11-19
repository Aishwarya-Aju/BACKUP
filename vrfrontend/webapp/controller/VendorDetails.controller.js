sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/ui/core/routing/History"
], function (Controller, JSONModel, MessageBox, History) {
    "use strict";

    return Controller.extend("vrfrontend.controller.VendorDetails", {

        onInit: function () {
            this.getOwnerComponent()
                .getRouter()
                .getRoute("VendorDetails")
                .attachPatternMatched(this._onVendorMatched, this);
        },

        _onVendorMatched: async function (oEvent) {
            var sVendorId = oEvent.getParameter("arguments").vendorId;
            var oModel = this.getOwnerComponent().getModel();

            if (!sVendorId) {
                MessageBox.error("Vendor ID was not provided.");
                return;
            }

            try {
                // Load the selected vendor from OData V4
                var oVendor = await oModel
                    .bindContext("/Vendors(" + sVendorId + ")")
                    .requestObject();

                if (!oVendor) {
                    MessageBox.error("Vendor details were not found.");
                    return;
                }

                // Calculate the risk state for the ObjectStatus
                var nScore = Number(oVendor.currentRiskScore || 0);
                var sRiskLevel = oVendor.riskLevel || "";

                var sRiskState = "Success";

                if (
                    sRiskLevel === "Critical" ||
                    sRiskLevel === "High" ||
                    (!sRiskLevel && nScore > 60)
                ) {
                    sRiskState = "Error";
                } else if (
                    sRiskLevel === "Medium" ||
                    (!sRiskLevel && nScore > 30)
                ) {
                    sRiskState = "Warning";
                }

                // Prepare data for the XML view
                var oDetails = Object.assign({}, oVendor, {
                    riskState: sRiskState
                });

                // Bind to the named model used by VendorDetails.view.xml
                this.getView().setModel(
                    new JSONModel(oDetails),
                    "selectedVendor"
                );

                console.log("Vendor details loaded:", oDetails);

            } catch (oError) {
                console.error("Failed to load vendor details:", oError);

                MessageBox.error(
                    "Unable to load vendor details. Please check the console."
                );
            }
        },

        onBack: function () {
         this.getOwnerComponent()
.getRouter()
.navTo("VendorDashboard", {}, true);
        }

    });
});