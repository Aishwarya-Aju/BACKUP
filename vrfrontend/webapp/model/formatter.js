
sap.ui.define([], function () {
    "use strict";

    // Recent tab: last 24 hours
    var RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

    // NEW badge and row highlight: 20 seconds
    var NEW_BADGE_WINDOW_MS = 20 * 1000;

    // Refresh clock every 250 milliseconds
    var NEW_BADGE_TICK_MS = 250;

    function toMillis(vValue) {
        if (vValue instanceof Date) {
            return vValue.getTime();
        }

        if (typeof vValue === "number") {
            return isFinite(vValue) ? vValue : NaN;
        }

        if (typeof vValue !== "string" || !vValue.trim()) {
            return NaN;
        }

        var sValue = vValue.trim();

        // Accept ISO timestamps, including fractional seconds.
        // Normalize fractional seconds to milliseconds.
        sValue = sValue.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$|$)/, "$1");

        var iMillis = Date.parse(sValue);

        return isFinite(iMillis) ? iMillis : NaN;
    }

    var oFormatter = {
        poStatusState: function (sStatus) {
            switch (sStatus) {
                case "DRAFT":
                    return "None";
                case "PENDING_APPROVAL":
                    return "Warning";
                case "APPROVED":
                    return "Success";
                case "REJECTED":
                    return "Error";
                case "SENT_TO_VENDOR":
                    return "Information";
                case "ACCEPTED":
                    return "Success";
                case "PARTIALLY_DELIVERED":
                    return "Warning";
                case "FULLY_DELIVERED":
                    return "Success";
                case "CANCELLED":
                    return "Error";
                case "CLOSED":
                    return "None";
                default:
                    return "None";
            }
        },

        riskLevelState: function (sRiskLevel) {
            switch (sRiskLevel) {
                case "Low":
                    return "Success";
                case "Medium":
                    return "Warning";
                case "High":
                    return "Error";
                default:
                    return "None";
            }
        },

        NEW_BADGE_WINDOW_MS: NEW_BADGE_WINDOW_MS,
        NEW_BADGE_TICK_MS: NEW_BADGE_TICK_MS,

        // Recent tab: independent 24-hour cutoff
        recentCutoff: function () {
            return new Date(
                Date.now() - RECENT_WINDOW_MS
            ).toISOString();
        },

        // NEW badge: show only while the PO is 0–20 seconds old
        isNew: function (vCreatedAt, vCurrentTime) {
            var iCreated = toMillis(vCreatedAt);
            var iNow = toMillis(vCurrentTime);

            if (!isFinite(iCreated) || !isFinite(iNow)) {
                return false;
            }

            var iAge = iNow - iCreated;

            return iAge >= 0 && iAge < NEW_BADGE_WINDOW_MS;
        },

        // Row highlight uses exactly the same 20-second rule
        newRowHighlight: function (vCreatedAt, vCurrentTime) {
            return oFormatter.isNew(vCreatedAt, vCurrentTime)
                ? "Information"
                : "None";
        }
    };

    return oFormatter;
});
