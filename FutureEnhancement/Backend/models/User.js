'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        fullName: { type: String, required: true, trim: true },
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        password: { type: String, required: true, minlength: 6, select: false },
        role: { type: String, enum: ['farmer', 'owner', 'admin'], default: 'farmer' },

        phone: { type: String, default: '' },
        village: { type: String, default: '' },
        district: { type: String, default: '' },
        state: { type: String, default: '' },

        isActive: { type: Boolean, default: true },
        isVerified: { type: Boolean, default: false },
        lastLogin: { type: Date },

        resetPasswordToken: { type: String },
        resetPasswordExpire: { type: Date },
        passwordChangedAt: { type: Date },
        passwordHistory: { type: [String], default: [] },
        resetAttempts: { type: Number, default: 0 },
        resetLockUntil: { type: Date },

        ratings: {
            average: { type: Number, default: 0 },
            count: { type: Number, default: 0 },
        },
    },
    { timestamps: true }
);

// Hash password before save
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    const hashed = await bcrypt.hash(this.password, 12);
    this.password = hashed;

    if (!this.isNew) {
        this.passwordChangedAt = Date.now() - 1000;
    }

    if (!this.passwordHistory) {
        this.passwordHistory = [];
    }
    this.passwordHistory.push(hashed);
    if (this.passwordHistory.length > 3) {
        this.passwordHistory.shift();
    }

    next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidate) {
    return bcrypt.compare(candidate, this.password);
};

// Strip password from JSON output
userSchema.methods.toJSON = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

userSchema.index({ email: 1 });
userSchema.index({ role: 1, isActive: 1 });

module.exports = mongoose.model('User', userSchema);
