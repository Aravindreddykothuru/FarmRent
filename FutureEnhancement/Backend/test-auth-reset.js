'use strict';

require('dotenv').config();
const request = require('supertest');
const mongoose = require('mongoose');
const app = require('./server'); // server exports the app
const User = require('./models/User');

const TEST_EMAIL = 'test_reset@example.com';
const TEST_PASSWORD = 'Password123!';

async function runTests() {
    console.log('🧪 Starting Forgot/Reset Password Integration Tests...');

    // Wait for DB to connect
    if (mongoose.connection.readyState !== 1) {
        await new Promise((resolve) => mongoose.connection.once('open', resolve));
    }

    // 1. Setup/cleanup test user
    await User.deleteMany({ email: TEST_EMAIL });
    const user = await User.create({
        fullName: 'Test Reset User',
        email: TEST_EMAIL,
        password: TEST_PASSWORD, // pre-save hashes this
        phone: '1234567890',
        isActive: true,
        isVerified: true
    });

    console.log('✅ Test user created in database.');

    // 2. Trigger forgot-password
    console.log('Sending forgot-password request...');
    const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ emailOrPhone: TEST_EMAIL });

    console.log(`Response status: ${forgotRes.status}`);
    console.log(`Response body: ${JSON.stringify(forgotRes.body)}`);

    if (forgotRes.status !== 200 || !forgotRes.body.success) {
        throw new Error('Forgot password request failed');
    }
    console.log('✅ Forgot password generic response verified.');

    // Fetch user from DB to get the hashed token and verify storage
    const updatedUser = await User.findOne({ email: TEST_EMAIL });
    if (!updatedUser.resetPasswordToken || !updatedUser.resetPasswordExpire) {
        throw new Error('Reset token or expiry not saved in DB');
    }
    console.log('✅ Hashed token and expiry successfully stored in database.');

    // Grab the raw token from the logged output or generate a dummy test since we know the link is printed.
    // Wait, since we are testing in a script, let's bypass sending and mock the reset controller with the token we know.
    // Wait, the reset controller expects the RAW token in the URL params, hashes it, and checks against the DB's hashed token.
    // Since we don't have the raw token from the API response (security requirement), let's manually generate a token and put it in DB for testing.
    const crypto = require('crypto');
    const rawToken = crypto.randomBytes(32).toString('hex');
    const testHashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    updatedUser.resetPasswordToken = testHashedToken;
    updatedUser.resetPasswordExpire = Date.now() + 30 * 60 * 1000;
    updatedUser.resetAttempts = 0;
    await updatedUser.save();

    // 3. Test Reset Password Validation (Mismatch)
    console.log('Testing reset with mismatched passwords...');
    const mismatchRes = await request(app)
        .post(`/api/v1/auth/reset-password/${rawToken}`)
        .send({ password: 'NewPassword123!', confirmPassword: 'DifferentPassword123!' });

    console.log(`Response status: ${mismatchRes.status}, Error: ${mismatchRes.body.error}`);
    if (mismatchRes.status !== 400 || mismatchRes.body.success) {
        throw new Error('Mismatched passwords check failed');
    }

    // 4. Test Reset Password Validation (Strength)
    console.log('Testing reset with weak password...');
    const weakRes = await request(app)
        .post(`/api/v1/auth/reset-password/${rawToken}`)
        .send({ password: 'weak', confirmPassword: 'weak' });

    console.log(`Response status: ${weakRes.status}, Error: ${weakRes.body.error}`);
    if (weakRes.status !== 400 || weakRes.body.success) {
        throw new Error('Weak password strength check failed');
    }

    // 5. Test Reset Password (Successful)
    console.log('Testing successful reset...');
    const successRes = await request(app)
        .post(`/api/v1/auth/reset-password/${rawToken}`)
        .send({ password: 'NewPassword123!', confirmPassword: 'NewPassword123!' });

    console.log(`Response status: ${successRes.status}, Message: ${successRes.body.message}`);
    if (successRes.status !== 200 || !successRes.body.success) {
        throw new Error('Password reset failed');
    }
    console.log('✅ Successful password reset verified.');

    // Verify token was deleted
    const resetUser = await User.findOne({ email: TEST_EMAIL });
    if (resetUser.resetPasswordToken || resetUser.resetPasswordExpire) {
        throw new Error('Token and expiry were not deleted after reset');
    }
    console.log('✅ Reset token and expiry successfully deleted from DB.');

    // 6. Test Password History (No reuse)
    console.log('Testing password reuse from history...');
    // Create new token for history test
    const rawHistoryToken = crypto.randomBytes(32).toString('hex');
    const hashedHistoryToken = crypto.createHash('sha256').update(rawHistoryToken).digest('hex');

    resetUser.resetPasswordToken = hashedHistoryToken;
    resetUser.resetPasswordExpire = Date.now() + 30 * 60 * 1000;
    await resetUser.save();

    // Try to reuse the password that we just reset to (NewPassword123!)
    const reuseRes = await request(app)
        .post(`/api/v1/auth/reset-password/${rawHistoryToken}`)
        .send({ password: 'NewPassword123!', confirmPassword: 'NewPassword123!' });

    console.log(`Response status: ${reuseRes.status}, Error: ${reuseRes.body.error}`);
    if (reuseRes.status !== 400 || reuseRes.body.success) {
        throw new Error('Password history reuse check failed');
    }
    console.log('✅ Password history reuse prevention verified.');

    // Clean up test user
    await User.deleteMany({ email: TEST_EMAIL });
    console.log('🧹 Cleanup complete.');
    console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests()
    .then(() => {
        mongoose.disconnect();
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Test failed:', err);
        mongoose.disconnect();
        process.exit(1);
    });
