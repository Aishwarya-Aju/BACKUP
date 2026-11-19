sap.ui.define([
    "vrfrontend/model/deliveryFormatter"
], function (formatter) {
    "use strict";

    function todayStamp() {
        var oNow = new Date();
        var pad = function (n) { return String(n).padStart(2, "0"); };
        return oNow.getFullYear() + "-" + pad(oNow.getMonth() + 1) + "-" + pad(oNow.getDate());
    }

    /**
     * One row per delivery item (header data repeated), so item-level data is preserved.
     * A delivery without items still produces one row.
     */
    function buildRows(aDeliveries) {
        var aRows = [];
        aDeliveries.forEach(function (d) {
            var oBase = {
                deliveryId: d.ID,
                vendorName: d.vendorName,
                poNumber: d.poNumber,
                invoiceNumber: d.invoiceNumber,
                shipmentDate: formatter.parseDate(d.shipmentDate),
                expectedDate: formatter.parseDate(d.expectedDeliveryDate),
                actualDate: formatter.parseDate(d.actualDeliveryDate),
                overallPercentage: Number(d.deliveryPercentage) || 0,
                deliveryStatus: d.deliveryStatus,
                shipmentStatus: d.shipmentStatus,
                delayDays: Number(d.delayDays) || 0,
                remarks: d.remarks || ""
            };
            var aItems = d.items && d.items.length ? d.items : [null];
            aItems.forEach(function (it) {
                var oRow = Object.assign({}, oBase);
                if (it) {
                    var nAccepted = Number(it.acceptedQuantity) || 0;
                    var nCumulative = Number(it.cumulativeDeliveredQuantity) || 0;
                    oRow.materialCode = it.materialCode;
                    oRow.acceptedQuantity = nAccepted;
                    oRow.shipmentQuantity = Number(it.deliveredQuantity) || 0;
                    oRow.cumulativeQuantity = nCumulative;
                    oRow.remainingQuantity = Math.max(nAccepted - nCumulative, 0);
                    oRow.itemPercentage = Number(it.itemDeliveryPercentage) || 0;
                    oRow.itemStatus = it.itemStatus;
                }
                aRows.push(oRow);
            });
        });
        return aRows;
    }

    // EdmType is only needed for Excel; the CSV export reuses labels/properties only.
    function columns(EdmTypes) {
        var EdmType = EdmTypes || {};
        var date = function (label, property) {
            return { label: label, property: property, type: EdmType.Date, format: "dd mmm yyyy", utc: false, width: 14 };
        };
        var num = function (label, property, scale) {
            return { label: label, property: property, type: EdmType.Number, scale: scale, delimiter: true, width: 14 };
        };
        var text = function (label, property, width) {
            return { label: label, property: property, type: EdmType.String, width: width || 18 };
        };
        return [
            text("Delivery ID", "deliveryId", 38),
            text("Vendor", "vendorName", 26),
            text("PO Number", "poNumber"),
            text("Invoice Number", "invoiceNumber"),
            date("Shipment Date", "shipmentDate"),
            date("Expected Delivery Date", "expectedDate"),
            date("Actual Delivery Date", "actualDate"),
            text("Material Code", "materialCode"),
            num("Accepted Quantity", "acceptedQuantity", 3),
            num("Delivered This Shipment", "shipmentQuantity", 3),
            num("Cumulative Delivered", "cumulativeQuantity", 3),
            num("Remaining Quantity", "remainingQuantity", 3),
            num("Item Delivery %", "itemPercentage", 2),
            text("Item Status", "itemStatus"),
            num("Overall PO Delivery %", "overallPercentage", 2),
            text("Delivery Status", "deliveryStatus"),
            text("Shipment Status", "shipmentStatus"),
            num("Delay Days", "delayDays", 0),
            text("Remarks", "remarks", 40)
        ];
    }

    function csvCell(vValue) {
        if (vValue === null || vValue === undefined) { return ""; }
        var s = vValue instanceof Date ? formatter.date(
            vValue.getFullYear() + "-" + String(vValue.getMonth() + 1).padStart(2, "0") + "-" + String(vValue.getDate()).padStart(2, "0")
        ) : String(vValue);
        // Quote when the cell contains comma, quote, CR or LF; double inner quotes.
        return /[",\r\n]/.test(s) ? "\"" + s.replace(/"/g, "\"\"") + "\"" : s;
    }

    return {
        /** Exports the given deliveries as .xlsx using sap.ui.export.Spreadsheet. */
        exportExcel: function (aDeliveries) {
            return new Promise(function (resolve, reject) {
                sap.ui.require(["sap/ui/export/Spreadsheet", "sap/ui/export/library"], function (Spreadsheet, exportLibrary) {
                    var oSheet = new Spreadsheet({
                        workbook: {
                            columns: columns(exportLibrary.EdmType),
                            context: { title: "Delivery Report", sheetName: "Delivery Report" }
                        },
                        dataSource: buildRows(aDeliveries),
                        fileName: "Delivery_Report_" + todayStamp() + ".xlsx"
                    });
                    oSheet.build()
                        .then(resolve)
                        .catch(reject)
                        .finally(function () { oSheet.destroy(); });
                }, reject);
            });
        },

        /** Exports the same report as UTF-8 CSV (with BOM so Excel reads special characters). */
        exportCsv: function (aDeliveries) {
            var aCols = columns();
            var aLines = [aCols.map(function (c) { return csvCell(c.label); }).join(",")];
            buildRows(aDeliveries).forEach(function (oRow) {
                aLines.push(aCols.map(function (c) { return csvCell(oRow[c.property]); }).join(","));
            });

            var oBlob = new Blob(["\uFEFF" + aLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
            var sUrl = URL.createObjectURL(oBlob);
            var oLink = document.createElement("a");
            oLink.href = sUrl;
            oLink.download = "Delivery_Report_" + todayStamp() + ".csv";
            oLink.click();
            URL.revokeObjectURL(sUrl);
        }
    };
});
