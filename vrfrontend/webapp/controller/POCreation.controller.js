
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

    // Route of the PO object page
    var ITEM_ROUTE = "POTeamItem";

    return Controller.extend("vrfrontend.controller.POCreation", {

        formatter: formatter,

        onInit: function () {
            this.getView().setModel(new JSONModel({
                numbers: [],
                dates: [],
                deliveryDates: [],
                statuses: []
            }), "poFilter");

            // Clock model used by the NEW badge and row highlight bindings
            this._oClockModel = new JSONModel({
                now: new Date().toISOString()
            });

            this.getView().setModel(this._oClockModel, "clock");

            // Re-evaluate NEW badges every formatter.NEW_BADGE_TICK_MS
            this._startBadgeClock();

            this._loadFilterValues();

            // PO number sort direction (false = ascending by default)
            this._bSortDescending = false;

            // Route matching state
            this._bRouteMatchedOnce = false;

            this.getOwnerComponent().getRouter()
                .getRoute("POCreation")
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

        onTableUpdateFinished: function (oEvent) {
            if (oEvent.getParameter("reason") === "Refresh") {
                this._loadFilterValues();
            }
        },

        addPO: function () {
            this.getOwnerComponent().getRouter().navTo(ITEM_ROUTE, {
                po: "new"
            });
        },

        // Click on a table row: open the object page for that PO
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

        // =========================================================
        // FILTER VALUES (unique PO numbers, dates, statuses)
        // =========================================================

        _loadFilterValues: async function () {
            try {
                var oModel = this.getOwnerComponent().getModel();

                // Only fetch the four fields we need
                var oListBinding = oModel.bindList(
                    "/PurchaseOrders",
                    null,
                    [],
                    [],
                    {
                        $select: "poNumber,poDate,expectedDeliveryDate,poStatus"
                    }
                );

                var aContexts = await oListBinding.requestContexts(0, 1000);

                var aPOs = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });

                // Unique, sorted values of one field as [{ value: ... }]
                var unique = function (sField, bNewestFirst) {
                    var aValues = Array.from(new Set(
                        aPOs.map(function (oPO) {
                            return oPO[sField];
                        }).filter(Boolean)
                    )).sort();

                    if (bNewestFirst) {
                        aValues.reverse();
                    }

                    return aValues.map(function (vValue) {
                        return {
                            value: vValue
                        };
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

        // One OR-filter built from selected MultiComboBox keys
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
                    return new Filter(
                        sFieldPath,
                        FilterOperator.EQ,
                        sKey
                    );
                }),
                and: false
            });
        },

        _applyPOFilters: function () {
            var oBinding = this.byId("poTeamTable").getBinding("items");

            if (!oBinding) {
                return;
            }

            // AND between different filters; OR within each dropdown filter
            var aFilters = [
                this._buildFilter("poTeamFilter", "poNumber"),
                this._buildFilter("poDateTeamFilter", "poDate"),
                this._buildFilter(
                    "poExDateTeamFilter",
                    "expectedDeliveryDate"
                ),
                this._buildFilter("poStatusTeamFilter", "poStatus"),
                this._getTabFilter()
            ].filter(Boolean);

            oBinding.filter(
                aFilters.length
                    ? new Filter({
                        filters: aFilters,
                        and: true
                    })
                    : []
            );
        },

        // Filter for the selected tab; null = no extra filter (All Orders)
        _getTabFilter: function () {
            var sKey = this.byId("poTeamTabBar").getSelectedKey();

            switch (sKey) {
                case "recent":
                    // Rolling 24-hour window on createdAt (independent of the NEW badge)
                    return new Filter(
                        "createdAt",
                        FilterOperator.GE,
                        formatter.recentCutoff()
                    );

                case "pending":
                    return new Filter(
                        "poStatus",
                        FilterOperator.EQ,
                        "PENDING_APPROVAL"
                    );

                case "accepted":
                    return new Filter(
                        "poStatus",
                        FilterOperator.EQ,
                        "ACCEPTED"
                    );

                case "sent":
                    return new Filter(
                        "poStatus",
                        FilterOperator.EQ,
                        "SENT_TO_VENDOR"
                    );

                case "rejected":
                    return new Filter(
                        "poStatus",
                        FilterOperator.EQ,
                        "REJECTED"
                    );

                default:
                    return null;
            }
        },

        onTabSelect: function () {
            this._applyPOFilters();
        },

        // Called every time the PO list route is matched
        _onRouteMatched: function () {
            // Initial load already requests the data
            if (!this._bRouteMatchedOnce) {
                this._bRouteMatchedOnce = true;
                return;
            }

            var oBinding = this.byId("poTeamTable").getBinding("items");

            if (!oBinding) {
                return;
            }

            if (this.byId("poTeamTabBar").getSelectedKey() === "recent") {
                // Recompute the rolling 24-hour cutoff
                this._applyPOFilters();
            } else {
                // Reload data so new POs are retrieved
                oBinding.refresh();
            }
        },

        // =========================================================
        // SORTING (numeric PO number, ascending / descending)
        // =========================================================

        onToggleSort: function () {
            this._bSortDescending = !this._bSortDescending;
            this._applyPOSort();

            var oButton = this.byId("poTeamSortButton");

            oButton.setIcon(
                this._bSortDescending
                    ? "sap-icon://sort-descending"
                    : "sap-icon://sort-ascending"
            );

            oButton.setTooltip(
                this._bSortDescending
                    ? "PO Number: descending (click for ascending)"
                    : "PO Number: ascending (click for descending)"
            );
        },

        // poSeq is the numeric part of the PO number.
        // poNumber is the tie-breaker.
        _applyPOSort: function () {
            var oBinding = this.byId("poTeamTable").getBinding("items");

            if (!oBinding) {
                return;
            }

            oBinding.sort([
                new Sorter("poSeq", this._bSortDescending),
                new Sorter("poNumber", this._bSortDescending)
            ]);
        },

        // =========================================================
        // DELETE
        // =========================================================

        onDeletePO: function () {
            var oTable = this.byId("poTeamTable");
            var aSelected = oTable.getSelectedItems();

            if (!aSelected.length) {
                MessageToast.show(
                    "Please select at least one PO to delete."
                );
                return;
            }

            MessageBox.confirm(
                "Delete " + aSelected.length +
                " selected Purchase Order(s)?",
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
            var oTable = this.byId("poTeamTable");

            try {
                await Promise.all(aSelectedItems.map(function (oItem) {
                    return oItem.getBindingContext().delete();
                }));

                oTable.removeSelections(true);

                MessageToast.show(
                    "Purchase Order(s) deleted successfully."
                );

                // Remove deleted values from dropdowns
                this._loadFilterValues();

            } catch (oError) {
                MessageBox.error(
                    "Failed to delete Purchase Order.\n" +
                    (oError.message || "")
                );
            }
        }
    });
});
