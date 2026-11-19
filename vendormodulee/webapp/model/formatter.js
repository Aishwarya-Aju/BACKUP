sap.ui.define([
    "sap/ui/core/format/DateFormat",
    "sap/ui/core/format/NumberFormat"
], function (DateFormat, NumberFormat) {     
    "use strict";
 
    // Purchase order status (VendorRiskService.PurchaseOrders/poStatus)
    var PO_STATUS = {
        DRAFT: { text: "Draft", state: "None" },
        PENDING_APPROVAL: { text: "Pending Approval", state: "Warning" },
        APPROVED: { text: "Approved", state: "Success" },
        SENT_TO_VENDOR: { text: "Pending Acceptance", state: "Warning" },
        ACCEPTED: { text: "Accepted", state: "Success" },
        REJECTED: { text: "Rejected", state: "Error" },
        PARTIALLY_DELIVERED: { text: "Partially Delivered", state: "Warning" },
        FULLY_DELIVERED: { text: "Fully Delivered", state: "Success" },
        CANCELLED: { text: "Cancelled", state: "Error" },
        CLOSED: { text: "Closed", state: "None" }
    };

    // Purchase order item status (VendorRiskService.PurchaseOrderItems/itemStatus)
    var ITEM_STATUS = {
        OPEN: { text: "Open", state: "Information" },
        CONFIRMED: { text: "Confirmed", state: "Success" },
        PARTIALLY_DELIVERED: { text: "Partially Delivered", state: "Warning" },
        FULLY_DELIVERED: { text: "Fully Delivered", state: "Success" },
        CANCELLED: { text: "Cancelled", state: "Error" },
        CLOSED: { text: "Closed", state: "None" }
    };

    // Invoice status (VendorRiskService.Invoices/invoiceStatus). The backend
    // sets DRAFT when the vendor accepts a purchase order and SUBMITTED in
    // its invoice create handler; the other values come from existing data.
    // Unknown values fall back to a readable label with a neutral state.
    var INVOICE_STATUS = {
        DRAFT: { text: "Draft", state: "Warning" },
        SUBMITTED: { text: "Submitted", state: "Information" },
        APPROVED: { text: "Approved", state: "Success" },
        UNDER_REVIEW: { text: "Under Review", state: "Warning" },
        BLOCKED: { text: "Blocked", state: "Error" }
    };

    // Edm.Date values arrive as "yyyy-MM-dd" strings
    var oSourceDateFormat = DateFormat.getDateInstance({
        pattern: "yyyy-MM-dd",
        UTC: true
    });

    var oDisplayDateFormat = DateFormat.getDateInstance({
        style: "medium",
        UTC: true
    });

    // Edm.DateTimeOffset values arrive as ISO strings
    var oDateTimeFormat = DateFormat.getDateTimeInstance({
        style: "medium"
    });

    var oAmountFormat = NumberFormat.getFloatInstance({
        minFractionDigits: 2,
        maxFractionDigits: 2,
        groupingEnabled: true
    });

    // Quantities are Decimal(15,3): no trailing zeros, up to 3 decimals
    var oQuantityFormat = NumberFormat.getFloatInstance({
        minFractionDigits: 0,
        maxFractionDigits: 3,
        groupingEnabled: true
    });

    var oScoreFormat = NumberFormat.getFloatInstance({
        minFractionDigits: 1,
        maxFractionDigits: 1
    });

    function humanize(sValue) {
        if (!sValue) {
            return "";
        }

        return String(sValue)
            .toLowerCase()
            .split("_")
            .map(function (sPart) {
                return sPart.charAt(0).toUpperCase() + sPart.slice(1);
            })
            .join(" ");
    }

    function formatDate(sValue) {
        if (!sValue) {
            return "";
        }

        var oDate = oSourceDateFormat.parse(sValue);

        return oDate ? oDisplayDateFormat.format(oDate) : sValue;
    }

    // Risk level / severity are free text in the backend, so they are matched
    // by their first letters instead of exact values
    function levelOf(sValue) {
        var sUpper = String(sValue || "").toUpperCase();

        if (sUpper.indexOf("CRIT") === 0 || sUpper.indexOf("HIGH") === 0 || sUpper.indexOf("SEV") === 0) {
            return "HIGH";
        }

        if (sUpper.indexOf("MED") === 0 || sUpper.indexOf("MOD") === 0) {
            return "MEDIUM";
        }

        if (sUpper.indexOf("LOW") === 0 || sUpper.indexOf("MIN") === 0) {
            return "LOW";
        }

        return "";
    }

    return {

        statusText: function (sStatus) {
            return PO_STATUS[sStatus] ? PO_STATUS[sStatus].text : humanize(sStatus);
        },

        statusState: function (sStatus) {
            return PO_STATUS[sStatus] ? PO_STATUS[sStatus].state : "None";
        },

        itemStatusText: function (sStatus) {
            return ITEM_STATUS[sStatus] ? ITEM_STATUS[sStatus].text : humanize(sStatus);
        },

        itemStatusState: function (sStatus) {
            return ITEM_STATUS[sStatus] ? ITEM_STATUS[sStatus].state : "None";
        },

        // ---------- Invoices ----------

        invoiceStatusText: function (sStatus) {
            return INVOICE_STATUS[sStatus] ? INVOICE_STATUS[sStatus].text : humanize(sStatus);
        },

        invoiceStatusState: function (sStatus) {
            return INVOICE_STATUS[sStatus] ? INVOICE_STATUS[sStatus].state : "None";
        },

        // A draft invoice has no invoice number until the vendor completes it
        invoiceNumber: function (sNumber) {
            return sNumber ? sNumber : "Not assigned yet";
        },

        blockedText: function (bBlocked) {
            return bBlocked ? "Blocked" : "Not blocked";
        },

        blockedState: function (bBlocked) {
            return bBlocked ? "Error" : "Success";
        },

        mismatchText: function (bMismatch) {
            return bMismatch ? "Mismatch" : "No mismatch";
        },

        mismatchState: function (bMismatch) {
            return bMismatch ? "Warning" : "Success";
        },

        // Quantity without trailing zeros, or an empty string
        quantity: function (vValue) {
            if (vValue === null || vValue === undefined || vValue === "") {
                return "";
            }

            var fValue = Number(vValue);

            return isNaN(fValue) ? String(vValue) : oQuantityFormat.format(fValue);
        },

        // ---------- General ----------

        // Formatted date, or an empty string
        date: function (sValue) {
            return formatDate(sValue);
        },

        // Expected delivery date, with a readable fallback when it is not set
        deliveryDate: function (sValue) {
            return sValue ? formatDate(sValue) : "Not set";
        },

        // Amount with two decimals and grouping (currency is shown separately)
        amount: function (vValue) {
            if (vValue === null || vValue === undefined || vValue === "") {
                return "";
            }

            var fValue = Number(vValue);

            return isNaN(fValue) ? String(vValue) : oAmountFormat.format(fValue);
        },

        // ---------- Risk ----------

        // Free-text value shown as words, e.g. "OPEN_ITEM" -> "Open Item"
        label: function (sValue) {
            return humanize(sValue);
        },

        // Risk level or severity -> ObjectStatus state
        riskLevelState: function (sValue) {
            var sLevel = levelOf(sValue);

            return sLevel === "HIGH" ? "Error" :
                sLevel === "MEDIUM" ? "Warning" :
                    sLevel === "LOW" ? "Success" : "None";
        },

        // Risk level -> NumericContent colour
        riskValueColor: function (sValue) {
            var sLevel = levelOf(sValue);

            return sLevel === "HIGH" ? "Error" :
                sLevel === "MEDIUM" ? "Critical" :
                    sLevel === "LOW" ? "Good" : "Neutral";
        },

        // Score with one decimal, or a dash when there is none
        score: function (vValue) {
            if (vValue === null || vValue === undefined || vValue === "") {
                return "-";
            }

            var fValue = Number(vValue);

            return isNaN(fValue) ? String(vValue) : oScoreFormat.format(fValue);
        },

        percent: function (vValue) {
            if (vValue === null || vValue === undefined || vValue === "") {
                return "";
            }

            var fValue = Number(vValue);

            return isNaN(fValue) ? String(vValue) : oScoreFormat.format(fValue) + " %";
        },

        // Date and time of a DateTimeOffset value
        dateTime: function (sValue) {
            if (!sValue) {
                return "";
            }

            var oDate = new Date(sValue);

            return isNaN(oDate.getTime()) ? String(sValue) : oDateTimeFormat.format(oDate);
        },

        yesNo: function (bValue) {
            return bValue ? "Yes" : "No";
        },

        delayText: function (iDays) {
            return Number(iDays) > 0 ? iDays + " days late" : "On time";
        },

        delayState: function (iDays) {
            return Number(iDays) > 0 ? "Error" : "Success";
        },

        // Days until a certificate expires (negative = already expired)
        daysLeftText: function (iDays) {
            if (iDays === null || iDays === undefined) {
                return "No expiry date";
            }

            return iDays < 0
                ? "Expired " + Math.abs(iDays) + " days ago"
                : iDays + " days";
        },

        daysLeftState: function (iDays) {
            if (iDays === null || iDays === undefined) {
                return "None";
            }

            return iDays < 0 ? "Error" : iDays <= 30 ? "Warning" : "Success";
        }
    };
});