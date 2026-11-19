sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/TextArea",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/VBox",
    "sap/m/DatePicker",
    "vendormodulee/model/formatter"
], function (
    Controller,
    History,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast,
    MessageBox,
    Dialog,
    TextArea,
    Button,
    Label,
    Text,
    VBox,
    DatePicker,
    formatter
) {
    "use strict";

    // Namespace of the bound actions in /odata/v4/vendor-risk/
    var SERVICE = "VendorRiskService";

    // Actions are sent immediately, in their own request. The default model
    // uses the update group "vendorBatch", which is only sent on submitBatch.
    var ACTION_GROUP = "$auto";

    // States of the invoice card
    //   NONE    : no invoice for this purchase order (card hidden)
    //   LOADING : invoice is being read
    //   FOUND   : invoice read, details shown
    //   ERROR   : invoice could not be read
    function createInvoiceState() {
        return {
            invoiceState: "NONE",
            errorText: "",
            invoiceId: "",
            invoiceNumber: "",
            invoiceStatus: "",
            invoiceDate: "",
            invoiceAmount: null,
            currency: ""
        };
    }

    // Best available message of an OData error: the text sent by the backend
    function getErrorText(oError, sFallback) {
        var sMessage = oError && oError.error && oError.error.message;

        return sMessage || (oError && oError.message) || sFallback;
    }

    return Controller.extend(
        "vendormodulee.controller.PurchaseOrderObjectPage",
        {

            onInit: function () {

                // View state only: the invoice that belongs to this order
                this.getView().setModel(
                    new JSONModel(createInvoiceState()),
                    "poView"
                );

                this.getOwnerComponent()
                    .getRouter()
                    .getRoute("RoutePurchaseOrderObjectPage")
                    .attachPatternMatched(
                        this._onObjectMatched,
                        this
                    );
            },

            _onObjectMatched: function (oEvent) {

                const sPurchaseOrderId =
                    oEvent.getParameter("arguments").purchaseOrderId;

                // Forget the invoice of the previously shown order
                this.getView().getModel("poView").setData(createInvoiceState());

                // Button and message visibility follow poStatus through
                // expression bindings in the view, so they update by themselves
                // whenever this binding is refreshed after an action.
                this.getView().bindElement({
                    path: "/PurchaseOrders(" + sPurchaseOrderId + ")",
                    parameters: {
                        $expand: "vendor,items"
                    },
                    events: {
                        dataReceived: function (oDataEvent) {

                            if (oDataEvent.getParameter("error")) {
                                MessageBox.error(
                                    "The purchase order could not be loaded. " +
                                    "Go back to My Purchase Orders and try again."
                                );
                            }
                        }
                    }
                });

                // Look for the invoice of this order (a draft exists after
                // the order was accepted). Silent: the card only appears when
                // an invoice exists or the lookup failed.
                this._loadInvoice(sPurchaseOrderId, false);
            },

            // Today as "yyyy-MM-dd" in the browser's time zone
            _getToday: function () {

                const oDate = new Date();

                return oDate.getFullYear() + "-" +
                    String(oDate.getMonth() + 1).padStart(2, "0") + "-" +
                    String(oDate.getDate()).padStart(2, "0");
            },

            // ID of the purchase order that is currently shown
            _getPurchaseOrderId: function () {

                const oContext = this.getView().getBindingContext();

                return oContext ? oContext.getProperty("ID") : null;
            },

            // ==============================
            // INVOICE OF THIS PURCHASE ORDER
            // ==============================
            // Reads Invoices filtered by purchaseOrder_ID. The real invoice ID
            // comes from this query: it is never derived from the order ID.
            // At most one invoice exists per order (the backend allows only
            // one), so the first result is the invoice.

            _loadInvoice: async function (sPurchaseOrderId, bShowLoading) {

                const oViewModel = this.getView().getModel("poView");
                const oODataModel = this.getView().getModel();
                const iToken = (this._iInvoiceToken = (this._iInvoiceToken || 0) + 1);
                let oBinding;

                if (!sPurchaseOrderId) {
                    return;
                }

                if (bShowLoading) {
                    oViewModel.setProperty("/errorText", "");
                    oViewModel.setProperty("/invoiceState", "LOADING");
                }

                try {

                    oBinding = oODataModel.bindList(
                        "/Invoices",
                        null,
                        [],
                        [
                            new Filter(
                                "purchaseOrder_ID",
                                FilterOperator.EQ,
                                sPurchaseOrderId
                            )
                        ],
                        {
                            $select: "ID,invoiceNumber,invoiceDate,invoiceAmount," +
                                "currency,invoiceStatus"
                        }
                    );

                    const aContexts = await oBinding.requestContexts(0, 2);

                    if (iToken !== this._iInvoiceToken) {
                        return; // a newer request replaced this one
                    }

                    if (!aContexts.length) {

                        oViewModel.setData(createInvoiceState());

                        return;
                    }

                    const oInvoice = aContexts[0].getObject();

                    oViewModel.setData({
                        invoiceState: "FOUND",
                        errorText: "",
                        invoiceId: oInvoice.ID,
                        invoiceNumber: oInvoice.invoiceNumber || "",
                        invoiceStatus: oInvoice.invoiceStatus || "",
                        invoiceDate: oInvoice.invoiceDate || "",
                        invoiceAmount: oInvoice.invoiceAmount,
                        currency: oInvoice.currency || ""
                    });

                } catch (oError) {

                    if (iToken === this._iInvoiceToken) {

                        oViewModel.setProperty("/invoiceState", "ERROR");
                        oViewModel.setProperty(
                            "/errorText",
                            "The invoice of this purchase order could not be loaded. " +
                            getErrorText(oError, "")
                        );
                    }

                } finally {

                    if (oBinding) {
                        oBinding.destroy();
                    }
                }
            },

            onRetryInvoiceLoad: function () {

                this._loadInvoice(this._getPurchaseOrderId(), true);
            },

            // View the invoice, whatever its status
            onOpenInvoice: function () {

                const sInvoiceId =
                    this.getView().getModel("poView").getProperty("/invoiceId");

                if (!sInvoiceId) {

                    MessageToast.show("The invoice is not available yet.");

                    return;
                }

                this.getOwnerComponent()
                    .getRouter()
                    .navTo(
                        "RouteInvoiceObjectPage",
                        { invoiceId: encodeURIComponent(sInvoiceId) }
                    );
            },

            // Complete the existing draft: opens the invoice form for the
            // invoice that was found above. Nothing is created here.
            onCompleteInvoice: function () {

                const oViewModel = this.getView().getModel("poView");
                const sInvoiceId = oViewModel.getProperty("/invoiceId");

                if (!sInvoiceId) {

                    MessageToast.show("The invoice is not available yet.");

                    return;
                }

                this.getOwnerComponent()
                    .getRouter()
                    .navTo(
                        "RouteInvoiceEdit",
                        { invoiceId: encodeURIComponent(sInvoiceId) }
                    );
            },

            // Reloads the order and its items (one binding, one request)
            _refreshPurchaseOrder: function () {

                const oBinding = this.getView().getElementBinding();

                if (!oBinding) {
                    return;
                }

                try {

                    oBinding.refresh();

                } catch (oError) {

                    // Pending changes block a binding refresh: fall back to
                    // reloading the model so the page never shows stale data
                    this.getView().getModel().refresh();
                }
            },

            // ==============================
            // UPDATE EXPECTED DELIVERY DATE
            // ==============================
            // The vendor-risk service has no separate action for this, so the
            // expectedDeliveryDate field of the purchase order is changed
            // directly. If the backend refuses the change, its message is shown.

            onUpdateExpectedDeliveryDate: function () {

                const oController = this;

                const oDatePicker = new DatePicker({
                    width: "100%",
                    valueFormat: "yyyy-MM-dd",
                    displayFormat: "dd-MM-yyyy",
                    placeholder: "Select expected delivery date",
                    minDate: new Date()
                });

                const oDialog = new Dialog({
                    title: "Update Expected Delivery Date",
                    contentWidth: "30rem",

                    content: [
                        new VBox({
                            class: "sapUiMediumMargin",
                            items: [

                                new Label({
                                    text: "Expected Delivery Date",
                                    required: true
                                }),

                                oDatePicker
                            ]
                        })
                    ],

                    beginButton: new Button({
                        text: "Update",
                        type: "Emphasized",

                        press: async function (oPressEvent) {

                            const oButton = oPressEvent.getSource();

                            const sDate = oDatePicker.getValue();

                            if (!sDate || !oDatePicker.getDateValue()) {

                                MessageToast.show(
                                    "Please select an expected delivery date"
                                );

                                return;
                            }

                            if (sDate < oController._getToday()) {

                                MessageToast.show(
                                    "Expected delivery date cannot be in the past"
                                );

                                return;
                            }

                            const oContext =
                                oController.getView().getBindingContext();

                            if (!oContext) {

                                MessageToast.show(
                                    "Purchase Order data not available"
                                );

                                return;
                            }

                            const oModel = oContext.getModel();

                            // Prevent a second click while the request runs
                            oButton.setEnabled(false);

                            try {

                                const pChange = oContext.setProperty(
                                    "expectedDeliveryDate",
                                    sDate,
                                    "vendorBatch"
                                );

                                await Promise.all([
                                    oModel.submitBatch("vendorBatch"),
                                    pChange
                                ]);

                                MessageToast.show(
                                    "Expected delivery date updated successfully"
                                );

                                oDialog.close();

                                await oContext.refresh();

                            } catch (oError) {

                                // Drop the rejected change so the page shows the
                                // date that is really stored in the backend
                                oModel.resetChanges("vendorBatch");

                                oButton.setEnabled(true);

                                MessageBox.error(
                                    getErrorText(
                                        oError,
                                        "Failed to update expected delivery date"
                                    )
                                );
                            }
                        }
                    }),

                    endButton: new Button({
                        text: "Cancel",

                        press: function () {
                            oDialog.close();
                        }
                    }),

                    afterClose: function () {
                        oDialog.destroy();
                    }
                });

                oDialog.open();
            },

            // ==============================
            // ACCEPT PURCHASE ORDER
            // ==============================
            // Bound action VendorRiskService.vendorAccept(expectedDeliveryDate).
            // The backend validates the date and the order status, then in one
            // transaction creates ONE draft invoice, sets the order to ACCEPTED
            // and its items to CONFIRMED. The date is not checked here: the
            // backend is the only authority and its message is shown.

            onAcceptPO: function () {

                const oController = this;

                const oCurrentContext = this.getView().getBindingContext();

                const sCurrentDate = oCurrentContext
                    ? oCurrentContext.getProperty("expectedDeliveryDate")
                    : null;

                const oDatePicker = new DatePicker({
                    width: "100%",
                    valueFormat: "yyyy-MM-dd",
                    displayFormat: "dd-MM-yyyy",
                    placeholder: "Select expected delivery date",
                    value: sCurrentDate || ""
                });

                const aDialogItems = [
                    new Label({
                        text: "Are you sure you want to accept this Purchase Order?"
                    }),

                    new Label({
                        text: "Expected Delivery Date",
                        required: true,
                        class: "sapUiSmallMarginTop"
                    }),

                    oDatePicker
                ];

                if (sCurrentDate) {

                    aDialogItems.push(
                        new Text({
                            text: "Delivery date on the purchase order: " +
                                formatter.date(sCurrentDate),
                            class: "sapUiTinyMarginTop"
                        })
                    );
                }

                aDialogItems.push(
                    new Text({
                        text: "The system checks the date you choose. " +
                            "A draft invoice is created when the order is accepted.",
                        wrapping: true,
                        class: "sapUiTinyMarginTop"
                    })
                );

                const oDialog = new Dialog({
                    title: "Confirm Purchase Order Acceptance",
                    contentWidth: "30rem",

                    content: [
                        new VBox({
                            class: "sapUiMediumMargin",
                            items: aDialogItems
                        })
                    ],

                    beginButton: new Button({
                        text: "Confirm",
                        type: "Emphasized",

                        press: async function (oPressEvent) {

                            const oButton = oPressEvent.getSource();

                            const sDate = oDatePicker.getValue();

                            if (!sDate || !oDatePicker.getDateValue()) {

                                MessageToast.show(
                                    "Please select an expected delivery date"
                                );

                                return;
                            }

                            const oContext =
                                oController.getView().getBindingContext();

                            if (!oContext) {

                                MessageToast.show(
                                    "Purchase Order data not available"
                                );

                                return;
                            }

                            const sPurchaseOrderId = oContext.getProperty("ID");

                            // Prevent a second click while the request runs
                            oButton.setEnabled(false);

                            try {

                                const oAction =
                                    oContext
                                        .getModel()
                                        .bindContext(
                                            SERVICE + ".vendorAccept(...)",
                                            oContext
                                        );

                                oAction.setParameter(
                                    "expectedDeliveryDate",
                                    sDate
                                );

                                await oAction.execute(ACTION_GROUP);

                                oDialog.close();

                                MessageToast.show(
                                    "Purchase Order accepted. A draft invoice was created."
                                );

                                // 1. Order status and item statuses: one
                                //    refresh of the order binding (items are
                                //    part of its $expand)
                                oController._refreshPurchaseOrder();

                                // 2. The invoice the backend created
                                await oController._loadInvoice(
                                    sPurchaseOrderId,
                                    true
                                );

                            } catch (oError) {

                                oButton.setEnabled(true);

                                MessageBox.error(
                                    getErrorText(
                                        oError,
                                        "Failed to accept Purchase Order"
                                    )
                                );

                                // The order may have been accepted elsewhere
                                // (for example a repeated attempt): show its
                                // real status and invoice
                                oController._refreshPurchaseOrder();
                                oController._loadInvoice(sPurchaseOrderId, false);
                            }
                        }
                    }),

                    endButton: new Button({
                        text: "Cancel",

                        press: function () {
                            oDialog.close();
                        }
                    }),

                    afterClose: function () {
                        oDialog.destroy();
                    }
                });

                oDialog.open();
            },

            // ==============================
            // REJECT PURCHASE ORDER
            // ==============================

            onRejectPO: function () {

                const oController = this;

                const oReasonInput = new TextArea({
                    width: "100%",
                    rows: 5,
                    maxLength: 500,
                    showExceededText: true,
                    placeholder: "Enter rejection reason..."
                });

                const oDialog = new Dialog({
                    title: "Reject Purchase Order",
                    contentWidth: "30rem",
                    content: [
                        new VBox({
                            class: "sapUiMediumMargin",
                            items: [

                                new Label({
                                    text: "Rejection Reason",
                                    required: true
                                }),

                                oReasonInput

                            ]
                        })
                    ],

                    beginButton: new Button({
                        text: "Reject",
                        type: "Reject",

                        press: async function (oPressEvent) {

                            const oButton = oPressEvent.getSource();

                            const sReason =
                                oReasonInput.getValue().trim();

                            if (!sReason) {

                                MessageToast.show(
                                    "Please enter a rejection reason"
                                );

                                return;
                            }

                            const oContext =
                                oController.getView().getBindingContext();

                            if (!oContext) {

                                MessageToast.show(
                                    "Purchase Order data not available"
                                );

                                return;
                            }

                            // Prevent a second click while the request runs
                            oButton.setEnabled(false);

                            try {

                                const oAction =
                                    oContext
                                        .getModel()
                                        .bindContext(
                                            SERVICE + ".vendorReject(...)",
                                            oContext
                                        );

                                oAction.setParameter(
                                    "reason",
                                    sReason
                                );

                                await oAction.execute(ACTION_GROUP);

                                MessageToast.show(
                                    "Purchase Order rejected successfully"
                                );

                                oDialog.close();

                                oController._refreshPurchaseOrder();

                            } catch (oError) {

                                oButton.setEnabled(true);

                                MessageBox.error(
                                    getErrorText(
                                        oError,
                                        "Failed to reject Purchase Order"
                                    )
                                );
                            }
                        }
                    }),

                    endButton: new Button({
                        text: "Cancel",

                        press: function () {
                            oDialog.close();
                        }
                    }),

                    afterClose: function () {
                        oDialog.destroy();
                    }
                });

                oDialog.open();
            },

            // ==============================
            // NAVIGATION
            // ==============================

            onNavBack: function () {

                const sPreviousHash =
                    History.getInstance().getPreviousHash();

                if (sPreviousHash !== undefined) {

                    window.history.back();

                } else {

                    // Opened directly from a link: no history to go back to
                    this.getOwnerComponent()
                        .getRouter()
                        .navTo("RoutePurchaseOrders", {}, true);
                }
            }

        }
    );
});
