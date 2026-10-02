const PDFDocument = require('pdfkit');
const supabase = require('./supabase');

/**
 * Generates an invoice PDF in-memory and returns it as a Buffer.
 */
async function generateInvoiceBuffer(bookingId) {
    if (!supabase) throw new Error('Database not configured');

    // Fetch booking details
    const { data: booking, error: bErr } = await supabase
        .from('equipment_rentals')
        .select('*, equipment(name, category, brand)')
        .eq('id', bookingId)
        .single();

    if (bErr || !booking) throw new Error(`Booking ${bookingId} not found`);

    // Fetch renter + owner info
    const userIds = [booking.renter_id, booking.owner_id].filter(Boolean);
    const { data: users } = await supabase.from('users').select('id, full_name, email').in('id', userIds);

    const renter = (users || []).find((u) => u.id === booking.renter_id);
    const owner = (users || []).find((u) => u.id === booking.owner_id);

    // Fetch payment info
    const { data: payment } = await supabase
        .from('payments')
        .select('status, gateway_payment_id, amount, updated_at')
        .eq('reference_id', bookingId)
        .maybeSingle();

    const invoiceNum = `FR-${bookingId.slice(0, 8).toUpperCase()}`;
    const equipName = booking.equipment?.name || 'Equipment';
    const equipType = booking.equipment?.category || '';
    const startDate = booking.start_date ? new Date(booking.start_date).toLocaleDateString('en-IN') : '';
    const endDate = booking.end_date ? new Date(booking.end_date).toLocaleDateString('en-IN') : '';
    const amount = payment?.amount ? `₹${Number(payment.amount).toFixed(2)}` : `₹${Number(booking.total_amount || 0).toFixed(2)}`;
    const paymentId = payment?.gateway_payment_id || 'N/A';
    const paidAt = payment?.updated_at ? new Date(payment.updated_at).toLocaleDateString('en-IN') : 'N/A';

    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const chunks = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', (err) => reject(err));

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
                doc.fontSize(9)
                    .font('Helvetica-Bold')
                    .fillColor('#333')
                    .text(label, 56, y + 6);
                doc.fontSize(9)
                    .font('Helvetica')
                    .fillColor('#333')
                    .text(String(value), 256, y + 6);
            });

            // Parties
            const partiesTop = tableTop + rows.length * rowH + 20;
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#166534').text('Parties', 50, partiesTop);
            doc.fontSize(9).font('Helvetica').fillColor('#333');
            doc.text(`Farmer:  ${renter?.full_name || 'N/A'}  (${renter?.email || ''})`, 50, partiesTop + 20);
            doc.text(`Owner:   ${owner?.full_name || 'N/A'}`, 50, partiesTop + 36);

            // Footer
            doc.moveTo(50, 720).lineTo(550, 720).strokeColor('#e5e7eb').stroke();
            doc.fontSize(8)
                .fillColor('#9ca3af')
                .text('This is a computer-generated invoice. Thank you for using FarmRent!', 50, 730, { align: 'center', width: 500 });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { generateInvoiceBuffer };
