sap.ui.define([
    "sap/ui/core/format/NumberFormat",
    "sap/ui/core/format/DateFormat"
], function (NumberFormat, DateFormat) {
    "use strict";

    var oQtyFormat = NumberFormat.getFloatInstance({ maxFractionDigits: 3, groupingEnabled: true });
    var oDateFormat = DateFormat.getDateInstance({ pattern: "dd MMM yyyy" });

    /** Converts a backend 'yyyy-MM-dd' string into a local Date (no timezone shift). */
    function parseDate(sDate) {
        var aMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(sDate || "");
        return aMatch ? new Date(+aMatch[1], +aMatch[2] - 1, +aMatch[3]) : null;
    }

    return {
        parseDate: parseDate,

        /** Date text; empty dates (e.g. actual delivery date of an open order) show a dash. */
        date: function (sDate) {
            var oDate = parseDate(sDate);
            return oDate ? oDateFormat.format(oDate) : "–";
        },

        qty: function (vValue) {
            return vValue === null || vValue === undefined || vValue === ""
                ? "–"
                : oQtyFormat.format(Number(vValue));
        },

               shortId: function (sId) {
            return sId ? String(sId).substring(0, 8).toUpperCase() : "–";
        },

        percentText: function (vValue) {
            return (Number(vValue) || 0).toFixed(2) + " %";
        },

        /** Semantic state for delivery / item status (ObjectStatus, ProgressIndicator). */
        statusState: function (sStatus) {
            switch (sStatus) {
                case "On Time": return "Success";
                case "Completed Late": return "Warning";
                case "Delayed": return "Error";
                case "Partially Delivered": return "Information";
                default: return "None";
            }
        },

        shipmentState: function (sStatus) {
            switch (sStatus) {
                case "Delivered": return "Success";
                case "In Transit": return "Information";
                case "Partially Delivered": return "Warning";
                case "Cancelled": return "Error";
                default: return "None";
            }
        },

        statusIcon: function (sStatus) {
            switch (sStatus) {
                case "On Time": return "sap-icon://accept";
                case "Completed Late": return "sap-icon://history";
                case "Delayed": return "sap-icon://alert";
                case "Partially Delivered": return "sap-icon://circle-task-2";
                default: return "sap-icon://pending";
            }
        },

        delayText: function (vDays) {
            var n = Number(vDays) || 0;
            return n > 0 ? n + (n === 1 ? " day" : " days") : "0";
        },

        delayState: function (vDays) {
            return (Number(vDays) || 0) > 0 ? "Error" : "Success";
        }
    };
});
