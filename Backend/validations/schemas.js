const { z } = require('zod');

const passwordSchema = z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');

exports.registerSchema = z.object({
    email:    z.string().email('Invalid email address'),
    password: passwordSchema,
    name:     z.string().min(2, 'Name too short').max(100).trim(),
    role:     z.enum(['farmer', 'owner']).default('farmer'),
    phone:    z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
    village:  z.string().max(100).trim().optional(),
    district: z.string().max(100).trim().optional(),
    state:    z.string().max(100).trim().optional(),
});

exports.loginSchema = z.object({
    email:    z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

// Accepts both canonical (equipment_id/start_date) and legacy (machineId/startDate) aliases
exports.bookingCreateSchema = z.object({
    equipment_id: z.string().uuid('Invalid equipment ID').optional(),
    machineId:    z.string().uuid('Invalid equipment ID').optional(),
    start_date:   z.string().optional(),
    startDate:    z.string().optional(),
    end_date:     z.string().optional(),
    endDate:      z.string().optional(),
    total_amount: z.number().positive().optional(),
    totalAmount:  z.number().positive().optional(),
    farmer_name:  z.string().max(100).trim().optional(),
    farmerName:   z.string().max(100).trim().optional(),
    payment_method: z.string().optional(),
    notes:        z.string().max(500).trim().optional(),
    pickup_lat:   z.number().min(-90).max(90).optional(),
    pickup_lng:   z.number().min(-180).max(180).optional(),
    dropoff_lat:  z.number().min(-90).max(90).optional(),
    dropoff_lng:  z.number().min(-180).max(180).optional(),
}).refine(d => d.equipment_id || d.machineId, { message: 'equipment_id is required', path: ['equipment_id'] })
  .refine(d => d.start_date || d.startDate,   { message: 'start_date is required',   path: ['start_date'] })
  .refine(d => d.end_date   || d.endDate,     { message: 'end_date is required',     path: ['end_date'] });

exports.equipmentCreateSchema = z.object({
    name:          z.string().min(3, 'Name must be at least 3 characters').max(200).trim(),
    type:          z.string().min(2).max(100).trim(),
    price_per_day: z.number({ invalid_type_error: 'Price must be a number' }).positive('Price must be positive'),
    description:   z.string().max(2000).trim().optional(),
    horsepower:    z.number().int().positive().optional(),
    year:          z.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
    brand:         z.string().max(100).trim().optional(),
    location:      z.string().max(300).trim().optional(),
    lat:           z.number().min(-90).max(90).optional(),
    lng:           z.number().min(-180).max(180).optional(),
    images:        z.array(z.string().url()).optional(),
}).passthrough();  // allow additional fields (address_full, village, district, etc.)

exports.equipmentUpdateSchema = exports.equipmentCreateSchema.partial();

exports.reviewCreateSchema = z.object({
    bookingId:  z.string().uuid('Invalid booking ID'),
    rating:     z.number().int().min(1, 'Rating min 1').max(5, 'Rating max 5'),
    reviewText: z.string().max(1000).trim().optional(),
    comment:    z.string().max(1000).trim().optional(),
});

exports.changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password required'),
    newPassword:     passwordSchema,
});

exports.profileUpdateSchema = z.object({
    name:       z.string().min(2).max(100).trim().optional(),
    phone:      z.string().regex(/^[6-9]\d{9}$/).optional(),
    avatar_url: z.string().url().optional(),
}).strict();

exports.forgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address').optional(),
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number').optional(),
}).refine(d => d.email || d.phone, { message: 'Email or phone number is required' });

exports.resetPasswordSchema = z.object({
    token:    z.string().min(1, 'Reset token is required'),
    password: passwordSchema,
});

exports.sendOTPSchema = z.object({
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
});

exports.verifyOTPSchema = z.object({
    otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
});

// Pre-registration phone OTP (no auth required)
exports.regSendOTPSchema = z.object({
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
    email: z.string().email().optional().or(z.literal('').transform(() => undefined)),
});

exports.regVerifyOTPSchema = z.object({
    phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
    otp:   z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
});

exports.partialRefundSchema = z.object({
    bookingId:  z.string().uuid('Invalid booking ID'),
    amount:     z.number().positive('Refund amount must be positive').optional(),
    reason:     z.string().max(300).trim().optional(),
});

exports.regEmailSendOTPSchema = z.object({
    email: z.string().email('Invalid email address'),
});

exports.regEmailVerifyOTPSchema = z.object({
    email: z.string().email('Invalid email address'),
    otp:   z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
});

exports.loginSendOTPSchema = z.object({
    email: z.string().email('Invalid email address'),
});

exports.loginVerifyOTPSchema = z.object({
    email: z.string().email('Invalid email address'),
    otp:   z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
});

exports.disputeCreateSchema = z.object({
    booking_id:  z.string().uuid('Invalid booking ID'),
    type:        z.enum(['equipment_damage', 'non_return', 'payment_dispute', 'service_issue', 'other']),
    description: z.string().min(10, 'Please describe the issue in detail').max(2000).trim(),
});
