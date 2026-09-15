const { Worker } = require('bullmq');
const { connection } = require('../lib/queueManager');
const { generateInvoiceBuffer } = require('../lib/invoiceGenerator');
const { uploadToS3 } = require('../lib/s3Storage');
const supabase = require('../lib/supabase');
const logger = require('../lib/logger');

let invoiceWorker = null;

function initInvoiceWorker() {
    if (invoiceWorker) return;

    try {
        invoiceWorker = new Worker(
            'invoices',
            async (job) => {
                const { bookingId } = job.data;
                if (!bookingId) throw new Error('bookingId is required for invoice job');

                logger.info('[invoice-worker] Starting invoice generation:', { bookingId });

                // 1. Generate PDF buffer
                const buffer = await generateInvoiceBuffer(bookingId);

                // 2. Upload to S3
                const uniqueKey = `invoices/farmrent-invoice-${bookingId.slice(0, 8)}-${Date.now()}.pdf`;
                const cdnUrl = await uploadToS3(uniqueKey, buffer, 'application/pdf');

                logger.info('[invoice-worker] Invoice uploaded successfully:', { bookingId, cdnUrl });

                // 3. Save URL in database & send email attachments
                if (supabase) {
                    const { error } = await supabase.from('equipment_rentals').update({ invoice_url: cdnUrl }).eq('id', bookingId);
                    if (error) {
                        logger.error('[invoice-worker] Failed to update invoice_url in DB:', { error: error.message });
                    }

                    // Fetch renter and owner details to dispatch invoice emails
                    const { data: bookingData } = await supabase
                        .from('equipment_rentals')
                        .select('renter_id, owner_id')
                        .eq('id', bookingId)
                        .maybeSingle();

                    if (bookingData) {
                        const { data: renter } = await supabase
                            .from('users')
                            .select('full_name, email')
                            .eq('id', bookingData.renter_id)
                            .maybeSingle();

                        const { data: owner } = await supabase
                            .from('users')
                            .select('full_name, email')
                            .eq('id', bookingData.owner_id)
                            .maybeSingle();

                        const emailService = require('../lib/emailService');

                        if (renter?.email) {
                            await emailService
                                .sendInvoiceEmail(renter.email, {
                                    userName: renter.full_name || 'Valued Farmer',
                                    bookingId,
                                    pdfBuffer: buffer,
                                })
                                .catch((e) => logger.warn('[invoice-worker] Failed to email invoice to renter', { error: e.message }));
                        }

                        if (owner?.email) {
                            await emailService
                                .sendInvoiceEmail(owner.email, {
                                    userName: owner.full_name || 'Equipment Owner',
                                    bookingId,
                                    pdfBuffer: buffer,
                                })
                                .catch((e) => logger.warn('[invoice-worker] Failed to email invoice to owner', { error: e.message }));
                        }
                    }
                }
            },
            {
                connection,
                concurrency: 2,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                },
            },
        );

        invoiceWorker.on('completed', (job) => {
            logger.info(`[invoice-worker] Job ${job.id} completed successfully`);
        });

        invoiceWorker.on('failed', (job, err) => {
            const loggedErrors = global.loggedWorkerErrors || (global.loggedWorkerErrors = new Set());
            const errKey = `invoice:${err.message}`;
            if (!loggedErrors.has(errKey)) {
                logger.error(`[invoice-worker] Job ${job?.id} failed: ${err.message}`);
                loggedErrors.add(errKey);
            }
        });

        process.once('SIGTERM', () => {
            invoiceWorker.close().catch(() => {});
        });
        process.once('SIGINT', () => {
            invoiceWorker.close().catch(() => {});
        });
    } catch (err) {
        logger.warn(`[invoice-worker] Initialization skipped: ${err.message}`);
    }
}

module.exports = { initInvoiceWorker };
