sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    return Controller.extend(
        "score.dashboard.controller.VendorDetails",
        {
            onBack: function () {
                const oApp = this.getView().getParent();

                if (oApp) {
                    oApp.back();
                }
            }
        }
    );
});
