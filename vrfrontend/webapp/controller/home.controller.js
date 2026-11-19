sap.ui.define([
    "sap/ui/core/mvc/Controller",
     "sap/m/MessageBox"
], (Controller,MessageBox) => {
    "use strict";

    return Controller.extend("vrfrontend.controller.home", {
        onInit() {
        },

          onOpenQualityControl: function () {
             this.getOwnerComponent()
        .getRouter()
        .navTo("QualityControl");
            // MessageBox.information(
            //     "The Quality Control module will be developed next."
            // );
        },
                    onOpenVendors: function () {
                          this.getOwnerComponent()
        .getRouter()
        .navTo("vendorSelfService");
    //                var sUrl = "https://65850598trial.launchpad.cfapps.us10.hana.ondemand.com/c2f19d74-1e62-4abc-981a-e982c7e24575.vendormodulee.vendormodulee-0.0.1/index.html";

    // window.open(sUrl, "_blank");
            },
           onOpenPurchaseOrdersTeam: function(){
                this.getOwnerComponent().getRouter().navTo("POCreation");
           },
            onOpenPurchaseOrders: function () {
                this.getOwnerComponent().getRouter().navTo("View1")
            },
            onOpenDeliveryTeam: function () {
                this.getOwnerComponent().getRouter().navTo("DeliveryTeam");
            },

            onOpenRiskDashboard: function () {
                      this.getOwnerComponent()
        .getRouter()
        .navTo("VendorDashboard");
                // MessageBox.information(
                //     "The Vendor Risk Dashboard will be developed next."
                // );
            }

    });
});