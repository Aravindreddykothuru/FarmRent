'use strict';

const mongoose = require('mongoose');

const connectDB = async () => {
    const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/farmrent';
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            await mongoose.connect(uri, {
                useNewUrlParser: true,
                useUnifiedTopology: true,
            });
            console.log(`✅ MongoDB connected: ${mongoose.connection.host}`);
            return;
        } catch (err) {
            retries++;
            console.error(`❌ MongoDB connection attempt ${retries}/${maxRetries} failed: ${err.message}`);
            if (retries === maxRetries) {
                console.error('MongoDB connection failed after max retries. Exiting.');
                process.exit(1);
            }
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
};

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected');
});

module.exports = connectDB;
