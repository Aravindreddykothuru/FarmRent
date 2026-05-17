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
            q, type, district, state,
            minPrice, maxPrice, minRating,
            needsOperator, lat, lng, radius = 50,
            page = 1, limit = 20, sort = 'relevance', cursor,
        } = params;

        const cacheKey = cache.buildSearchKey('search:machines', params);
        const cached = await cache.get(cacheKey);
        if (cached) return { ...cached, fromCache: true };

        const startTime = Date.now();
        const pipeline = [];

        const matchStage = { isActive: true, isApproved: true, status: { $in: ['available'] } };

        if (type) matchStage.type = Array.isArray(type) ? { $in: type } : type;
        if (state) matchStage['location.state'] = new RegExp(state, 'i');
        if (district) matchStage['location.district'] = new RegExp(district, 'i');
        if (minPrice || maxPrice) {
            matchStage['pricing.baseRatePerDay'] = {};
            if (minPrice) matchStage['pricing.baseRatePerDay'].$gte = parseFloat(minPrice);
            if (maxPrice) matchStage['pricing.baseRatePerDay'].$lte = parseFloat(maxPrice);
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
            price_asc: { 'pricing.baseRatePerDay': 1 },
            price_desc: { 'pricing.baseRatePerDay': -1 },
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
                            name: 1, type: 1, model: 1, manufacturer: 1,
                            'location.district': 1, 'location.state': 1, 'location.village': 1,
                            'pricing.baseRatePerHour': 1, 'pricing.baseRatePerDay': 1,
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
                                { $project: { name: 1, 'ownerDetails.businessName': 1, 'address.district': 1 } },
                            ],
                            as: 'owner',
                        },
                    },
                    { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },

                ],
                priceRange: [{ $group: { _id: null, min: { $min: '$pricing.baseRatePerDay' }, max: { $max: '$pricing.baseRatePerDay' } } }],
                byType: [{ $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
                byDistrict: [{ $group: { _id: '$location.district', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }],
            },
        });

        const Machine = mongoose.model('Machine');
        const [result] = await Machine.aggregate(pipeline).allowDiskUse(false);
        const queryTime = Date.now() - startTime;
        if (queryTime > 1500) logger.warn(`Slow search query: ${queryTime}ms`);

        const response = {
            results: result.data,
            metadata: result.metadata[0] || { total: 0, page: parseInt(page), limit: parseInt(limit), totalPages: 0 },
            facets: { priceRange: result.priceRange[0] || { min: 0, max: 0 }, byType: result.byType, byDistrict: result.byDistrict },
            queryTime: `${queryTime}ms`,
            nextCursor: result.data.length === parseInt(limit) ? result.data[result.data.length - 1]?._id : null,
        };

        await cache.set(cacheKey, response, cache.searchTTL);
        return response;
    }

    static async autocomplete(q, limit = 5) {
        if (!q || q.length < 2) return [];
        const cacheKey = `autocomplete:${q.toLowerCase()}`;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const Machine = mongoose.model('Machine');
        const suggestions = await Machine.find(
            {
                $or: [
                    { name: { $regex: `^${q}`, $options: 'i' } },
                    { type: { $regex: `^${q}`, $options: 'i' } },
                    { 'location.district': { $regex: `^${q}`, $options: 'i' } },
                ],
                isActive: true, isApproved: true,
            },
            { name: 1, type: 1, 'location.district': 1, 'pricing.baseRatePerDay': 1 }
        ).limit(limit).lean();

        await cache.set(cacheKey, suggestions, 600);
        return suggestions;
    }

    static async searchNearby(lat, lng, radiusKm = 25, limit = 10) {
        const cacheKey = `nearby:${lat}:${lng}:${radiusKm}`;
        const cached = await cache.get(cacheKey);
        if (cached) return cached;

        const Machine = mongoose.model('Machine');
        const results = await Machine.find({
            'location.coordinates': {
                $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radiusKm * 1000 },
            },
            isActive: true, isApproved: true, status: 'available',
        })
            .select('name type pricing.baseRatePerDay ratings location.district images')
            .limit(limit).lean();

        await cache.set(cacheKey, results, cache.searchTTL);
        return results;
    }
}

module.exports = SearchService;
