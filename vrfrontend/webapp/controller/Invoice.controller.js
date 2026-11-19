sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast,
    MessageBox
) {
    "use strict";

    return Controller.extend("vrfrontend.controller.Invoice", {

        onInit: function () {
            this.getView().setModel(new JSONModel({
                editMode: false
            }), "ui");

            // Models used by the three filter dropdowns in the view.
            // They start empty and are filled by _loadFilterValues().
            this.getView().setModel(new JSONModel({ statuses: [] }), "invoiceStatus");
            this.getView().setModel(new JSONModel({ dates: [] }), "invoiceDate");
            this.getView().setModel(new JSONModel({ materials: [] }), "materialCode");

            this._loadFilterValues();
        },

        // =========================================================
        // FILTER VALUES (unique statuses, dates, material codes)
        // =========================================================

        _loadFilterValues: async function () {
            try {
                const oModel = this.getOwnerComponent().getModel();

                // Only fetch the three fields we need
                const oListBinding = oModel.bindList("/Invoices", null, [], [], {
                    $select: "invoiceStatus,invoiceDate,materialCode"
                });

                const aContexts = await oListBinding.requestContexts(0, 1000);

                const oStatuses = new Set();
                const oDates = new Set();
                const oMaterials = new Set();

                aContexts.forEach(function (oContext) {
                    const oInvoice = oContext.getObject();

                    if (oInvoice.invoiceStatus) { oStatuses.add(oInvoice.invoiceStatus); }
                    if (oInvoice.invoiceDate) { oDates.add(oInvoice.invoiceDate); }
                    if (oInvoice.materialCode) { oMaterials.add(oInvoice.materialCode); }
                });

                const oView = this.getView();

                oView.getModel("invoiceStatus").setProperty(
                    "/statuses",
                    Array.from(oStatuses).sort().map(function (s) {
                        return { status: s };
                    })
                );

                // Newest date first
                oView.getModel("invoiceDate").setProperty(
                    "/dates",
                    Array.from(oDates).sort().reverse().map(function (d) {
                        return { date: d };
                    })
                );

                oView.getModel("materialCode").setProperty(
                    "/materials",
                    Array.from(oMaterials).sort().map(function (m) {
                        return { material: m };
                    })
                );

            } catch (oError) {
                console.error("Failed to load filter values:", oError);
            }
        },

        // =========================================================
        // FILTERS
        // =========================================================

        onInvoiceFilterChange: function () {
            this._applyInvoiceFilters();
        },

        onInStatusFilterChange: function () {
            this._applyInvoiceFilters();
        },

        onDateFilterChange: function () {
            this._applyInvoiceFilters();
        },

        onInMaterialFilterChange: function () {
            this._applyInvoiceFilters();
        },

        _buildFilter: function (sControlId, sFieldPath) {
            const oControl = this.byId(sControlId);

            if (!oControl) {
                return null;
            }

            const aKeys = oControl.getSelectedKeys();

            if (!aKeys.length) {
                return null;
            }

            return new Filter({
                filters: aKeys.map(function (sKey) {
                    return new Filter(sFieldPath, FilterOperator.EQ, sKey);
                }),
                and: false
            });
        },

        _applyInvoiceFilters: function () {
            const oBinding = this.byId("invoiceTable").getBinding("items");

            if (!oBinding) {
                return;
            }

            // AND between the different filters, OR inside each one
            const aFilters = [
                this._buildFilter("invoiceFilter", "invoiceNumber"),
                this._buildFilter("inStatusFilter", "invoiceStatus"),
                this._buildFilter("inDateFilter", "invoiceDate"),
                this._buildFilter("inMaterialFilter", "materialCode")
            ].filter(Boolean);

            oBinding.filter(aFilters);
        },


        onEditInvoice: function () {
            const oTable = this.byId("invoiceTable");
            const aSelectedItems = oTable.getSelectedItems();

            if (aSelectedItems.length === 0) {
                MessageToast.show("Please select at least one invoice to edit.");
                return;
            }

            this.getView().getModel("ui").setProperty("/editMode", true);

            this._bInvoiceEditing = true;
            this.byId("editInvoiceButton").setVisible(false);
            this.byId("saveInvoiceButton").setVisible(true);
            this.byId("cancelInvoiceButton").setVisible(true);

            MessageToast.show(aSelectedItems.length + " invoice(s) ready for editing.");
        },

        onSaveInvoice: async function () {
            try {
                const oModel = this.getView().getModel();
                await oModel.submitBatch("invoiceUpdate");
                MessageToast.show("Invoice(s) updated successfully.");
                this._exitInvoiceEditMode();

            } catch (oError) {
                console.error("Failed to save invoice:", oError);
                MessageBox.error(
                    "Failed to save invoice.\n\n" +
                    (oError.message || "Unknown error")
                );
            }
        },

        _exitInvoiceEditMode: function () {
            this.getView().getModel("ui").setProperty("/editMode", false);

            this._bInvoiceEditing = false;
            this.byId("editInvoiceButton").setVisible(true);
            this.byId("saveInvoiceButton").setVisible(false);
            this.byId("cancelInvoiceButton").setVisible(false);
            this.byId("invoiceTable").removeSelections(true);
        },

        onDeleteInvoice: function () {
            const oTable = this.byId("invoiceTable");
            const oSelectedItem = oTable.getSelectedItem();

            if (!oSelectedItem) {
                MessageToast.show("Please select an invoice to delete.");
                return;
            }

            oSelectedItem.getBindingContext().delete()
                .then(() => {
                    MessageToast.show("Invoice deleted successfully.");
                    oTable.removeSelections(true);
                })
                .catch((oError) => {
                    console.error("Delete failed:", oError);
                    MessageToast.show("Failed to delete invoice.");
                });
        },

        onCancelInvoice: function () {
            this._exitInvoiceEditMode();
            MessageToast.show("Invoice editing cancelled.");
        }

    });
});