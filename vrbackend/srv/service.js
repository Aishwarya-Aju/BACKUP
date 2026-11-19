/* ===========================================================================
 * VENDOR RISK AND PROCUREMENT CONTROL TOWER  -  srv/service.js
 * ===========================================================================
 *
 * FILE MAP (search for the part number to jump to a section)
 *
 *   PART 1  Imports and SAP Alert Notification helpers
 *   PART 2  Service start, entities, common helpers, dashboard counts
 *   PART 3  Procurement team  - Purchase Order create / approve / reject / send
 *   PART 4  Vendor team       - vendorAccept / vendorReject
 *   PART 5  Invoice           - date check, CREATE, updateInvoice
 *   PART 6  Delivery team     - delivery details, Deliveries, DeliveryItems
 *   PART 7  Risk calculation  - config, data loader, Delivery / Quality / Price risk
 *   PART 8  Risk actions      - Delivery, Quality, Price and Overall vendor risk
 *   PART 9  Vendor block action and daily high-risk alert job
 *   PART 10 OLD CODE kept as comments (not active, for reference only)
 *
 * ========================================================================= */


// ===========================================================================
// PART 1  -  IMPORTS AND SAP ALERT NOTIFICATION HELPERS
// ===========================================================================


const cds = require('@sap/cds');
const { path } = require('@sap/cds/lib/compile/parse');
// const nodemailer = require("nodemailer");
//import cds, { requires } from "@sap/cds";

const {
    AlertNotificationClient,
    OAuthAuthentication,
    RegionUtils,
    Severity,
    Category
} = require('@sap_oss/alert-notification-client');

let ansClient;

// Creates the Alert Notification client once and re-uses it
function getAnsClient() {
    if (ansClient) {
        return ansClient;
    }

    const vcapServices = JSON.parse(
        process.env.VCAP_SERVICES || '{}'
    );

    const ansService = vcapServices['alert-notification']?.[0];
    const credentials = ansService?.credentials;

    if (
        !credentials?.client_id ||
        !credentials?.client_secret ||
        !credentials?.oauth_url
    ) {
        throw new Error(
            'Alert Notification service credentials are missing'
        );
    }

    const authentication = new OAuthAuthentication({
        username: credentials.client_id,
        password: credentials.client_secret,
        oAuthTokenUrl: credentials.oauth_url.split('?')[0]
    });

    ansClient = new AlertNotificationClient({
        authentication,
        region: RegionUtils.US10
    });

    return ansClient;
}

// Notification: vendor accepted a purchase order
async function publishVendorAcceptedEvent({
    poId,
    vendorId,
    expectedDeliveryDate
}) {
    const client = getAnsClient();

    return client.sendEvent({
        eventType: 'VendorPurchaseOrderAccepted',
        subject: 'Vendor Purchase Order Accepted',
        body:
            `Purchase order ${poId} was accepted by vendor ${vendorId}. ` +
            `Expected delivery date: ${expectedDeliveryDate}.`,
        severity: Severity.INFO,
        category: Category.NOTIFICATION,
        resource: {
            resourceName: 'Vendor Risk and Procurement Control Tower',
            resourceType: 'application',
            resourceInstance: String(poId)
        }
    });
}

// Alert: vendor is high risk
async function publishVendorHighEvent({
    vendorID,
    vendorName,
    currentRiskScore,
    deliveryRiskScore,
    qualityRiskScore,
    priceRiskScore,
    riskLevel
}) {
    const client = getAnsClient();
    console.log("Sending vendor risk details:", {
        vendorID,
        vendorName,
        currentRiskScore,
        deliveryRiskScore,
        qualityRiskScore,
        priceRiskScore,
        riskLevel
    });

    return client.sendEvent({
        eventType: 'VendorHighRisk',
        subject: `Vendor High Risk Alert - ${vendorName}`,
        body: `Vendor ${vendorName} has been identified as ${riskLevel}.`,
        severity: Severity.WARNING,
        category: Category.ALERT,
        tags: {
            vendorName: String(vendorName),
            // vendorId: String(vendorID),
            currentRiskScore: String(currentRiskScore),
            deliveryRiskScore: String(deliveryRiskScore),
            qualityRiskScore: String(qualityRiskScore),
            priceRiskScore: String(priceRiskScore),
            riskLevel: String(riskLevel)
        },
        resource: {
            resourceName: 'Vendor Risk and Procurement Control Tower',
            resourceType: 'application',
            resourceInstance: String(vendorID)
        }
    });
}


module.exports = cds.service.impl(async function () {
    const bpa = await cds.connect.to("bpa");
    const { Vendors, PurchaseOrders, PurchaseOrderItems, Materials, Invoices, InvoiceItems, Deliveries, DeliveryItems, QualityComplaints, RiskAssessments,InvoiceNumberSequences } = this.entities;

    // -----------------------------------------------------------------------
    // Invoice number generator  (INV-<year>-<running number>)
    // -----------------------------------------------------------------------
    async function generateInvoiceNumber(tx) {
        const currentYear = new Date().getFullYear();

        // Lock the sequence row so concurrent requests
        // cannot generate the same invoice number.
        const sequence = await tx.run(
            SELECT.one
                .from(InvoiceNumberSequences)
                .where({ sequenceName: 'INVOICE' })
                .forUpdate()
        );

        if (!sequence) {
            throw new Error(
                'Invoice number sequence is missing. ' +
                'Add the INVOICE record to InvoiceNumberSequences.'
            );
        }

        // Start again from 1 when the calendar year changes.
        const nextNumber =
            Number(sequence.currentYear) === currentYear
                ? Number(sequence.lastNumber) + 1
                : 1;

        // Save the latest number in the database.
        await tx.run(
            UPDATE(InvoiceNumberSequences)
                .set({
                    currentYear: currentYear,
                    lastNumber: nextNumber
                })
                .where({ sequenceName: 'INVOICE' })
        );

        return `INV-${currentYear}-${String(nextNumber).padStart(4, '0')}`;
    }

    // -----------------------------------------------------------------------
    // Dashboard counts
    // -----------------------------------------------------------------------
    this.on("totalVendor", async (req) => {
        const result = await cds.run(SELECT.one
            .from(Vendors)
            .columns("count(*) as count"));
        return Number(result.count);
    })
    this.on("totalPO", async (req) => {
        const result = await cds.run(SELECT.one
            .from(PurchaseOrders)
            .columns("count(*) as count"));
        return Number(result.count);
    })
    this.on("totalInvoice", async (req) => {
        const result = await cds.run(SELECT.one
            .from(Invoices)
            .columns("count(*) as count"));
        return Number(result.count);
    })


    // ===========================================================================
    // PART 3  -  PROCUREMENT TEAM: PURCHASE ORDER
    // ===========================================================================

    // Create: generate PO number (PONO001...), PO date, status PENDING_APPROVAL
    this.before('CREATE', PurchaseOrders, async (req) => {
        const data = req.data;
        const tx = cds.tx(req);

        // Fetch existing PO numbers from the database
        const aPOs = await tx.run(
            SELECT.from(PurchaseOrders).columns("poNumber")
        );

        // Find the greatest numeric PO number
        let iMaxNumber = 0;

        for (const oPO of aPOs) {
            const oMatch = oPO.poNumber?.match(/^PONO(\d+)$/i);

            if (oMatch) {
                const iNumber = Number(oMatch[1]);

                if (Number.isSafeInteger(iNumber) && iNumber > iMaxNumber) {
                    iMaxNumber = iNumber;
                }
            }
        }

        // Increment the greatest number by 1
        data.poNumber =
            `PONO${String(iMaxNumber + 1).padStart(3, "0")}`;


        // PO Date
        data.poDate = new Date();

        if (!data.vendor_ID) {
            return req.error(400, 'Please select a vendor to create the Purchase Order')
        }
        if (!data.buyer_ID) {
            return req.error(400, 'Please select your employee name to create the Purchase Order')
        }
        data.poStatus = 'PENDING_APPROVAL';
    })

    // Approve a pending purchase order
    this.on('poAccept', PurchaseOrders, async (req) => {
        const { ID } = req.params[0];
        const po = await SELECT.one.from(PurchaseOrders).where({ ID });
        if (!po) {
            return req.error(404, "Purchase Order not found");
        }
        if (po.poStatus !== "PENDING_APPROVAL") {
            return req.error(400, 'Only pending approvals can be accepted');
        }
        await UPDATE(PurchaseOrders).set({ poStatus: "APPROVED" }).where({ ID });
        return SELECT.one.from(PurchaseOrders).where({ ID });
    })

    // Reject a pending purchase order
    this.on('poReject', PurchaseOrders, async (req) => {
        const { ID } = req.params[0];
        const po = await SELECT.one.from(PurchaseOrders).where({ ID });
        if (!po) {
            return req.error(404, "Purchase Order not found");
        }
        if (po.poStatus !== "PENDING_APPROVAL") {
            return req.error(400, "Only pending purchase order can be rejected");
        }
        await UPDATE(PurchaseOrders).set({ poStatus: "REJECTED" }).where({ ID });
        return SELECT.one.from(PurchaseOrders).where({ ID });
    })

    // Send an approved purchase order to the vendor
    this.on('poSentVendor', PurchaseOrders, async (req) => {
        const { ID } = req.params[0];
        const po = await SELECT.one.from(PurchaseOrders).where({ ID });
        if (!po) {
            return req.error(404, "Purchase Order not found");
        }
        if (po.poStatus !== "APPROVED") {
            return req.error(400, 'Only approvals can sent to vendor');
        }
        await UPDATE(PurchaseOrders).set({ poStatus: "SENT_TO_VENDOR" }).where({ ID });
        return SELECT.one.from(PurchaseOrders).where({ ID });
    })


    // ===========================================================================
    // PART 4  -  VENDOR TEAM: ACCEPT / REJECT PURCHASE ORDER
    // ===========================================================================

    // -----------------------------------------------------------------------
    // Vendor accepts the PO: validates the delivery date (max 5 days after the
    // original date), creates the DRAFT invoice and confirms the PO items.
    // -----------------------------------------------------------------------
    this.on('vendorAccept', PurchaseOrders, async (req) => {
        const { ID } = req.params[0];
        const { expectedDeliveryDate } = req.data;
        const tx = cds.tx(req);

        // 1. Validate the date supplied by the vendor
        if (!expectedDeliveryDate) {
            return req.reject(
                400,
                'Please provide the expected delivery date'
            );
        }

        const dateString = String(expectedDeliveryDate);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return req.reject(400, 'Invalid delivery date format');
        }

        const vendorDate = new Date(`${dateString}T00:00:00Z`);

        if (
            Number.isNaN(vendorDate.getTime()) ||
            vendorDate.toISOString().slice(0, 10) !== dateString
        ) {
            return req.reject(400, 'Please provide a valid delivery date');
        }

        // 2. Read the Purchase Order
        const po = await tx.run(
            SELECT.one.from(PurchaseOrders).where({ ID })
        );

        if (!po) {
            return req.reject(404, 'Purchase Order not found');
        }

        if (po.poStatus !== 'SENT_TO_VENDOR') {
            return req.reject(
                400,
                'Only purchase orders sent to the vendor can be accepted'
            );
        }

        // 3. Validate against the original PO expected delivery date
        if (!po.expectedDeliveryDate) {
            return req.reject(
                400,
                'The purchase order has no original expected delivery date'
            );
        }

        const originalDateString =
            String(po.expectedDeliveryDate).slice(0, 10);

        const originalDate = new Date(
            `${originalDateString}T00:00:00Z`
        );

        if (
            Number.isNaN(originalDate.getTime()) ||
            originalDate.toISOString().slice(0, 10) !== originalDateString
        ) {
            return req.reject(
                400,
                'The original purchase order delivery date is invalid'
            );
        }

        const latestAllowedDate = new Date(originalDate);
        latestAllowedDate.setUTCDate(
            latestAllowedDate.getUTCDate() + 5
        );

        const latestAllowedDateString =
            latestAllowedDate.toISOString().slice(0, 10);

        if (dateString < originalDateString) {
            return req.reject(
                400,
                `Expected delivery date cannot be before ${originalDateString}`
            );
        }

        if (dateString > latestAllowedDateString) {
            return req.reject(
                400,
                `Expected delivery date cannot be later than ${latestAllowedDateString}`
            );
        }

        // 4. Prevent duplicate invoices for this PO
        const existingInvoice = await tx.run(
            SELECT.one.from(Invoices)
                .columns('ID')
                .where({ purchaseOrder_ID: ID })
        );

        if (existingInvoice) {
            return req.reject(
                409,
                'An invoice already exists for this purchase order'
            );
        }

        // 5. Generate the invoice number and create the Draft Invoice
        const invoiceNumber = await generateInvoiceNumber(tx);

        await tx.run(
            INSERT.into(Invoices).entries({
                ID: cds.utils.uuid(),
                invoiceNumber: invoiceNumber,
                vendor_ID: po.vendor_ID,
                purchaseOrder_ID: ID,
                expectedDeliveryDate: dateString,
                invoiceStatus: 'DRAFT',
                blocked: false,
                mismatch: false,
                currency: po.currency
            })
        );

        // 6. Accept the PO without changing its original date
        await tx.run(
            UPDATE(PurchaseOrders)
                .set({ poStatus: 'ACCEPTED' })
                .where({ ID })
        );

        // 7. Confirm all items belonging to this PO
        await tx.run(
            UPDATE(PurchaseOrderItems)
                .set({ itemStatus: 'CONFIRMED' })
                .where({ purchaseOrder_ID: ID })
        );

        // 8. Return the updated PO
        const updatedPO = await tx.run(
            SELECT.one.from(PurchaseOrders).where({ ID })
        );

        req.on('succeeded', async () => {
            try {
                await publishVendorAcceptedEvent({
                    poId: updatedPO.poNumber || ID,
                    vendorId: po.vendor_ID,
                    expectedDeliveryDate: dateString
                });

                console.log(
                    `[ANS] Vendor acceptance event sent for PO ${ID}`
                );
            } catch (error) {
                console.error(
                    '[ANS] Failed to publish vendor acceptance event:',
                    error.message
                );
            }
        });

        return updatedPO;
    });


    // -----------------------------------------------------------------------
    // Vendor rejects the PO with a reason
    // -----------------------------------------------------------------------
    this.on('vendorReject', PurchaseOrders, async (req) => {
        const { ID } = req.params[0];
        const { reason } = req.data;
        const tx = cds.tx(req);

        // 1. Validate rejection reason
        const rejectionReason = String(reason || '').trim();

        if (!rejectionReason) {
            return req.reject(
                400,
                'Please provide a reason for rejecting the purchase order'
            );
        }

        if (rejectionReason.length > 500) {
            return req.reject(
                400,
                'Rejection reason cannot exceed 500 characters'
            );
        }

        // 2. Load the Purchase Order
        const po = await tx.run(
            SELECT.one.from(PurchaseOrders).where({ ID })
        );

        if (!po) {
            return req.reject(404, 'Purchase Order not found');
        }

        // 3. Only a PO sent to the vendor can be rejected
        if (po.poStatus !== 'SENT_TO_VENDOR') {
            return req.reject(
                400,
                'Only purchase orders sent to the vendor can be rejected'
            );
        }

        // 4. Reject the PO and save the reason
        await tx.run(
            UPDATE(PurchaseOrders)
                .set({
                    poStatus: 'REJECTED',
                    rejectionReason: rejectionReason
                })
                .where({ ID })
        );

        // 5. Mark all items belonging to this PO as rejected
        await tx.run(
            UPDATE(PurchaseOrderItems)
                .set({ itemStatus: 'REJECTED' })
                .where({ purchaseOrder_ID: ID })
        );

        // 6. Return the updated Purchase Order
        return await tx.run(
            SELECT.one.from(PurchaseOrders).where({ ID })
        );
    });


    // ===========================================================================
    // PART 5  -  INVOICE (vendor team)
    // ===========================================================================

    // -----------------------------------------------------------------------
    // Returns an error text, or null when the delivery date is valid.
    // Rule: a real yyyy-MM-dd date (it is not compared with the invoice date).
    // -----------------------------------------------------------------------
    function checkDeliveryDate(deliveryDate) {
        const s = String(deliveryDate || '');

        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            return 'Delivery date is required';
        }

        const parsed = new Date(s + 'T00:00:00Z');

        if (
            Number.isNaN(parsed.getTime()) ||
            parsed.toISOString().slice(0, 10) !== s
        ) {
            return 'Please provide a valid delivery date';
        }

        // Do not compare delivery date with invoice date.
        return null;
    }


    // -----------------------------------------------------------------------
    // Create invoice: validates and sets vendor, currency, number and status
    // -----------------------------------------------------------------------
    this.before('CREATE', Invoices, async (req) => {
        const data = req.data;
        const tx = cds.tx(req);

        // Validate purchase order
        if (!data.purchaseOrder_ID) {
            return req.reject(400, 'Purchase order is required');
        }

        const po = await tx.run(
            SELECT.one
                .from(PurchaseOrders)
                .where({ ID: data.purchaseOrder_ID })
        );

        if (!po) {
            return req.reject(404, 'Purchase order not found');
        }

        // Validate invoice date
        const invoiceDate = String(data.invoiceDate || '');

        if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
            return req.reject(400, 'A valid invoice date is required');
        }

        const parsedInvoiceDate = new Date(invoiceDate + 'T00:00:00Z');

        if (
            Number.isNaN(parsedInvoiceDate.getTime()) ||
            parsedInvoiceDate.toISOString().slice(0, 10) !== invoiceDate
        ) {
            return req.reject(400, 'Please provide a valid invoice date');
        }

        // Validate delivery date without comparing it to invoice date
        const deliveryDateError = checkDeliveryDate(data.deliveryDate);

        if (deliveryDateError) {
            return req.reject(400, deliveryDateError);
        }

        // Ensure only one invoice exists for each purchase order
        const existingInvoice = await tx.run(
            SELECT.one
                .from(Invoices)
                .where({ purchaseOrder_ID: data.purchaseOrder_ID })
        );

        if (existingInvoice) {
            return req.reject(
                409,
                'An invoice already exists for this purchase order'
            );
        }

        // Generate invoice number on the backend
        data.invoiceNumber = await generateInvoiceNumber(tx);

        // Use the purchase order's vendor and currency
        data.vendor_ID = po.vendor_ID;
        data.currency = data.currency || po.currency;

        // Validate invoice items
        if (!Array.isArray(data.items) || data.items.length === 0) {
            return req.reject(400, 'At least one invoice item is required');
        }

        // Set initial invoice status
        data.invoiceStatus = 'SUBMITTED';
        data.blocked = false;
        data.mismatch = false;
    });


    // -----------------------------------------------------------------------
    // Update / submit a DRAFT or SUBMITTED invoice (items, dates, vendor rate)
    // -----------------------------------------------------------------------

    this.on('updateInvoice', Invoices, async (req) => {
        const { ID } = req.params[0];
        const {  invoiceDate, items, deliveryDate } = req.data;

        const tx = cds.tx(req);

        // 1. Load the existing invoice
        const invoice = await tx.run(
            SELECT.one.from(Invoices).where({ ID })
        );

        if (!invoice) {
            return req.reject(404, 'Invoice not found');
        }

        // 2. Allow draft invoices to be submitted
        //    and submitted invoices to be edited
        if (
            invoice.invoiceStatus !== 'DRAFT' &&
            invoice.invoiceStatus !== 'SUBMITTED'
        ) {
            return req.reject(
                400,
                'Only draft or submitted invoices can be updated'
            );
        }

        // 3. Preserve the invoice number generated by the backend.
        // Generate one only for an older draft that has no number.
        const cleanInvoiceNumber =
            invoice.invoiceNumber ||
            await generateInvoiceNumber(tx);

        // Ensure the invoice number is unique for this vendor.
        const duplicate = await tx.run(
            SELECT.one.from(Invoices).where({
                invoiceNumber: cleanInvoiceNumber,
                vendor_ID: invoice.vendor_ID
            })
        );

        if (duplicate && duplicate.ID !== ID) {
            return req.reject(
                409,
                'Invoice number conflict. Please try again.'
            );
        }

        // 4. Validate invoice date
        const dateString = String(invoiceDate || '');

        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
            return req.reject(
                400,
                'Please provide a valid invoice date'
            );
        }

        const parsedDate = new Date(dateString + 'T00:00:00Z');

        if (
            Number.isNaN(parsedDate.getTime()) ||
            parsedDate.toISOString().slice(0, 10) !== dateString
        ) {
            return req.reject(
                400,
                'Please provide a valid invoice date'
            );
        }

        // 5. Validate delivery date
        // Delivery date must be valid and cannot be earlier
        // than the invoice date.
        const deliveryError = checkDeliveryDate(
            deliveryDate,
            dateString
        );

        if (deliveryError) {
            return req.reject(400, deliveryError);
        }

        // 6. Validate invoice items
        if (!Array.isArray(items) || items.length === 0) {
            return req.reject(
                400,
                'Add at least one invoice item'
            );
        }

        const seenItems = new Set();
        const updatedItems = [];
        let invoiceTotal = 0;

        for (const line of items) {
            const poItemId = line.purchaseOrderItem_ID;
            const quantity = Number(line.quantity);

            if (!poItemId) {
                return req.reject(
                    400,
                    'Each invoice item must reference a purchase order item'
                );
            }

            if (seenItems.has(poItemId)) {
                return req.reject(
                    400,
                    'The same purchase order item cannot appear twice'
                );
            }

            seenItems.add(poItemId);

            if (!Number.isFinite(quantity) || quantity <= 0) {
                return req.reject(
                    400,
                    'Invoice quantity must be greater than zero'
                );
            }

            // Ensure the purchase order item belongs to this invoice's PO
            const poItem = await tx.run(
                SELECT.one.from(PurchaseOrderItems).where({
                    ID: poItemId,
                    purchaseOrder_ID: invoice.purchaseOrder_ID
                })
            );

            if (!poItem) {
                return req.reject(
                    400,
                    'An invoice item does not belong to this invoice purchase order'
                );
            }

            // Get quantities already invoiced on other invoices
            const existingLines = await tx.run(
                SELECT.from(InvoiceItems)
                    .columns('quantity', 'invoice_ID')
                    .where({ purchaseOrderItem_ID: poItemId })
            );

            const invoicedElsewhere = existingLines
                .filter(item => item.invoice_ID !== ID)
                .reduce(
                    (sum, item) => sum + Number(item.quantity || 0),
                    0
                );

            // Prevent invoicing more than the ordered quantity
            if (
                invoicedElsewhere + quantity >
                Number(poItem.orderedQuantity)
            ) {
                return req.reject(
                    400,
                    `Invoice quantity exceeds the remaining quantity for ${poItem.materialCode}`
                );
            }

            // Use the material rate entered by the vendor.
            const unitPrice = Number(line.unitPrice);

            if (
                line.unitPrice === undefined ||
                line.unitPrice === null ||
                line.unitPrice === '' ||
                !Number.isFinite(unitPrice) ||
                unitPrice <= 0
            ) {
                return req.reject(
                    400,
                    `Please enter a valid material rate for ${poItem.materialCode}`
                );
            }

            const lineAmount = Number(
                (quantity * unitPrice).toFixed(2)
            );

            invoiceTotal += lineAmount;

            updatedItems.push({
                invoice_ID: ID,
                purchaseOrderItem_ID: poItem.ID,
                materialCode: poItem.materialCode,
                materialDescription: poItem.materialDescription,
                quantity,
                unit: poItem.unit,
                unitPrice,
                lineAmount,
                currency: poItem.currency || invoice.currency
            });
        }

        invoiceTotal = Number(invoiceTotal.toFixed(2));

        // 7. Recalculate legacy price-risk fields
        const firstItem = await tx.run(
            SELECT.one.from(PurchaseOrderItems).where({
                ID: updatedItems[0].purchaseOrderItem_ID
            })
        );

        const oldPrice = Number(firstItem.oldUnitPrice || 0);
        const currentPrice = Number(updatedItems[0].unitPrice);

        const priceDifference = Number(
            (currentPrice - oldPrice).toFixed(2)
        );

        const priceDeviationPercent = oldPrice > 0
            ? Number(
                ((priceDifference / oldPrice) * 100).toFixed(2)
            )
            : 0;

        // 8. Replace invoice items
        await tx.run(
            DELETE.from(InvoiceItems).where({ invoice_ID: ID })
        );

        await tx.run(
            INSERT.into(InvoiceItems).entries(updatedItems)
        );

        // 9. Update invoice header and submit the invoice
        await tx.run(
            UPDATE(Invoices)
                .set({
                    invoiceNumber: cleanInvoiceNumber,
                    invoiceDate: dateString,
                    deliveryDate: String(deliveryDate),
                    invoiceAmount: invoiceTotal,
                    materialCode: firstItem.materialCode,
                    quantity: updatedItems[0].quantity,
                    oldPrice,
                    currentPrice,
                    priceDifference,
                    priceDeviationPercent,

                    // Draft becomes submitted after successful completion
                    invoiceStatus: 'SUBMITTED'
                })
                .where({ ID })
        );

        // 10. Return the updated invoice
        return await tx.run(
            SELECT.one.from(Invoices).where({ ID })
        );
    });


    // ===========================================================================
    // PART 6  -  DELIVERY TEAM
    //   6.1 Helpers and getDeliveryDetails (data for the New Delivery form)
    //   6.2 Deliveries  - CREATE / UPDATE / DELETE rules
    //   6.3 DeliveryItems - quantity rules
    //   6.4 Progress calculation and recalculation of the whole Purchase Order
    //   One delivery record per Purchase Order; items follow the invoice items.
    // ===========================================================================


    // Validates vendor + PO, then returns the PO, its single invoice and the invoice items
    async function loadDeliveryContext(req, tx, vendorID, purchaseOrderID) {
        if (!vendorID) return req.reject(400, 'Vendor is required');
        if (!purchaseOrderID) return req.reject(400, 'Purchase Order is required');

        const po = await tx.run(SELECT.one.from(PurchaseOrders).where({ ID: purchaseOrderID }));
        if (!po) return req.reject(404, 'Purchase Order not found');

        if (String(po.vendor_ID).toLowerCase() !== String(vendorID).toLowerCase()) {
            return req.reject(400, 'The selected vendor does not belong to this Purchase Order');
        }

        const invoice = await tx.run(SELECT.one.from(Invoices).where({ purchaseOrder_ID: po.ID }));
        if (!invoice) return req.reject(400, `No invoice found for Purchase Order ${po.poNumber}`);
        if (!invoice.deliveryDate) return req.reject(400, 'The invoice has no delivery date');

        const invoiceItems = await tx.run(SELECT.from(InvoiceItems).where({ invoice_ID: invoice.ID }));
        if (!invoiceItems.length) return req.reject(400, 'The invoice has no items');

        return { po, invoice, invoiceItems };
    }

    // Total delivered so far per invoice item, across ALL delivery records
    async function getDeliveredTotals(tx, invoiceItemIDs) {
        const rows = await tx.run(
            SELECT.from(DeliveryItems)
                .columns('invoiceItem_ID', 'deliveredQuantity')
                .where({ invoiceItem_ID: { in: invoiceItemIDs } })
        );
        const totals = new Map();
        for (const r of rows) {
            totals.set(r.invoiceItem_ID, (totals.get(r.invoiceItem_ID) || 0) + (Number(r.deliveredQuantity) || 0));
        }
        return totals;
    }

    function getKey(req) {
        const last = req.params?.at(-1);
        return req.data.ID ?? last?.ID ?? last;
    }


    // Step 3-4 of the form: shows invoice, items, accepted qty, delivered so far
    this.on('getDeliveryDetails', async (req) => {
        const tx = cds.tx(req);
        const { vendorID, purchaseOrderID } = req.data;
        const { po, invoice, invoiceItems } =
            await loadDeliveryContext(req, tx, vendorID, purchaseOrderID);
        const delivered = await getDeliveredTotals(tx, invoiceItems.map(i => i.ID));

        const poItemIDs = invoiceItems.map(i => i.purchaseOrderItem_ID).filter(Boolean);
        const poItems = poItemIDs.length
            ? await tx.run(SELECT.from(PurchaseOrderItems).columns('ID', 'orderedQuantity').where({ ID: { in: poItemIDs } }))
            : [];
        const orderedByItem = new Map(poItems.map(p => [p.ID, Number(p.orderedQuantity) || 0]));

        return {
            purchaseOrderID: po.ID,
            poNumber: po.poNumber,
            invoiceID: invoice.ID,
            invoiceNumber: invoice.invoiceNumber,
            expectedDeliveryDate: invoice.deliveryDate,
            items: invoiceItems.map(i => {
                const accepted = Number(i.quantity) || 0;
                const done = delivered.get(i.ID) || 0;
                return {
                    invoiceItemID: i.ID,
                    materialCode: i.materialCode,
                    materialDescription: i.materialDescription,
                    unit: i.unit,
                    acceptedQuantity: accepted,
                    orderedQuantity: orderedByItem.get(i.purchaseOrderItem_ID) ?? 0,
                    deliveredSoFar: done,
                    remainingQuantity: Math.max(accepted - done, 0)
                };
            })
        };
    });


    const SHIPMENT_STATUSES = ['Not Shipped', 'In Transit', 'Partially Delivered', 'Delivered', 'Cancelled'];

    this.before('CREATE', 'Deliveries', async (req) => {
        const tx = cds.tx(req);
        const data = req.data;

        const { po, invoice, invoiceItems } =
            await loadDeliveryContext(req, tx, data.vendor_ID, data.purchaseOrder_ID);

        const existingDelivery = await tx.run(
            SELECT.one.from(Deliveries).columns('ID').where({ purchaseOrder_ID: po.ID })
        );
        if (existingDelivery) {
            return req.reject(409, `A delivery already exists for Purchase Order ${po.poNumber}. Please edit the existing delivery.`);
        }

        data.shipmentStatus = data.shipmentStatus || 'Not Shipped';
        if (!SHIPMENT_STATUSES.includes(data.shipmentStatus)) {
            return req.reject(400, `Shipment status must be one of: ${SHIPMENT_STATUSES.join(', ')}`);
        }

        // Quantities typed by the delivery team: invoiceItem_ID -> quantity
        const typed = new Map();
        for (const line of data.items || []) {
            if (!invoiceItems.some(i => i.ID === line.invoiceItem_ID)) {
                return req.reject(400, 'An item does not belong to the invoice of this Purchase Order');
            }
            if (typed.has(line.invoiceItem_ID)) {
                return req.reject(400, 'The same invoice item cannot appear twice');
            }
            typed.set(line.invoiceItem_ID, line.deliveredQuantity);
        }

        const alreadyDelivered = await getDeliveredTotals(tx, invoiceItems.map(i => i.ID));

        // One delivery item for EVERY invoice item (0 if the team typed nothing)
        const items = [];
        for (const inv of invoiceItems) {
            const qty = Number(typed.get(inv.ID) ?? 0);
            const accepted = Number(inv.quantity) || 0;
            const error = checkQuantity(qty, accepted, alreadyDelivered.get(inv.ID) || 0, inv.materialCode);
            if (error) return req.reject(400, error);

            items.push({
                ID: cds.utils.uuid(),
                invoiceItem_ID: inv.ID,
                materialCode: inv.materialCode,
                acceptedQuantity: accepted,
                deliveredQuantity: qty
            });
        }

        // Header: system-controlled values (anything the client sent is overwritten)
        data.ID = cds.utils.uuid();
        data.vendor_ID = po.vendor_ID;
        data.purchaseOrder_ID = po.ID;
        data.expectedDeliveryDate = invoice.deliveryDate;
        data.shipmentDate = new Date().toISOString().slice(0, 10);   // record creation date only
        data.actualDeliveryDate = null;
        data.deliveryStatus = 'Pending';
        data.delayDays = 0;
        data.partialDelivery = false;
        data.deliveryPercentage = 0;
        data.items = items;
    });

    this.before('UPDATE', 'Deliveries', async (req) => {
        const existing = await cds.tx(req).run(
            SELECT.one.from(Deliveries).where({ ID: getKey(req) })
        );
        if (!existing) return req.reject(404, 'Delivery not found');

        if (req.data.items) {
            return req.reject(400, 'Update delivered quantities through DeliveryItems');
        }
        if (req.data.shipmentStatus !== undefined && !SHIPMENT_STATUSES.includes(req.data.shipmentStatus)) {
            return req.reject(400, `Shipment status must be one of: ${SHIPMENT_STATUSES.join(', ')}`);
        }

        // The team may change only shipmentStatus and remarks.
        // Everything else is removed from the request, so the database values stay untouched.
        for (const f of ['vendor_ID', 'purchaseOrder_ID', 'shipmentDate', 'expectedDeliveryDate',
            'actualDeliveryDate', 'deliveryStatus', 'delayDays', 'partialDelivery',
            'deliveryPercentage', 'deliveryRiskScore', 'deliveryRiskLevel']) {
            delete req.data[f];
        }
    });

    function checkQuantity(qty, accepted, alreadyDelivered, material) {
        if (!Number.isFinite(qty)) return `Delivered quantity for ${material} must be a number`;
        if (qty < 0) return `Delivered quantity for ${material} cannot be negative`;
        if (Number((alreadyDelivered + qty).toFixed(3)) > accepted) {
            return `Delivered quantity for ${material} exceeds the remaining accepted quantity (${accepted - alreadyDelivered})`;
        }
        return null;
    }

    this.before('CREATE', 'DeliveryItems', (req) =>
        req.reject(400, 'Delivery items are created automatically with the delivery'));

    this.before('UPDATE', 'DeliveryItems', async (req) => {
        const tx = cds.tx(req);
        const existing = await tx.run(SELECT.one.from(DeliveryItems).where({ ID: getKey(req) }));
        if (!existing) return req.reject(404, 'Delivery item not found');

        const oldQty = Number(existing.deliveredQuantity) || 0;
        const newQty = req.data.deliveredQuantity === undefined
            ? oldQty
            : Number(req.data.deliveredQuantity);

        // Cumulative of OTHER records = total - this record's old quantity (no double counting)
        const totals = await getDeliveredTotals(tx, [existing.invoiceItem_ID]);
        const others = (totals.get(existing.invoiceItem_ID) || 0) - oldQty;

        const error = checkQuantity(newQty, Number(existing.acceptedQuantity), others, existing.materialCode);
        if (error) return req.reject(400, error);

        for (const f of ['delivery_ID', 'invoiceItem_ID', 'materialCode', 'acceptedQuantity',
            'cumulativeDeliveredQuantity', 'itemDeliveryPercentage', 'partialDelivery',
            'itemStatus', 'itemDelayDays', 'completionDate']) {
            delete req.data[f];
        }
    });

    // Whole calendar days since 1970 (UTC). Time portion is ignored.
    function toDayNumber(value) {
        if (!value) return null;
        const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
    }

    // accepted/delivered are cumulative quantities (one item, or the sum of all items of the order)
    function calculateProgress({ accepted, delivered, expectedDate, completionDate }) {
        const a = Number(accepted) > 0 ? Number(accepted) : 0;
        const d = Number(delivered) > 0 ? Number(delivered) : 0;

        const percentage = a > 0 ? Number(Math.min((d / a) * 100, 100).toFixed(2)) : 0;
        const completed = a > 0 && d >= a;
        const partial = d > 0 && d < a;

        const expected = toDayNumber(expectedDate);
        const today = toDayNumber(new Date());
        let delayDays = 0;
        let status;

        if (completed) {
            const done = toDayNumber(completionDate) ?? today;
            delayDays = expected === null ? 0 : Math.max(done - expected, 0);
            status = delayDays > 0 ? 'Completed Late' : 'On Time';
        } else {
            // today is used only to test "overdue"; it is never saved as a delivery date
            delayDays = expected === null ? 0 : Math.max(today - expected, 0);
            status = delayDays > 0 ? 'Delayed' : (partial ? 'Partially Delivered' : 'Pending');
        }
        return { percentage, completed, partial, delayDays, status };
    }

    this.after('CREATE', 'Deliveries', async (_result, req) => {
        await recalculatePurchaseOrder(cds.tx(req), req.data.purchaseOrder_ID);
    });

    this.after('UPDATE', 'DeliveryItems', async (_result, req) => {
        const tx = cds.tx(req);
        const item = await tx.run(SELECT.one.from(DeliveryItems).columns('delivery_ID').where({ ID: getKey(req) }));
        const delivery = item && await tx.run(SELECT.one.from(Deliveries).columns('purchaseOrder_ID').where({ ID: item.delivery_ID }));
        if (delivery) await recalculatePurchaseOrder(tx, delivery.purchaseOrder_ID);
    });

    // Deleting a shipment changes the cumulative totals of the PO
    this.before('DELETE', 'Deliveries', async (req) => {
        const d = await cds.tx(req).run(SELECT.one.from(Deliveries).columns('purchaseOrder_ID').where({ ID: getKey(req) }));
        req.poID = d?.purchaseOrder_ID;
    });
    this.after('DELETE', 'Deliveries', async (_result, req) => {
        if (req.poID) await recalculatePurchaseOrder(cds.tx(req), req.poID);
    });

    async function recalculatePurchaseOrder(tx, poID) {
        const deliveries = await tx.run(SELECT.from(Deliveries).where({ purchaseOrder_ID: poID }));
        if (!deliveries.length) return null;

        // The invoice is the source of the expected date (it may have been edited)
        const invoice = await tx.run(
            SELECT.one.from(Invoices).columns('deliveryDate').where({ purchaseOrder_ID: poID })
        );
        const expectedDate = invoice?.deliveryDate || deliveries[0].expectedDeliveryDate;

        const shipmentDate = new Map(deliveries.map(d => [d.ID, d.shipmentDate]));
        const items = await tx.run(
            SELECT.from(DeliveryItems).where({ delivery_ID: { in: deliveries.map(d => d.ID) } })
        );

        // Group the delivery rows by invoice item
        const groups = new Map();
        for (const it of items) {
            if (!groups.has(it.invoiceItem_ID)) groups.set(it.invoiceItem_ID, []);
            groups.get(it.invoiceItem_ID).push(it);
        }

        let totalAccepted = 0;
        let totalDelivered = 0;
        let lastCompletion = null;

        for (const list of groups.values()) {
            list.sort((a, b) => String(shipmentDate.get(a.delivery_ID))
                .localeCompare(String(shipmentDate.get(b.delivery_ID))));

            const accepted = Number(list[0].acceptedQuantity) || 0;
            let running = 0;
            let completionDate = null;

            for (const it of list) {
                running += Number(it.deliveredQuantity) || 0;
                if (!completionDate && accepted > 0 && running >= accepted) {
                    completionDate = shipmentDate.get(it.delivery_ID);
                }
            }

            const r = calculateProgress({ accepted, delivered: running, expectedDate, completionDate });

            for (const it of list) {
                await tx.run(UPDATE(DeliveryItems).set({
                    cumulativeDeliveredQuantity: running,
                    itemDeliveryPercentage: r.percentage,
                    partialDelivery: r.partial,
                    itemStatus: r.status,
                    itemDelayDays: r.delayDays,
                    completionDate
                }).where({ ID: it.ID }));
            }

            totalAccepted += accepted;
            totalDelivered += Math.min(running, accepted);
            if (completionDate && (!lastCompletion || completionDate > lastCompletion)) {
                lastCompletion = completionDate;
            }
        }

        const order = calculateProgress({
            accepted: totalAccepted,
            delivered: totalDelivered,
            expectedDate,
            completionDate: lastCompletion
        });

        for (const d of deliveries) {
            await tx.run(UPDATE(Deliveries).set({
                expectedDeliveryDate: expectedDate,
                actualDeliveryDate: order.completed ? lastCompletion : null,
                deliveryPercentage: order.percentage,
                partialDelivery: order.partial,
                delayDays: order.delayDays,
                deliveryStatus: order.status
            }).where({ ID: d.ID }));
        }

        return {
            purchaseOrder_ID: poID,
            deliveryPercentage: order.percentage,
            delayDays: order.delayDays,
            status: order.status
        };
    }


    // ===========================================================================
    // PART 7  -  RISK CALCULATION  (Delivery, Quality, Price)
    //
    //   All three risks are calculated per ITEM -> per ORDER -> per VENDOR.
    //   They are calculated when requested (nothing extra is stored).
    //
    //   Data sources
    //     committed quantity ..... InvoiceItems.quantity (vendor accepted quantity)
    //     received quantity ...... sum of DeliveryItems.deliveredQuantity (all shipments)
    //     expected date .......... Invoices.deliveryDate
    //     actual date ............ DeliveryItems.completionDate
    //     inspected / rejected ... QualityComplaints (same PO and material)
    //     PO price ............... PurchaseOrderItems.newUnitPrice (else contractPrice, oldUnitPrice)
    //     invoice price .......... InvoiceItems.unitPrice (rate entered by the vendor)
    //
    //   7.1 Configuration and small helpers
    //   7.2 Data loader (one entry per PO that has a submitted invoice)
    //   7.3 Delivery risk
    //   7.4 Quality risk
    //   7.5 Price risk
    // ===========================================================================

    // ---------------------------------------------------------------------------
    // 7.1  CONFIGURATION AND SMALL HELPERS
    // ---------------------------------------------------------------------------
    // Change these numbers to tune the risk logic
    const RISK_CONFIG = {
        delayGraceDays: 0,      // days late that are tolerated (no delay risk)
        delayMaxDays: 10,       // days late that give 100% delay risk
        quantityWeight: 0.5,    // share of quantity shortfall in delivery risk
        delayWeight: 0.5,       // share of delay in delivery risk
        lowLimit: 10,           // 0 - 10%   = Low
        mediumLimit: 30         // 10 - 30%  = Medium, above = High
    };

    function round2(value) {
        return Number(Number(value).toFixed(2));
    }

    function clampPercent(value) {
        return Math.min(Math.max(value, 0), 100);
    }

    function getRiskLevel(percent) {
        if (percent === null || percent === undefined) {
            return 'Pending';
        }
        if (percent <= RISK_CONFIG.lowLimit) {
            return 'Low';
        }
        if (percent <= RISK_CONFIG.mediumLimit) {
            return 'Medium';
        }
        return 'High';
    }

    // Average of valueField, weighted by weightField. Items without a value are skipped.
    function weightedAverage(rows, valueField, weightField) {
        let sum = 0;
        let weight = 0;
        for (const row of rows) {
            if (row[valueField] === null || row[valueField] === undefined) {
                continue;
            }
            sum += row[valueField] * row[weightField];
            weight += row[weightField];
        }
        return weight > 0 ? round2(sum / weight) : null;
    }

    // ---------------------------------------------------------------------------
    // 7.2  DATA LOADER
    // Loads everything needed for one vendor (a few simple queries).
    // Returns one entry per Purchase Order that has a submitted invoice.
    // ---------------------------------------------------------------------------
    async function loadRiskOrders(vendorID) {
        const db = cds.db;

        const purchaseOrders = await db.run(
            SELECT.from(PurchaseOrders).where({ vendor_ID: vendorID })
        );
        if (purchaseOrders.length === 0) {
            return [];
        }
        const poIDs = purchaseOrders.map(po => po.ID);

        const invoices = await db.run(
            SELECT.from(Invoices).where({ purchaseOrder_ID: { in: poIDs } })
        );
        const invoiceIDs = invoices.map(inv => inv.ID);

        let invoiceItems = [];
        if (invoiceIDs.length > 0) {
            invoiceItems = await db.run(
                SELECT.from(InvoiceItems).where({ invoice_ID: { in: invoiceIDs } })
            );
        }

        const poItems = await db.run(
            SELECT.from(PurchaseOrderItems).where({ purchaseOrder_ID: { in: poIDs } })
        );

        const deliveries = await db.run(
            SELECT.from(Deliveries).columns('ID').where({ purchaseOrder_ID: { in: poIDs } })
        );
        const deliveryIDs = deliveries.map(d => d.ID);

        let deliveryItems = [];
        if (deliveryIDs.length > 0) {
            deliveryItems = await db.run(
                SELECT.from(DeliveryItems).where({ delivery_ID: { in: deliveryIDs } })
            );
        }

        const complaints = await db.run(
            SELECT.from(QualityComplaints).where({ vendor_ID: vendorID })
        );

        const orders = [];

        for (const po of purchaseOrders) {
            const invoice = invoices.find(inv => inv.purchaseOrder_ID === po.ID);
            if (!invoice || invoice.invoiceStatus === 'DRAFT') {
                continue;   // no submitted invoice yet: nothing to assess
            }

            const lines = [];

            for (const invItem of invoiceItems) {
                if (invItem.invoice_ID !== invoice.ID) {
                    continue;
                }

                const poItem = poItems.find(p => p.ID === invItem.purchaseOrderItem_ID) || {};

                // Received quantity: add ALL shipments of this invoice item (no double counting)
                let receivedQuantity = 0;
                let completionDate = null;
                for (const dItem of deliveryItems) {
                    if (dItem.invoiceItem_ID !== invItem.ID) {
                        continue;
                    }
                    receivedQuantity += Number(dItem.deliveredQuantity) || 0;
                    if (dItem.completionDate) {
                        completionDate = dItem.completionDate;
                    }
                }

                // Inspection data: complaints of the same PO and material
                let inspectedQuantity = 0;
                let rejectedQuantity = 0;
                for (const complaint of complaints) {
                    if (complaint.purchaseOrder_ID === po.ID &&
                        complaint.materialCode === invItem.materialCode) {
                        inspectedQuantity += Number(complaint.inspectedQuantity) || 0;
                        rejectedQuantity += Number(complaint.rejectedQuantity) || 0;
                    }
                }

                // Price to compare with: the PO price, else contract price, else old price
                let poPrice = Number(poItem.newUnitPrice) || 0;
                if (poPrice <= 0) {
                    poPrice = Number(poItem.contractPrice) || 0;
                }
                if (poPrice <= 0) {
                    poPrice = Number(poItem.oldUnitPrice) || 0;
                }

                lines.push({
                    materialCode: invItem.materialCode,
                    materialDescription: invItem.materialDescription,
                    orderedQuantity: Number(poItem.orderedQuantity) || 0,
                    committedQuantity: Number(invItem.quantity) || 0,   // vendor accepted quantity
                    receivedQuantity: receivedQuantity,
                    completionDate: completionDate,
                    inspectedQuantity: inspectedQuantity,
                    rejectedQuantity: rejectedQuantity,
                    poPrice: poPrice,
                    invoicePrice: invItem.unitPrice === null || invItem.unitPrice === undefined
                        ? null : Number(invItem.unitPrice),
                    poCurrency: poItem.currency || null,
                    invoiceCurrency: invItem.currency || invoice.currency || null,
                    poUnit: poItem.unit || null,
                    invoiceUnit: invItem.unit || null
                });
            }

            orders.push({
                purchaseOrderID: po.ID,
                poNumber: po.poNumber,
                invoiceNumber: invoice.invoiceNumber,
                expectedDate: invoice.deliveryDate,
                lines: lines
            });
        }

        return orders;
    }

    // ---------------------------------------------------------------------------
    // 7.3  DELIVERY RISK
    // quantityRisk = shortfall / committed * 100
    // delayRisk    = delay days converted to 0-100 (RISK_CONFIG)
    // deliveryRisk = quantityRisk * 0.5 + delayRisk * 0.5
    // Judged only when the item is complete or past its expected date.
    // ---------------------------------------------------------------------------

    // Days late -> delay risk % (0 inside the grace period, 100 at delayMaxDays)
    function calculateDelayRisk(delayDays) {
        const lateDays = delayDays - RISK_CONFIG.delayGraceDays;
        if (lateDays <= 0) {
            return 0;
        }
        const range = RISK_CONFIG.delayMaxDays - RISK_CONFIG.delayGraceDays;
        if (range <= 0) {
            return 100;
        }
        return clampPercent((lateDays / range) * 100);
    }

    function calculateDeliveryItem(line, expectedDate) {
        const committed = line.committedQuantity;
        const received = line.receivedQuantity;
        const shortfall = Math.max(0, committed - received);
        const isComplete = committed > 0 && received >= committed;

        const today = toDayNumber(new Date());
        const expected = toDayNumber(expectedDate);
        const isOverdue = expected !== null && today > expected;

        // Delay: completed items use the completion date, open items use today
        let delayDays = 0;
        if (expected !== null) {
            if (isComplete) {
                const done = toDayNumber(line.completionDate);
                delayDays = Math.max((done === null ? today : done) - expected, 0);
            } else if (isOverdue) {
                delayDays = today - expected;
            }
        }

        // Date that the expected date is compared with:
        // delivered item -> the date it was completed, open item -> today
        let delayCheckDate = new Date().toISOString().slice(0, 10);
        if (isComplete && line.completionDate) {
            delayCheckDate = String(line.completionDate).slice(0, 10);
        }

        // Short timing text for the UI
        let timingStatus = 'Not due yet';
        if (expected === null) {
            timingStatus = 'No expected date';
        } else if (isComplete) {
            timingStatus = delayDays > 0
                ? 'Delivered ' + delayDays + ' day(s) late'
                : 'Delivered on time';
        } else if (isOverdue) {
            timingStatus = 'Overdue by ' + delayDays + ' day(s)';
        }

        const item = {
            materialCode: line.materialCode,
            materialDescription: line.materialDescription,
            orderedQuantity: line.orderedQuantity,
            committedQuantity: committed,
            receivedQuantity: received,
            shortfallQuantity: shortfall,
            expectedDeliveryDate: expectedDate,
            actualDeliveryDate: isComplete ? line.completionDate : null,
            delayCheckDate: delayCheckDate,
            timingStatus: timingStatus,
            delayDays: delayDays,
            quantityRisk: null,
            delayRisk: null,
            deliveryRisk: null,
            riskLevel: 'Pending',
            riskStatus: ''
        };

        // Not complete and not yet due: it is too early to judge
        if (!isComplete && !isOverdue) {
            item.riskStatus = received > 0 ? 'In Progress' : 'Pending Delivery';
            return item;
        }

        item.quantityRisk = committed > 0 ? round2(clampPercent((shortfall / committed) * 100)) : 0;
        item.delayRisk = round2(calculateDelayRisk(delayDays));
        item.deliveryRisk = round2(clampPercent(
            (item.quantityRisk * RISK_CONFIG.quantityWeight) +
            (item.delayRisk * RISK_CONFIG.delayWeight)
        ));
        item.riskLevel = getRiskLevel(item.deliveryRisk);
        item.riskStatus = 'Calculated';
        return item;
    }

    function calculateDeliveryOrder(order) {
        const items = order.lines.map(line => calculateDeliveryItem(line, order.expectedDate));

        let committed = 0;
        let received = 0;
        let shortfall = 0;
        let delayDays = 0;
        let allComplete = items.length > 0;
        let lastCompletion = null;
        let checkDate = null;
        let anyCalculated = false;
        let anyInProgress = false;

        for (const item of items) {
            committed += item.committedQuantity;
            received += item.receivedQuantity;
            shortfall += item.shortfallQuantity;
            delayDays = Math.max(delayDays, item.delayDays);

            if (!checkDate || item.delayCheckDate > checkDate) {
                checkDate = item.delayCheckDate;
            }

            if (item.actualDeliveryDate) {
                if (!lastCompletion || item.actualDeliveryDate > lastCompletion) {
                    lastCompletion = item.actualDeliveryDate;
                }
            } else {
                allComplete = false;
            }
            if (item.riskStatus === 'Calculated') { anyCalculated = true; }
            if (item.riskStatus === 'In Progress') { anyInProgress = true; }
        }

        // Quantity-weighted risks (items that are still pending are left out)
        const quantityRisk = weightedAverage(items, 'quantityRisk', 'committedQuantity');
        const delayRisk = weightedAverage(items, 'delayRisk', 'committedQuantity');
        const deliveryRisk = weightedAverage(items, 'deliveryRisk', 'committedQuantity');

        let riskStatus = 'Pending Delivery';
        if (anyCalculated) {
            riskStatus = 'Calculated';
        } else if (anyInProgress) {
            riskStatus = 'In Progress';
        }

        // Timing text of the whole order
        let timingStatus = 'Not due yet';
        if (allComplete) {
            timingStatus = delayDays > 0
                ? 'Delivered ' + delayDays + ' day(s) late'
                : 'Delivered on time';
        } else if (delayDays > 0) {
            timingStatus = 'Overdue by ' + delayDays + ' day(s)';
        }

        return {
            purchaseOrderID: order.purchaseOrderID,
            poNumber: order.poNumber,
            invoiceNumber: order.invoiceNumber,
            expectedDeliveryDate: order.expectedDate,
            actualDeliveryDate: allComplete ? lastCompletion : null,
            delayCheckDate: checkDate,
            timingStatus: timingStatus,
            committedQuantity: committed,
            receivedQuantity: received,
            shortfallQuantity: shortfall,
            delayDays: delayDays,
            quantityRisk: quantityRisk,
            delayRisk: delayRisk,
            deliveryRisk: deliveryRisk,
            riskLevel: getRiskLevel(deliveryRisk),
            riskStatus: riskStatus,
            items: items
        };
    }

    function buildDeliveryRisk(vendor, orders) {
        const orderRisks = orders.map(calculateDeliveryOrder);

        let onTimeOrders = 0;
        let delayedOrders = 0;
        const allItems = [];
        for (const order of orderRisks) {
            if (order.delayDays > 0) {
                delayedOrders++;
            } else if (order.actualDeliveryDate) {
                onTimeOrders++;
            }
            for (const item of order.items) {
                allItems.push(item);
            }
        }

        const deliveryRisk = weightedAverage(allItems, 'deliveryRisk', 'committedQuantity');

        let calculationStatus = 'Calculated';
        if (orderRisks.length === 0) {
            calculationStatus = 'Pending Invoice';
        } else if (deliveryRisk === null) {
            calculationStatus = 'Pending Delivery';
        }

        return {
            vendorID: vendor.ID,
            vendorName: vendor.vendorName,
            totalOrders: orderRisks.length,
            onTimeOrders: onTimeOrders,
            delayedOrders: delayedOrders,
            quantityRisk: weightedAverage(allItems, 'quantityRisk', 'committedQuantity'),
            delayRisk: weightedAverage(allItems, 'delayRisk', 'committedQuantity'),
            deliveryRiskScore: deliveryRisk,
            riskLevel: getRiskLevel(deliveryRisk),
            calculationStatus: calculationStatus,
            orders: orderRisks
        };
    }

    async function calculateDeliveryRiskScore(vendorID) {
        const vendor = await cds.db.run(
            SELECT.one.from(Vendors).columns('ID', 'vendorName').where({ ID: vendorID })
        );
        if (!vendor) {
            return null;
        }
        return buildDeliveryRisk(vendor, await loadRiskOrders(vendorID));
    }

    // ---------------------------------------------------------------------------
    // 7.4  QUALITY RISK  =  rejected quantity / inspected quantity * 100
    // No inspection data = "Pending Inspection" (never shown as 0%).
    // ---------------------------------------------------------------------------
    function calculateQualityItem(line) {
        const inspected = line.inspectedQuantity;
        const rejected = line.rejectedQuantity;

        const item = {
            materialCode: line.materialCode,
            materialDescription: line.materialDescription,
            receivedQuantity: line.receivedQuantity,
            inspectedQuantity: inspected,
            acceptedQuantity: Math.max(inspected - rejected, 0),
            rejectedQuantity: rejected,
            qualityRisk: null,
            riskLevel: 'Pending',
            riskStatus: 'Pending Inspection'
        };

        // No inspection = no quality result (never shown as 0%)
        if (inspected > 0) {
            item.qualityRisk = round2(clampPercent((rejected / inspected) * 100));
            item.riskLevel = getRiskLevel(item.qualityRisk);
            item.riskStatus = 'Calculated';
        }
        return item;
    }

    function calculateQualityOrder(order) {
        const items = order.lines.map(calculateQualityItem);

        let received = 0;
        let inspected = 0;
        let rejected = 0;
        for (const item of items) {
            received += item.receivedQuantity;
            inspected += item.inspectedQuantity;
            rejected += item.rejectedQuantity;
        }

        // Inspection-weighted: total rejected / total inspected
        const qualityRisk = inspected > 0 ? round2(clampPercent((rejected / inspected) * 100)) : null;

        return {
            purchaseOrderID: order.purchaseOrderID,
            poNumber: order.poNumber,
            invoiceNumber: order.invoiceNumber,
            receivedQuantity: received,
            inspectedQuantity: inspected,
            acceptedQuantity: Math.max(inspected - rejected, 0),
            rejectedQuantity: rejected,
            qualityRisk: qualityRisk,
            riskLevel: getRiskLevel(qualityRisk),
            riskStatus: qualityRisk === null ? 'Pending Inspection' : 'Calculated',
            items: items
        };
    }

    function buildQualityRisk(vendor, orders) {
        const orderRisks = orders.map(calculateQualityOrder);

        let received = 0;
        let inspected = 0;
        let rejected = 0;
        for (const order of orderRisks) {
            received += order.receivedQuantity;
            inspected += order.inspectedQuantity;
            rejected += order.rejectedQuantity;
        }

        const qualityRisk = inspected > 0 ? round2(clampPercent((rejected / inspected) * 100)) : null;

        let calculationStatus = 'Calculated';
        if (orderRisks.length === 0) {
            calculationStatus = 'Pending Invoice';
        } else if (qualityRisk === null) {
            calculationStatus = 'Pending Inspection';
        }

        return {
            vendorID: vendor.ID,
            vendorName: vendor.vendorName,
            totalOrders: orderRisks.length,
            receivedQuantity: received,
            inspectedQuantity: inspected,
            acceptedQuantity: Math.max(inspected - rejected, 0),
            rejectedQuantity: rejected,
            qualityRiskScore: qualityRisk,
            riskLevel: getRiskLevel(qualityRisk),
            calculationStatus: calculationStatus,
            orders: orderRisks
        };
    }

    async function calculateQualityRiskScore(vendorID) {
        const vendor = await cds.db.run(
            SELECT.one.from(Vendors).columns('ID', 'vendorName').where({ ID: vendorID })
        );
        if (!vendor) {
            return null;
        }
        return buildQualityRisk(vendor, await loadRiskOrders(vendorID));
    }

    // ---------------------------------------------------------------------------
    // 7.5  PRICE RISK  =  price increase / PO value * 100  (savings are not risk)
    // Compared only when price, currency and unit are consistent.
    // ---------------------------------------------------------------------------
    function calculatePriceItem(line) {
        const quantity = line.committedQuantity;

        const item = {
            materialCode: line.materialCode,
            materialDescription: line.materialDescription,
            quantity: quantity,
            poUnitPrice: line.poPrice,
            invoiceUnitPrice: line.invoicePrice,
            poValue: 0,
            invoiceValue: 0,
            priceDifference: null,
            priceDeviation: null,
            priceRisk: null,
            savingAmount: 0,
            increaseAmount: 0,
            riskLevel: 'Pending',
            riskStatus: 'Calculated'
        };

        // Prices can only be compared when they are complete and consistent
        if (!(line.poPrice > 0) || line.invoicePrice === null || !(line.invoicePrice >= 0)) {
            item.riskStatus = 'Price Missing';
            return item;
        }
        if (line.poCurrency && line.invoiceCurrency && line.poCurrency !== line.invoiceCurrency) {
            item.riskStatus = 'Currency Mismatch';
            return item;
        }
        if (line.poUnit && line.invoiceUnit && line.poUnit !== line.invoiceUnit) {
            item.riskStatus = 'Unit Mismatch';
            return item;
        }

        const difference = line.invoicePrice - line.poPrice;

        item.poValue = round2(line.poPrice * quantity);
        item.invoiceValue = round2(line.invoicePrice * quantity);
        item.priceDifference = round2(difference);
        item.priceDeviation = round2((difference / line.poPrice) * 100);
        item.priceRisk = round2(clampPercent(Math.max(item.priceDeviation, 0)));
        item.increaseAmount = difference > 0 ? round2(difference * quantity) : 0;
        item.savingAmount = difference < 0 ? round2(-difference * quantity) : 0;
        item.riskLevel = getRiskLevel(item.priceRisk);
        return item;
    }

    // Adds up a list of price items (PO or vendor total). Only comparable items are counted.
    function sumPriceItems(items) {
        let poValue = 0;
        let invoiceValue = 0;
        let increase = 0;
        let saving = 0;
        for (const item of items) {
            if (item.riskStatus !== 'Calculated') {
                continue;
            }
            poValue += item.poValue;
            invoiceValue += item.invoiceValue;
            increase += item.increaseAmount;
            saving += item.savingAmount;
        }
        return {
            poValue: round2(poValue),
            invoiceValue: round2(invoiceValue),
            priceDifference: round2(invoiceValue - poValue),
            savingAmount: round2(saving),
            priceRisk: poValue > 0 ? round2(clampPercent((increase / poValue) * 100)) : null
        };
    }

    function calculatePriceOrder(order) {
        const items = order.lines.map(calculatePriceItem);
        const total = sumPriceItems(items);

        return {
            purchaseOrderID: order.purchaseOrderID,
            poNumber: order.poNumber,
            invoiceNumber: order.invoiceNumber,
            poValue: total.poValue,
            invoiceValue: total.invoiceValue,
            priceDifference: total.priceDifference,
            savingAmount: total.savingAmount,
            priceRisk: total.priceRisk,
            riskLevel: getRiskLevel(total.priceRisk),
            riskStatus: total.priceRisk === null ? 'Price Missing' : 'Calculated',
            items: items
        };
    }

    function buildPriceRisk(vendor, orders) {
        const orderRisks = orders.map(calculatePriceOrder);

        const allItems = [];
        for (const order of orderRisks) {
            for (const item of order.items) {
                allItems.push(item);
            }
        }
        const total = sumPriceItems(allItems);

        let calculationStatus = 'Calculated';
        if (orderRisks.length === 0) {
            calculationStatus = 'Pending Invoice';
        } else if (total.priceRisk === null) {
            calculationStatus = 'Price Missing';
        }

        return {
            vendorID: vendor.ID,
            vendorName: vendor.vendorName,
            totalOrders: orderRisks.length,
            poValue: total.poValue,
            invoiceValue: total.invoiceValue,
            priceDifference: total.priceDifference,
            savingAmount: total.savingAmount,
            priceRiskScore: total.priceRisk,
            riskLevel: getRiskLevel(total.priceRisk),
            calculationStatus: calculationStatus,
            orders: orderRisks
        };
    }

    async function calculatePriceRiskScore(vendorID) {
        const vendor = await cds.db.run(
            SELECT.one.from(Vendors).columns('ID', 'vendorName').where({ ID: vendorID })
        );
        if (!vendor) {
            return null;
        }
        return buildPriceRisk(vendor, await loadRiskOrders(vendorID));
    }


    // ===========================================================================
    // PART 8  -  RISK ACTIONS  (used by the Risk Dashboard buttons)
    //   Delivery / Quality / Price actions return the vendor result together with
    //   all its orders and items. The overall action combines the three risks
    //   (delivery 40% + quality 35% + price 25%) and saves the RiskAssessment.
    // ===========================================================================

        this.on('calculateDeliveryRisk', async (req) => {
        const { vendorID } = req.data;

        if (!vendorID) {
            return req.reject(400, 'vendorID is required');
        }

        const result = await calculateDeliveryRiskScore(vendorID);
        if (!result) {
            return req.reject(404, 'Vendor not found');
        }
        return result;
    });

    this.on('calculateQualityRisk', async (req) => {
        const { vendorID } = req.data;

        if (!vendorID) {
            return req.reject(400, 'vendorID is required');
        }

        const result = await calculateQualityRiskScore(vendorID);
        if (!result) {
            return req.reject(404, 'Vendor not found');
        }
        return result;
    });

    this.on('calculatePriceDeviationRisk', async (req) => {
        const { vendorID } = req.data;

        if (!vendorID) {
            return req.reject(400, 'vendorID is required');
        }

        const result = await calculatePriceRiskScore(vendorID);
        if (!result) {
            return req.reject(404, 'Vendor not found');
        }
        return result;
    });


    // =========================================================
    // OVERALL VENDOR RISK  (delivery 40% + quality 35% + price 25%)
    // =========================================================

    this.on('calculateOverallVendorRisk', async (req) => {
        const { vendorID } = req.data;

        if (!vendorID) {
            return req.reject(400, 'vendorID is required');
        }

        const delivery = await calculateDeliveryRiskScore(vendorID);
        const quality = await calculateQualityRiskScore(vendorID);
        const price = await calculatePriceRiskScore(vendorID);

        if (!delivery || !quality || !price) {
            return req.reject(404, 'Vendor not found');
        }

        // A risk that is still pending (null) is left out and the other weights are scaled up
        const parts = [
            { score: delivery.deliveryRiskScore, weight: 0.40 },
            { score: quality.qualityRiskScore, weight: 0.35 },
            { score: price.priceRiskScore, weight: 0.25 }
        ];

        let weightedTotal = 0;
        let usedWeight = 0;
        for (const part of parts) {
            if (part.score === null || part.score === undefined) {
                continue;
            }
            weightedTotal += part.score * part.weight;
            usedWeight += part.weight;
        }

        let finalScore = null;
        let riskLevel = 'Pending';

        if (usedWeight > 0) {
            finalScore = round2(weightedTotal / usedWeight);

            if (finalScore <= 20) {
                riskLevel = 'Low';
            } else if (finalScore <= 40) {
                riskLevel = 'Medium';
            } else if (finalScore <= 70) {
                riskLevel = 'High';
            } else {
                riskLevel = 'Critical';
            }
        }

        const calculationStatus = usedWeight >= 0.999 ? 'Completed' : 'Partial';

        // Save or update the latest Risk Assessment of the vendor
        const assessmentData = {
            assessmentDate: new Date(),
            deliveryRisk: delivery.deliveryRiskScore,
            qualityRisk: quality.qualityRiskScore,
            priceRisk: price.priceRiskScore,
            totalRiskScore: finalScore,
            riskLevel: riskLevel,
            calculationStatus: calculationStatus
        };

        const existing = await SELECT.one
            .from(RiskAssessments)
            .where({ vendor_ID: vendorID })
            .orderBy({ assessmentDate: 'desc' });

        if (existing) {
            await UPDATE(RiskAssessments)
                .set(assessmentData)
                .where({ ID: existing.ID });
            
        } else {
            await INSERT.into(RiskAssessments).entries({
                vendor_ID: vendorID,
                ...assessmentData
            });
            
        }
        try {
    const bpaResponse = await triggerbpa(vendorID);

    console.log(
        `[BPA] Workflow triggered for assessment ${vendorID}`,
        bpaResponse
    );

} catch (error) {
    console.error('[BPA] Workflow trigger failed:', error);
}

        return {
            vendorID: vendorID,
            deliveryRisk: delivery.deliveryRiskScore,
            qualityRisk: quality.qualityRiskScore,
            priceRisk: price.priceRiskScore,
            overallRiskScore: finalScore,
            riskLevel: riskLevel,
            calculationStatus: calculationStatus
        };
    });

async function triggerbpa(vendorID) {

    const { RiskAssessments, Vendors } = cds.entities('db');

    // 1. Fetch the latest risk assessment for the vendor
    const assessmentData = await SELECT.one
        .from(RiskAssessments)
        .where({ vendor_ID: vendorID });

    if (!assessmentData) {
        throw new Error(`No risk assessment found for vendor: ${vendorID}`);
    }

    // 2. Fetch vendor details
    const vendorData = await SELECT.one
        .from(Vendors)
        .where({ ID: vendorID });

    if (!vendorData) {
        throw new Error(`Vendor not found: ${vendorID}`);
    }

      // 3. Prepare BPA process payload
    const payload = {
        definitionId: "us10.65850598trial.highriskvendorescalation.highRishVendorEscaltionProcess",
        context:  {
        "assessmentId": assessmentData.ID,
        "vendorId": assessmentData.vendor_ID,
        "vendorName": "trialname",
        "deliveryRisk": 100,
        "qualityRisk": 90,
        "priceRisk": 80,
        "totalRiskScore": 80,
        "riskLevel": "Critical"
        }
    };

    // 4. Trigger SAP Build Process Automation
    const response = await bpa.send({
        method: 'POST',
        data: payload,
        headers: {
            'Content-Type': 'application/json'
        },
        path: '/workflow/rest/v1/workflow-instances'
    });

    return response;
}
    // ===========================================================================
    // PART 9  -  VENDOR BLOCK ACTION AND DAILY HIGH-RISK ALERT JOB
    // ===========================================================================

    // -----------------------------------------------------------------------
    // Action for BPA: block a vendor (and close the related risk alert)
    // -----------------------------------------------------------------------
    this.on('blockVendor', async (req) => {

    const { vendorId, reason } = req.data;
    const { Vendors } = cds.entities('db');

    if (!vendorId) {
        return req.reject(400, 'Vendor ID is required');
    }

    if (!reason || !reason.trim()) {
        return req.reject(400, 'Rejection reason is required');
    }

    const vendor = await SELECT.one
        .from(Vendors)
        .where({ ID: vendorId });

    if (!vendor) {
        return req.reject(404, 'Vendor not found');
    }

    if (['BLOCKED', 'BLACKLISTED'].includes(vendor.vendorStatus)) {
        return `Vendor already ${vendor.vendorStatus}`;
    }

    await UPDATE(Vendors)
        .where({ ID: vendorId })
        .with({
            vendorStatus: 'BLOCKED',
            blockReason: reason,
            blockedAt: new Date().toISOString()
        });

    return 'Vendor successfully blocked';
});

    // -----------------------------------------------------------------------
    // Daily job: send an alert for every vendor whose risk level is High
    // -----------------------------------------------------------------------
    this.on("runRiskAssessment", async (req) => {

        console.log("[Job Scheduler] Vendor risk check started");

        // Get vendors whose existing risk level is High
        const highRiskVendors = await SELECT.from(Vendors)
            .where({ riskLevel: "High" });

        console.log(
            `[Job Scheduler] Found ${highRiskVendors.length} high-risk vendors`
        );

        for (const vendor of highRiskVendors) {

            try {

                // Publish event to SAP Alert Notification
                await publishVendorHighEvent(vendor);
 
                console.log(
                    `[ANS] High-risk alert published for vendor: ${vendor.email}`
                );

            } catch (error) {

                console.error(
                    `[ANS] Alert failed for vendor ${vendor.ID}:`,
                    error.message
                );

            }
        }

        console.log("[Job Scheduler] Vendor risk check completed");

        // Keep the return compatible with an action declared as returns many Vendors
        return highRiskVendors;
    });

})


/* ===========================================================================
 * PART 10  -  OLD CODE KEPT AS COMMENTS
 * ---------------------------------------------------------------------------
 * Nothing below is active. It is the previous risk and delivery logic that was
 * replaced by PART 6, PART 7 and PART 8. Kept only for reference.
 * ========================================================================= */


// ---------------------------------------------------------------------------
// 10.1  Old Deliveries before CREATE / UPDATE handlers and old calculateDeliveryRisk action
// Replaced by PART 6 (delivery handlers) and PART 8 (risk actions).
// ---------------------------------------------------------------------------
    // this.before('CREATE', 'Deliveries', async (req) => {
    //     calculateDeliveryFields(req.data);
    // });

    // this.before('UPDATE', 'Deliveries', async (req) => {

    //     const delivery = await SELECT.one
    //         .from(Deliveries)
    //         .where({ ID: req.data.ID });

    //     if (!delivery) {
    //         return req.error(404, 'Delivery not found');
    //     }

    //     const data = {
    //         ...delivery,
    //         ...req.data
    //     };

    //     calculateDeliveryFields(data);

    //     req.data.deliveryPercentage = data.deliveryPercentage;
    //     req.data.partialDelivery = data.partialDelivery;
    //     req.data.delayDays = data.delayDays;
    //     req.data.deliveryStatus = data.deliveryStatus;
    // });


    // this.on('calculateDeliveryRisk', async (req) => {

    //     const { vendorID } = req.data;

    //     if (!vendorID) {
    //         return req.error(400, 'vendorID is required');
    //     }

    //     return await calculateDeliveryRiskScore(vendorID);
    // });


// ---------------------------------------------------------------------------
// 10.2  Old calculatePriceDeviationRisk action
// Replaced by PART 8.
// ---------------------------------------------------------------------------
    // this.on('calculatePriceDeviationRisk', async (req) => {

    //     const { vendorID } = req.data;

    //     if (!vendorID) {
    //         return req.error(400, 'vendorID is required');
    //     }

    //     return await calculatePriceRiskScore(vendorID);
    // });


// ---------------------------------------------------------------------------
// 10.3  Old calculateOverallVendorRisk handler
// Replaced by PART 8 (it used overallRiskScore, but the entity field is totalRiskScore).
// ---------------------------------------------------------------------------
    // this.on('calculateOverallVendorRisk', async (req) => {

        // const { vendorID } = req.data;

        // if (!vendorID) {
            // return req.error(400, 'vendorID is required');
        // }

        // Get already-defined calculations
        // const delivery = await calculateDeliveryRiskScore(vendorID);

        // const quality = await calculateQualityRiskScore(vendorID);

        // const price = await calculatePriceRiskScore(vendorID);


        // -----------------------------------------------------
        // Overall Risk Calculation
        // -----------------------------------------------------

        // const overallRiskScore =
            // (delivery.deliveryRiskScore * 0.40) +
            // (quality.qualityRiskScore * 0.35) +
            // (price.priceRiskScore * 0.25);

        // const finalScore =
            // Number(overallRiskScore.toFixed(2));


        // -----------------------------------------------------
        // Overall Risk Level
        // -----------------------------------------------------

        // let riskLevel;

        // if (finalScore <= 20) {
            // riskLevel = 'Low';
        // }
        // else if (finalScore <= 40) {
            // riskLevel = 'Medium';
        // }
        // else if (finalScore <= 70) {
            // riskLevel = 'High';
        // }
        // else {
            // riskLevel = 'Critical';
        // }


        // -----------------------------------------------------
        // Save Risk Assessment
        // -----------------------------------------------------

        // -----------------------------------------------------
        // Save or update the latest Risk Assessment
        // -----------------------------------------------------

        // const existing = await SELECT.one
            // .from(RiskAssessments)
            // .where({ vendor_ID: vendorID })
            // .orderBy({ assessmentDate: 'desc' });

        // const assessmentData = {
            // assessmentDate: new Date(),
            // deliveryRisk: delivery.deliveryRiskScore,
            // qualityRisk: quality.qualityRiskScore,
            // priceRisk: price.priceRiskScore,
            // overallRiskScore: finalScore,
            // riskLevel: riskLevel,
            // calculationStatus: 'Completed'
        // };

        // if (existing) {
            // await UPDATE(RiskAssessments)
                // .set(assessmentData)
                // .where({ ID: existing.ID });

            // console.log(
                // "Risk assessment updated:",
                // existing.ID,
                // assessmentData
            // );
        // } else {
            // await INSERT.into(RiskAssessments).entries({
                // vendor_ID: vendorID,
                // ...assessmentData
            // });

            // console.log(
                // "New risk assessment created:",
                // vendorID,
                // assessmentData
            // );
        // }

        // Verify the saved assessment
        // const savedAssessment = await SELECT.one
            // .from(RiskAssessments)
            // .where({ vendor_ID: vendorID })
            // .orderBy({ assessmentDate: 'desc' });

        // console.log("SAVED ASSESSMENT =", savedAssessment);
        // return {

            // vendorID: vendorID,

            // deliveryRisk:
                // delivery.deliveryRiskScore,

            // qualityRisk:
                // quality.qualityRiskScore,

            // priceRisk:
                // price.priceRiskScore,

            // overallRiskScore:
                // finalScore,

            // riskLevel:
                // riskLevel,

            // calculationStatus:
                // 'Completed'
        // };
    // });


// ---------------------------------------------------------------------------
// 10.4  Old delivery risk calculation (delivery-record based)
// Replaced by PART 7 (item -> order -> vendor).
// ---------------------------------------------------------------------------
    // async function calculateDeliveryRiskScore(vendorID) {

    //     const deliveries = await SELECT.from(Deliveries).where({
    //         vendor_ID: vendorID
    //     });


    //     if (!deliveries.length) {
    //         return {
    //             vendorID: vendorID,
    //             deliveryRiskScore: 0,
    //             riskLevel: 'No Data'
    //         };
    //     }


    //     // Calculate delivery fields for all the delivery made by particular vendor
    //     const calculatedDeliveries =
    //         deliveries.map(delivery => {
    //             const data = {
    //                 ...delivery
    //             };

    //             calculateDeliveryFields(data);

    //             return data;
    //         });

    //     // Save calculated delivery fields
    //     for (const delivery of calculatedDeliveries) {

    //         await UPDATE(Deliveries)
    //             .set({

    //                 deliveryPercentage:
    //                     delivery.deliveryPercentage,

    //                 partialDelivery:
    //                     delivery.partialDelivery,

    //                 delayDays:
    //                     delivery.delayDays,

    //                 deliveryStatus:
    //                     delivery.deliveryStatus
    //             })
    //             .where({
    //                 ID: delivery.ID
    //             });
    //     }


    //     const totalDeliveries = calculatedDeliveries.length;


    //     const delayedDeliveries =
    //         calculatedDeliveries.filter(
    //             d => d.deliveryStatus === 'Delayed'
    //         ).length;


    //     const partialDeliveries =
    //         calculatedDeliveries.filter(
    //             d => d.partialDelivery === true
    //         ).length;


    //     const totalDelayDays =
    //         calculatedDeliveries.reduce(
    //             (sum, d) =>
    //                 sum + (Number(d.delayDays) || 0),
    //             0
    //         );


    //     const averageDelayDays =
    //         totalDelayDays / totalDeliveries;


    //     const delayedPercentage =
    //         (delayedDeliveries / totalDeliveries) * 100;


    //     const partialPercentage =
    //         (partialDeliveries / totalDeliveries) * 100;


    //     const totalDeliveryPercentage =
    //         calculatedDeliveries.reduce(
    //             (sum, d) =>
    //                 sum +
    //                 (Number(d.deliveryPercentage) || 0),
    //             0
    //         );


    //     const averageDeliveryPercentage =
    //         totalDeliveryPercentage /
    //         totalDeliveries;

    //     //delay score calculation based on avg delay days 
    //     let delayScore = 0;

    //     if (averageDelayDays <= 0)
    //         delayScore = 0;

    //     else if (averageDelayDays <= 2)
    //         delayScore = 20;

    //     else if (averageDelayDays <= 5)
    //         delayScore = 40;

    //     else if (averageDelayDays <= 10)
    //         delayScore = 70;

    //     else
    //         delayScore = 100;

    //     //delay delivery score based on delaypercent 

    //     let delayedDeliveryScore = 0;

    //     if (delayedPercentage <= 10)
    //         delayedDeliveryScore = 10;

    //     else if (delayedPercentage <= 25)
    //         delayedDeliveryScore = 30;

    //     else if (delayedPercentage <= 50)
    //         delayedDeliveryScore = 60;

    //     else if (delayedPercentage <= 75)
    //         delayedDeliveryScore = 80;

    //     else
    //         delayedDeliveryScore = 100;
    //     //partial de score based on Par del score

    //     let partialDeliveryScore = 0;

    //     if (partialPercentage <= 10)
    //         partialDeliveryScore = 10;

    //     else if (partialPercentage <= 25)
    //         partialDeliveryScore = 30;

    //     else if (partialPercentage <= 50)
    //         partialDeliveryScore = 60;

    //     else if (partialPercentage <= 75)
    //         partialDeliveryScore = 80;

    //     else
    //         partialDeliveryScore = 100;

    //     //completionscore risk score
    //     let completionScore = 0;

    //     if (averageDeliveryPercentage >= 95)
    //         completionScore = 0;

    //     else if (averageDeliveryPercentage >= 80)
    //         completionScore = 30;

    //     else if (averageDeliveryPercentage >= 60)
    //         completionScore = 60;

    //     else if (averageDeliveryPercentage >= 40)
    //         completionScore = 80;

    //     else
    //         completionScore = 100;
    //     // delivery risk score  weightage delay = 50% , dds 25% pds 15% cs 10%

    //     const deliveryRiskScore =
    //         (delayScore * 0.50) +
    //         (delayedDeliveryScore * 0.25) +
    //         (partialDeliveryScore * 0.15) +
    //         (completionScore * 0.10);


    //     const finalScore =
    //         Number(deliveryRiskScore.toFixed(2));


    //     let riskLevel;

    //     if (finalScore <= 20)
    //         riskLevel = 'Low';

    //     else if (finalScore <= 40)
    //         riskLevel = 'Medium';

    //     else if (finalScore <= 70)
    //         riskLevel = 'High';

    //     else
    //         riskLevel = 'Critical';


    //     return {

    //         vendorID: vendorID,

    //         totalDeliveries:
    //             totalDeliveries,

    //         delayedDeliveries:
    //             delayedDeliveries,

    //         partialDeliveries:
    //             partialDeliveries,

    //         averageDelayDays:
    //             Number(averageDelayDays.toFixed(2)),

    //         delayedPercentage:
    //             Number(delayedPercentage.toFixed(2)),

    //         partialPercentage:
    //             Number(partialPercentage.toFixed(2)),

    //         averageDeliveryPercentage:
    //             Number(averageDeliveryPercentage.toFixed(2)),

    //         delayScore:
    //             delayScore,

    //         delayedDeliveryScore:
    //             delayedDeliveryScore,

    //         partialDeliveryScore:
    //             partialDeliveryScore,

    //         completionScore:
    //             completionScore,

    //         deliveryRiskScore:
    //             finalScore,

    //         riskLevel:
    //             riskLevel
    //     };
    // }


// ---------------------------------------------------------------------------
// 10.5  Old quality risk calculation (complaint based, severity score)
// Replaced by PART 7 (rejected / inspected per item, order, vendor).
// ---------------------------------------------------------------------------
    // async function calculateQualityRiskScore(vendorID) {
        // const complaints = await SELECT
            // .from(QualityComplaints)
            // .where({
                // vendor_ID: vendorID
            // });
        // if (!complaints.length) {
            // return {
                // vendorID: vendorID,
                // totalComplaints: 0,
                // qualityRiskScore: 0,
                // riskLevel: 'No Data'
            // };
        // }

        // let totalInspectedQuantity = 0;
        // let totalRejectedQuantity = 0;
        // let totalDefectPercentage = 0;
        // let totalSeverityScore = 0;
        // for (const complaint of complaints) {
            // const inspected =
                // Number(
                    // complaint.inspectedQuantity
                // ) || 0;

            // const rejected =
                // Number(
                    // complaint.rejectedQuantity
                // ) || 0;

            // totalInspectedQuantity += inspected;
            // totalRejectedQuantity += rejected;
            // let defectPercentage = 0;
            // if (inspected > 0) {
                // defectPercentage = (rejected / inspected) * 100;
                // defectPercentage = Math.min(
                    // defectPercentage,
                    // 100
                // );
            // }

            // totalDefectPercentage += defectPercentage;

            // Save calculated defect percentage

            // await UPDATE(QualityComplaints)
                // .set({
                    // defectPercentage:
                        // Number(
                            // defectPercentage.toFixed(2)
                        // )
                // })
                // .where({
                    // ID: complaint.ID
                // });

            // Severity score

            // const severity =
                // String(
                    // complaint.severity || ''
                // ).toLowerCase();
            // let severityScore = 0;
            // if (severity === 'low')
                // severityScore = 10;
            // else if (severity === 'medium')
                // severityScore = 40;
            // else if (severity === 'high')
                // severityScore = 70;
            // else if (severity === 'critical')
                // severityScore = 100;
            // totalSeverityScore +=
                // severityScore;
        // }

        // const totalComplaints =
            // complaints.length;
        // const averageDefectPercentage =
            // totalDefectPercentage /
            // totalComplaints;
        // const averageSeverityScore =
            // totalSeverityScore /
            // totalComplaints;

        // -----------------------------------------------------
        // Defect Score
        // -----------------------------------------------------

        // let defectScore = 0;

        // if (averageDefectPercentage <= 0)
            // defectScore = 0;

        // else if (averageDefectPercentage <= 1)
            // defectScore = 10;

        // else if (averageDefectPercentage <= 3)
            // defectScore = 30;

        // else if (averageDefectPercentage <= 5)
            // defectScore = 50;

        // else if (averageDefectPercentage <= 10)
            // defectScore = 75;

        // else
            // defectScore = 100;


        // -----------------------------------------------------
        // Quality Risk
        // -----------------------------------------------------

        // const qualityRiskScore =
            // (defectScore * 0.70) +
            // (averageSeverityScore * 0.30);


        // const finalScore = Number(qualityRiskScore.toFixed(2));


        // let riskLevel;

        // if (finalScore <= 20)
            // riskLevel = 'Low';

        // else if (finalScore <= 40)
            // riskLevel = 'Medium';

        // else if (finalScore <= 70)
            // riskLevel = 'High';

        // else
            // riskLevel = 'Critical';


        // return {

            // vendorID: vendorID,

            // totalComplaints:
                // totalComplaints,

            // totalInspectedQuantity:
                // totalInspectedQuantity,

            // totalRejectedQuantity:
                // totalRejectedQuantity,

            // averageDefectPercentage:
                // Number(
                    // averageDefectPercentage.toFixed(2)
                // ),

            // defectScore:
                // defectScore,

            // severityScore:
                // Number(
                    // averageSeverityScore.toFixed(2)
                // ),

            // qualityRiskScore:
                // finalScore,

            // riskLevel:
                // riskLevel
        // };
    // }


// ---------------------------------------------------------------------------
// 10.6  Old price risk calculation (invoice header oldPrice / currentPrice)
// Replaced by PART 7 (PO price vs invoice unit price per item).
// ---------------------------------------------------------------------------
    // async function calculatePriceRiskScore(vendorID) {
    //     const invoices = await SELECT
    //         .from(Invoices)
    //         .where({
    //             vendor_ID: vendorID
    //         });

    //     if (!invoices.length) {
    //         return {
    //             vendorID: vendorID,
    //             totalInvoices: 0,
    //             priceRiskScore: 0,
    //             riskLevel: 'No Data'
    //         };
    //     }

    //     let totalPriceIncrease = 0;
    //     let totalDeviation = 0;
    //     for (const invoice of invoices) {
    //         const oldPrice =
    //             Number(invoice.oldPrice) || 0;
    //         const currentPrice =
    //             Number(invoice.currentPrice) || 0;
    //         let priceDifference =
    //             currentPrice - oldPrice;
    //         let priceDeviation = 0;
    //         if (oldPrice > 0) {
    //             priceDeviation =
    //                 (priceDifference / oldPrice) * 100;
    //         }

    //         // Negative price changes are not considered risk
    //         const riskDeviation =
    //             Math.max(
    //                 priceDeviation,
    //                 0
    //             );

    //         if (riskDeviation > 0) {
    //             totalPriceIncrease +=
    //                 priceDifference;
    //         }

    //         totalDeviation +=
    //             riskDeviation;

    //         // Save calculated values
    //         await UPDATE(Invoices)
    //             .set({
    //                 priceDifference:
    //                     Number(
    //                         priceDifference.toFixed(2)
    //                     ),
    //                 priceDeviationPercent:
    //                     Number(
    //                         priceDeviation.toFixed(2)
    //                     )
    //             })
    //             .where({
    //                 ID: invoice.ID
    //             });
    //     }

    //     const totalInvoices =
    //         invoices.length;
    //     const averagePriceDeviationPercent =
    //         totalDeviation /
    //         totalInvoices;
    //     let priceDeviationScore = 0;
    //     if (averagePriceDeviationPercent <= 0)
    //         priceDeviationScore = 0;
    //     else if (averagePriceDeviationPercent <= 2)
    //         priceDeviationScore = 10;
    //     else if (averagePriceDeviationPercent <= 5)
    //         priceDeviationScore = 30;
    //     else if (averagePriceDeviationPercent <= 10)
    //         priceDeviationScore = 50;
    //     else if (averagePriceDeviationPercent <= 20)
    //         priceDeviationScore = 75;
    //     else
    //         priceDeviationScore = 100;
    //     const finalScore =
    //         Number(
    //             priceDeviationScore.toFixed(2)
    //         );


    //     let riskLevel;

    //     if (finalScore <= 20)
    //         riskLevel = 'Low';

    //     else if (finalScore <= 40)
    //         riskLevel = 'Medium';

    //     else if (finalScore <= 70)
    //         riskLevel = 'High';

    //     else
    //         riskLevel = 'Critical';


    //     return {

    //         vendorID: vendorID,

    //         totalInvoices:
    //             totalInvoices,

    //         totalPriceIncrease:
    //             Number(
    //                 totalPriceIncrease.toFixed(2)
    //             ),

    //         averagePriceDeviationPercent:
    //             Number(
    //                 averagePriceDeviationPercent.toFixed(2)
    //             ),

    //         priceDeviationScore:
    //             priceDeviationScore,

    //         priceRiskScore:
    //             finalScore,

    //         riskLevel:
    //             riskLevel
    //     };
    // }


// ---------------------------------------------------------------------------
// 10.7  Old calculateDeliveryFields(data)
// Replaced by calculateProgress() in PART 6.
// ---------------------------------------------------------------------------
    // function calculateDeliveryFields(data) {

    //     const ordered =
    //         Number(data.orderedQuantity) || 0;

    //     const delivered =
    //         Number(data.deliveredQuantity) || 0;


    //     // Delivery percentage

    //     if (ordered > 0) {

    //         let percentage =
    //             (delivered / ordered) * 100;

    //         percentage =
    //             Math.min(
    //                 percentage,
    //                 100
    //             );

    //         data.deliveryPercentage =
    //             Number(
    //                 percentage.toFixed(2)
    //             );

    //     }
    //     else {

    //         data.deliveryPercentage = 0;
    //     }


    //     // Partial delivery

    //     if (
    //         delivered > 0 &&
    //         delivered < ordered
    //     ) {

    //         data.partialDelivery = true;

    //     }
    //     else {

    //         data.partialDelivery = false;
    //     }


    //     // No expected date

    //     if (!data.expectedDeliveryDate) {

    //         data.delayDays = 0;

    //         data.deliveryStatus =
    //             'Pending';

    //         return;
    //     }


    //     const expected =
    //         new Date(
    //             data.expectedDeliveryDate
    //         );


    //     const comparisonDate =
    //         data.actualDeliveryDate
    //             ? new Date(
    //                 data.actualDeliveryDate
    //             )
    //             : new Date();


    //     expected.setHours(0, 0, 0, 0);

    //     comparisonDate.setHours(0, 0, 0, 0);


    //     const difference =
    //         Math.floor(
    //             (
    //                 comparisonDate -
    //                 expected
    //             ) /
    //             (1000 * 60 * 60 * 24)
    //         );


    //     if (data.actualDeliveryDate) {

    //         if (difference > 0) {

    //             data.delayDays =
    //                 difference;

    //             data.deliveryStatus =
    //                 'Delayed';

    //         }
    //         else {

    //             data.delayDays = 0;

    //             data.deliveryStatus =
    //                 'On Time';
    //         }

    //     }
    //     else {

    //         if (difference > 0) {

    //             data.delayDays =
    //                 difference;

    //             data.deliveryStatus =
    //                 'Delayed';

    //         }
    //         else {

    //             data.delayDays = 0;

    //             data.deliveryStatus =
    //                 'Pending';
    //         }
    //     }
    // }


// ---------------------------------------------------------------------------
// 10.8  Previous 0-20 point delivery risk function
// Replaced by PART 7 (0-100 percentage, so the overall formula works).
// ---------------------------------------------------------------------------
    // async function calculateDeliveryRiskScore(vendorID) {
        // const SHORTFALL_MAX_POINTS = 14;
        // const DELAY_MAX_POINTS = 6;
        // const DELAY_FULL_SCORE_DAYS = 10;   // 10+ days late = full delay score

        // const tx = cds.db;
        // const today = toDayNumber(new Date());

        // const orders = await tx.run(
            // SELECT.from(PurchaseOrders).columns('ID').where({ vendor_ID: vendorID })
        // );

        // const results = [];
        // for (const po of orders) {
            // const invoice = await tx.run(
                // SELECT.one.from(Invoices).columns('deliveryDate').where({ purchaseOrder_ID: po.ID })
            // );
            // if (!invoice || !invoice.deliveryDate) continue;      // not accepted / invoiced yet

            // Refreshes the stored values (so "overdue" is current) and returns the order result
            // let order = await recalculatePurchaseOrder(tx, po.ID);

            // if (!order) {                                          // no delivery record at all
                // const overdue = Math.max(today - toDayNumber(invoice.deliveryDate), 0);
                // if (overdue === 0) continue;                       // not due yet: no evidence
                // order = { deliveryPercentage: 0, delayDays: overdue, status: 'Delayed' };
            // }
            // results.push(order);
        // }

        // if (!results.length) {
            // return {
                // vendorID, totalOrders: 0, delayedOrders: 0, incompleteOrders: 0,
                // averageDeliveryPercentage: 0, averageShortfallPercentage: 0, averageDelayDays: 0,
                // shortfallPoints: 0, delayPoints: 0, deliveryRiskScore: 0,
                // maxScore: 20, riskLevel: 'No Data'
            // };
        // }

        // const n = results.length;
        // const sum = (fn) => results.reduce((s, o) => s + fn(o), 0);

        // const avgPercentage = sum(o => Number(o.deliveryPercentage)) / n;
        // const avgShortfall = 100 - avgPercentage;
        // const avgDelayDays = sum(o => o.delayDays) / n;
        // const avgDelayScore = sum(o => Math.min(o.delayDays / DELAY_FULL_SCORE_DAYS, 1) * 100) / n;

        // const shortfallPoints = (avgShortfall / 100) * SHORTFALL_MAX_POINTS;
        // const delayPoints = (avgDelayScore / 100) * DELAY_MAX_POINTS;
        // const score = Number(Math.min(shortfallPoints + delayPoints, 20).toFixed(2));

        // let riskLevel;
        // if (score <= 4) riskLevel = 'Low';
        // else if (score <= 8) riskLevel = 'Medium';
        // else if (score <= 14) riskLevel = 'High';
        // else riskLevel = 'Critical';

        // return {
            // vendorID,
            // totalOrders: n,
            // delayedOrders: results.filter(o => o.delayDays > 0).length,
            // incompleteOrders: results.filter(o => !['On Time', 'Completed Late'].includes(o.status)).length,
            // averageDeliveryPercentage: Number(avgPercentage.toFixed(2)),
            // averageShortfallPercentage: Number(avgShortfall.toFixed(2)),
            // averageDelayDays: Number(avgDelayDays.toFixed(2)),
            // shortfallPoints: Number(shortfallPoints.toFixed(2)),
            // delayPoints: Number(delayPoints.toFixed(2)),
            // deliveryRiskScore: score,
            // maxScore: 20,
            // riskLevel
        // };
    // }