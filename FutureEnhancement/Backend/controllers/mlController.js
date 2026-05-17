'use strict';

const Booking = require('../models/Booking');
const Machine = require('../models/Machine');
const User = require('../models/User');
const { sendSuccess } = require('../utils/helpers');

/**
 * ML Integration APIs
 * Note: These implement rule-based ML approximations.
 * Replace scoring functions with actual ML model calls (Python service / TensorFlow.js) in production.
 */

/**
 * @desc    Demand prediction for a machine type in a region
 * @route   GET /api/v1/ml/demand-prediction
 * @access  Private (Owner | Admin)
 */
exports.getDemandPrediction = async (req, res, next) => {
    try {
        const { district, machineType, daysAhead = 30 } = req.query;

        const historicalData = await Booking.aggregate([
            {
                $match: {
                    status: { $in: ['completed', 'confirmed'] },
                    createdAt: { $gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
                },
            },
            {
                $lookup: {
                    from: 'machines',
                    localField: 'machine',
                    foreignField: '_id',
                    as: 'machineData',
                },
            },
            { $unwind: '$machineData' },
            {
                $match: {
                    ...(district && { 'machineData.location.district': new RegExp(district, 'i') }),
                    ...(machineType && { 'machineData.type': machineType }),
                },
            },
            {
                $group: {
                    _id: {
                        month: { $month: '$startDate' },
                        dayOfWeek: { $dayOfWeek: '$startDate' },
                    },
                    avgDemand: { $avg: 1 },
                    totalBookings: { $sum: 1 },
                    avgRevenue: { $avg: '$pricing.finalAmount' },
                },
            },
            { $sort: { '_id.month': 1 } },
        ]);

        const seasonalScores = {
            1: 0.7, 2: 0.6, 3: 0.5,
            4: 0.4, 5: 0.4, 6: 0.9,
            7: 1.0, 8: 0.9, 9: 0.8,
            10: 0.9, 11: 0.8, 12: 0.7,
        };

        const predictions = [];
        for (let i = 1; i <= parseInt(daysAhead); i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const month = date.getMonth() + 1;
            const dayOfWeek = date.getDay();

            const seasonalScore = seasonalScores[month];
            const weekendBoost = (dayOfWeek === 0 || dayOfWeek === 6) ? 0.7 : 1.0;
            const historicalForMonth = historicalData.find((h) => h._id.month === month);
            const historicalFactor = historicalForMonth
                ? Math.min(historicalForMonth.totalBookings / 10, 1.5)
                : 1.0;

            const demandScore = parseFloat((seasonalScore * weekendBoost * historicalFactor).toFixed(2));
            const demandLevel = demandScore >= 1.2 ? 'very_high' : demandScore >= 0.8 ? 'high' : demandScore >= 0.5 ? 'medium' : 'low';

            predictions.push({
                date: date.toISOString().split('T')[0],
                demandScore,
                demandLevel,
                recommendedPriceMultiplier: parseFloat((0.8 + demandScore * 0.4).toFixed(2)),
                estimatedBookings: Math.round(demandScore * (historicalForMonth?.totalBookings / 30 || 2)),
            });
        }

        const avgDemand = predictions.reduce((s, p) => s + p.demandScore, 0) / predictions.length;
        const peakDays = predictions.filter((p) => p.demandLevel === 'very_high' || p.demandLevel === 'high');

        sendSuccess(res, {
            region: district || 'All',
            machineType: machineType || 'All',
            forecastDays: parseInt(daysAhead),
            summary: {
                avgDemandScore: parseFloat(avgDemand.toFixed(2)),
                peakDayCount: peakDays.length,
                bestDaysToList: peakDays.slice(0, 5).map((p) => p.date),
                recommendedAction:
                    avgDemand >= 0.8 ? 'High demand period — consider increasing prices by 20-40%'
                        : avgDemand >= 0.5 ? 'Moderate demand — maintain standard pricing'
                            : 'Low demand — consider offering discounts to attract bookings',
            },
            predictions,
            historicalPatterns: historicalData,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Machine recommendations for a farmer
 * @route   GET /api/v1/ml/recommendations
 * @access  Farmer
 */
exports.getMachineRecommendations = async (req, res, next) => {
    try {
        const { cropType, fieldSize, district, budget, date } = req.query;
        const farmerId = req.user?._id;

        const bookingHistory = farmerId
            ? await Booking.find({ farmer: farmerId, status: 'completed' })
                .populate('machine', 'type location ratings pricing')
                .limit(20)
            : [];

        const preferredTypes = {};
        bookingHistory.forEach((b) => {
            if (b.machine) {
                preferredTypes[b.machine.type] = (preferredTypes[b.machine.type] || 0) + 1;
            }
        });

        const cropMachineMap = {
            rice: ['transplanter', 'harvester', 'tractor'],
            wheat: ['harvester', 'thresher', 'seeder'],
            sugarcane: ['tractor', 'harvester'],
            cotton: ['sprayer', 'harvester', 'cultivator'],
            vegetables: ['tractor', 'sprayer', 'irrigation_pump'],
            default: ['tractor', 'cultivator', 'seeder'],
        };

        const recommendedTypes = cropMachineMap[cropType?.toLowerCase()] || cropMachineMap.default;

        const machineQuery = {
            isActive: true,
            isApproved: true,
            status: 'available',
            type: { $in: recommendedTypes },
        };

        if (district) machineQuery['location.district'] = new RegExp(district, 'i');
        if (budget) machineQuery['pricing.baseRatePerDay'] = { $lte: parseFloat(budget) };

        if (date) {
            const dateObj = new Date(date);
            const bookedMachineIds = await Booking.find({
                startDate: { $lte: dateObj },
                endDate: { $gte: dateObj },
                status: { $in: ['confirmed', 'active'] },
            }).distinct('machine');
            machineQuery._id = { $nin: bookedMachineIds };
        }

        const machines = await Machine.find(machineQuery)
            .populate('owner', 'name phone ratings')
            .limit(20);

        const scoredMachines = machines.map((machine) => {
            let score = 0;
            score += (machine.ratings?.average / 5) * 30 || 0;
            if (preferredTypes[machine.type]) score += Math.min(preferredTypes[machine.type] * 5, 20);
            if (budget) {
                const budgetRatio = parseFloat(budget) / (machine.pricing?.baseRatePerDay || 1);
                score += Math.min(budgetRatio * 10, 20);
            } else {
                score += 10;
            }
            score += Math.min(machine.totalBookings || 0, 20);
            const typeIndex = recommendedTypes.indexOf(machine.type);
            if (typeIndex !== -1) score += 10 - typeIndex * 3;

            return {
                machine: machine.toObject(),
                relevanceScore: parseFloat(score.toFixed(1)),
                matchReasons: [
                    (machine.ratings?.average >= 4) ? '⭐ Highly rated' : null,
                    preferredTypes[machine.type] ? '🔁 Previously used type' : null,
                    typeIndex === 0 ? `✅ Best fit for ${cropType || 'your crop'}` : null,
                    (machine.totalBookings >= 10) ? '📈 Popular choice' : null,
                ].filter(Boolean),
            };
        });

        scoredMachines.sort((a, b) => b.relevanceScore - a.relevanceScore);

        sendSuccess(res, {
            query: { cropType, fieldSize, district, budget, date },
            totalFound: scoredMachines.length,
            recommendations: scoredMachines.slice(0, 10),
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Predict optimal price for a machine listing
 * @route   POST /api/v1/ml/optimal-pricing
 * @access  Owner
 */
exports.getOptimalPricing = async (req, res, next) => {
    try {
        const { machineType, district, horsepower, condition } = req.body;

        const marketData = await Machine.aggregate([
            {
                $match: {
                    type: machineType,
                    'location.district': new RegExp(district, 'i'),
                    isActive: true,
                    isApproved: true,
                },
            },
            {
                $group: {
                    _id: null,
                    avgDailyRate: { $avg: '$pricing.baseRatePerDay' },
                    minDailyRate: { $min: '$pricing.baseRatePerDay' },
                    maxDailyRate: { $max: '$pricing.baseRatePerDay' },
                    avgHourlyRate: { $avg: '$pricing.baseRatePerHour' },
                    count: { $sum: 1 },
                },
            },
        ]);

        const market = marketData[0] || { avgDailyRate: 1500, avgHourlyRate: 200, count: 0 };
        const conditionMultipliers = { excellent: 1.2, good: 1.0, fair: 0.85, poor: 0.7 };
        const conditionMult = conditionMultipliers[condition] || 1.0;
        const hpPremium = horsepower >= 50 ? 1.3 : horsepower >= 35 ? 1.1 : 1.0;

        const recommendedDaily = parseFloat((market.avgDailyRate * conditionMult * hpPremium).toFixed(0));
        const recommendedHourly = parseFloat((market.avgHourlyRate * conditionMult * hpPremium).toFixed(0));

        sendSuccess(res, {
            machineType,
            district,
            marketInsight: {
                competitorsInArea: market.count,
                marketAvgDaily: Math.round(market.avgDailyRate || 0),
                marketMinDaily: Math.round(market.minDailyRate || 0),
                marketMaxDaily: Math.round(market.maxDailyRate || 0),
            },
            recommendation: {
                suggestedDailyRate: recommendedDaily,
                suggestedHourlyRate: recommendedHourly,
                competitiveRange: {
                    low: Math.round(recommendedDaily * 0.85),
                    mid: recommendedDaily,
                    premium: Math.round(recommendedDaily * 1.2),
                },
                strategy:
                    market.count < 3
                        ? 'Low competition in your area — you can price at premium'
                        : market.count < 8
                            ? 'Moderate competition — price competitively near market average'
                            : 'High competition — price slightly below average to attract more bookings',
            },
            adjustmentFactors: { conditionMultiplier: conditionMult, horsepowerPremium: hpPremium },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Farmer churn risk analysis
 * @route   GET /api/v1/ml/churn-risk
 * @access  Admin
 */
exports.getChurnRisk = async (req, res, next) => {
    try {
        const farmers = await User.find({ role: 'farmer', isActive: true }).select('_id name email lastLogin createdAt');
        const farmerIds = farmers.map((f) => f._id);

        const bookingStats = await Booking.aggregate([
            { $match: { farmer: { $in: farmerIds } } },
            {
                $group: {
                    _id: '$farmer',
                    totalBookings: { $sum: 1 },
                    lastBookingDate: { $max: '$createdAt' },
                    completedBookings: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
                    },
                },
            },
        ]);

        const statsMap = Object.fromEntries(bookingStats.map((s) => [s._id.toString(), s]));
        const now = Date.now();

        const riskProfiles = farmers.map((farmer) => {
            const stats = statsMap[farmer._id.toString()];
            let riskScore = 0;

            const daysSinceBooking = stats?.lastBookingDate
                ? (now - new Date(stats.lastBookingDate)) / (1000 * 60 * 60 * 24)
                : 365;

            if (daysSinceBooking > 90) riskScore += 40;
            else if (daysSinceBooking > 60) riskScore += 25;
            else if (daysSinceBooking > 30) riskScore += 10;

            if (!stats || stats.totalBookings === 0) riskScore += 30;
            else if (stats.totalBookings < 3) riskScore += 15;

            const completionRate = stats ? stats.completedBookings / stats.totalBookings : 0;
            if (completionRate < 0.5) riskScore += 20;
            else if (completionRate < 0.8) riskScore += 10;

            const daysSinceLogin = farmer.lastLogin
                ? (now - new Date(farmer.lastLogin)) / (1000 * 60 * 60 * 24)
                : 180;
            if (daysSinceLogin > 60) riskScore += 10;

            const riskLevel = riskScore >= 70 ? 'critical' : riskScore >= 45 ? 'high' : riskScore >= 25 ? 'medium' : 'low';

            return {
                farmer: { id: farmer._id, name: farmer.name, email: farmer.email },
                riskScore,
                riskLevel,
                totalBookings: stats?.totalBookings || 0,
                daysSinceLastBooking: Math.round(daysSinceBooking),
                completionRate: parseFloat((completionRate * 100).toFixed(1)),
                recommendedAction:
                    riskLevel === 'critical' ? 'Send personalized re-engagement offer'
                        : riskLevel === 'high' ? 'Send promotional discount code'
                            : riskLevel === 'medium' ? 'Send seasonal reminder email'
                                : 'No action needed',
            };
        });

        riskProfiles.sort((a, b) => b.riskScore - a.riskScore);

        const summary = {
            critical: riskProfiles.filter((r) => r.riskLevel === 'critical').length,
            high: riskProfiles.filter((r) => r.riskLevel === 'high').length,
            medium: riskProfiles.filter((r) => r.riskLevel === 'medium').length,
            low: riskProfiles.filter((r) => r.riskLevel === 'low').length,
        };

        sendSuccess(res, { summary, total: farmers.length, riskProfiles });
    } catch (error) {
        next(error);
    }
};
