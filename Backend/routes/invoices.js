const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const supabase = require('../lib/supabase');

// GET /api/v1/invoices/:bookingId  — streams a PDF receipt
router.get('/:bookingId', asyncHandler(async (req, res) => {
    if (!supabase) return res.status(503).json({ status: 'error', message: 'DB unavailable' });

    // Fetch booking with equipment and payment details
    const { data: booking, error: bErr } = await supabase
        .from('bookings')
        .select('*, equipment(name, type, brand)')
        .eq('id', req.params.bookingId)
        .single();

    if (bErr || !booking) return res.status(404).json({ status: 'error', message: 'Booking not found' });

    // Verify access
    if (booking.renter_id !== req.user.id && booking.owner_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ status: 'error', message: 'Forbidden' });
    }

    // Fetch renter + owner names
    const userIds = [booking.renter_id, booking.owner_id].filter(Boolean);
    const { data: users } = await supabase.from('users').select('id, name, email').in('id', userIds);
    const renter = users?.find(u => u.id === booking.renter_id);
    const owner  = users?.find(u => u.id === booking.owner_id);

    // Fetch payment info
    const { data: payment } = await supabase
        .from('payments')
        .select('status, razorpay_payment_id, amount_paise, paid_at')
        .eq('booking_id', req.params.bookingId)
        .maybeSingle();

    // Try to use pdfkit, fall back to HTML if not installed
    let PDFDocument;
    try { PDFDocument = require('pdfkit'); } catch { PDFDocument = null; }

    const invoiceNum = `FR-${req.params.bookingId.slice(0, 8).toUpperCase()}`;
    const equipName  = booking.equipment?.name || 'Equipment';
    const equipType  = booking.equipment?.type || '';
    const startDate  = booking.start_date ? new Date(booking.start_date).toLocaleDateString('en-IN') : '';
    const endDate    = booking.end_date   ? new Date(booking.end_date).toLocaleDateString('en-IN')   : '';
    const amount     = payment?.amount_paise ? `₹${(payment.amount_paise / 100).toFixed(2)}` : `₹${Number(booking.total_amount || 0).toFixed(2)}`;
    const paymentId  = payment?.razorpay_payment_id || 'N/A';
    const paidAt     = payment?.paid_at ? new Date(payment.paid_at).toLocaleDateString('en-IN') : 'N/A';

    if (!PDFDocument) {
        // Fallback: HTML invoice
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `inline; filename="invoice-${invoiceNum}.html"`);
        return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Invoice ${invoiceNum}</title>
<style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#333}
h1{color:#166534}table{width:100%;border-collapse:collapse;margin:16px 0}
td{padding:10px;border:1px solid #e5e7eb}
.footer{margin-top:40px;color:#9ca3af;font-size:12px;border-top:1px solid #e5e7eb;padding-top:16px}</style>
</head><body>
<h1>🌾 FarmRent Invoice</h1>
<p><strong>Invoice #:</strong> ${invoiceNum}</p>
<p><strong>Date:</strong> ${new Date().toLocaleDateString('en-IN')}</p>
<h3>Equipment Details</h3>
<table><tr><td>Equipment</td><td>${equipName} (${equipType})</td></tr>
<tr><td>Rental Period</td><td>${startDate} → ${endDate}</td></tr>
<tr><td>Total Amount</td><td><strong>${amount}</strong></td></tr>
<tr><td>Payment ID</td><td>${paymentId}</td></tr>
<tr><td>Payment Date</td><td>${paidAt}</td></tr></table>
<h3>Parties</h3>
<table><tr><td>Farmer</td><td>${renter?.name || 'N/A'} (${renter?.email || ''})</td></tr>
<tr><td>Owner</td><td>${owner?.name || 'N/A'}</td></tr></table>
<div class="footer">Thank you for using FarmRent. This is a computer-generated invoice.</div>
</body></html>`);
    }

    // Full PDF invoice
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="farmrent-invoice-${invoiceNum}.pdf"`);

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);

    // Header
    doc.fillColor('#166534').fontSize(22).font('Helvetica-Bold').text('FarmRent', 50, 50);
    doc.fillColor('#333').fontSize(10).font('Helvetica').text('Agricultural Equipment Rental Platform', 50, 78);
    doc.moveTo(50, 100).lineTo(550, 100).strokeColor('#e5e7eb').stroke();

    // Invoice info
    doc.fontSize(18).font('Helvetica-Bold').fillColor('#333').text('INVOICE', 50, 115);
    doc.fontSize(10).font('Helvetica').fillColor('#666');
    doc.text(`Invoice #: ${invoiceNum}`, 50, 145);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, 50, 160);
    doc.text(`Status: ${payment?.status?.toUpperCase() || 'PENDING'}`, 50, 175);

    // Equipment section
    doc.moveTo(50, 200).lineTo(550, 200).strokeColor('#e5e7eb').stroke();
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#166534').text('Equipment Details', 50, 210);

    const tableTop = 230;
    const rowH = 22;
    const rows = [
        ['Equipment', equipName + (equipType ? ` (${equipType})` : '')],
        ['Rental Period', `${startDate}  →  ${endDate}`],
        ['Total Amount', amount],
        ['Payment ID', paymentId],
        ['Payment Date', paidAt],
    ];
    rows.forEach(([label, value], i) => {
        const y = tableTop + i * rowH;
        doc.rect(50, y, 200, rowH).fillAndStroke('#f9fafb', '#e5e7eb');
        doc.rect(250, y, 300, rowH).fillAndStroke('#ffffff', '#e5e7eb');
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text(label, 56, y + 6);
        doc.fontSize(9).font('Helvetica').fillColor('#333').text(String(value), 256, y + 6);
    });

    // Parties
    const partiesTop = tableTop + rows.length * rowH + 20;
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#166534').text('Parties', 50, partiesTop);
    doc.fontSize(9).font('Helvetica').fillColor('#333');
    doc.text(`Farmer:  ${renter?.name || 'N/A'}  (${renter?.email || ''})`, 50, partiesTop + 20);
    doc.text(`Owner:   ${owner?.name || 'N/A'}`, 50, partiesTop + 36);

    // Footer
    doc.moveTo(50, 720).lineTo(550, 720).strokeColor('#e5e7eb').stroke();
    doc.fontSize(8).fillColor('#9ca3af').text('This is a computer-generated invoice. Thank you for using FarmRent!', 50, 730, { align: 'center', width: 500 });

    doc.end();
}));

module.exports = router;
