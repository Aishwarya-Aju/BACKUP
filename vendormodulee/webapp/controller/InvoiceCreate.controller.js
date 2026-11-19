sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/routing/History",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "vendormodulee/model/formatter"
], function (
    Controller,
    History,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast,
    MessageBox,
    formatter
) {
    "use strict";

    var SERVICE = "VendorRiskService";
    var ACTION_GROUP = "$auto";

    var STATUS_DRAFT = "DRAFT";
    var STATUS_SUBMITTED = "SUBMITTED";

    var INVOICE_SELECT =
        "ID,invoiceNumber,invoiceDate,deliveryDate," +
        "expectedDeliveryDate,currency,invoiceStatus,purchaseOrder_ID";

    var UUID_PATTERN =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

    var QUANTITY_PATTERN = /^\d{1,12}(\.\d{1,3})?$/;

    var PRICE_PATTERN = /^\d{1,12}(\.\d{1,3})?$/;

    function toNumber(vValue) {
        if (
            vValue === null ||
            vValue === undefined ||
            String(vValue).trim() === ""
        ) {
            return null;
        }

        var fValue = Number(vValue);

        return Number.isFinite(fValue) ? fValue : null;
    }

    function getErrorText(oError, sFallback) {
        var oBackend = oError && oError.error;
        var sMessage =
            (oBackend && oBackend.message) ||
            (oError && oError.message) ||
            "";

        var aDetails =
            oBackend && Array.isArray(oBackend.details)
                ? oBackend.details
                : [];

        aDetails.forEach(function (oDetail) {
            if (
                oDetail &&
                oDetail.message &&
                sMessage.indexOf(oDetail.message) < 0
            ) {
                sMessage += "\n" + oDetail.message;
            }
        });

        return sMessage || sFallback;
    }

    return Controller.extend(
        "vendormodulee.controller.InvoiceCreate",
        {
            // =========================================
            // INITIALIZATION
            // =========================================

            onInit: function () {
                this.getView().setModel(
                    new JSONModel(this._createState()),
                    "inv"
                );

                var oRouter = this.getOwnerComponent().getRouter();

                oRouter.getRoute("RouteInvoiceEdit")
                    .attachPatternMatched(
                        this._onEditRouteMatched,
                        this
                    );

                oRouter.getRoute("RouteInvoiceCreateForPO")
                    .attachPatternMatched(
                        this._onForPurchaseOrderRouteMatched,
                        this
                    );

                oRouter.getRoute("RouteInvoiceCreate")
                    .attachPatternMatched(
                        this._onCreateRouteMatched,
                        this
                    );
            },

            onExit: function () {
                this._destroyInvoiceBinding();
            },

            _createState: function () {
                return {
                    busy: false,
                    submitting: false,
                    ready: false,

                    errorText: "",
                    linesErrorText: "",

                    invoiceId: "",
                    invoiceStatus: "",
                    isDraft: false,

                    pageTitle: "Invoice",
                    submitText: "Save Invoice",

                    invoiceNumber: "",
                    invoiceNumberState: "None",
                    invoiceNumberStateText: "",

                    invoiceDate: this._getToday(),
                    invoiceDateState: "None",
                    invoiceDateStateText: "",

                    deliveryDate: "",
                    deliveryDateState: "None",
                    deliveryDateStateText: "",

                    purchaseOrderId: "",
                    poNumber: "",
                    vendorDisplay: "",
                    currency: "",

                    poItems: [],
                    lines: [],
                    estimatedTotal: 0
                };
            },

            _getModel: function () {
                return this.getView().getModel("inv");
            },

            _getODataModel: function () {
                return this.getView().getModel();
            },

            _getToday: function () {
                var oDate = new Date();

                return oDate.getFullYear() + "-" +
                    String(oDate.getMonth() + 1).padStart(2, "0") + "-" +
                    String(oDate.getDate()).padStart(2, "0");
            },

            _newLine: function () {
                return {
                    purchaseOrderItem_ID: "",

                    materialCode: "",
                    materialDescription: "",

                    orderedQuantity: null,
                    unit: "",

                    // Reference price from the purchase order
                    unitPrice: null,

                    // Price entered by the vendor
                    vendorUnitPrice: "",

                    currency: "",
                    quantity: "",
                    lineTotal: null,

                    itemState: "None",
                    itemStateText: "",

                    qtyState: "None",
                    qtyStateText: "",

                    priceState: "None",
                    priceStateText: ""
                };
            },

            _lineForItem: function (
                oPoItem,
                sQuantity,
                vVendorUnitPrice
            ) {
                var oLine = this._newLine();

                oLine.purchaseOrderItem_ID = oPoItem.ID;
                oLine.materialCode = oPoItem.materialCode;
                oLine.materialDescription = oPoItem.materialDescription;
                oLine.orderedQuantity = oPoItem.orderedQuantity;
                oLine.unit = oPoItem.unit;

                // Purchase order reference price
                oLine.unitPrice = oPoItem.unitPrice;

                // Saved vendor-entered price from the invoice item
                oLine.vendorUnitPrice =
                    vVendorUnitPrice === null ||
                    vVendorUnitPrice === undefined
                        ? ""
                        : String(vVendorUnitPrice);

                oLine.currency = oPoItem.currency;
                oLine.quantity = sQuantity || "";

                return oLine;
            },

            // =========================================
            // ROUTING
            // =========================================

            _onCreateRouteMatched: function () {
                MessageToast.show(
                    "Invoices are created automatically when you accept a purchase order. Open the draft from the invoice list."
                );

                this.getOwnerComponent().getRouter().navTo(
                    "RouteInvoices",
                    {},
                    true
                );
            },

            _onForPurchaseOrderRouteMatched: function (oEvent) {
                var sPurchaseOrderId =
                    oEvent.getParameter("arguments").purchaseOrderId;

                this._resetForm();

                if (!UUID_PATTERN.test(sPurchaseOrderId || "")) {
                    this._getModel().setProperty(
                        "/errorText",
                        "The purchase order in the link is not valid. Open the invoice from the purchase order or invoice list."
                    );
                    return;
                }

                this._openInvoiceOfPurchaseOrder(sPurchaseOrderId);
            },

            _onEditRouteMatched: function (oEvent) {
                var sInvoiceId =
                    oEvent.getParameter("arguments").invoiceId;

                this._resetForm();

                if (!UUID_PATTERN.test(sInvoiceId || "")) {
                    this._getModel().setProperty(
                        "/errorText",
                        "The invoice in the link is not valid. Open it from the invoice list."
                    );
                    return;
                }

                this._loadInvoice(sInvoiceId);
            },

            _resetForm: function () {
                this._iLoadToken = (this._iLoadToken || 0) + 1;

                this._destroyInvoiceBinding();

                this._getModel().setData(this._createState());
            },

            _destroyInvoiceBinding: function () {
                if (this._oInvoiceBinding) {
                    this._oInvoiceBinding.destroy();
                }

                this._oInvoiceBinding = null;
                this._oInvoiceContext = null;
            },

            _openInvoiceOfPurchaseOrder: async function (
                sPurchaseOrderId
            ) {
                var oViewModel = this._getModel();
                var iToken = this._iLoadToken;
                var oBinding;

                oViewModel.setProperty("/busy", true);

                try {
                    oBinding = this._getODataModel().bindList(
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
                            $select: "ID"
                        }
                    );

                    var aContexts = await oBinding.requestContexts(0, 1);

                    if (iToken !== this._iLoadToken) {
                        return;
                    }

                    if (!aContexts.length) {
                        oViewModel.setProperty(
                            "/errorText",
                            "This purchase order has no invoice yet. A draft invoice should be created when the purchase order is accepted."
                        );
                        return;
                    }

                    var sInvoiceId = aContexts[0].getProperty("ID");

                    this.getOwnerComponent().getRouter().navTo(
                        "RouteInvoiceEdit",
                        {
                            invoiceId: encodeURIComponent(sInvoiceId)
                        },
                        true
                    );
                } catch (oError) {
                    if (iToken === this._iLoadToken) {
                        oViewModel.setProperty(
                            "/errorText",
                            "The invoice could not be loaded. " +
                            getErrorText(oError, "")
                        );
                    }
                } finally {
                    if (oBinding) {
                        oBinding.destroy();
                    }

                    if (iToken === this._iLoadToken) {
                        oViewModel.setProperty("/busy", false);
                    }
                }
            },

            // =========================================
            // LOAD INVOICE
            // =========================================

            _loadInvoice: async function (sInvoiceId) {
                var oViewModel = this._getModel();
                var iToken = this._iLoadToken;

                oViewModel.setProperty("/busy", true);

                try {
                    this._oInvoiceBinding =
                        this._getODataModel().bindList(
                            "/Invoices",
                            null,
                            [],
                            [
                                new Filter(
                                    "ID",
                                    FilterOperator.EQ,
                                    sInvoiceId
                                )
                            ],
                            {
                                $select: INVOICE_SELECT
                            }
                        );

                    var aContexts =
                        await this._oInvoiceBinding.requestContexts(0, 1);

                    if (iToken !== this._iLoadToken) {
                        return;
                    }

                    if (!aContexts.length) {
                        throw new Error("The invoice was not found.");
                    }

                    var oContext = aContexts[0];
                    var oInvoice = oContext.getObject();
                    var sStatus = oInvoice.invoiceStatus || "";

                    if (
                        sStatus !== STATUS_DRAFT &&
                        sStatus !== STATUS_SUBMITTED
                    ) {
                        MessageToast.show(
                            "This invoice can no longer be edited."
                        );

                        this.getOwnerComponent().getRouter().navTo(
                            "RouteInvoiceObjectPage",
                            {
                                invoiceId: encodeURIComponent(sInvoiceId)
                            },
                            true
                        );
                        return;
                    }

                    this._oInvoiceContext = oContext;

                    var bDraft = sStatus === STATUS_DRAFT;

                    oViewModel.setProperty("/invoiceId", oInvoice.ID);
                    oViewModel.setProperty("/invoiceStatus", sStatus);
                    oViewModel.setProperty("/isDraft", bDraft);

                    oViewModel.setProperty(
                        "/pageTitle",
                        bDraft ? "Complete Draft Invoice" : "Edit Invoice"
                    );

                    oViewModel.setProperty(
                        "/submitText",
                        bDraft ? "Submit Invoice" : "Save Changes"
                    );

                    oViewModel.setProperty(
                        "/purchaseOrderId",
                        oInvoice.purchaseOrder_ID || ""
                    );

                    oViewModel.setProperty(
                        "/currency",
                        oInvoice.currency || ""
                    );

                    oViewModel.setProperty(
                        "/invoiceNumber",
                        oInvoice.invoiceNumber || ""
                    );

                    oViewModel.setProperty(
                        "/invoiceDate",
                        oInvoice.invoiceDate || this._getToday()
                    );

                    oViewModel.setProperty(
                        "/deliveryDate",
                        oInvoice.deliveryDate ||
                            oInvoice.expectedDeliveryDate ||
                            ""
                    );

                    if (!oInvoice.purchaseOrder_ID) {
                        throw new Error(
                            "The invoice has no purchase order."
                        );
                    }

                    await this._loadPurchaseOrder(
                        oInvoice.purchaseOrder_ID,
                        sInvoiceId,
                        iToken
                    );
                } catch (oError) {
                    if (iToken === this._iLoadToken) {
                        oViewModel.setProperty(
                            "/errorText",
                            "The invoice could not be loaded. " +
                            getErrorText(oError, "")
                        );
                    }
                } finally {
                    if (iToken === this._iLoadToken) {
                        oViewModel.setProperty("/busy", false);
                    }
                }
            },

            // =========================================
            // LOAD PURCHASE ORDER AND ITEMS
            // =========================================

            _loadPurchaseOrder: async function (
                sPurchaseOrderId,
                sInvoiceId,
                iToken
            ) {
                var oViewModel = this._getModel();
                var oODataModel = this._getODataModel();
                var oContextBinding;

                try {
                    oContextBinding = oODataModel.bindContext(
                        "/PurchaseOrders(" + sPurchaseOrderId + ")",
                        null,
                        {
                            $expand:
                                "vendor($select=vendorName,vendorCode)," +
                                "items($expand=material)"
                        }
                    );

                    var oPO = await oContextBinding.requestObject();

                    if (iToken !== this._iLoadToken) {
                        return;
                    }

                    if (!oPO) {
                        throw new Error("Purchase order not found.");
                    }

                    var aItems = (oPO.items || []).map(function (oItem) {
                        var fPrice = toNumber(oItem.newUnitPrice);

                        if (fPrice === null) {
                            fPrice = toNumber(oItem.contractPrice);
                        }

                        return {
                            ID: oItem.ID,

                            materialCode:
                                oItem.materialCode ||
                                (oItem.material &&
                                    oItem.material.materialCode) ||
                                "",

                            materialDescription:
                                oItem.materialDescription ||
                                (oItem.material &&
                                    oItem.material.materialDescription) ||
                                "",

                            label:
                                (oItem.materialCode ||
                                    (oItem.material &&
                                        oItem.material.materialCode) ||
                                    "Material") +
                                " - " +
                                (oItem.materialDescription ||
                                    (oItem.material &&
                                        oItem.material.materialDescription) ||
                                    ""),

                            orderedQuantity:
                                toNumber(oItem.orderedQuantity) || 0,

                            invoicedQuantity: 0,
                            remainingQuantity:
                                toNumber(oItem.orderedQuantity) || 0,

                            available: true,
                            unit: oItem.unit,
                            unitPrice: fPrice,

                            materialRate: toNumber(
                                oItem.material &&
                                oItem.material.currentUnitPrice
                            ),

                            currency: oItem.currency || oPO.currency
                        };
                    });

                    var oInvoiced = await this._loadInvoiceItems(
                        aItems,
                        sInvoiceId
                    );

                    if (iToken !== this._iLoadToken) {
                        return;
                    }

                    aItems.forEach(function (oItem) {
                        oItem.invoicedQuantity =
                            oInvoiced.elsewhere[oItem.ID] || 0;

                        oItem.remainingQuantity = Math.max(
                            0,
                            Number(
                                (
                                    oItem.orderedQuantity -
                                    oItem.invoicedQuantity
                                ).toFixed(3)
                            )
                        );

                        oItem.available =
                            oItem.remainingQuantity > 0;
                    });

                    var oVendor = oPO.vendor || {};

                    oViewModel.setProperty(
                        "/poNumber",
                        oPO.poNumber || ""
                    );

                    oViewModel.setProperty(
                        "/vendorDisplay",
                        oVendor.vendorName
                            ? oVendor.vendorName +
                                (
                                    oVendor.vendorCode
                                        ? " (" + oVendor.vendorCode + ")"
                                        : ""
                                )
                            : ""
                    );

                    if (!oViewModel.getProperty("/currency")) {
                        oViewModel.setProperty(
                            "/currency",
                            oPO.currency || ""
                        );
                    }

                    oViewModel.setProperty("/poItems", aItems);

                    if (!aItems.length) {
                        oViewModel.setProperty(
                            "/errorText",
                            "This purchase order has no items to invoice."
                        );
                        return;
                    }

                    var aLines = [];

                    oInvoiced.own.forEach(function (oOwn) {
                        var oPoItem = aItems.find(function (oItem) {
                            return oItem.ID ===
                                oOwn.purchaseOrderItem_ID;
                        });

                        if (oPoItem) {
                            aLines.push(
                                this._lineForItem(
                                    oPoItem,
                                    String(oOwn.quantity || ""),
                                    oOwn.unitPrice
                                )
                            );
                        }
                    }, this);

                    if (!aLines.length) {
                        aLines.push(this._newLine());
                    }

                    oViewModel.setProperty("/lines", aLines);

                    this._updateEstimate();

                    oViewModel.setProperty("/ready", true);
                } finally {
                    if (oContextBinding) {
                        oContextBinding.destroy();
                    }
                }
            },

            // =========================================
            // LOAD EXISTING INVOICE ITEM LINES
            // =========================================

            _loadInvoiceItems: async function (
                aItems,
                sInvoiceId
            ) {
                var oResult = {
                    own: [],
                    elsewhere: {}
                };

                var oBinding;

                if (!aItems.length) {
                    return oResult;
                }

                try {
                    oBinding = this._getODataModel().bindList(
                        "/InvoiceItems",
                        null,
                        null,
                        new Filter({
                            filters: aItems.map(function (oItem) {
                                return new Filter(
                                    "purchaseOrderItem_ID",
                                    FilterOperator.EQ,
                                    oItem.ID
                                );
                            }),
                            and: false
                        }),
                        {
                            $select:
                                "purchaseOrderItem_ID,quantity,unitPrice,invoice_ID"
                        }
                    );

                    var aContexts =
                        await oBinding.requestContexts(0, 5000);

                    aContexts.forEach(function (oContext) {
                        var sItemId =
                            oContext.getProperty("purchaseOrderItem_ID");

                        var fQuantity =
                            toNumber(oContext.getProperty("quantity")) || 0;

                        var fUnitPrice =
                            toNumber(oContext.getProperty("unitPrice"));

                        if (
                            oContext.getProperty("invoice_ID") ===
                            sInvoiceId
                        ) {
                            oResult.own.push({
                                purchaseOrderItem_ID: sItemId,
                                quantity: fQuantity,
                                unitPrice: fUnitPrice
                            });
                        } else {
                            oResult.elsewhere[sItemId] =
                                (oResult.elsewhere[sItemId] || 0) +
                                fQuantity;
                        }
                    });
                } catch (oError) {
                    // Do not silently assume there are no other invoices.
                    // Display a warning so the user knows the quantity
                    // preview could not be loaded.
                    this._getModel().setProperty(
                        "/linesErrorText",
                        "Previously invoiced quantities could not be loaded. The backend will validate the final quantities."
                    );
                } finally {
                    if (oBinding) {
                        oBinding.destroy();
                    }
                }

                return oResult;
            },

            // =========================================
            // FORM EVENTS
            // =========================================

            onInvoiceNumberChange: function () {
                var oModel = this._getModel();

                oModel.setProperty("/invoiceNumberState", "None");
                oModel.setProperty("/invoiceNumberStateText", "");
            },

            onInvoiceDateChange: function () {
                var oModel = this._getModel();

                oModel.setProperty("/invoiceDateState", "None");
                oModel.setProperty("/invoiceDateStateText", "");

                oModel.setProperty("/deliveryDateState", "None");
                oModel.setProperty("/deliveryDateStateText", "");
            },

            onDeliveryDateChange: function () {
                var oModel = this._getModel();

                oModel.setProperty("/deliveryDateState", "None");
                oModel.setProperty("/deliveryDateStateText", "");
            },

            onAddLine: function () {
                var oModel = this._getModel();
                var aLines =
                    (oModel.getProperty("/lines") || []).slice();

                aLines.push(this._newLine());

                oModel.setProperty("/lines", aLines);
                oModel.setProperty("/linesErrorText", "");
            },

            onRemoveLine: function (oEvent) {
                var oModel = this._getModel();
                var iIndex = this._getLineIndex(oEvent.getSource());

                var aLines =
                    (oModel.getProperty("/lines") || []).slice();

                if (iIndex < 0) {
                    return;
                }

                aLines.splice(iIndex, 1);

                oModel.setProperty("/lines", aLines);

                this._updateEstimate();
            },

            onItemChange: function (oEvent) {
                var oModel = this._getModel();
                var iIndex = this._getLineIndex(oEvent.getSource());

                var oSelected = oEvent.getParameter("selectedItem");
                var sKey = oSelected ? oSelected.getKey() : "";

                if (iIndex < 0) {
                    return;
                }

                var oPoItem =
                    (oModel.getProperty("/poItems") || []).find(
                        function (oItem) {
                            return oItem.ID === sKey;
                        }
                    );

                var sPath = "/lines/" + iIndex;

                oModel.setProperty(
                    sPath + "/purchaseOrderItem_ID",
                    oPoItem ? oPoItem.ID : ""
                );

                oModel.setProperty(
                    sPath + "/materialCode",
                    oPoItem ? oPoItem.materialCode : ""
                );

                oModel.setProperty(
                    sPath + "/materialDescription",
                    oPoItem ? oPoItem.materialDescription : ""
                );

                oModel.setProperty(
                    sPath + "/orderedQuantity",
                    oPoItem ? oPoItem.orderedQuantity : null
                );

                oModel.setProperty(
                    sPath + "/unit",
                    oPoItem ? oPoItem.unit : ""
                );

                // Reference PO price
                oModel.setProperty(
                    sPath + "/unitPrice",
                    oPoItem ? oPoItem.unitPrice : null
                );

                // A newly selected line needs its own vendor-entered price
                oModel.setProperty(
                    sPath + "/vendorUnitPrice",
                    ""
                );

                oModel.setProperty(
                    sPath + "/currency",
                    oPoItem ? oPoItem.currency : ""
                );

                oModel.setProperty(sPath + "/itemState", "None");
                oModel.setProperty(sPath + "/itemStateText", "");
                oModel.setProperty(sPath + "/qtyState", "None");
                oModel.setProperty(sPath + "/qtyStateText", "");
                oModel.setProperty(sPath + "/priceState", "None");
                oModel.setProperty(sPath + "/priceStateText", "");

                this._updateEstimate();
            },

            onQuantityChange: function (oEvent) {
                var iIndex = this._getLineIndex(oEvent.getSource());

                if (iIndex >= 0) {
                    var oModel = this._getModel();
                    var sPath = "/lines/" + iIndex;

                    oModel.setProperty(sPath + "/qtyState", "None");
                    oModel.setProperty(sPath + "/qtyStateText", "");
                }

                this._updateEstimate();
            },

            onVendorUnitPriceChange: function (oEvent) {
                var iIndex = this._getLineIndex(oEvent.getSource());

                if (iIndex >= 0) {
                    var oModel = this._getModel();
                    var sPath = "/lines/" + iIndex;

                    oModel.setProperty(sPath + "/priceState", "None");
                    oModel.setProperty(
                        sPath + "/priceStateText",
                        ""
                    );
                }

                this._updateEstimate();
            },

            _getLineIndex: function (oControl) {
                var oContext =
                    oControl.getBindingContext("inv");

                var aMatch =
                    oContext &&
                    /^\/lines\/(\d+)$/.exec(oContext.getPath());

                return aMatch ? Number(aMatch[1]) : -1;
            },

            // =========================================
            // CALCULATE LINE TOTALS AND INVOICE TOTAL
            // =========================================

            _updateEstimate: function () {
                var oModel = this._getModel();
                var aLines = oModel.getProperty("/lines") || [];
                var fTotal = 0;

                aLines.forEach(function (oLine, iIndex) {
                    var fQuantity = toNumber(oLine.quantity);
                    var fVendorPrice =
                        toNumber(oLine.vendorUnitPrice);

                    var fLine = null;

                    if (
                        fQuantity !== null &&
                        fQuantity > 0 &&
                        fVendorPrice !== null &&
                        fVendorPrice > 0
                    ) {
                        fLine = Number(
                            (fQuantity * fVendorPrice).toFixed(2)
                        );

                        fTotal += fLine;
                    }

                    oModel.setProperty(
                        "/lines/" + iIndex + "/lineTotal",
                        fLine
                    );
                });

                oModel.setProperty(
                    "/estimatedTotal",
                    Number(fTotal.toFixed(2))
                );
            },

            // =========================================
            // VALIDATION
            // =========================================

            _validate: function () {
                var oModel = this._getModel();
                var bValid = true;

                oModel.setProperty("/linesErrorText", "");

                // Invoice number
                // var sNumber =
                //     (oModel.getProperty("/invoiceNumber") || "").trim();

                // Invoice number is generated automatically by the backend.
// No invoice-number validation is required in the frontend.

              
                
           

                // Invoice date
                var sDate = oModel.getProperty("/invoiceDate");
                var oDatePicker = this.byId("invoiceDatePicker");

                if (
                    !sDate ||
                    !oDatePicker ||
                    !oDatePicker.getDateValue()
                ) {
                    oModel.setProperty(
                        "/invoiceDateState",
                        "Error"
                    );

                    oModel.setProperty(
                        "/invoiceDateStateText",
                        "Select a valid invoice date."
                    );

                    bValid = false;
                } else {
                    oModel.setProperty(
                        "/invoiceDateState",
                        "None"
                    );

                    oModel.setProperty(
                        "/invoiceDateStateText",
                        ""
                    );
                }

                // Delivery date
                var sDeliveryDate =
                    oModel.getProperty("/deliveryDate");

                var oDeliveryPicker =
                    this.byId("deliveryDatePicker");

                if (
                    !sDeliveryDate ||
                    !oDeliveryPicker ||
                    !oDeliveryPicker.getDateValue()
                ) {
                    oModel.setProperty(
                        "/deliveryDateState",
                        "Error"
                    );

                    oModel.setProperty(
                        "/deliveryDateStateText",
                        "Select a valid delivery date."
                    );

                    bValid = false;
                } 
                 else {
                    oModel.setProperty(
                        "/deliveryDateState",
                        "None"
                    );

                    oModel.setProperty(
                        "/deliveryDateStateText",
                        ""
                    );
                }

                // Invoice lines
                var aLines = oModel.getProperty("/lines") || [];
                var aPoItems = oModel.getProperty("/poItems") || [];
                var mSeen = {};

                if (!aLines.length) {
                    oModel.setProperty(
                        "/linesErrorText",
                        "Add at least one invoice item."
                    );

                    return false;
                }

                aLines.forEach(function (oLine, iIndex) {
                    var sPath = "/lines/" + iIndex;

                    var oPoItem = aPoItems.find(function (oItem) {
                        return oItem.ID ===
                            oLine.purchaseOrderItem_ID;
                    });

                    oModel.setProperty(sPath + "/itemState", "None");
                    oModel.setProperty(
                        sPath + "/itemStateText",
                        ""
                    );

                    oModel.setProperty(sPath + "/qtyState", "None");
                    oModel.setProperty(
                        sPath + "/qtyStateText",
                        ""
                    );

                    oModel.setProperty(sPath + "/priceState", "None");
                    oModel.setProperty(
                        sPath + "/priceStateText",
                        ""
                    );

                    if (!oPoItem) {
                        oModel.setProperty(
                            sPath + "/itemState",
                            "Error"
                        );

                        oModel.setProperty(
                            sPath + "/itemStateText",
                            "Select a purchase order item."
                        );

                        bValid = false;
                        return;
                    }

                    if (mSeen[oPoItem.ID]) {
                        oModel.setProperty(
                            sPath + "/itemState",
                            "Error"
                        );

                        oModel.setProperty(
                            sPath + "/itemStateText",
                            "This item is already on another line. Use one line per item."
                        );

                        bValid = false;
                        return;
                    }

                    mSeen[oPoItem.ID] = true;

                    // Quantity validation
                    var sQuantity = String(
                        oLine.quantity === null ||
                        oLine.quantity === undefined
                            ? ""
                            : oLine.quantity
                    ).trim();

                    var fQuantity = toNumber(sQuantity);

                    if (
                        !sQuantity ||
                        fQuantity === null ||
                        fQuantity <= 0
                    ) {
                        oModel.setProperty(
                            sPath + "/qtyState",
                            "Error"
                        );

                        oModel.setProperty(
                            sPath + "/qtyStateText",
                            "Enter a quantity greater than zero."
                        );

                        bValid = false;
                    } else if (!QUANTITY_PATTERN.test(sQuantity)) {
                        oModel.setProperty(
                            sPath + "/qtyState",
                            "Error"
                        );

                        oModel.setProperty(
                            sPath + "/qtyStateText",
                            "Use a quantity with at most 3 decimal places."
                        );

                        bValid = false;
                    } else if (
                        fQuantity > oPoItem.remainingQuantity
                    ) {
                        oModel.setProperty(
                            sPath + "/qtyState",
                            "Error"
                        );

                        oModel.setProperty(
                            sPath + "/qtyStateText",
                            "Quantity exceeds the remaining quantity (" +
                                formatter.quantity(
                                    oPoItem.remainingQuantity
                                ) +
                                " " +
                                (oPoItem.unit || "") +
                                ")."
                        );

                        bValid = false;
                    }

                    // Vendor-entered unit price validation
                    var sVendorPrice = String(
                        oLine.vendorUnitPrice === null ||
                        oLine.vendorUnitPrice === undefined
                            ? ""
                            : oLine.vendorUnitPrice
                    ).trim();

                    var fVendorPrice = toNumber(sVendorPrice);

                    if (
                        !sVendorPrice ||
                        fVendorPrice === null ||
                        fVendorPrice <= 0
                    ) {
                        oModel.setProperty(
                            sPath + "/priceState",
                            "Error"
                        );

                        oModel.setProperty(
                            sPath + "/priceStateText",
                            "Enter a vendor unit price greater than zero."
                        );

                        bValid = false;
                    } else if (!PRICE_PATTERN.test(sVendorPrice)) {
                        oModel.setProperty(
                            sPath + "/priceState",
                            "Error"
                        );

                        oModel.setProperty(
                            sPath + "/priceStateText",
                            "Use a unit price with at most 3 decimal places."
                        );

                        bValid = false;
                    }
                });

                var bLineProblem =
                    aLines.some(function (oLine) {
                        return oLine.itemState === "Error" ||
                            oLine.qtyState === "Error" ||
                            oLine.priceState === "Error";
                    });

                if (bLineProblem) {
                    oModel.setProperty(
                        "/linesErrorText",
                        "Check the marked invoice items before submitting."
                    );
                }

                return bValid;
            },

            // =========================================
            // HANDLE BACKEND VALIDATION ERRORS
            // =========================================

            _markBackendError: function (sMessage) {
                var oModel = this._getModel();
                var sText = String(sMessage || "");

                if (/invoice number/i.test(sText)) {
                    oModel.setProperty(
                        "/invoiceNumberState",
                        "Error"
                    );

                    oModel.setProperty(
                        "/invoiceNumberStateText",
                        sText
                    );
                } else if (/delivery date/i.test(sText)) {
                    oModel.setProperty(
                        "/deliveryDateState",
                        "Error"
                    );

                    oModel.setProperty(
                        "/deliveryDateStateText",
                        sText
                    );
                } else if (/invoice date/i.test(sText)) {
                    oModel.setProperty(
                        "/invoiceDateState",
                        "Error"
                    );

                    oModel.setProperty(
                        "/invoiceDateStateText",
                        sText
                    );
                } else if (
                    /price|unitprice|unit price|amount/i.test(sText)
                ) {
                    oModel.setProperty("/linesErrorText", sText);

                    oModel.getProperty("/lines").forEach(
                        function (oLine, iIndex) {
                            if (
                                oLine.materialCode &&
                                sText.indexOf(oLine.materialCode) >= 0
                            ) {
                                oModel.setProperty(
                                    "/lines/" + iIndex + "/priceState",
                                    "Error"
                                );

                                oModel.setProperty(
                                    "/lines/" + iIndex + "/priceStateText",
                                    sText
                                );
                            }
                        }
                    );
                } else if (/quantity|item/i.test(sText)) {
                    oModel.setProperty("/linesErrorText", sText);

                    oModel.getProperty("/lines").forEach(
                        function (oLine, iIndex) {
                            if (
                                oLine.materialCode &&
                                sText.indexOf(oLine.materialCode) >= 0
                            ) {
                                oModel.setProperty(
                                    "/lines/" + iIndex + "/qtyState",
                                    "Error"
                                );

                                oModel.setProperty(
                                    "/lines/" + iIndex + "/qtyStateText",
                                    sText
                                );
                            }
                        }
                    );
                } else {
                    oModel.setProperty("/linesErrorText", sText);
                }
            },

            // =========================================
            // SUBMIT
            // =========================================

            onSubmit: function () {
                var oController = this;
                var oModel = this._getModel();

                if (oModel.getProperty("/submitting")) {
                    return;
                }

                if (!this._validate()) {
                    MessageToast.show(
                        "Please correct the marked fields."
                    );
                    return;
                }

                var iLines = oModel.getProperty("/lines").length;
                var bDraft = oModel.getProperty("/isDraft");

                var sAction = bDraft
                    ? "Submit Invoice"
                    : "Save Changes";

              MessageBox.confirm(
    (bDraft
        ? "Submit invoice"
        : "Save changes to invoice") +
    " for purchase order " +
    oModel.getProperty("/poNumber") +
    " with " +
    iLines +
    (iLines === 1 ? " item" : " items") +
    "?",
    {
        title: bDraft
            ? "Submit Invoice"
            : "Save Invoice",

        actions: [
            sAction,
            MessageBox.Action.CANCEL
        ],

        emphasizedAction: sAction,

        onClose: function (sChosen) {
            if (sChosen === sAction) {
                oController._saveInvoice();
            }
        }
    }
);
            },

            // =========================================
            // SAVE EXISTING INVOICE
            // =========================================

            _saveInvoice: async function () {
                var oViewModel = this._getModel();
                var oODataModel = this._getODataModel();
                var oContext = this._oInvoiceContext;
                var iToken = this._iLoadToken;

                if (oViewModel.getProperty("/submitting")) {
                    return;
                }

                if (!oContext) {
                    MessageBox.error(
                        "The invoice is not loaded. Go back and open it again."
                    );
                    return;
                }

                oViewModel.setProperty("/submitting", true);
                oViewModel.setProperty("/busy", true);
                oViewModel.setProperty("/errorText", "");

                var sInvoiceId =
                    oViewModel.getProperty("/invoiceId");

                var oAction;

                try {
                    oAction = oODataModel.bindContext(
                        SERVICE + ".updateInvoice(...)",
                        oContext
                    );

                    // oAction.setParameter(
                    //     "invoiceNumber",
                    //     oViewModel.getProperty("/invoiceNumber").trim()
                    // );

                    oAction.setParameter(
                        "invoiceDate",
                        oViewModel.getProperty("/invoiceDate")
                    );

                    oAction.setParameter(
                        "deliveryDate",
                        oViewModel.getProperty("/deliveryDate")
                    );

                    // Send vendor-entered unitPrice to CAP for each line.
                    // The backend must persist it and calculate amounts.
                    oAction.setParameter(
                        "items",
                        oViewModel.getProperty("/lines").map(
                            function (oLine) {
                                return {
                                    purchaseOrderItem_ID:
                                        oLine.purchaseOrderItem_ID,

                                    quantity: Number(
                                        String(oLine.quantity).trim()
                                    ),

                                    unitPrice: Number(
                                        String(
                                            oLine.vendorUnitPrice
                                        ).trim()
                                    )
                                };
                            }
                        )
                    );

                    await oAction.execute(ACTION_GROUP);

                    if (iToken !== this._iLoadToken) {
                        return;
                    }

                    var oReturned =
                        oAction.getBoundContext() &&
                        oAction.getBoundContext().getObject();

                    var sNumber =
    (oReturned && oReturned.invoiceNumber) ||
    "automatically numbered invoice";

                    oViewModel.setProperty("/submitting", false);
                    oViewModel.setProperty("/busy", false);

                    MessageToast.show(
                        "Invoice " + sNumber + " was saved."
                    );

                    this.getOwnerComponent().getRouter().navTo(
                        "RouteInvoiceObjectPage",
                        {
                            invoiceId: encodeURIComponent(sInvoiceId)
                        },
                        true
                    );
                } catch (oError) {
                    oViewModel.setProperty("/submitting", false);
                    oViewModel.setProperty("/busy", false);

                    if (
                        (oError && oError.canceled) ||
                        iToken !== this._iLoadToken
                    ) {
                        return;
                    }

                    var sMessage = getErrorText(
                        oError,
                        "The invoice could not be saved. Check the details and try again."
                    );

                    this._markBackendError(sMessage);

                    MessageBox.error(sMessage, {
                        title: "Invoice Could Not Be Saved"
                    });
                } finally {
                    if (oAction) {
                        oAction.destroy();
                    }
                }
            },

            // =========================================
            // NAVIGATION
            // =========================================

            onNavBack: function () {
                if (this._getModel().getProperty("/submitting")) {
                    return;
                }

                if (
                    History.getInstance().getPreviousHash() !== undefined
                ) {
                    window.history.back();
                } else {
                    this.getOwnerComponent().getRouter().navTo(
                        "RouteInvoices",
                        {},
                        true
                    );
                }
            }
        }
    );
});