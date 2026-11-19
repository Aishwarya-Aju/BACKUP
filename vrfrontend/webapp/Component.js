sap.ui.define([
    "sap/ui/core/UIComponent",
    "vrfrontend/model/models",
    "sap/ushell/Container",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast"
], (UIComponent, models, Container,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast) => {
    "use strict";

    return UIComponent.extend("vrfrontend.Component", {
        metadata: {
            manifest: "json",
            interfaces: [
                "sap.ui.core.IAsyncContentCreation"
            ]
        },

        init() {
            // call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // set the device model
            this.setModel(models.createDeviceModel(), "device");

            // enable routing
            this.getRouter().initialize();

            // Initialize user model before loading the view
            this.setModel(new JSONModel({
                ID: "",
                empId: "",
                name: "",
                designation: ""
            }), "user");
            console.log("hello")
 
            this.onLoadUser();

        },
        onLoadUser: async function () {
            let oListBinding;
            console.log("Hi")
            try {
                // Get logged-in user from Build Work Zone
                const oUserInfo =
                    await Container.getServiceAsync("UserInfo");
 
                const sEmail = oUserInfo.getUser().getEmail();
 
                console.log("Logged-in email:", sEmail);
 
                if (!sEmail) {
                    MessageToast.show("User email not available");
                    return;
                }
 
                // Get component's default OData V4 model
                const oModel = this.getModel();
 
                if (!oModel || typeof oModel.bindList !== "function") {
                    throw new Error(
                        "Default model is not an OData V4 model"
                    );
                }
 
                // Fetch user matching the email
                oListBinding = oModel.bindList("/Employee", null, null, [
                    new Filter(
                        "empId",
                        FilterOperator.EQ,
                        sEmail
                    )
                ]);
 
                const aContexts =
                    await oListBinding.requestContexts(0, 1);
 
                if (aContexts.length === 0) {
                    MessageToast.show("No user record found");
                    return;
                }
 
                const oUserData = aContexts[0].getObject();
 
                // Assign backend data to JSONModel
                this.getModel("user").setData({
                    ID: oUserData.ID,
                    name: oUserData.name,
                    empId: oUserData.empId,
                    designation: oUserData.designation,
                });
 
                console.log("Logged-in user:", oUserData);
                console.log("Role:", oUserData.role);
 
            } catch (error) {
                console.error("Error loading user:", error);
                MessageToast.show("Unable to load user details");
            } finally {
                if (oListBinding) {
                    oListBinding.destroy();
                }
            }
        }
 
    });
});