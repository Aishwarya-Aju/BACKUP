sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "vrfrontend/model/formatter"
], function (
    Controller,
    JSONModel,
    MessageToast,
    MessageBox,
    Filter,
    FilterOperator,
    Sorter,
    formatter
) {
    "use strict";

    // Route of the PO object page (must match the route name in manifest.json exactly)
    var ITEM_ROUTE = "POItem";

    return Controller.extend("vrfrontend.controller.PurchaseOrder", {

        formatter: formatter,

        // =========================================================
        // LIFECYCLE
        // =========================================================

        onInit: function () {
            // Values shown in the four filter dropdowns
            this.getView().setModel(new JSONModel({
                numbers: [],
                dates: [],
                deliveryDates: [],
                statuses: []
            }), "poFilter");

            this._loadFilterValues();

            // Clock model used by the NEW badge and row highlight bindings
            this._oClockModel = new JSONModel({
                now: new Date().toISOString()
            });

            this.getView().setModel(this._oClockModel, "clock");

            // Re-evaluate NEW badges every formatter.NEW_BADGE_TICK_MS
            this._startBadgeClock();

            // PO number sort direction (false = ascending, which is the default)
            this._bSortDescending = false;

            // Re-evaluate the Recent window whenever the list page is opened again
            this._bRouteMatchedOnce = false;
            this.getOwnerComponent().getRouter()
                .getRoute("PurchaseOrder")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        onExit: function () {
            // Prevent the timer from continuing after this controller exits
            this._stopBadgeClock();
            this._oClockModel = null;
        },

        // Starts the single clock timer of this controller (never creates a duplicate)
        _startBadgeClock: function () {
            this._stopBadgeClock();

            this._newBadgeTimer = setInterval(function () {
                if (this._oClockModel) {
                    this._oClockModel.setProperty(
                        "/now",
                        new Date().toISOString()
                    );
                }
            }.bind(this), formatter.NEW_BADGE_TICK_MS);
        },

        _stopBadgeClock: function () {
            if (this._newBadgeTimer) {
                clearInterval(this._newBadgeTimer);
                this._newBadgeTimer = null;
            }
        },

        // Reload the dropdown values when the table data was refreshed
        // (for example after a new PO was created)
        onTableUpdateFinished: function (oEvent) {
            if (oEvent.getParameter("reason") === "Refresh") {
                this._loadFilterValues();
            }
        },

        // =========================================================
        // FILTER VALUES (unique PO numbers, dates, statuses)
        // =========================================================

        _loadFilterValues: async function () {
            try {
                var oModel = this.getOwnerComponent().getModel();

                // Only fetch the four fields we need
                var oListBinding = oModel.bindList("/PurchaseOrders", null, [], [], {
                    $select: "poNumber,poDate,expectedDeliveryDate,poStatus"
                });

                var aContexts = await oListBinding.requestContexts(0, 1000);
                var aPOs = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                // Unique, sorted values of one field as [{ value: ... }]
                var unique = function (sField, bNewestFirst) {
                    var aValues = Array.from(new Set(
                        aPOs.map(function (oPO) { return oPO[sField]; })
                            .filter(Boolean)
                    )).sort();

                    if (bNewestFirst) {
                        aValues.reverse();
                    }

                    return aValues.map(function (vValue) {
                        return { value: vValue };
                    });
                };

                this.getView().getModel("poFilter").setData({
                    numbers: unique("poNumber"),
                    dates: unique("poDate", true),
                    deliveryDates: unique("expectedDeliveryDate", true),
                    statuses: unique("poStatus")
                });

            } catch (oError) {
                console.error("Failed to load filter values:", oError);
            }
        },

        // =========================================================
        // FILTERS
        // =========================================================

        onpoFilterChange: function () {
            this._applyPOFilters();
        },

        onpoDateFilterChange: function () {
            this._applyPOFilters();
        },

        onpoExDateFilterChange: function () {
            this._applyPOFilters();
        },

        onpoStatusFilterChange: function () {
            this._applyPOFilters();
        },

        // One OR-filter built from the selected keys of a MultiComboBox
        _buildFilter: function (sControlId, sFieldPath) {
            var oControl = this.byId(sControlId);

            if (!oControl) {
                return null;
            }

            var aKeys = oControl.getSelectedKeys();

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

        _applyPOFilters: function () {
            var oBinding = this.byId("poTable").getBinding("items");

            if (!oBinding) {
                return;
            }

            // AND between the different filters, OR inside each one
            var aFilters = [
                this._buildFilter("poFilter", "poNumber"),
                this._buildFilter("poDateFilter", "poDate"),
                this._buildFilter("poExDateFilter", "expectedDeliveryDate"),
                this._buildFilter("poStatusFilter", "poStatus"),
                this._getTabFilter()
            ].filter(Boolean);

            // One explicit AND filter, so the tab filter can never be OR-ed with the
            // status dropdown. The sorter defined in the XML view stays active.
            oBinding.filter(aFilters.length
                ? new Filter({ filters: aFilters, and: true })
                : []);
        },

        // Filter for the selected tab; null = no extra filter (All Orders)
        _getTabFilter: function () {
            var sKey = this.byId("poTabBar").getSelectedKey();

            switch (sKey) {
                case "recent":
                    // Rolling 24h window on createdAt. Null createdAt never matches "ge".
                    return new Filter("createdAt", FilterOperator.GE, formatter.recentCutoff());
                case "pending":
                    return new Filter("poStatus", FilterOperator.EQ, "PENDING_APPROVAL");
                case "accepted":
                    return new Filter("poStatus", FilterOperator.EQ, "ACCEPTED");
                case "sent":
                    return new Filter("poStatus", FilterOperator.EQ, "SENT_TO_VENDOR");
                case "rejected":
                    return new Filter("poStatus", FilterOperator.EQ, "REJECTED");
                default:
                    return null;
            }
        },

        onTabSelect: function () {
            this._applyPOFilters();
        },

        // Called every time the PO list route is matched
        _onRouteMatched: function () {
            // The first match is the initial load, which already requests the data
            if (!this._bRouteMatchedOnce) {
                this._bRouteMatchedOnce = true;
                return;
            }

            var oBinding = this.byId("poTable").getBinding("items");

            if (!oBinding) {
                return;
            }

            if (this.byId("poTabBar").getSelectedKey() === "recent") {
                // Recompute the 24h cutoff (sends a fresh request)
                this._applyPOFilters();
            } else {
                // Reload data so new POs and the NEW badge are re-evaluated
                oBinding.refresh();
            }
        },

        // =========================================================
        // SORTING (numeric PO number, ascending / descending)
        // =========================================================

        onToggleSort: function () {
            this._bSortDescending = !this._bSortDescending;
            this._applyPOSort();

            var oButton = this.byId("poSortButton");
            oButton.setIcon(this._bSortDescending
                ? "sap-icon://sort-descending"
                : "sap-icon://sort-ascending");
            oButton.setTooltip(this._bSortDescending
                ? "PO Number: descending (click for ascending)"
                : "PO Number: ascending (click for descending)");
        },

        // poSeq is the numeric part of the PO number (calculated in the backend
        // service). poNumber is only a tie-breaker. Filters and tabs keep this sorter.
        _applyPOSort: function () {
            var oBinding = this.byId("poTable").getBinding("items");

            if (!oBinding) {
                return;
            }

            oBinding.sort([
                new Sorter("poSeq", this._bSortDescending),
                new Sorter("poNumber", this._bSortDescending)
            ]);
        },

        // =========================================================
        // CREATE (dialog)
        // =========================================================

        // addPO: async function () {
        //     if (!this.dialog) {
        //         this.dialog = await this.loadFragment({
        //             name: "vrfrontend.view.PO"
        //         });
        //     }

        //     this.dialog.open();
        // },

        // onCloseDialog: function () {
        //     if (this.dialog) {
        //         this.dialog.close();
        //     }
        // },

        // onCreate: async function () {
        //     var oModel = this.getOwnerComponent().getModel();

        //     if (!oModel) {
        //         MessageBox.error("OData model is not available.");
        //         return;
        //     }

        //     try {
        //         var sPONumber = this.byId("inputPONumber").getValue().trim();
        //         var sPODate = this.byId("inputPODate").getValue();
        //         var sExpectedDate = this.byId("inputExpectedDate").getValue();
        //         var sPOStatus = this.byId("inputPOStatus").getSelectedKey();
        //         var sCurrency = this.byId("inputCurrency").getValue().trim();
        //         var sPaymentTerms = this.byId("inputPaymentTerms").getSelectedKey();
        //         var sContractReference = this.byId("inputContactReference").getValue().trim();
        //         var sVendorID = this.byId("inputVendor").getSelectedKey();
        //         var sBuyerID = this.byId("inputBuyer").getSelectedKey();

        //         // Validate mandatory fields
        //         if (
        //             !sPONumber || !sPODate || !sExpectedDate || !sPOStatus ||
        //             !sCurrency || !sPaymentTerms || !sContractReference ||
        //             !sVendorID || !sBuyerID
        //         ) {
        //             MessageBox.warning(
        //                 "Fill all mandatory fields and select a Vendor and Buyer."
        //             );
        //             return;
        //         }

        //         var oPOData = {
        //             poNumber: sPONumber,
        //             poDate: sPODate,
        //             expectedDeliveryDate: sExpectedDate,
        //             poStatus: sPOStatus,
        //             currency: sCurrency,
        //             paymentTerms: sPaymentTerms,
        //             contractReference: sContractReference,

        //             // These names must match your CDS foreign-key fields
        //             vendor_ID: sVendorID,
        //             buyer_ID: sBuyerID
        //         };

        //         var oContext = oModel.bindList("/PurchaseOrders").create(oPOData);

        //         await oContext.created();

        //         MessageToast.show("Purchase Order created successfully.");

        //         this.dialog.close();
        //         this._clearPOForm();

        //         // Refreshing the table also reloads the filter dropdowns
        //         // (see onTableUpdateFinished)
        //         var oBinding = this.byId("poTable").getBinding("items");

        //         if (oBinding) {
        //             oBinding.refresh();
        //         }

        //     } catch (oError) {
        //         console.error("PO creation error:", oError);

        //         var sErrorMessage = oError.message ||
        //             "Purchase Order creation failed. Please try again.";

        //         if (oError.responseText) {
        //             try {
        //                 var oResponse = JSON.parse(oError.responseText);

        //                 sErrorMessage =
        //                     (oResponse.error && oResponse.error.message && oResponse.error.message.value) ||
        //                     (oResponse.error && oResponse.error.message) ||
        //                     sErrorMessage;
        //             } catch (e) {
        //                 console.warn("Could not parse backend error response.", e);
        //             }
        //         }

        //         MessageBox.error(sErrorMessage, {
        //             title: "Purchase Order Creation Failed"
        //         });
        //     }
        // },
          addPO: function () {
            this.getOwnerComponent().getRouter().navTo(ITEM_ROUTE, {
                po: "new"
            });
        },
              onPOPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext();

            if (!oContext) {
                MessageBox.error("Purchase Order context not found.");
                return;
            }

            this.getOwnerComponent().getRouter().navTo(ITEM_ROUTE, {
                po: encodeURIComponent(oContext.getPath())
            });
        },

        _clearPOForm: function () {
            this.byId("inputPONumber").setValue("");
            this.byId("inputPODate").setValue("");
            this.byId("inputExpectedDate").setValue("");
            this.byId("inputPOStatus").setSelectedKey("DRAFT");
            this.byId("inputAmount").setValue("");
            this.byId("inputCurrency").setValue("INR");
            this.byId("inputPaymentTerms").setSelectedKey("NET30");
            this.byId("inputContactReference").setValue("");
            this.byId("inputVendor").setSelectedKey("");
            this.byId("inputBuyer").setSelectedKey("");
        },

        // =========================================================
        // DELETE
        // =========================================================

        onDeletePO: function () {
            var oTable = this.byId("poTable");
            var aSelected = oTable.getSelectedItems();

            if (!aSelected.length) {
                MessageToast.show("Please select at least one PO to delete.");
                return;
            }

            MessageBox.confirm(
                "Delete " + aSelected.length + " selected Purchase Order(s)?",
                {
                    title: "Delete Purchase Order",
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) {
                            this._deleteSelected(aSelected);
                        }
                    }.bind(this)
                }
            );
        },

        _deleteSelected: async function (aSelectedItems) {
            try {
                await Promise.all(aSelectedItems.map(function (oItem) {
                    return oItem.getBindingContext().delete();
                }));

                this.byId("poTable").removeSelections(true);
                MessageToast.show("Purchase Order(s) deleted successfully.");

                // Remove deleted PO numbers etc. from the dropdowns
                this._loadFilterValues();

            } catch (oError) {
                MessageBox.error(
                    "Failed to delete Purchase Order.\n" + (oError.message || "")
                );
            }
        },

        // =========================================================
        // NAVIGATION
        // =========================================================

        // Click on a table row: open the object page for that PO
        // onPOPress: function (oEvent) {
        //     var oContext = oEvent.getSource().getBindingContext();

        //     if (!oContext) {
        //         MessageBox.error("Purchase Order context not found.");
        //         return;
        //     }

        //     this.getOwnerComponent().getRouter().navTo(ITEM_ROUTE, {
        //         po: encodeURIComponent(oContext.getPath())
        //     });
        // }
    });
});