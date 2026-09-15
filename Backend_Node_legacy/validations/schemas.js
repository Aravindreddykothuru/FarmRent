const { z } = require('zod');

const passwordSchema = z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');

// Emails are case-insensitive identifiers: normalise once here so every lookup and insert agrees.
const emailSchema = z.string().trim().toLowerCase().email('Invalid email address');

const mobileSchema = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');
const otpSchema = z
    .string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d{6}$/, 'OTP must be numeric');
const uuidSchema = (label) => z.string().uuid(`Invalid ${label}`);

// Calendar date as sent by <input type="date">; rejects impossible dates such as 2026-02-30.
const isoDateSchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .refine((s) => {
        const d = new Date(`${s}T00:00:00Z`);
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, 'Invalid calendar date');

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);

exports.registerSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    name: z.string().trim().min(2, 'Name too short').max(100),
    role: z.enum(['farmer', 'owner']).default('farmer'),
    phone: mobileSchema,
    village: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
});

exports.loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required'),
});

// ── Bookings ─────────────────────────────────────────────────────────────────
// Accepts canonical snake_case and the camelCase names the web client sends, and
// normalises to snake_case. Price fields from the client are intentionally not accepted:
// the server prices every booking from the listing's daily rate.
const bookingInputSchema = z
    .object({
        equipment_id: uuidSchema('equipment ID').optional(),
        machineId: uuidSchema('equipment ID').optional(),
        start_date: isoDateSchema.optional(),
        startDate: isoDateSchema.optional(),
        end_date: isoDateSchema.optional(),
        endDate: isoDateSchema.optional(),
        payment_method: z.enum(['razorpay', 'cod']).optional(),
        paymentMethod: z.enum(['razorpay', 'cod']).optional(),
        promo_code: z.string().trim().toUpperCase().max(40).optional(),
        promoCode: z.string().trim().toUpperCase().max(40).optional(),
        delivery_mode: z.enum(['pickup', 'delivery']).optional(),
        deliveryMode: z.enum(['pickup', 'delivery']).optional(),
        field_address: z.string().trim().max(300).optional(),
        fieldAddress: z.string().trim().max(300).optional(),
        notes: z.string().trim().max(500).optional(),
        pickup_lat: latSchema.optional(),
        pickup_lng: lngSchema.optional(),
        dropoff_lat: latSchema.optional(),
        dropoff_lng: lngSchema.optional(),
    })
    .transform((d) => ({
        equipment_id: d.equipment_id ?? d.machineId,
        start_date: d.start_date ?? d.startDate,
        end_date: d.end_date ?? d.endDate,
        payment_method: d.payment_method ?? d.paymentMethod ?? 'razorpay',
        promo_code: d.promo_code ?? d.promoCode ?? null,
        delivery_mode: d.delivery_mode ?? d.deliveryMode ?? 'pickup',
        field_address: d.field_address ?? d.fieldAddress ?? null,
        notes: d.notes ?? null,
        pickup_lat: d.pickup_lat ?? null,
        pickup_lng: d.pickup_lng ?? null,
        dropoff_lat: d.dropoff_lat ?? null,
        dropoff_lng: d.dropoff_lng ?? null,
    }))
    .refine((d) => d.equipment_id, { message: 'equipment_id is required', path: ['equipment_id'] })
    .refine((d) => d.start_date, { message: 'start_date is required', path: ['start_date'] })
    .refine((d) => d.end_date, { message: 'end_date is required', path: ['end_date'] });

// A quote only needs the selection; creating a delivery booking also needs the address.
exports.bookingQuoteSchema = bookingInputSchema;
exports.bookingCreateSchema = bookingInputSchema.refine((d) => d.delivery_mode !== 'delivery' || d.field_address, {
    message: 'field_address is required for delivery',
    path: ['field_address'],
});

exports.bookingListQuerySchema = z.object({
    status: z.enum(['pending', 'confirmed', 'in_progress', 'return_pending', 'completed', 'cancelled', 'rejected', 'all']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

exports.bookingCompleteSchema = z.object({
    otp: otpSchema.optional(),
});

exports.driverTripStartSchema = z.object({
    booking_id: uuidSchema('booking ID'),
});

exports.driverTripEndSchema = exports.driverTripStartSchema.extend({
    otp: otpSchema.optional(),
});

exports.bookingCancelSchema = z.object({
    reason: z.string().trim().max(300).optional(),
});

exports.promoValidateSchema = z.object({
    code: z.string().trim().toUpperCase().min(1, 'Promo code is required').max(40),
    amount: z.coerce.number().positive('amount must be positive'),
});

exports.bookingExtensionCreateSchema = z.object({
    new_end_date: isoDateSchema,
    reason: z
        .string()
        .trim()
        .max(500)
        .optional()
        .or(z.literal('').transform(() => undefined)),
});

exports.bookingExtensionRespondSchema = z.object({
    status: z.enum(['approved', 'rejected']),
});

// ── Equipment ────────────────────────────────────────────────────────────────

exports.equipmentCreateSchema = z.object({
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(200),
    type: z.string().trim().min(2).max(100),
    price_per_day: z.number().positive('Price must be positive'),
    description: z.string().trim().max(2000).optional(),
    horsepower: z.number().int().positive().optional(),
    year: z
        .number()
        .int()
        .min(1950)
        .max(new Date().getFullYear() + 1)
        .optional(),
    brand: z.string().trim().max(100).optional(),
    location: z.string().trim().max(300).optional(),
    latitude: latSchema.optional(),
    longitude: lngSchema.optional(),
    images: z.array(z.string().url()).max(10).optional(),
    address_full: z.string().trim().max(300).optional(),
    village: z.string().trim().max(100).optional(),
    town: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    pincode: z
        .string()
        .regex(/^\d{6}$/, 'Enter a valid 6-digit pincode')
        .optional(),
    price_weekly: z.number().positive().optional(),
    price_monthly: z.number().positive().optional(),
});

exports.equipmentUpdateSchema = exports.equipmentCreateSchema.partial();

// /api/v1/machines uses the nested "Machine" shape the web client works with.
const machineLocationSchema = z.object({
    full: z.string().trim().max(300).optional(),
    village: z.string().trim().max(100).optional(),
    town: z.string().trim().max(100).optional(),
    district: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    pincode: z
        .string()
        .regex(/^\d{6}$/, 'Enter a valid 6-digit pincode')
        .optional()
        .or(z.literal('').transform(() => undefined)),
    coordinates: z
        .object({
            type: z.literal('Point').optional(),
            coordinates: z.tuple([lngSchema, latSchema]),
        })
        .optional(),
});

const machinePricingSchema = z.object({
    baseRatePerDay: z.coerce.number().positive('Daily rate must be positive').max(1000000),
    baseRatePerHour: z.coerce.number().positive().optional(),
    weeklyRate: z.coerce.number().positive().optional(),
    monthlyRate: z.coerce.number().positive().optional(),
    securityDeposit: z.coerce.number().min(0).optional(),
    operatorIncluded: z.boolean().optional(),
});

const machineFields = {
    name: z.string().trim().min(3, 'Name must be at least 3 characters').max(200),
    type: z
        .string()
        .trim()
        .toLowerCase()
        .max(50)
        .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Invalid equipment type'),
    description: z.string().trim().max(2000).optional(),
    brand: z.string().trim().max(100).optional(),
    status: z.enum(['available', 'active', 'inactive', 'maintenance']).optional(),
    pricing: machinePricingSchema,
    location: machineLocationSchema.optional(),
    pickup_lat: latSchema.optional(),
    pickup_lng: lngSchema.optional(),
    pickup_address: z.string().trim().max(300).optional(),
    pickup_landmark: z.string().trim().max(200).optional(),
    service_radius_km: z.coerce.number().min(1).max(500).optional(),
    service_pincodes: z
        .array(z.string().regex(/^\d{6}$/, 'Service pincodes must be 6 digits'))
        .max(50)
        .optional(),
    images: z.array(z.string().url('Invalid image URL').max(2048)).max(10).optional(),
    features: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    specifications: z.record(z.string().max(60), z.union([z.string().max(200), z.number()])).optional(),
};

const pickupPairRule = [
    (d) => (d.pickup_lat == null) === (d.pickup_lng == null),
    { message: 'pickup_lat and pickup_lng must be provided together', path: ['pickup_lat'] },
];

exports.machineCreateSchema = z.object(machineFields).refine(...pickupPairRule);

exports.machineUpdateSchema = z
    .object({
        ...Object.fromEntries(Object.entries(machineFields).map(([key, schema]) => [key, schema.optional()])),
        pricing: machinePricingSchema.partial().optional(),
    })
    .refine(...pickupPairRule);

exports.machineListQuerySchema = z.object({
    status: z.enum(['available', 'active', 'inactive', 'maintenance']).optional(),
    type: z.string().trim().toLowerCase().max(50).optional(),
    q: z.string().trim().max(100).optional(),
    owner: z.literal('me').optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radius: z.coerce.number().positive().max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});

// ── Reviews / profile / password ─────────────────────────────────────────────

exports.reviewCreateSchema = z.object({
    bookingId: uuidSchema('booking ID'),
    rating: z.number().int().min(1, 'Rating min 1').max(5, 'Rating max 5'),
    reviewText: z.string().trim().max(1000).optional(),
    comment: z.string().trim().max(1000).optional(),
});

exports.changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password required'),
    newPassword: passwordSchema,
});

exports.profileUpdateSchema = z.object({
    name: z.string().trim().min(2).max(100).optional(),
    phone: mobileSchema.nullable().optional(),
    avatar_url: z.string().url().optional(),
    role: z.enum(['farmer', 'owner']).optional(),
});

// ── Password reset / OTP ─────────────────────────────────────────────────────

exports.forgotPasswordSchema = z
    .object({
        email: emailSchema.optional(),
        phone: mobileSchema.optional(),
    })
    .refine((d) => d.email || d.phone, { message: 'Email or phone number is required' });

exports.resetPasswordSchema = z.object({
    token: z.string().min(1, 'Reset token is required'),
    password: passwordSchema,
});

exports.sendOTPSchema = z.object({ phone: mobileSchema });

exports.verifyOTPSchema = z.object({ otp: otpSchema });

// Pre-registration phone OTP (no auth required)
exports.regSendOTPSchema = z.object({
    phone: mobileSchema,
    email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
});

exports.regVerifyOTPSchema = z.object({ phone: mobileSchema, otp: otpSchema });

exports.regEmailSendOTPSchema = z.object({ email: emailSchema });

exports.regEmailVerifyOTPSchema = z.object({ email: emailSchema, otp: otpSchema });

exports.loginSendOTPSchema = z.object({ email: emailSchema });

exports.loginVerifyOTPSchema = z.object({ email: emailSchema, otp: otpSchema });

// ── Payments ─────────────────────────────────────────────────────────────────

// The order amount is derived from the booking on the server; only the booking is identified here.
exports.createOrderSchema = z
    .object({
        bookingId: uuidSchema('booking ID').optional(),
        receipt: z.string().max(100).optional(),
        notes: z.record(z.string(), z.any()).optional(),
    })
    .transform((d) => ({ ...d, bookingId: d.bookingId ?? d.notes?.bookingId ?? d.receipt }))
    .refine((d) => typeof d.bookingId === 'string' && z.string().uuid().safeParse(d.bookingId).success, {
        message: 'bookingId is required',
        path: ['bookingId'],
    });

exports.verifyPaymentSchema = z.object({
    razorpay_order_id: z.string().min(1, 'razorpay_order_id is required'),
    razorpay_payment_id: z.string().min(1, 'razorpay_payment_id is required'),
    razorpay_signature: z.string().min(1, 'razorpay_signature is required'),
});

exports.partialRefundSchema = z.object({
    bookingId: uuidSchema('booking ID'),
    amount: z.number().positive('Refund amount must be positive').optional(),
    reason: z.string().trim().max(300).optional(),
});

// ── Disputes / KYC ───────────────────────────────────────────────────────────

const DISPUTE_TYPES = ['equipment_damage', 'non_return', 'payment_dispute', 'service_issue', 'other'];
const DISPUTE_STATUSES = ['open', 'under_review', 'resolved_farmer', 'resolved_owner', 'closed'];
const KYC_DOC_TYPES = ['aadhar', 'driving_license', 'farm_proof', 'gst'];

exports.disputeCreateSchema = z
    .object({
        bookingId: uuidSchema('booking ID').optional(),
        booking_id: uuidSchema('booking ID').optional(),
        type: z.enum(DISPUTE_TYPES, { message: `Type must be one of: ${DISPUTE_TYPES.join(', ')}` }),
        description: z.string().trim().min(10, 'Please describe the issue in detail').max(2000),
        evidenceUrls: z.array(z.string().url('Invalid evidence URL')).max(10).optional(),
    })
    .refine((d) => d.bookingId || d.booking_id, { message: 'bookingId is required', path: ['bookingId'] });

exports.disputeResolveSchema = z.object({
    status: z.enum(DISPUTE_STATUSES, { message: `Status must be one of: ${DISPUTE_STATUSES.join(', ')}` }),
    admin_notes: z.string().trim().max(1000).optional(),
});

exports.kycUploadSchema = z.object({
    doc_type: z.enum(KYC_DOC_TYPES, { message: `doc_type must be one of: ${KYC_DOC_TYPES.join(', ')}` }),
});

exports.kycRejectSchema = z.object({
    reason: z.string().min(1, 'Reason is required').max(500, 'Reason too long'),
});

// ── Offers / chat / saved searches ───────────────────────────────────────────

exports.offerCreateSchema = z
    .object({
        equipment_id: uuidSchema('equipment ID'),
        offered_price_per_day: z.coerce.number().positive('offered_price_per_day must be positive'),
        start_date: isoDateSchema,
        end_date: isoDateSchema,
        message: z.string().trim().max(500).optional(),
    })
    .refine((d) => d.end_date >= d.start_date, { message: 'end_date must be on or after start_date', path: ['end_date'] });

// The web client sends accept/reject/counter; the stored statuses are accepted/rejected/countered.
const OFFER_ACTIONS = {
    accept: 'accepted',
    accepted: 'accepted',
    reject: 'rejected',
    rejected: 'rejected',
    counter: 'countered',
    countered: 'countered',
};
exports.offerRespondSchema = z
    .object({
        action: z.enum(Object.keys(OFFER_ACTIONS), { message: 'action must be accept, reject or counter' }),
        counter_price: z.coerce.number().positive().optional(),
        counter_message: z.string().trim().max(500).optional(),
    })
    .transform((d) => ({ ...d, action: OFFER_ACTIONS[d.action] }))
    .refine((d) => d.action !== 'countered' || d.counter_price, {
        message: 'counter_price is required to counter',
        path: ['counter_price'],
    });

exports.chatInitSchema = z.object({
    equipment_id: uuidSchema('equipment ID'),
});

exports.savedSearchCreateSchema = z.object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name too long'),
    filters: z.record(z.string(), z.any()),
    alert_on: z.boolean().default(false).optional(),
});

exports.savedSearchUpdateSchema = z.object({
    alert_on: z.boolean({ message: 'alert_on is required' }),
});

// ── Addresses / preferences ──────────────────────────────────────────────────

exports.addressCreateSchema = z.object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    address_line1: z.string().trim().min(1, 'Address line 1 is required').max(200),
    address_line2: z
        .string()
        .trim()
        .max(200)
        .optional()
        .or(z.literal('').transform(() => undefined)),
    city: z.string().trim().min(1, 'City is required').max(100),
    state: z.string().trim().min(1, 'State is required').max(100),
    pincode: z.string().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
    is_default: z.boolean().default(false).optional(),
});

exports.addressUpdateSchema = exports.addressCreateSchema.partial();

exports.notificationPreferenceSchema = z.object({
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    push: z.boolean().optional(),
});

exports.isoDateSchema = isoDateSchema;
