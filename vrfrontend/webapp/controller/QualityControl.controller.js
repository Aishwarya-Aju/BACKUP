
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment"
], function (
    Controller,
    JSONModel,
    MessageBox,
    MessageToast,
    Filter,
    FilterOperator,
    Fragment
) {
    "use strict";

    return Controller.extend("vrfrontend.controller.QualityControl", {

        // ==========================================
        // INITIALIZATION
        // ==========================================
        onInit: function () {
            this._sStatusFilter = "";
            this._sSearch = "";
            this._oComplaintDialog = null;

            this.getView().setModel(new JSONModel({
                complaints: [],
                vendors: [],
                purchaseOrders: [],
                filteredPurchaseOrders: [],
                purchaseOrderMaterials: [],
                summary: {
                    total: 0,
                    open: 0,
                    investigating: 0,
                    resolved: 0
                }
            }), "quality");

            this._loadComplaints();
        },

        // ==========================================
        // STATUS FILTER
        // ==========================================
        onStatusFilterChange: function (oEvent) {
            var sStatus = oEvent.getSource().getSelectedKey();

            this._sStatusFilter =
                sStatus === "ALL" ? "" : (sStatus || "");

            this._applyFilters();
        },

        // ==========================================
        // LOAD VENDORS
        // ==========================================
        _loadVendors: async function () {
            var oModel = this.getOwnerComponent().getModel();
            var oBinding;

            if (!oModel) {
                throw new Error("Default OData model is unavailable.");
            }

            try {
                oBinding = oModel.bindList(
                    "/Vendors",
                    undefined,
                    undefined,
                    undefined,
                    {
                        $select: [
                            "ID",
                            "vendorCode",
                            "vendorName"
                        ]
                    }
                );

                var aContexts =
                    await oBinding.requestContexts(0, 1000);

                var aVendors = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                this.getView().getModel("quality")
                    .setProperty("/vendors", aVendors);

                console.log("Loaded vendors:", aVendors.length);

            } finally {
                if (oBinding) {
                    oBinding.destroy();
                }
            }
        },

        // ==========================================
        // LOAD PURCHASE ORDERS
        // ==========================================
        _loadPurchaseOrders: async function () {
            var oModel = this.getOwnerComponent().getModel();
            var oBinding;

            if (!oModel) {
                throw new Error("Default OData model is unavailable.");
            }

            try {
                oBinding = oModel.bindList(
                    "/PurchaseOrders",
                    undefined,
                    undefined,
                    undefined,
                    {
                        $select: [
                            "ID",
                            "poNumber",
                            "vendor_ID",
                            "poStatus"
                        ]
                    }
                );

                var aContexts =
                    await oBinding.requestContexts(0, 1000);

                var aOrders = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                console.log("Loaded purchase orders:", aOrders.length);

                if (aOrders.length > 0) {
                    console.log(
                        "Sample purchase order fields:",
                        Object.keys(aOrders[0])
                    );
                    console.log("Sample purchase order:", aOrders[0]);
                }

                this.getView().getModel("quality")
                    .setProperty("/purchaseOrders", aOrders);

                this.getView().getModel("quality")
                    .setProperty("/filteredPurchaseOrders", []);

            } finally {
                if (oBinding) {
                    oBinding.destroy();
                }
            }
        },

        // ==========================================
        // VENDOR CHANGE
        // Filter purchase orders by selected vendor
        // ==========================================
        onVendorChange: function (oEvent) {
            var sVendorID = oEvent.getSource().getSelectedKey();
            var oFormModel = this.getView().getModel("complaintForm");
            var oQualityModel = this.getView().getModel("quality");

            if (!oFormModel || !oQualityModel) {
                return;
            }

            oFormModel.setProperty("/vendor_ID", sVendorID);
            oFormModel.setProperty("/purchaseOrder_ID", "");
            oFormModel.setProperty("/materialCode", "");

            // Clear materials belonging to the previous PO.
            oQualityModel.setProperty("/purchaseOrderMaterials", []);

            var aAllOrders =
                oQualityModel.getProperty("/purchaseOrders") || [];

            var sSelectedVendorID = String(sVendorID || "")
                .trim()
                .toLowerCase();

            var aFilteredOrders = aAllOrders.filter(function (oOrder) {
                var sOrderVendorID = String(
                    oOrder.vendor_ID ||
                    (oOrder.vendor && oOrder.vendor.ID) ||
                    ""
                ).trim().toLowerCase();

                return sSelectedVendorID !== "" &&
                    sOrderVendorID === sSelectedVendorID;
            });

            oQualityModel.setProperty(
                "/filteredPurchaseOrders",
                aFilteredOrders
            );

            console.log("Selected vendor:", sVendorID);
            console.log(
                "Matching purchase orders:",
                aFilteredOrders.length,
                aFilteredOrders
            );
        },

        // ==========================================
        // PURCHASE ORDER CHANGE
        // Load material codes belonging to selected PO
        // ==========================================
        onPurchaseOrderChange: async function (oEvent) {
            var oView = this.getView();
            var oFormModel = oView.getModel("complaintForm");
            var oQualityModel = oView.getModel("quality");

            var sPOID = oEvent.getSource().getSelectedKey();

            if (!oFormModel || !oQualityModel) {
                return;
            }

            oFormModel.setProperty("/purchaseOrder_ID", sPOID);
            oFormModel.setProperty("/materialCode", "");

            // Clear materials from the previously selected PO.
            oQualityModel.setProperty("/purchaseOrderMaterials", []);

            console.log("Selected PO ID:", sPOID);

            if (!sPOID) {
                return;
            }

            var oModel = this.getOwnerComponent().getModel();
            var oBinding;

            if (!oModel) {
                MessageBox.error("OData model is not available.");
                return;
            }

            try {
                oBinding = oModel.bindList(
                    "/PurchaseOrderItems",
                    undefined,
                    undefined,
                    undefined,
                    {
                        $select: [
                            "ID",
                            "purchaseOrder_ID",
                            "materialCode",
                            "materialDescription"
                        ]
                    }
                );

                var aContexts =
                    await oBinding.requestContexts(0, 1000);

                var aItems = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                console.log("Purchase order items:", aItems);

                if (aItems.length > 0) {
                    console.log(
                        "First item fields:",
                        Object.keys(aItems[0])
                    );
                }

                // Match items to the selected purchase order.
                var aMaterials = aItems.filter(function (oItem) {
                    var sItemPOID = oItem.purchaseOrder_ID ||
                        (oItem.purchaseOrder &&
                            oItem.purchaseOrder.ID);

                    return String(sItemPOID || "").toLowerCase() ===
                        String(sPOID).toLowerCase();
                });

                // Remove duplicate material codes.
                var oSeen = {};
                var aUniqueMaterials = [];

                aMaterials.forEach(function (oItem) {
                    var sCode = oItem.materialCode;

                    if (sCode && !oSeen[sCode]) {
                        oSeen[sCode] = true;

                        aUniqueMaterials.push({
                            materialCode: sCode,
                            materialDescription:
                                oItem.materialDescription || sCode
                        });
                    }
                });

                oQualityModel.setProperty(
                    "/purchaseOrderMaterials",
                    aUniqueMaterials
                );

                console.log("Materials loaded:", aUniqueMaterials);

                if (aUniqueMaterials.length === 0) {
                    MessageToast.show(
                        "No materials found for this purchase order."
                    );
                }

            } catch (oError) {
                console.error(
                    "Failed to load purchase order items:",
                    oError
                );

                MessageBox.error(
                    "Could not load materials. Check the browser console for details."
                );

            } finally {
                if (oBinding) {
                    oBinding.destroy();
                }
            }
        },

        // ==========================================
        // LOAD QUALITY COMPLAINTS
        // ==========================================
        _loadComplaints: async function () {
            var oModel = this.getOwnerComponent().getModel();

            if (!oModel) {
                MessageBox.error(
                    "The default OData model is not available."
                );
                return;
            }

            var oBinding;

            try {
                oBinding = oModel.bindList(
                    "/QualityComplaints",
                    undefined,
                    undefined,
                    undefined,
                    {
                        $select: [
                            "ID",
                            "complaintNumber",
                            "materialCode",
                            "complaintDate",
                            "defectType",
                            "severity",
                            "defectPercentage",
                            "complaintStatus"
                        ]
                    }
                );

                var aContexts =
                    await oBinding.requestContexts(0, 1000);

                var aComplaints = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                var fnStatus = function (oComplaint) {
                    return String(
                        oComplaint.complaintStatus || ""
                    ).toUpperCase();
                };

                var oSummary = {
                    total: aComplaints.length,

                    open: aComplaints.filter(function (oComplaint) {
                        return fnStatus(oComplaint) === "OPEN";
                    }).length,

                    investigating: aComplaints.filter(function (oComplaint) {
                        return fnStatus(oComplaint) === "INVESTIGATING";
                    }).length,

                    resolved: aComplaints.filter(function (oComplaint) {
                        var sStatus = fnStatus(oComplaint);

                        return sStatus === "RESOLVED" ||
                            sStatus === "CLOSED";
                    }).length
                };

                var oQualityModel =
                    this.getView().getModel("quality");

                oQualityModel.setProperty(
                    "/complaints",
                    aComplaints
                );

                oQualityModel.setProperty("/summary", oSummary);

                this._applyFilters();

            } catch (oError) {
                console.error(
                    "Failed to load quality complaints:",
                    oError
                );

                MessageBox.error(
                    "Unable to load quality complaints. Check the OData service and browser console."
                );

            } finally {
                if (oBinding) {
                    oBinding.destroy();
                }
            }
        },

        onRefresh: function () {
            this._loadComplaints();
        },

        // ==========================================
        // SEARCH
        // ==========================================
        onSearch: function (oEvent) {
            this._sSearch =
                oEvent.getParameter("newValue") ||
                oEvent.getParameter("query") ||
                "";

            this._applyFilters();
        },

        // ==========================================
        // SUMMARY CARD FILTERS
        // ==========================================
        onShowAllComplaints: function () {
            this._sStatusFilter = "";
            this._syncStatusDropdown();
            this._applyFilters();
        },

        onShowOpenComplaints: function () {
            this._sStatusFilter = "OPEN";
            this._syncStatusDropdown();
            this._applyFilters();
        },

        onShowInvestigatingComplaints: function () {
            this._sStatusFilter = "INVESTIGATING";
            this._syncStatusDropdown();
            this._applyFilters();
        },

        onShowResolvedComplaints: function () {
            this._sStatusFilter = "RESOLVED";
            this._syncStatusDropdown();
            this._applyFilters();
        },

        _syncStatusDropdown: function () {
            var oStatusSelect = this.byId("qualityStatusFilter");

            if (oStatusSelect) {
                oStatusSelect.setSelectedKey(
                    this._sStatusFilter || "ALL"
                );
            }
        },

        // ==========================================
        // APPLY SEARCH AND STATUS FILTERS
        // ==========================================
        _applyFilters: function () {
            var oTable = this.byId("qualityComplaintsTable");

            if (!oTable) {
                return;
            }

            var oBinding = oTable.getBinding("items");

            if (!oBinding) {
                return;
            }

            var aFilters = [];
            var sSearch = (this._sSearch || "").trim();

            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter(
                            "complaintNumber",
                            FilterOperator.Contains,
                            sSearch
                        ),
                        new Filter(
                            "materialCode",
                            FilterOperator.Contains,
                            sSearch
                        ),
                        new Filter(
                            "defectType",
                            FilterOperator.Contains,
                            sSearch
                        )
                    ],
                    and: false
                }));
            }

            if (this._sStatusFilter === "RESOLVED") {
                aFilters.push(new Filter({
                    filters: [
                        new Filter(
                            "complaintStatus",
                            FilterOperator.EQ,
                            "RESOLVED"
                        ),
                        new Filter(
                            "complaintStatus",
                            FilterOperator.EQ,
                            "CLOSED"
                        )
                    ],
                    and: false
                }));
            } else if (this._sStatusFilter) {
                aFilters.push(new Filter(
                    "complaintStatus",
                    FilterOperator.EQ,
                    this._sStatusFilter
                ));
            }

            oBinding.filter(aFilters);
        },

        // ==========================================
        // OPEN CREATE COMPLAINT DIALOG
        // ==========================================
        onCreateComplaint: async function () {
            var oView = this.getView();

            try {
                await Promise.all([
                    this._loadVendors(),
                    this._loadPurchaseOrders()
                ]);

                if (!this._oComplaintDialog) {
                    this._oComplaintDialog = await Fragment.load({
                        id: oView.getId(),
                        name: "vrfrontend.view.fragments.QualityComplaint",
                        controller: this
                    });

                    oView.addDependent(this._oComplaintDialog);
                }

                var oFormModel = new JSONModel({
                    complaintNumber: "",
                    vendor_ID: "",
                    purchaseOrder_ID: "",
                    materialCode: "",
                    complaintDate: "",
                    defectType: "",
                    severity: "MEDIUM",
                    inspectedQuantity: "",
                    rejectedQuantity: "",
                    defectPercentage: "0.00",
                    complaintStatus: "OPEN",
                    rootCause: "",
                    correctiveAction: ""
                });

                oView.setModel(oFormModel, "complaintForm");

                var oQualityModel = oView.getModel("quality");

                oQualityModel.setProperty("/filteredPurchaseOrders", []);
                oQualityModel.setProperty("/purchaseOrderMaterials", []);

                this._oComplaintDialog.open();

            } catch (oError) {
                console.error(
                    "Unable to open complaint form:",
                    oError
                );

                MessageBox.error(
                    "Unable to load the complaint form data. Check the browser console."
                );
            }
        },

        // ==========================================
        // CALCULATE DEFECT PERCENTAGE
        // ==========================================
       onComplaintQuantityChange: function (oEvent) {
    var oFormModel = this.getView().getModel("complaintForm");

    if (!oFormModel) {
        return;
    }

    // Read the latest values directly from the input fields.
    var oDialog = this._oComplaintDialog;
    var aInputs = oDialog ? oDialog.findAggregatedObjects(true, function (oControl) {
        return oControl.isA("sap.m.Input");
    }) : [];

    var nInspected = 0;
    var nRejected = 0;

    aInputs.forEach(function (oInput) {
        var sValue = oInput.getValue();

        if (oInput.getBindingPath("value") === "/inspectedQuantity") {
            nInspected = parseFloat(sValue) || 0;
        } else if (oInput.getBindingPath("value") === "/rejectedQuantity") {
            nRejected = parseFloat(sValue) || 0;
        }
    });

    var nPercentage = nInspected > 0
        ? (nRejected / nInspected) * 100
        : 0;

    oFormModel.setProperty("/defectPercentage", nPercentage.toFixed(2));

    console.log("Inspected:", nInspected);
    console.log("Rejected:", nRejected);
    console.log("Defect Percentage:", nPercentage.toFixed(2));
},
        // ==========================================
        // CLOSE DIALOG
        // ==========================================
        onCloseQualityComplaint: function () {
            if (this._oComplaintDialog) {
                this._oComplaintDialog.close();
            }
        },

        // ==========================================
        // SAVE PLACEHOLDER
        // ==========================================
        onSaveQualityComplaint: async function () {
    var oView = this.getView();
    var oFormModel = oView.getModel("complaintForm");
    var oODataModel = this.getOwnerComponent().getModel();

    if (!oFormModel || !oODataModel) {
        MessageBox.error("Complaint form or OData model is unavailable.");
        return;
    }

    var oDialog = this._oComplaintDialog;
    var aInputs = oDialog.findAggregatedObjects(true, function (oControl) {
        return oControl.isA("sap.m.Input");
    });

    // Read the latest quantity values directly from the inputs.
    aInputs.forEach(function (oInput) {
        var sPath = oInput.getBindingPath("value");
        var sValue = oInput.getValue();

        if (sPath === "/inspectedQuantity") {
            oFormModel.setProperty("/inspectedQuantity", sValue);
        } else if (sPath === "/rejectedQuantity") {
            oFormModel.setProperty("/rejectedQuantity", sValue);
        }
    });

    var oForm = oFormModel.getData();

    var nInspected = Number(oForm.inspectedQuantity);
    var nRejected = Number(oForm.rejectedQuantity);

    // Validate required fields.
    if (
        !oForm.complaintNumber ||
        !oForm.vendor_ID ||
        !oForm.purchaseOrder_ID ||
        !oForm.materialCode ||
        !oForm.complaintDate ||
        !oForm.defectType ||
        !oForm.severity
    ) {
        MessageBox.warning("Please fill in all required fields.");
        return;
    }

    if (!Number.isFinite(nInspected) || nInspected <= 0) {
        MessageBox.warning("Inspected Quantity must be greater than zero.");
        return;
    }

    if (!Number.isFinite(nRejected) || nRejected < 0) {
        MessageBox.warning("Rejected Quantity cannot be negative.");
        return;
    }

    if (nRejected > nInspected) {
        MessageBox.warning(
            "Rejected Quantity cannot exceed Inspected Quantity."
        );
        return;
    }

    var nDefectPercentage = (nRejected / nInspected) * 100;

    var oPayload = {
        complaintNumber: oForm.complaintNumber.trim(),
        vendor_ID: oForm.vendor_ID,
        purchaseOrder_ID: oForm.purchaseOrder_ID,
        materialCode: oForm.materialCode,
        complaintDate: oForm.complaintDate,
        defectType: oForm.defectType,
        severity: oForm.severity,
        inspectedQuantity: String(nInspected),
        rejectedQuantity: String(nRejected),
        defectPercentage: nDefectPercentage.toFixed(2),
        complaintStatus: oForm.complaintStatus || "OPEN",
        rootCause: oForm.rootCause || "",
        correctiveAction: oForm.correctiveAction || ""
    };

    var oBinding;
    var oCreatedContext;

    try {
        console.log("Saving quality complaint:", oPayload);

        oBinding = oODataModel.bindList("/QualityComplaints");

        // Create the complaint through the CAP OData V4 service.
        oCreatedContext = oBinding.create(oPayload);

        await oCreatedContext.created();

        MessageToast.show("Quality complaint saved successfully!");

        this._oComplaintDialog.close();

        // Reload the table and summary cards from the backend.
        await this._loadComplaints();

    } catch (oError) {
        console.error("Failed to save quality complaint:", oError);

        MessageBox.error(
            "Unable to save the quality complaint. Check the browser console for the backend error."
        );

    } finally {
        if (oBinding) {
            oBinding.destroy();
        }
    }
},

        // ==========================================
        // NAVIGATION
        // ==========================================
        onNavBack: function () {
            this.getOwnerComponent()
                .getRouter()
                .navTo("Routehome", {}, true);
        }

    });
});
