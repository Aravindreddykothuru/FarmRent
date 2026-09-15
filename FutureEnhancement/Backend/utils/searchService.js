'use strict';

const mongoose = require('mongoose');
const cache = require('./cacheManager');          // fixed: was ../cache/cacheManager
const logger = require('./logger');

/**
 * Search Service (NFR Edition)
 * Sub-2-second search via Redis caching + aggregation pipelines + 2dsphere geo index.
 */
class SearchService {
    static async searchMachines(params) {
        const {
            q, type, category, district, state,
            minPrice, maxPrice, minRating,
            needsOperator, lat, lng, radius = 50,
            page = 1, limit = 20, sort = 'relevance', cursor,
        } = params;

        const cacheKey = cache.buildSearchKey('search:machines', params);
        const cached = await cache.get(cacheKey);
        if (cached) return { ...cached, fromCache: true };

        const startTime = Date.now();
        const pipeline = [];

        const matchStage = { isActive: true, isVerified: true, status: { $in: ['available'] } };

        const targetCategory = category || type;
        if (targetCategory) matchStage.category = Array.isArray(targetCategory) ? { $in: targetCategory } : targetCategory;
        if (state) matchStage['location.state'] = new RegExp(state, 'i');
        if (district) matchStage['location.district'] = new RegExp(district, 'i');
        if (minPrice || maxPrice) {
            matchStage['pricing.dailyRate'] = {};
            if (minPrice) matchStage['pricing.dailyRate'].$gte = parseFloat(minPrice);
            if (maxPrice) matchStage['pricing.dailyRate'].$lte = parseFloat(maxPrice);
        }
        if (minRating) matchStage['ratings.average'] = { $gte: parseFloat(minRating) };
        if (needsOperator === 'true') matchStage['pricing.operatorIncluded'] = true;
        if (lat && lng) {
            matchStage['location.coordinates'] = {
                $geoWithin: { $centerSphere: [[parseFloat(lng), parseFloat(lat)], parseFloat(radius) / 6371] },
            };
        }
        if (cursor) matchStage._id = { $gt: new mongoose.Types.ObjectId(cursor) };

        if (q) {
            pipeline.push({ $match: { $text: { $search: q } } });
            pipeline.push({ $addFields: { textScore: { $meta: 'textScore' } } });
        }
        pipeline.push({ $match: matchStage });

        const sortMap = {
            relevance: q ? { textScore: -1, 'ratings.average': -1 } : { 'ratings.average': -1 },
            price_asc: { 'pricing.dailyRate': 1 },
            price_desc: { 'pricing.dailyRate': -1 },
            rating: { 'ratings.average': -1, 'ratings.count': -1 },
            nearest: lat ? { distanceKm: 1 } : { createdAt: -1 },
            popular: { totalBookings: -1 },
            newest: { createdAt: -1 },
        };
        pipeline.push({ $sort: sortMap[sort] || sortMap.relevance });

        pipeline.push({
            $facet: {
                metadata: [
                    { $count: 'total' },
                    { $addFields: { page: parseInt(page), limit: parseInt(limit), totalPages: { $ceil: { $divide: ['$total', parseInt(limit)] } } } },
                ],
                data: [
                    { $skip: cursor ? 0 : (page - 1) * parseInt(limit) },
                    { $limit: parseInt(limit) },
                    {
                        $project: {
                            name: 1, category: 1, model: 1, manufacturer: 1,
                            'location.district': 1, 'location.state': 1, 'location.village': 1,
                            'pricing.baseRatePerHour': 1, 'pricing.dailyRate': 1,
                            'pricing.operatorIncluded': 1, 'pricing.securityDeposit': 1,
                            'specifications.horsepower': 1, 'specifications.fuelType': 1,
                            'ratings.average': 1, 'ratings.count': 1,
                            images: { $slice: ['$images', 1] },
                            status: 1, totalBookings: 1, distanceKm: 1, textScore: 1,
                        },
                    },
                    {
                        $lookup: {
                            from: 'users',
                            let: { ownerId: '$owner' },
                            pipeline: [
                                { $match: { $expr: { $eq: ['$_id', '$$ownerId'] } } },
                                { $project: { fullName: 1, 'ownerDetails.businessName': 1, 'address.district': 1 } },
                            ],
                            as: 'owner',
                        },
                    },
                    { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },

                ],
                priceRange: [{ $group: { _id: null, min: { $min: '$pricing.dailyRate' }, max: { $max: '$pricing.dailyRate' } } }],
                byType: [{ $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
                byDistrict: [{ $group: { _id: '$location.district', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }],
            },
        });

        const Equipment = mongoose.model('Equipment');
        const [result] = await Equipment.aggregate(pipeline).allowDiskUse(false);
        const queryTime = Date.now() - startTime;
        if (queryTime > 1500) logger.warn(`Slow search query: ${queryTime}ms`);

        const mappedData = (result.data || []).map(item => {
            const mapped = { ...item };
            mapped.type = item.category;
            if (item.pricing) {
                mapped.pricing = {
                    ...item.pricing,
                    baseRatePerDay: item.pricing.dailyRate
                };
            }
            if (item.owner) {
                mapped.owner = {
                    ...item.owner,
                    name: item.owner.fullName
                };
            }
            return mapped;
        });

        const priceRangeResult = result.priceRange[0] || { min: 0, max: 0 };

        const response = {
            results: mappedData,
            metadata: result.metadata[0] || { total: 0, page: parseInt(page), limit: parseInt(limit), totalPages: 0 },
            facets: { priceRange: { min: priceRangeResult.min || 0, max: priceRangeResult.max || 0 }, byType: result.byType, byDistrict: result.byDistrict },
            queryTime: `${queryTime}ms`,
            nextCursor: mappedData.length === parseInt(limit) ? mappedData[mappedData.length - 1]?._id : null,
        };

        await cache.set(cacheKey, response, cache.searchTTL);
        return response;
    }

    static async autocomplete(q, limit = 5) {
        if (!q || q.length < 2) return [];
        const cacheKey = `autocomplete:${q.toLowerCase()}`;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const Equipment = mongoose.model('Equipment');
        const suggestions = await Equipment.find(
            {
                $or: [
                    { name: { $regex: `^${q}`, $options: 'i' } },
                    { category: { $regex: `^${q}`, $options: 'i' } },
                    { 'location.district': { $regex: `^${q}`, $options: 'i' } },
                ],
                isActive: true, isVerified: true,
            },
            { name: 1, category: 1, 'location.district': 1, 'pricing.dailyRate': 1 }
        ).limit(limit).lean();

        const mapped = suggestions.map(item => ({
            ...item,
            type: item.category,
            pricing: { baseRatePerDay: item.pricing?.dailyRate }
        }));

        await cache.set(cacheKey, mapped, 600);
        return mapped;
    }

    static async searchNearby(lat, lng, radiusKm = 25, limit = 10) {
        const cacheKey = `nearby:${lat}:${lng}:${radiusKm}`;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const Equipment = mongoose.model('Equipment');
        const results = await Equipment.find({
            'location.coordinates': {
                $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radiusKm * 1000 },
            },
            isActive: true, isVerified: true, status: 'available',
        })
            .select('name category pricing.dailyRate ratings location.district images')
            .limit(limit).lean();

        const mapped = results.map(item => ({
            ...item,
            type: item.category,
            pricing: { baseRatePerDay: item.pricing?.dailyRate }
        }));

        await cache.set(cacheKey, mapped, cache.searchTTL);
        return mapped;
    }
}

module.exports = SearchService;
