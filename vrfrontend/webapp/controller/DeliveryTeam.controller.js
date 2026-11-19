sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "vrfrontend/model/deliveryFormatter",
    "vrfrontend/util/DeliveryExport"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Fragment,
    MessageBox,
    MessageToast,
    formatter,
    DeliveryExport
) {
    "use strict";

    // Values accepted by the backend (srv/service.js SHIPMENT_STATUSES)
    var SHIPMENT_STATUSES = ["Not Shipped", "In Transit", "Partially Delivered", "Delivered", "Cancelled"];
    var EDIT_GROUP = "deliveryEdit";

    return Controller.extend("vrfrontend.controller.DeliveryTeam", {

        formatter: formatter,

        // ==========================================
        // INITIALIZATION
        // ==========================================
        onInit: function () {
            this._oNewDialog = null;
            this._oDetailsDialog = null;
            this._bSaving = false;
            this._iPORequest = 0;
            this._iDetailsRequest = 0;
            this._aInvoices = [];

            this._oState = new JSONModel(this._createInitialState());
            this.getView().setModel(this._oState, "dlv");

            this.getOwnerComponent()
                .getRouter()
                .getRoute("DeliveryTeam")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        onExit: function () {
            if (this._oNewDialog) { this._oNewDialog.destroy(); }
            if (this._oDetailsDialog) { this._oDetailsDialog.destroy(); }
        },

        _createInitialState: function () {
            return {
                busy: false,
                deliveries: [],
                orders: [],
                filtered: [],
                filteredCount: 0,
                counts: { all: 0, pending: 0, created: 0 },
                vendors: [],
                shipmentStatuses: SHIPMENT_STATUSES.map(function (s) { return { key: s }; }),
                summary: { total: 0, pending: 0, inTransit: 0, partial: 0, completed: 0, delayed: 0 },
                filters: {
                    creation: "ALL",
                    search: "",
                    deliveryStatus: "ALL",
                    shipmentStatus: "ALL",
                    sortKey: "shipmentDate",
                    sortDesc: true
                },
                create: this._createEmptyForm(),
                detail: { busy: false, editing: false, canSave: false, error: "", items: [] }
            };
        },

        _createEmptyForm: function () {
            return {
                vendorID: "",
                vendorName: "",
                purchaseOrderID: "",
                purchaseOrders: [],
                loadingPOs: false,
                loading: false,
                saving: false,
                error: "",
                hasDetails: false,
                hasItems: false,
                details: {},
                currentProgress: 0,
                items: [],
                overall: { percent: 0, text: "", state: "None" },
                shipmentStatus: "Not Shipped",
                remarks: "",
                canSave: false
            };
        },

        _onRouteMatched: function () {
            this._loadAll();
        },

        // ==========================================
        // NAVIGATION / TOOLBAR
        // ==========================================
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("Routehome", {}, true);
        },

        onRefresh: async function () {
            await this._loadAll();
            MessageToast.show("Deliveries refreshed");
        },

        // ==========================================
        // BACKEND READS
        // ==========================================
        _odata: function () {
            return this.getOwnerComponent().getModel();
        },

        _readList: async function (sPath, mParameters, aFilters) {
            var oBinding = this._odata().bindList(sPath, undefined, undefined, aFilters, mParameters);

            try {
                var aContexts = await oBinding.requestContexts(0, 5000);
                return aContexts.map(function (oContext) { return oContext.getObject(); });
            } finally {
                oBinding.destroy();
            }
        },

        _errorText: function (oError) {
            return (oError && (oError.message || (oError.error && oError.error.message))) ||
                "An unexpected error occurred.";
        },

        _loadAll: async function () {
            this._oState.setProperty("/busy", true);

            try {
                await Promise.all([this._loadVendors(), this._loadDeliveries(), this._loadInvoices()]);
                this._applyFilters();   // merge again now that deliveries AND invoices are loaded
            } catch (oError) {
                MessageBox.error("Unable to load delivery data.\n\n" + this._errorText(oError));
            } finally {
                this._oState.setProperty("/busy", false);
            }
        },

        _loadVendors: async function () {
            var aVendors = await this._readList("/Vendors", {
                $select: ["ID", "vendorCode", "vendorName"],
                $orderby: "vendorName"
            });
            this._oState.setProperty("/vendors", aVendors);
        },

        _loadDeliveries: async function () {
            var aData = await this._readList("/Deliveries", {
                $select: [
                    "ID", "shipmentDate", "expectedDeliveryDate", "actualDeliveryDate",
                    "deliveryStatus", "delayDays", "partialDelivery", "deliveryPercentage",
                    "shipmentStatus", "remarks"
                ],
                $expand: {
                    vendor: { $select: ["ID", "vendorName"] },
                    purchaseOrder: {
                        $select: ["ID", "poNumber"],
                        $expand: { invoice: { $select: ["ID", "invoiceNumber"] } }
                    },
                    items: {
                        $select: [
                            "ID", "invoiceItem_ID", "materialCode", "acceptedQuantity", "deliveredQuantity",
                            "cumulativeDeliveredQuantity", "itemDeliveryPercentage", "partialDelivery",
                            "itemStatus", "itemDelayDays", "completionDate"
                        ],
                        $expand: { invoiceItem: { $select: ["ID", "materialDescription", "unit"] } }
                    }
                }
            });

            this._oState.setProperty("/deliveries", aData.map(this._toRow));
            this._updateSummary();
            this._applyFilters();
        },

        /** Invoices make a PO eligible for delivery; read once per refresh and cached. */
        _loadInvoices: async function () {
            this._aInvoices = await this._readList("/Invoices", {
                $select: ["ID", "invoiceNumber", "deliveryDate", "purchaseOrder_ID", "vendor_ID"],
                $expand: {
                    purchaseOrder: { $select: ["ID", "poNumber"] },
                    vendor: { $select: ["ID", "vendorName"] }
                }
            });
        },

        /**
         * One row per PO: its delivery if it exists, otherwise a virtual
         * "Pending Creation" row built from the invoice. Nothing is written to the database.
         */
        _buildOrders: function () {
            var aDeliveries = this._oState.getProperty("/deliveries");
            var mByPO = {};
            var mUsed = {};
            var mSeenPO = {};
            var aOrders = [];

            aDeliveries.forEach(function (d) { mByPO[d.purchaseOrderID] = d; });

            this._aInvoices.forEach(function (oInv) {
                var sPO = oInv.purchaseOrder_ID;
                if (!sPO || mSeenPO[sPO]) { return; }
                mSeenPO[sPO] = true;

                var oDelivery = mByPO[sPO];
                if (oDelivery) {
                    mUsed[oDelivery.ID] = true;
                    aOrders.push(Object.assign({}, oDelivery, { hasDelivery: true, creationStatus: "Delivery Created" }));
                    return;
                }

                aOrders.push({
                    ID: "",
                    hasDelivery: false,
                    creationStatus: "Pending Creation",
                    purchaseOrderID: sPO,
                    vendorID: oInv.vendor_ID,
                    vendorName: (oInv.vendor && oInv.vendor.vendorName) || "",
                    poNumber: (oInv.purchaseOrder && oInv.purchaseOrder.poNumber) || "",
                    invoiceNumber: oInv.invoiceNumber,
                    expectedDeliveryDate: oInv.deliveryDate,
                    shipmentDate: null,
                    actualDeliveryDate: null,
                    deliveryPercentage: 0,
                    deliveryStatus: "",
                    shipmentStatus: "",
                    delayDays: 0,
                    partialDelivery: false,
                    remarks: "",
                    items: []
                });
            });

            // Deliveries not matched above (PO without invoice, or old duplicates) stay visible and deletable
            aDeliveries.forEach(function (d) {
                if (!mUsed[d.ID]) {
                    aOrders.push(Object.assign({}, d, { hasDelivery: true, creationStatus: "Delivery Created" }));
                }
            });

            var iPending = aOrders.filter(function (r) { return !r.hasDelivery; }).length;
            this._oState.setProperty("/orders", aOrders);
            this._oState.setProperty("/counts", {
                all: aOrders.length,
                pending: iPending,
                created: aOrders.length - iPending
            });
        },

        _toRow: function (d) {
            return {
                ID: d.ID,
                purchaseOrderID: (d.purchaseOrder && d.purchaseOrder.ID) || "",
                vendorID: (d.vendor && d.vendor.ID) || "",
                vendorName: (d.vendor && d.vendor.vendorName) || "",
                poNumber: (d.purchaseOrder && d.purchaseOrder.poNumber) || "",
                invoiceNumber: (d.purchaseOrder && d.purchaseOrder.invoice && d.purchaseOrder.invoice.invoiceNumber) || "",
                shipmentDate: d.shipmentDate,
                expectedDeliveryDate: d.expectedDeliveryDate,
                actualDeliveryDate: d.actualDeliveryDate,
                deliveryPercentage: Number(d.deliveryPercentage) || 0,
                deliveryStatus: d.deliveryStatus,
                shipmentStatus: d.shipmentStatus,
                delayDays: Number(d.delayDays) || 0,
                partialDelivery: !!d.partialDelivery,
                remarks: d.remarks || "",
                items: (d.items || []).map(function (it) {
                    return {
                        ID: it.ID,
                        materialCode: it.materialCode,
                        materialDescription: (it.invoiceItem && it.invoiceItem.materialDescription) || "",
                        unit: (it.invoiceItem && it.invoiceItem.unit) || "",
                        orderedQuantity: (it.invoiceItem && it.invoiceItem.purchaseOrderItem && it.invoiceItem.purchaseOrderItem.orderedQuantity) || 0,
                        acceptedQuantity: it.acceptedQuantity,
                        deliveredQuantity: it.deliveredQuantity,
                        cumulativeDeliveredQuantity: it.cumulativeDeliveredQuantity,
                        itemDeliveryPercentage: it.itemDeliveryPercentage,
                        itemStatus: it.itemStatus,
                        itemDelayDays: it.itemDelayDays,
                        completionDate: it.completionDate
                    };
                })
            };
        },

        // ==========================================
        // SUMMARY CARDS (calculated from loaded data)
        // ==========================================
        _updateSummary: function () {
            var aRows = this._oState.getProperty("/deliveries");
            var count = function (fn) { return aRows.filter(fn).length; };

            this._oState.setProperty("/summary", {
                total: aRows.length,
                pending: count(function (r) { return r.deliveryStatus === "Pending"; }),
                inTransit: count(function (r) { return r.shipmentStatus === "In Transit"; }),
                partial: count(function (r) { return r.deliveryStatus === "Partially Delivered"; }),
                completed: count(function (r) {
                    return r.deliveryStatus === "On Time" || r.deliveryStatus === "Completed Late";
                }),
                delayed: count(function (r) { return r.deliveryStatus === "Delayed"; })
            });
        },

        // ==========================================
        // SEARCH / FILTER / SORT
        // ==========================================
        onSearch: function (oEvent) {
            var sValue = oEvent.getParameter("newValue");
            if (sValue === undefined) { sValue = oEvent.getParameter("query"); }
            this._oState.setProperty("/filters/search", sValue || "");
            this._applyFilters();
        },

        onDeliveryStatusFilter: function (oEvent) {
            this._oState.setProperty("/filters/deliveryStatus", oEvent.getSource().getSelectedKey());
            this._applyFilters();
        },

        onShipmentStatusFilter: function (oEvent) {
            this._oState.setProperty("/filters/shipmentStatus", oEvent.getSource().getSelectedKey());
            this._applyFilters();
        },

        onSortKeyChange: function (oEvent) {
            this._oState.setProperty("/filters/sortKey", oEvent.getSource().getSelectedKey());
            this._applyFilters();
        },

        onToggleSortDirection: function () {
            this._oState.setProperty("/filters/sortDesc", !this._oState.getProperty("/filters/sortDesc"));
            this._applyFilters();
        },

        onClearFilters: function () {
            this._oState.setProperty("/filters", {
                creation: "ALL",
                search: "",
                deliveryStatus: "ALL",
                shipmentStatus: "ALL",
                sortKey: "shipmentDate",
                sortDesc: true
            });
            this._applyFilters();
        },

        onCreationFilter: function (oEvent) {
            this._oState.setProperty("/filters/creation", oEvent.getParameter("item").getKey());
            this._applyFilters();
        },

        _applyFilters: function () {
            this._buildOrders();

            var oFilters = this._oState.getProperty("/filters");
            var sSearch = (oFilters.search || "").trim().toLowerCase();

            var aRows = this._oState.getProperty("/orders").filter(function (r) {
                if (oFilters.creation === "PENDING" && r.hasDelivery) { return false; }
                if (oFilters.creation === "CREATED" && !r.hasDelivery) { return false; }
                if (oFilters.deliveryStatus !== "ALL" && r.deliveryStatus !== oFilters.deliveryStatus) { return false; }
                if (oFilters.shipmentStatus !== "ALL" && r.shipmentStatus !== oFilters.shipmentStatus) { return false; }
                if (!sSearch) { return true; }
                return [r.ID, r.vendorName, r.poNumber, r.invoiceNumber].some(function (s) {
                    return String(s || "").toLowerCase().indexOf(sSearch) !== -1;
                });
            });

            var sKey = oFilters.sortKey;
            var iDir = oFilters.sortDesc ? -1 : 1;
            aRows.sort(function (a, b) {
                var x = a[sKey];
                var y = b[sKey];
                if (x === y) { return 0; }
                if (x === null || x === undefined || x === "") { return 1; }
                if (y === null || y === undefined || y === "") { return -1; }
                if (typeof x === "number" && typeof y === "number") { return (x - y) * iDir; }
                return String(x).localeCompare(String(y)) * iDir;
            });

            this._oState.setProperty("/filtered", aRows);
            this._oState.setProperty("/filteredCount", aRows.length);
        },
        // ==========================================
        // EXPORT (all rows matching the current filters)
        // ==========================================
        onExportCsv: function () {
            var aRows = this._oState.getProperty("/filtered").filter(function (r) { return r.hasDelivery; });
            if (!aRows.length) {
                MessageToast.show("There are no created deliveries to export.");
                return;
            }
            try {
                DeliveryExport.exportCsv(aRows);
                MessageToast.show("CSV report downloaded");
            } catch (oError) {
                MessageBox.error("CSV export failed.\n\n" + this._errorText(oError));
            }
        },

        onExportExcel: async function () {
            var aRows = this._oState.getProperty("/filtered").filter(function (r) { return r.hasDelivery; });
            if (!aRows.length) {
                MessageToast.show("There are no created deliveries to export.");
                return;
            }
            try {
                await DeliveryExport.exportExcel(aRows);
                MessageToast.show("Excel report downloaded");
            } catch (oError) {
                MessageBox.error("Excel export failed.\n\n" + this._errorText(oError));
            }
        },

        // ==========================================
        // QUANTITY HELPERS
        // ==========================================
        _round3: function (n) {
            return Math.round(n * 1000) / 1000;
        },

        /** Returns { value } or { error }. Empty input counts as 0. */
        _parseQuantity: function (vText, nMax) {
            var sText = String(vText === undefined || vText === null ? "" : vText).trim();

            if (sText === "") { return { value: 0 }; }
            if (sText.charAt(0) === "-") { return { error: "The quantity cannot be negative." }; }
            if (!/^\d+(\.\d{1,3})?$/.test(sText)) {
                return { error: "Enter a valid number (up to 3 decimals)." };
            }

            var nValue = Number(sText);
            if (nValue > nMax + 0.0000001) {
                return { error: "The quantity cannot exceed the remaining accepted quantity (" + formatter.qty(nMax) + ")." };
            }
            return { value: nValue };
        },

        _percent: function (nValue, nTotal) {
            return nTotal > 0 ? Math.min(Math.round((nValue / nTotal) * 10000) / 100, 100) : 0;
        },

        /** Preview status only; the backend calculates the saved status. */
        _projectedStatus: function (nAccepted, nProjected, sExpectedDate) {
            var oToday = new Date();
            oToday.setHours(0, 0, 0, 0);
            var oExpected = formatter.parseDate(sExpectedDate);
            var bOverdue = !!oExpected && oToday > oExpected;

            if (nAccepted > 0 && nProjected >= nAccepted) { return bOverdue ? "Completed Late" : "On Time"; }
            if (bOverdue) { return "Delayed"; }
            return nProjected > 0 ? "Partially Delivered" : "Pending";
        },

        // ==========================================
        // NEW DELIVERY
        // ==========================================
        _getNewDialog: async function () {
            if (!this._oNewDialog) {
                this._oNewDialog = await Fragment.load({
                    id: this.getView().getId(),
                    name: "vrfrontend.view.fragments.NewDelivery",
                    controller: this
                });
                this.getView().addDependent(this._oNewDialog);
            }
            return this._oNewDialog;
        },

        onNewDelivery: async function () {
            this._iPORequest++;
            this._iDetailsRequest++;
            this._oState.setProperty("/create", this._createEmptyForm());

            try {
                if (!this._oState.getProperty("/vendors").length) {
                    await this._loadVendors();
                }
                (await this._getNewDialog()).open();
            } catch (oError) {
                MessageBox.error("Unable to open the delivery form.\n\n" + this._errorText(oError));
            }
        },

        /** Create Delivery on a pending row: opens the existing dialog with vendor and PO prefilled. */
        onCreateFromRow: function (oEvent) {
            this._openNewDialogFor(oEvent.getSource().getBindingContext("dlv").getObject());
        },

        _openNewDialogFor: async function (oRow) {
            var iDetails = ++this._iDetailsRequest;
            this._iPORequest++;

            this._oState.setProperty("/create", Object.assign(this._createEmptyForm(), {
                vendorID: oRow.vendorID,
                vendorName: oRow.vendorName,
                purchaseOrderID: oRow.purchaseOrderID,
                purchaseOrders: [{ ID: oRow.purchaseOrderID, poNumber: oRow.poNumber, poStatus: "" }],
                loading: true
            }));

            try {
                if (!this._oState.getProperty("/vendors").length) {
                    await this._loadVendors();
                }
                (await this._getNewDialog()).open();

                var oResult = await this._requestDeliveryDetails(oRow.vendorID, oRow.purchaseOrderID);
                if (iDetails !== this._iDetailsRequest) { return; }
                this._applyDeliveryDetails(oResult);
            } catch (oError) {
                if (iDetails === this._iDetailsRequest) {
                    this._oState.setProperty("/create/error", this._errorText(oError));
                }
            } finally {
                if (iDetails === this._iDetailsRequest) {
                    this._oState.setProperty("/create/loading", false);
                }
            }
        },

        /** Edit on an existing delivery: opens the details dialog directly in edit mode. */
        onEditFromRow: async function (oEvent) {
            var sID = oEvent.getSource().getBindingContext("dlv").getProperty("ID");

            await this._openDetails(sID);
            if (this._oState.getProperty("/detail/ID")) {
                this.onEditDelivery();
            }
        },

        onCancelNewDelivery: function () {
            this._oNewDialog.close();
        },

        onVendorSelected: async function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var sVendorID = oItem ? oItem.getKey() : "";
            var iRequest = ++this._iPORequest;
            this._iDetailsRequest++;

            // Reset everything that depends on the vendor
            var oForm = Object.assign(this._createEmptyForm(), {
                vendorID: sVendorID,
                vendorName: oItem ? oItem.getText() : "",
                shipmentStatus: this._oState.getProperty("/create/shipmentStatus"),
                remarks: this._oState.getProperty("/create/remarks")
            });
            this._oState.setProperty("/create", oForm);

            if (!sVendorID) { return; }

            this._oState.setProperty("/create/loadingPOs", true);
            try {
                var aPOs = await this._readList(
                    "/PurchaseOrders",
                    { $select: ["ID", "poNumber", "poStatus"], $orderby: "poNumber" },
                    [new Filter("vendor_ID", FilterOperator.EQ, sVendorID)]
                );
                if (iRequest !== this._iPORequest) { return; }   // a newer vendor was selected
                this._oState.setProperty("/create/purchaseOrders", aPOs);
                if (!aPOs.length) {
                    this._oState.setProperty("/create/error", "This vendor has no purchase orders.");
                }
            } catch (oError) {
                if (iRequest === this._iPORequest) {
                    this._oState.setProperty("/create/error",
                        "Unable to load purchase orders. " + this._errorText(oError));
                }
            } finally {
                if (iRequest === this._iPORequest) {
                    this._oState.setProperty("/create/loadingPOs", false);
                }
            }
        },

        _offerEditExisting: function (sID) {
            MessageBox.confirm("A delivery already exists for this purchase order. Do you want to open it and edit it?", {
                onClose: async function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        this._oNewDialog.close();
                        await this._openDetails(sID);
                        this.onEditDelivery();
                    }
                }.bind(this)
            });
        },

        onPOSelected: async function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var sPOID = oItem ? oItem.getKey() : "";
            console.log(sPOID)
            var sVendorID = this._oState.getProperty("/create/vendorID");
            var iRequest = ++this._iDetailsRequest;
            console.log(sVendorID),
                console.log(iRequest)

            this._oState.setProperty("/create/purchaseOrderID", sPOID);
            this._oState.setProperty("/create/error", "");
            this._oState.setProperty("/create/hasDetails", false);
            this._oState.setProperty("/create/hasItems", false);
            this._oState.setProperty("/create/items", []);
            this._oState.setProperty("/create/canSave", false);

            if (!sPOID) { return; }

            this._oState.setProperty("/create/loading", true);

            try {
                // Check if delivery already exists
                var aExisting = await this._readList(
                    "/Deliveries",
                    { $select: ["ID"] },
                    [new Filter("purchaseOrder_ID", FilterOperator.EQ, sPOID)]
                );

                if (iRequest !== this._iDetailsRequest) { return; }

                if (aExisting.length) {
                    this._oState.setProperty(
                        "/create/error",
                        "A delivery already exists for this purchase order."
                    );

                    this._offerEditExisting(aExisting[0].ID);
                    return;
                }

                // Fetch PO details if no delivery exists
                var oResult = await this._requestDeliveryDetails(sVendorID, sPOID);

                if (iRequest !== this._iDetailsRequest) { return; }
                this._applyDeliveryDetails(oResult);

            } catch (oError) {
                if (iRequest === this._iDetailsRequest) {
                    this._oState.setProperty("/create/error", this._errorText(oError));
                }
            } finally {
                if (iRequest === this._iDetailsRequest) {
                    this._oState.setProperty("/create/loading", false);
                }
            }
        },

        /** Calls the unbound OData V4 function getDeliveryDetails(vendorID, purchaseOrderID). */
        _requestDeliveryDetails: async function (sVendorID, sPOID) {

            var oOperation = this._odata().bindContext("/getDeliveryDetails(...)");

            try {
                oOperation.setParameter("vendorID", sVendorID);
                oOperation.setParameter("purchaseOrderID", sPOID);

                await oOperation.execute();

                var oResult = await oOperation.requestObject();

                console.log("Delivery API Response:", oResult);

                var oDetails = oResult && (
                    oResult.value !== undefined
                        ? oResult.value
                        : oResult
                );

                if (!oDetails) {
                    throw new Error(
                        "Backend returned no delivery details for the selected Purchase Order."
                    );
                }

                return oDetails;

            } finally {
                oOperation.destroy();
            }
        },

        _applyDeliveryDetails: function (oResult) {

            console.log("backend result : " + oResult)

            if (!oResult) {
                this._oState.setProperty(
                    "/create/error",
                    "No delivery details found for the selected Purchase Order."
                );
                return;
            }

            var aItems = Array.isArray(oResult.items)
                ? oResult.items
                : [];

            var aItems = oResult.items || [];

            if (!oResult.expectedDeliveryDate) {
                this._oState.setProperty("/create/error", "The invoice has no delivery date.");
                return;
            }
            if (!aItems.length) {
                this._oState.setProperty("/create/error", "The invoice has no items to deliver.");
                return;
            }

            var nAccepted = 0;
            var nDelivered = 0;
            var aRows = aItems.map(function (it) {
                nAccepted += Number(it.acceptedQuantity) || 0;
                nDelivered += Math.min(Number(it.deliveredSoFar) || 0, Number(it.acceptedQuantity) || 0);
                return {
                    invoiceItemID: it.invoiceItemID,
                    materialCode: it.materialCode,
                    materialDescription: it.materialDescription,
                    unit: it.unit,
                    orderedQuantity: Number(it.orderedQuantity) || 0,
                    acceptedQuantity: Number(it.acceptedQuantity) || 0,
                    deliveredSoFar: Number(it.deliveredSoFar) || 0,
                    remainingQuantity: Number(it.remainingQuantity) || 0,
                    deliverNow: "",
                    projectedTotal: Number(it.deliveredSoFar) || 0,
                    progress: 0,
                    progressText: "",
                    status: "",
                    state: "None",
                    valueState: "None",
                    valueStateText: ""
                };
            });

            this._oState.setProperty("/create/details", {
                poNumber: oResult.poNumber,
                invoiceNumber: oResult.invoiceNumber,
                expectedDeliveryDate: oResult.expectedDeliveryDate
            });
            this._oState.setProperty("/create/currentProgress", this._percent(nDelivered, nAccepted));
            this._oState.setProperty("/create/items", aRows);
            this._oState.setProperty("/create/hasDetails", true);
            this._oState.setProperty("/create/hasItems", true);
            this._recalculateCreate();
        },

        onCreateQuantityChange: function (oEvent) {
            // Take the typed text from the event so the calculation never sees a stale model value.
            var sPath = oEvent.getSource().getBindingContext("dlv").getPath();
            this._oState.setProperty(sPath + "/deliverNow", oEvent.getParameter("value"));
            this._recalculateCreate();
        },

        _recalculateCreate: function () {
            var aItems = this._oState.getProperty("/create/items");
            var sExpected = this._oState.getProperty("/create/details/expectedDeliveryDate");
            var nAccepted = 0;
            var nProjected = 0;
            var bValid = true;

            aItems.forEach(function (oItem) {
                var oParsed = this._parseQuantity(oItem.deliverNow, oItem.remainingQuantity);
                var nNow = oParsed.error ? 0 : oParsed.value;

                if (oParsed.error) { bValid = false; }
                oItem.valueState = oParsed.error ? "Error" : "None";
                oItem.valueStateText = oParsed.error || "";

                oItem.projectedTotal = this._round3(oItem.deliveredSoFar + nNow);
                oItem.progress = this._percent(oItem.projectedTotal, oItem.acceptedQuantity);
                oItem.progressText = formatter.percentText(oItem.progress);
                oItem.status = this._projectedStatus(oItem.acceptedQuantity, oItem.projectedTotal, sExpected);
                oItem.state = formatter.statusState(oItem.status);

                nAccepted += oItem.acceptedQuantity;
                nProjected += Math.min(oItem.projectedTotal, oItem.acceptedQuantity);
            }, this);

            var nPercent = this._percent(nProjected, nAccepted);
            var sOverallStatus = this._projectedStatus(nAccepted, nProjected, sExpected);

            this._oState.setProperty("/create/items", aItems);
            this._oState.setProperty("/create/overall", {
                percent: nPercent,
                text: formatter.qty(nProjected) + " of " + formatter.qty(nAccepted) + " accepted units (" + sOverallStatus + ")",
                state: formatter.statusState(sOverallStatus)
            });
            this._oState.setProperty("/create/canSave",
                bValid && aItems.length > 0 && !this._oState.getProperty("/create/error") && !this._bSaving);
        },

        onSaveDelivery: async function () {
            if (this._bSaving) { return; }

            var oForm = this._oState.getProperty("/create");
            this._recalculateCreate();

            if (!oForm.vendorID) { MessageBox.warning("Please select a vendor."); return; }
            if (!oForm.purchaseOrderID) { MessageBox.warning("Please select a purchase order."); return; }
            if (!oForm.hasItems || oForm.error) { MessageBox.warning("The selected purchase order cannot be delivered."); return; }
            if (!this._oState.getProperty("/create/canSave")) {
                MessageBox.warning("Please correct the quantities marked in red.");
                return;
            }

            var aLines = oForm.items.map(function (oItem) {
                return {
                    invoiceItem_ID: oItem.invoiceItemID,
                    deliveredQuantity: String(this._parseQuantity(oItem.deliverNow, oItem.remainingQuantity).value)
                };
            }, this);

            var oPayload = {
                vendor_ID: oForm.vendorID,
                purchaseOrder_ID: oForm.purchaseOrderID,
                shipmentStatus: oForm.shipmentStatus,
                remarks: oForm.remarks || "",
                items: aLines
            };

            var oBinding = this._odata().bindList("/Deliveries");
            var oContext;

            this._bSaving = true;
            this._oState.setProperty("/create/saving", true);
            this._oState.setProperty("/create/canSave", false);

            try {
                oContext = oBinding.create(oPayload);
                await oContext.created();

                var sNewID = oContext.getProperty("ID");
                this._oNewDialog.close();
                MessageToast.show("Delivery saved successfully");

                await this._loadDeliveries();
                if (sNewID) { await this._openDetails(sNewID); }   // shows the server-calculated values
            } catch (oError) {
                if (oContext) {
                    try { await oContext.delete(); } catch { /* transient context already removed */ }
                }
                // Not stored in /create/error: that field blocks saving and is only for load errors.
                MessageBox.error("The delivery could not be saved.\n\n" + this._errorText(oError));
            } finally {
                oBinding.destroy();
                this._bSaving = false;
                this._oState.setProperty("/create/saving", false);
                this._recalculateCreate();
            }
        },

        // ==========================================
        // DELIVERY DETAILS / EDIT
        // ==========================================
        _getDetailsDialog: async function () {
            if (!this._oDetailsDialog) {
                this._oDetailsDialog = await Fragment.load({
                    id: this.getView().getId(),
                    name: "vrfrontend.view.fragments.DeliveryDetails",
                    controller: this
                });
                this.getView().addDependent(this._oDetailsDialog);
            }
            return this._oDetailsDialog;
        },

        onViewDetails: function (oEvent) {
            var sID = oEvent.getSource().getBindingContext("dlv").getProperty("ID");
            this._openDetails(sID);
        },

        onDeleteDelivery: function (oEvent) {
            var oRow = oEvent.getSource().getBindingContext("dlv").getObject();

            MessageBox.confirm(
                "Delete the delivery for PO " + oRow.poNumber + " and all its items? This cannot be undone.",
                {
                    title: "Delete Delivery",
                    emphasizedAction: MessageBox.Action.DELETE,
                    actions: [MessageBox.Action.DELETE, MessageBox.Action.CANCEL],
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.DELETE) {
                            this._deleteDelivery(oRow.ID);
                        }
                    }.bind(this)
                }
            );
        },

        _deleteDelivery: async function (sID) {
            var oBinding = this._odata().bindList(
                "/Deliveries", undefined, undefined,
                [new Filter("ID", FilterOperator.EQ, sID)]
            );

            this._oState.setProperty("/busy", true);
            try {
                var aContexts = await oBinding.requestContexts(0, 1);
                if (!aContexts.length) {
                    throw new Error("The delivery no longer exists.");
                }
                await aContexts[0].delete();
                MessageToast.show("Delivery deleted");
                await this._loadDeliveries();
            } catch (oError) {
                MessageBox.error("The delivery could not be deleted.\n\n" + this._errorText(oError));
            } finally {
                oBinding.destroy();
                this._oState.setProperty("/busy", false);
            }
        },

        _openDetails: async function (sID) {
            try {
                var oDialog = await this._getDetailsDialog();
                this._oState.setProperty("/detail",
                    { busy: true, editing: false, canSave: false, error: "", items: [] });
                oDialog.open();
                await this._loadDetail(sID);
            } catch (oError) {
                MessageBox.error("Unable to load the delivery.\n\n" + this._errorText(oError));
            }
        },

        /** Reads one delivery (with items) from the backend into the detail state. */
        _loadDetail: async function (sID) {
            var oBinding = this._odata().bindContext("/Deliveries(" + sID + ")", undefined, {
                $select: [
                    "ID", "shipmentDate", "expectedDeliveryDate", "actualDeliveryDate", "deliveryStatus",
                    "delayDays", "deliveryPercentage", "shipmentStatus", "remarks"
                ],
                $expand: {
                    vendor: { $select: ["ID", "vendorName"] },
                    purchaseOrder: {
                        $select: ["ID", "poNumber"],
                        $expand: { invoice: { $select: ["ID", "invoiceNumber"] } }
                    },
                    items: {
                        $select: [
                            "ID", "materialCode", "acceptedQuantity", "deliveredQuantity",
                            "cumulativeDeliveredQuantity", "itemDeliveryPercentage",
                            "itemStatus", "itemDelayDays", "completionDate"
                        ],
                        $expand: {
                            invoiceItem: {
                                $select: ["ID", "materialDescription", "unit"],
                                $expand: { purchaseOrderItem: { $select: ["ID", "orderedQuantity"] } }
                            }
                        }
                    }
                }
            });

            try {
                var oData = await oBinding.requestObject();
                var oRow = this._toRow(oData);

                this._oState.setProperty("/detail", Object.assign({}, oRow, {
                    busy: false,
                    editing: false,
                    canSave: false,
                    error: "",
                    editShipmentStatus: oRow.shipmentStatus,
                    editRemarks: oRow.remarks,
                    items: oRow.items.map(this._toDetailItem, this)
                }));
            } finally {
                oBinding.destroy();
            }
        },

        _toDetailItem: function (it) {
            var nAccepted = Number(it.acceptedQuantity) || 0;
            var nOriginal = Number(it.deliveredQuantity) || 0;
            var nCumulative = Number(it.cumulativeDeliveredQuantity) || 0;
            var nProgress = Number(it.itemDeliveryPercentage) || 0;

            return Object.assign({}, it, {
                acceptedQuantity: nAccepted,
                originalQty: nOriginal,
                newQty: String(nOriginal),
                // most this shipment may carry: accepted minus what OTHER shipments delivered
                maxQty: this._round3(Math.max(nAccepted - (nCumulative - nOriginal), 0)),
                projectedCumulative: nCumulative,
                projectedRemaining: this._round3(Math.max(nAccepted - nCumulative, 0)),
                progress: nProgress,
                progressText: formatter.percentText(nProgress),
                state: formatter.statusState(it.itemStatus),
                valueState: "None",
                valueStateText: ""
            });
        },

        onEditDelivery: function () {
            this._oState.setProperty("/detail/editing", true);
            this._recalculateDetail();
        },

        onCancelEdit: function () {
            var oDetail = this._oState.getProperty("/detail");

            oDetail.items.forEach(function (oItem) {
                oItem.newQty = String(oItem.originalQty);
            });
            oDetail.editShipmentStatus = oDetail.shipmentStatus;
            oDetail.editRemarks = oDetail.remarks;
            oDetail.editing = false;
            oDetail.error = "";
            this._oState.setProperty("/detail", oDetail);
            this._recalculateDetail();
        },

        onCloseDetails: function () {
            this._oDetailsDialog.close();
        },

        onDetailQuantityChange: function (oEvent) {
            var sPath = oEvent.getSource().getBindingContext("dlv").getPath();
            this._oState.setProperty(sPath + "/newQty", oEvent.getParameter("value"));
            this._recalculateDetail();
        },

        _recalculateDetail: function () {
            var oDetail = this._oState.getProperty("/detail");
            var bValid = true;

            oDetail.items.forEach(function (oItem) {
                var oParsed = this._parseQuantity(oItem.newQty, oItem.maxQty);
                var nNew = oParsed.error ? oItem.originalQty : oParsed.value;
                var nCumulative = this._round3(Number(oItem.cumulativeDeliveredQuantity) - oItem.originalQty + nNew);

                if (oParsed.error) { bValid = false; }
                oItem.valueState = oParsed.error ? "Error" : "None";
                oItem.valueStateText = oParsed.error || "";
                oItem.projectedCumulative = nCumulative;
                oItem.projectedRemaining = this._round3(Math.max(oItem.acceptedQuantity - nCumulative, 0));
                oItem.progress = this._percent(nCumulative, oItem.acceptedQuantity);
                oItem.progressText = formatter.percentText(oItem.progress);
            }, this);

            oDetail.canSave = oDetail.editing && bValid && !oDetail.busy;
            this._oState.setProperty("/detail", oDetail);
        },

        /**
         * Quantities are PATCHed on DeliveryItems, shipment status and remarks on Deliveries.
         * All changes go into one $batch group; the backend recalculates everything.
         */
        onSaveChanges: async function () {
            if (this._bSaving) { return; }

            var oDetail = this._oState.getProperty("/detail");
            this._recalculateDetail();
            if (!this._oState.getProperty("/detail/canSave")) {
                MessageBox.warning("Please correct the quantities marked in red.");
                return;
            }

            var aChangedItems = oDetail.items.filter(function (oItem) {
                return this._parseQuantity(oItem.newQty, oItem.maxQty).value !== oItem.originalQty;
            }, this);
            var bStatusChanged = oDetail.editShipmentStatus !== oDetail.shipmentStatus;
            var bRemarksChanged = (oDetail.editRemarks || "") !== (oDetail.remarks || "");

            if (!aChangedItems.length && !bStatusChanged && !bRemarksChanged) {
                MessageToast.show("No changes to save.");
                return;
            }

            var oModel = this._odata();
            var aBindings = [];
            var aUpdates = [];

            this._bSaving = true;
            this._oState.setProperty("/detail/busy", true);
            this._oState.setProperty("/detail/error", "");

            try {
                for (var i = 0; i < aChangedItems.length; i++) {
                    var oItem = aChangedItems[i];
                    var oItemBinding = oModel.bindContext("/DeliveryItems(" + oItem.ID + ")", undefined, {
                        $$updateGroupId: EDIT_GROUP,
                        $select: ["ID", "deliveredQuantity"]
                    });
                    aBindings.push(oItemBinding);
                    await oItemBinding.requestObject();
                    aUpdates.push(oItemBinding.getBoundContext().setProperty(
                        "deliveredQuantity",
                        String(this._parseQuantity(oItem.newQty, oItem.maxQty).value),
                        EDIT_GROUP
                    ));
                }

                if (bStatusChanged || bRemarksChanged) {
                    var oHeaderBinding = oModel.bindContext("/Deliveries(" + oDetail.ID + ")", undefined, {
                        $$updateGroupId: EDIT_GROUP,
                        $select: ["ID", "shipmentStatus", "remarks"]
                    });
                    aBindings.push(oHeaderBinding);
                    await oHeaderBinding.requestObject();
                    var oHeaderContext = oHeaderBinding.getBoundContext();
                    if (bStatusChanged) {
                        aUpdates.push(oHeaderContext.setProperty("shipmentStatus", oDetail.editShipmentStatus, EDIT_GROUP));
                    }
                    if (bRemarksChanged) {
                        aUpdates.push(oHeaderContext.setProperty("remarks", oDetail.editRemarks || "", EDIT_GROUP));
                    }
                }

                await Promise.all([oModel.submitBatch(EDIT_GROUP)].concat(aUpdates));

                MessageToast.show("Delivery updated successfully");
                await this._loadDeliveries();
                await this._loadDetail(oDetail.ID);   // server-calculated values
            } catch (oError) {
                try { oModel.resetChanges(EDIT_GROUP); } catch { /* nothing pending */ }
                this._oState.setProperty("/detail/error", this._errorText(oError));
            } finally {
                aBindings.forEach(function (oBinding) { oBinding.destroy(); });
                this._bSaving = false;
                this._oState.setProperty("/detail/busy", false);
                this._recalculateDetail();
            }
        },
        //-----------pdf logic-------------------
        onpdf: function () {
            var oTable = this.byId("deliveriesTable"); // Replace with your table ID

            if (!oTable) {
                sap.m.MessageBox.error("Delivery table not found.");
                return;
            }

            var oSelectedItem = oTable.getSelectedItem();

            if (!oSelectedItem) {
                sap.m.MessageBox.warning("Please select one delivery record.");
                return;
            }

            var oContext = oSelectedItem.getBindingContext("dlv");

            if (!oContext) {
                sap.m.MessageBox.error("Unable to read the selected delivery record.");
                return;
            }

            var oRecord = oContext.getObject();

            var jsPDF = window.jspdf && window.jspdf.jsPDF;

            if (!jsPDF) {
                sap.m.MessageBox.error("jsPDF library is not loaded.");
                return;
            }

            var oDoc = new jsPDF({
                orientation: "portrait",
                unit: "mm",
                format: "a4"
            });

            var y = 20;
            var left = 15;
            var pageWidth = 180;

            oDoc.setFontSize(18);
            oDoc.text("Delivery Report", left, y);

            y += 12;
            oDoc.setFontSize(10);

            var aFields = [
                ["PO Number", oRecord.poNumber],
                ["Vendor Name", oRecord.vendorName],
                ["Invoice Number", oRecord.invoiceNumber],
                ["Shipment Date", oRecord.shipmentDate],
                ["Expected Delivery", oRecord.expectedDeliveryDate],
                ["Actual Delivery", oRecord.actualDeliveryDate],
                ["Delivery Percentage", oRecord.deliveryPercentage],
                ["Delivery Status", oRecord.deliveryStatus],
                ["Shipment Status", oRecord.shipmentStatus],
                ["Delay Days", oRecord.delayDays],
                ["Partial Delivery", oRecord.partialDelivery],
                ["Remarks", oRecord.remarks]
            ];

            aFields.forEach(function (aField) {
                var sValue = aField[1] == null || aField[1] === ""
                    ? "-"
                    : String(aField[1]);

                var aLines = oDoc.splitTextToSize(
                    aField[0] + ": " + sValue,
                    pageWidth
                );

                // Keep the report on one page by shrinking the font if needed.
                if (y + (aLines.length * 5) > 275) {
                    oDoc.setFontSize(8);
                }

                oDoc.text(aLines, left, y);
                y += aLines.length * 5 + 2;
            });

            var sFileName = "Delivery_" +
                String(oRecord.poNumber || "Report").replace(/[\\/:*?"<>|]/g, "_") +
                ".pdf";

            oDoc.save(sFileName);
        }
    });
});
