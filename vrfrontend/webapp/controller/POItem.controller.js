sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (
    Controller,
    UIComponent,
    JSONModel,
    MessageToast,
    MessageBox,
    Filter,
    FilterOperator
) {
    "use strict";

    // Batch group used to send header + item changes together
    var BATCH_GROUP = "poItemChanges";
    var ITEM_ROUTE = "POItem";
    var LIST_ROUTE = "PurchaseOrder";

    // Bound actions exposed by VendorRiskService.
    // NOTE: check "send" against your srv/*.cds file and rename if needed.
    var ACTIONS = {
        accept: "VendorRiskService.poAccept",
        reject: "VendorRiskService.poReject",
        send: "VendorRiskService.poSentVendor"
    };

    return Controller.extend("vrfrontend.controller.POItem", {

        onInit: function () {
            var oView = this.getView();

            oView.setModel(new JSONModel(this._getEmptyPO()), "po");

            oView.setModel(new JSONModel({
                editMode: false,
                isNew: false,
                busy: false
            }), "ui");

            // Static dropdown values (keeps the view short)
            oView.setModel(new JSONModel({
                currencies: this._toList(["INR", "USD", "EUR"]),
                paymentTerms: [
                    { key: "IMMEDIATE", text: "Immediate" },
                    { key: "NET15", text: "NET15" },
                    { key: "NET30", text: "NET30" },
                    { key: "NET45", text: "NET45" },
                    { key: "NET60", text: "NET60" },
                    { key: "NET90", text: "NET90" }
                ],
                units: this._toList([
                    "EA", "KG", "G", "L", "M", "CM", "BOX", "BAG", "SET", "PACK"
                ])
            }), "lookups");

            // Materials master data, loaded once and shared by all rows
            var oMaterialsModel = new JSONModel({ items: [] });
            // JSONModel shows only 100 entries by default
            oMaterialsModel.setSizeLimit(1000);
            oView.setModel(oMaterialsModel, "materials");
            this._loadMaterials();

            UIComponent.getRouterFor(this)
                .getRoute(ITEM_ROUTE)
                .attachPatternMatched(this._onPORouteMatched, this);
        },

        formatStatusState: function (sStatus) {
            switch (sStatus) {
                case "PENDING_APPROVAL":
                    return "Warning";
                case "APPROVED":
                    return "Success";
                case "REJECTED":
                case "CANCELLED":
                    return "Error";
                default:
                    return "None";
            }
        },


        _getODataModel: function () {
            return this.getOwnerComponent().getModel();
        },

        _setBusy: function (bBusy) {
            this.getView().getModel("ui").setProperty("/busy", bBusy);
        },

        _toList: function (aValues) {
            return aValues.map(function (sValue) {
                return { key: sValue, text: sValue };
            });
        },

        _getEmptyPO: function () {
            return {
                poId: "",
                poNumber: "",
                vendorId: "",
                vendor_ID: "",
                currency: "INR",
                contractReference: "",
                expectedDeliveryDate: "",
                paymentTerms: "NET30",
                buyerId: "",
                buyer_ID: "",
                remarks: "",
                totalAmount: 0,
                poStatus: "",
                items: []
            };
        },

        _getEmptyItem: function (sCurrency) {
            return {
                ID: null,
                materialId: "",
                materialCode: "",
                description: "",
                materialGroup: "",
                quantity: "",
                unit: "EA",
                oldUnitPrice: "",
                contractPrice: 0,
                currency: sCurrency || "INR",
                totalAmount: 0,
                requestedDeliveryDate: ""
            };
        },

        // =========================================================
        // DATA LOADING
        // =========================================================

        _loadMaterials: async function () {
            var oModel = this._getODataModel();

            if (!oModel) {
                MessageBox.error("OData model is not available.");
                return;
            }

            try {
                // $select = only fetch the fields we use
                var oBinding = oModel.bindList("/Materials", null, [], [], {
                    $select: "ID,materialCode,materialDescription,materialGroup," +
                        "baseUnit,currentUnitPrice,contractPrice,currency,status"
                });

                var aContexts = await oBinding.requestContexts(0, 1000);

                var aMaterials = aContexts
                    .map(function (oContext) {
                        return oContext.getObject();
                    })
                    .filter(function (oMaterial) {
                        return oMaterial.status !== "INACTIVE";
                    });

                this.getView()
                    .getModel("materials")
                    .setProperty("/items", aMaterials);

            } catch (oError) {
                MessageBox.error(
                    "Failed to load Materials: " +
                    (oError.message || "Unknown error")
                );
            }
        },

  _onPORouteMatched: function (oEvent) {
    console.log("NEW POItem controller, route arg =", oEvent.getParameter("arguments").po);
    var sPOPath = oEvent.getParameter("arguments").po;

    if (!sPOPath) {
        MessageBox.error("Purchase Order path not found.");
        return;
    }

    sPOPath = decodeURIComponent(sPOPath);

    // "Create New" navigates here with po = "new" -> open an empty form
    if (sPOPath === "new" || sPOPath === "/new") {
        this._initNewPO();
        return;
    }

    if (sPOPath.charAt(0) !== "/") {
        sPOPath = "/" + sPOPath;
    }

    this._sPOPath = sPOPath;
    this._loadPurchaseOrder(sPOPath);
},

// Prepares the page for creating a new PO (nothing is read from the server)
_initNewPO: function () {
    this._sPOPath = null;
    this._oPOBinding = null;
    this._oPOContext = null;
    this._oItemsBinding = null;
    this._aItemContexts = [];

    this.getView().getModel("po").setData(this._getEmptyPO());

    var oUiModel = this.getView().getModel("ui");
    oUiModel.setProperty("/editMode", true);
    oUiModel.setProperty("/isNew", true);
    oUiModel.setProperty("/busy", false);
},
        _loadPurchaseOrder: async function (sPOPath) {
            if (/(^|\/)new$/i.test(sPOPath || "")) {
        this._initNewPO();
        return;
    }

    var oODataModel = this._getODataModel();

            if (!oODataModel) {
                MessageBox.error("OData model is not available.");
                return;
            }

            this._setBusy(true);

            try {
                var oPOBinding = oODataModel.bindContext(sPOPath);
                var oPO = await oPOBinding.requestObject();

                if (!oPO) {
                    MessageBox.error("Purchase Order not found.");
                    return;
                }

                this._oPOBinding = oPOBinding;
                this._oPOContext = oPOBinding.getBoundContext();

                // Pass the ID we already have (no second header request)
                var aItems = await this._loadPurchaseOrderItems(oPO.ID);

                this.getView().getModel("po").setData({
                    poId: oPO.ID || "",
                    poNumber: oPO.poNumber || "",
                    vendorId: oPO.vendor_ID || "",
                    vendor_ID: oPO.vendor_ID || "",
                    currency: oPO.currency || "INR",
                    contractReference: oPO.contractReference || "",
                    expectedDeliveryDate: oPO.expectedDeliveryDate || "",
                    paymentTerms: oPO.paymentTerms || "NET30",
                    buyerId: oPO.buyer_ID || "",
                    buyer_ID: oPO.buyer_ID || "",
                    remarks: oPO.remarks || "",
                    totalAmount: Number(oPO.totalAmount) || 0,
                    poStatus: oPO.poStatus || "",
                    items: aItems
                });

                var oUiModel = this.getView().getModel("ui");
                oUiModel.setProperty("/editMode", false);
                oUiModel.setProperty("/isNew", false);

            } catch (oError) {
                MessageBox.error(
                    "Failed to load Purchase Order.\n\n" +
                    (oError.message || "Unknown error")
                );
            } finally {
                this._setBusy(false);
            }
        },

        _loadPurchaseOrderItems: async function (sPOId) {
            this._oItemsBinding = null;
            this._aItemContexts = [];

            if (!sPOId) {
                return [];
            }

            try {
                var oItemsBinding = this._getODataModel().bindList(
                    "/PurchaseOrderItems",
                    null,
                    null,
                    [new Filter("purchaseOrder_ID", FilterOperator.EQ, sPOId)]
                );

                var aContexts = await oItemsBinding.requestContexts(0, 100);

                this._oItemsBinding = oItemsBinding;
                this._aItemContexts = aContexts;

                return aContexts.map(function (oContext) {
                    var oItem = oContext.getObject();
                    var fQty = Number(oItem.orderedQuantity) || 0;
                    var fPrice = Number(oItem.oldUnitPrice) || 0;

                    return {
                        ID: oItem.ID || "",
                        oDataPath: oContext.getPath(),
                        materialId: oItem.material_ID || "",
                        materialCode: oItem.materialCode || "",
                        materialGroup: oItem.materialGroup || "",
                        description: oItem.materialDescription || "",
                        quantity: fQty,
                        unit: oItem.unit || "EA",
                        oldUnitPrice: fPrice,
                        contractPrice: Number(oItem.contractPrice) || 0,
                        currency: oItem.currency || "INR",
                        totalAmount: fQty * fPrice,
                        requestedDeliveryDate: oItem.requestedDeliveryDate || ""
                    };
                });

            } catch (oError) {
                MessageBox.error(
                    "Failed to load purchase order items: " +
                    (oError.message || "Unknown error")
                );
                return [];
            }
        },

        onEdit: function () {
            this.getView().getModel("ui").setProperty("/editMode", true);
            MessageToast.show("Edit mode enabled.");
        },

    onCancelEdit: async function () {
    // New PO: nothing saved yet, just go back to the list
    if (this.getView().getModel("ui").getProperty("/isNew")) {
        UIComponent.getRouterFor(this).navTo(LIST_ROUTE);
        return;
    }

    if (!this._sPOPath) {
        MessageBox.error("Purchase Order path not available.");
        return;
    }

    // Throw away anything queued in the batch group
    this._getODataModel().resetChanges(BATCH_GROUP);

    await this._loadPurchaseOrder(this._sPOPath);
    MessageToast.show("Changes discarded.");
},

        // =========================================================
        // ITEMS
        // =========================================================

        onAddItem: function () {
            var oView = this.getView();
            var oPoModel = oView.getModel("po");

            if (!oView.getModel("ui").getProperty("/editMode")) {
                MessageToast.show("Please enable edit mode to add items");
                return;
            }

            // New array so the table refreshes reliably
            var aItems = (oPoModel.getProperty("/items") || []).concat([
                this._getEmptyItem(oPoModel.getProperty("/currency"))
            ]);

            oPoModel.setProperty("/items", aItems);
        },

        onMaterialChange: function (oEvent) {
            var oSelectedItem = oEvent.getParameter("selectedItem");
            var oRowContext = oEvent.getSource().getBindingContext("po");

            // Nothing selected (e.g. free text typed) -> do nothing
            if (!oSelectedItem || !oRowContext) {
                return;
            }

            // The selected list item already knows its material record
            var oMaterial = oSelectedItem.getBindingContext("materials").getObject();
            var oPOModel = this.getView().getModel("po");
            var sPath = oRowContext.getPath();

            oPOModel.setProperty(sPath + "/materialId", oMaterial.ID || "");
            oPOModel.setProperty(sPath + "/materialCode", oMaterial.materialCode || "");
            oPOModel.setProperty(sPath + "/description", oMaterial.materialDescription || "");
            oPOModel.setProperty(sPath + "/materialGroup", oMaterial.materialGroup || "");
            oPOModel.setProperty(sPath + "/unit", oMaterial.baseUnit || "EA");
            oPOModel.setProperty(sPath + "/oldUnitPrice", Number(oMaterial.currentUnitPrice) || 0);
            oPOModel.setProperty(sPath + "/contractPrice", Number(oMaterial.contractPrice) || 0);
            oPOModel.setProperty(sPath + "/currency", oMaterial.currency || "INR");

            this._recalculateRow(sPath);
        },

        onQuantityChange: function (oEvent) {
            this._onRowValueChange(oEvent, "quantity");
        },

        onPriceChange: function (oEvent) {
            this._onRowValueChange(oEvent, "oldUnitPrice");
        },

        _onRowValueChange: function (oEvent, sField) {
            var oContext = oEvent.getSource().getBindingContext("po");

            if (!oContext) {
                return;
            }

            var sPath = oContext.getPath();

            this.getView().getModel("po").setProperty(
                sPath + "/" + sField,
                Number(oEvent.getParameter("value")) || 0
            );

            this._recalculateRow(sPath);
        },

        _recalculateRow: function (sPath) {
            var oModel = this.getView().getModel("po");
            var fQuantity = Number(oModel.getProperty(sPath + "/quantity")) || 0;
            var fPrice = Number(oModel.getProperty(sPath + "/oldUnitPrice")) || 0;

            oModel.setProperty(sPath + "/totalAmount", fQuantity * fPrice);
            this._calculatePOTotal();
        },

        _calculatePOTotal: function () {
            var oModel = this.getView().getModel("po");
            var aItems = oModel.getProperty("/items") || [];

            var fTotal = aItems.reduce(function (fSum, oItem) {
                return fSum + (Number(oItem.totalAmount) || 0);
            }, 0);

            oModel.setProperty("/totalAmount", fTotal);
        },

        // =========================================================
        // SAVE
        // =========================================================

        _validate: function (oPO) {
            // if (!oPO.poNumber) { return "Please enter the PO Number."; }
            if (!oPO.currency) { return "Please select a Currency."; }
            if (!oPO.contractReference) { return "Please enter the Contract Reference."; }
            if (!oPO.expectedDeliveryDate) { return "Please select the Expected Delivery Date."; }
            if (!oPO.paymentTerms) { return "Please select the Payment Terms."; }

            var aItems = oPO.items || [];

            for (var i = 0; i < aItems.length; i++) {
                if (!aItems[i].materialCode) {
                    return "Please select a material for item " + (i + 1) + ".";
                }

                var fQuantity = Number(aItems[i].quantity);

                if (!Number.isFinite(fQuantity) || fQuantity <= 0) {
                    return "Enter a valid quantity for item " + (i + 1) + ".";
                }
            }

            return "";
        },

        onSave: async function () {
            var oODataModel = this._getODataModel();
            var oPO = this.getView().getModel("po").getData();

            if (!oODataModel) {
                MessageBox.error("OData model is not available.");
                return;
            }

            var bIsNew = this.getView().getModel("ui").getProperty("/isNew");

            if (!bIsNew && (!this._oPOContext || !oPO.poId)) {
                MessageBox.error("Purchase Order context is missing.");
                return;
            }

            var sError = this._validate(oPO);

            if (sError) {
                MessageBox.error(sError);
                return;
            }

            // New PO -> deep create instead of PATCH
            if (bIsNew) {
                await this._createPurchaseOrder(oPO);
                return;
            }

            var oPOContext = this._oPOContext;
            var aPending = [];   // promises returned by setProperty / create

            // Queue a header change in the batch group
            var queueHeader = function (sProperty, vValue) {
                aPending.push(oPOContext.setProperty(sProperty, vValue, BATCH_GROUP));
            };

            this._setBusy(true);

            try {
                // 1. Header
                // queueHeader("poNumber", oPO.poNumber);
                queueHeader("currency", oPO.currency);
                queueHeader("contractReference", oPO.contractReference || "");
                queueHeader("expectedDeliveryDate", oPO.expectedDeliveryDate || null);
                queueHeader("paymentTerms", oPO.paymentTerms);
                queueHeader("totalAmount", Number(oPO.totalAmount) || 0);

                if (oPO.buyer_ID) {
                    queueHeader("buyer_ID", oPO.buyer_ID);
                }

                if (oPO.vendor_ID) {
                    queueHeader("vendor_ID", oPO.vendor_ID);
                }

                // 2. Items
                var oCreateBinding = oODataModel.bindList(
                    "/PurchaseOrderItems",
                    undefined,
                    undefined,
                    undefined,
                    { $$updateGroupId: BATCH_GROUP }
                );

                // Look existing contexts up by ID once, not once per row
                var mExisting = new Map(
                    (this._aItemContexts || []).map(function (oContext) {
                        return [oContext.getProperty("ID"), oContext];
                    })
                );

                var aCreated = [];

                (oPO.items || []).forEach(function (oItem) {
                    var oPayload = {
                        material_ID: oItem.materialId || null,
                        materialCode: oItem.materialCode,
                        materialDescription: oItem.description || "",
                        materialGroup: oItem.materialGroup || "",
                        orderedQuantity: Number(oItem.quantity),
                        unit: oItem.unit || "EA",
                        oldUnitPrice: Number(oItem.oldUnitPrice) || 0,
                        contractPrice: Number(oItem.contractPrice) || 0,
                        currency: oItem.currency || oPO.currency || "INR",
                        requestedDeliveryDate: oItem.requestedDeliveryDate || null
                    };

                    if (oItem.ID) {
                        var oItemContext = mExisting.get(oItem.ID);

                        if (!oItemContext) {
                            throw new Error("Existing item context not found: " + oItem.ID);
                        }

                        Object.keys(oPayload).forEach(function (sProperty) {
                            aPending.push(
                                oItemContext.setProperty(sProperty, oPayload[sProperty], BATCH_GROUP)
                            );
                        });
                    } else {
                        oPayload.purchaseOrder_ID = oPO.poId;
                        aCreated.push(oCreateBinding.create(oPayload));
                    }
                });

                // 3. Send everything in ONE $batch
                oODataModel.submitBatch(BATCH_GROUP);

                // 4. Wait for the server answer (errors are thrown here)
                await Promise.all(aPending.concat(aCreated.map(function (oContext) {
                    return oContext.created();
                })));

                // 5. Reload fresh data and leave edit mode
                await this._loadPurchaseOrder(this._sPOPath);

                MessageToast.show("Purchase Order and items saved successfully.");

            } catch (oError) {
                // Remove half-sent changes so the next save starts clean
                oODataModel.resetChanges(BATCH_GROUP);

                MessageBox.error(
                    "Failed to save Purchase Order and items.\n\n" +
                    (oError.message || "Check the Network tab for the $batch response.")
                );
            } finally {
                this._setBusy(false);
            }
        },
        // Deep create: header + items go to the server in one request
_createPurchaseOrder: async function (oPO) {
    var oODataModel = this._getODataModel();

    this._setBusy(true);

    try {
        var aItems = (oPO.items || []).map(function (oItem) {
            return {
                material_ID: oItem.materialId || null,
                materialCode: oItem.materialCode,
                materialDescription: oItem.description || "",
                materialGroup: oItem.materialGroup || "",
                orderedQuantity: Number(oItem.quantity),
                unit: oItem.unit || "EA",
                oldUnitPrice: Number(oItem.oldUnitPrice) || 0,
                contractPrice: Number(oItem.contractPrice) || 0,
                currency: oItem.currency || oPO.currency || "INR",
                requestedDeliveryDate: oItem.requestedDeliveryDate || null
            };
        });

        var oPayload = {
            // poNumber: oPO.poNumber,
            currency: oPO.currency,
            contractReference: oPO.contractReference || "",
            expectedDeliveryDate: oPO.expectedDeliveryDate || null,
            paymentTerms: oPO.paymentTerms,
            // remarks: oPO.remarks || "",
            totalAmount: Number(oPO.totalAmount) || 0,
            items: aItems   // <-- must match the composition name in your db/*.cds
        };

        if (oPO.vendor_ID) { oPayload.vendor_ID = oPO.vendor_ID; }
        if (oPO.buyer_ID) { oPayload.buyer_ID = oPO.buyer_ID; }

        var oListBinding = oODataModel.bindList("/PurchaseOrders");
        var oNewContext = oListBinding.create(oPayload);

        await oNewContext.created();

        MessageToast.show("Purchase Order created successfully.");
        UIComponent.getRouterFor(this).navTo(LIST_ROUTE);

    } catch (oError) {
        MessageBox.error(
            "Failed to create Purchase Order.\n\n" +
            (oError.message || "Check the Network tab for the response.")
        );
    } finally {
        this._setBusy(false);
    }
},

        onAcceptPO: function () {
            this._runAction(ACTIONS.accept, "Purchase Order accepted successfully.");
        },

        onRejectPO: function () {
            MessageBox.confirm("Do you really want to cancel this Purchase Order?", {
                title: "Cancel Purchase Order",
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        this._runAction(ACTIONS.reject, "Purchase Order rejected successfully.");
                    }
                }.bind(this)
            });
        },

        onSentPO: function () {
            this._runAction(ACTIONS.send, "Purchase Order marked as sent to vendor.");
        },

        // One place that calls a bound action and reloads the page
        _runAction: async function (sAction, sSuccessText) {
            var sPOPath = this._sPOPath;

            if (!sPOPath || !sPOPath.startsWith("/PurchaseOrders(")) {
                MessageBox.error("Invalid Purchase Order path.");
                return;
            }

            this._setBusy(true);

            try {
                await this._getODataModel()
                    .bindContext(sPOPath + "/" + sAction + "(...)")
                    .execute();

                MessageToast.show(sSuccessText);
                await this._loadPurchaseOrder(sPOPath);

            } catch (oError) {
                MessageBox.error(oError.message || "The action failed.");
            } finally {
                this._setBusy(false);
            }
        }

    });
});
