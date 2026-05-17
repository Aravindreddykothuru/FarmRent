'use strict';

const mongoose = require('mongoose');
const cache = require('../cache/cacheManager');
const logger = require('../utils/logger');

/**
 * Search Service
 * Delivers sub-2-second search results through:
 * 1. Redis caching (120s TTL)
 * 2. Optimized MongoDB compound indexes
 * 3. Projection to return only needed fields
 * 4. Aggregation pipelines for complex queries
 * 5. Cursor-based pagination (faster than skip/limit for large datasets)
 */
class SearchService {
  /**
   * Search machines with full-text + filter support
   * Target: < 200ms from DB, < 50ms from cache
   */
  static async searchMachines(params) {
    const {
      q,                    // Full-text search query
      type, district, state,
      minPrice, maxPrice,
      minRating,
      needsOperator,
      lat, lng, radius = 50,
      page = 1, limit = 20,
      sort = 'relevance',
      cursor,               // For cursor-based pagination
      available,            // Filter by availability on specific date
    } = params;

    const cacheKey = cache.buildSearchKey('search:machines', params);
    const cached = await cache.get(cacheKey);
    if (cached) return { ...cached, fromCache: true };

    const startTime = Date.now();

    // Build aggregation pipeline for maximum performance
    const pipeline = [];

    // Stage 1: Match filter (uses indexes)
    const matchStage = {
      isActive: true,
      isApproved: true,
      status: { $in: ['available'] },
    };

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

    // Geospatial filter (uses 2dsphere index)
    if (lat && lng) {
      matchStage['location.coordinates'] = {
        $geoWithin: {
          $centerSphere: [
            [parseFloat(lng), parseFloat(lat)],
            parseFloat(radius) / 6371, // Convert km to radians
          ],
        },
      };
    }

    // Cursor-based pagination for large result sets
    if (cursor) {
      matchStage._id = { $gt: new mongoose.Types.ObjectId(cursor) };
    }

    pipeline.push({ $match: matchStage });

    // Stage 2: Full-text search scoring (if query provided)
    if (q) {
      pipeline.unshift({ $match: { $text: { $search: q } } });
      pipeline.push({ $addFields: { textScore: { $meta: 'textScore' } } });
    }

    // Stage 3: Add computed distance field if geo query
    if (lat && lng) {
      pipeline.push({
        $addFields: {
          distanceKm: {
            $round: [
              {
                $multiply: [
                  6371,
                  {
                    $acos: {
                      $add: [
                        {
                          $multiply: [
                            { $sin: { $degreesToRadians: parseFloat(lat) } },
                            { $sin: { $degreesToRadians: { $arrayElemAt: ['$location.coordinates.coordinates', 1] } } },
                          ],
                        },
                        {
                          $multiply: [
                            { $cos: { $degreesToRadians: parseFloat(lat) } },
                            { $cos: { $degreesToRadians: { $arrayElemAt: ['$location.coordinates.coordinates', 1] } } },
                            { $cos: { $subtract: [{ $degreesToRadians: parseFloat(lng) }, { $degreesToRadians: { $arrayElemAt: ['$location.coordinates.coordinates', 0] } }] } },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
              1,
            ],
          },
        },
      });
    }

    // Stage 4: Sort
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

    // Stage 5: Parallel facets (count + data in one round trip)
    pipeline.push({
      $facet: {
        metadata: [
          { $count: 'total' },
          {
            $addFields: {
              page: parseInt(page),
              limit: parseInt(limit),
              totalPages: { $ceil: { $divide: ['$total', parseInt(limit)] } },
            },
          },
        ],
        data: [
          { $skip: cursor ? 0 : (page - 1) * parseInt(limit) },
          { $limit: parseInt(limit) },
          // Stage 6: Project only necessary fields (reduces payload size)
          {
            $project: {
              name: 1, type: 1, model: 1, manufacturer: 1,
              'location.district': 1, 'location.state': 1, 'location.village': 1,
              'pricing.baseRatePerHour': 1, 'pricing.baseRatePerDay': 1,
              'pricing.operatorIncluded': 1, 'pricing.securityDeposit': 1,
              'specifications.horsepower': 1, 'specifications.fuelType': 1,
              'ratings.average': 1, 'ratings.count': 1,
              images: { $slice: ['$images', 1] }, // Only first image for list view
              status: 1, totalBookings: 1,
              distanceKm: 1,
              textScore: 1,
            },
          },
          // Stage 7: Lookup owner (lightweight - only needed fields)
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
          { $unwind: { path: '$owner', preserveNullAndEmpty: true } },
        ],
        // Stage 8: Aggregated facets for filter UI
        priceRange: [
          { $group: { _id: null, min: { $min: '$pricing.baseRatePerDay' }, max: { $max: '$pricing.baseRatePerDay' } } },
        ],
        byType: [
          { $group: { _id: '$type', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
        byDistrict: [
          { $group: { _id: '$location.district', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ],
      },
    });

    const Machine = mongoose.model('Machine');
    const [result] = await Machine.aggregate(pipeline).allowDiskUse(false);

    const queryTime = Date.now() - startTime;
    if (queryTime > 1500) {
      logger.warn(`Slow search query: ${queryTime}ms`, { params });
    }

    const response = {
      results: result.data,
      metadata: result.metadata[0] || { total: 0, page: parseInt(page), limit: parseInt(limit), totalPages: 0 },
      facets: {
        priceRange: result.priceRange[0] || { min: 0, max: 0 },
        byType: result.byType,
        byDistrict: result.byDistrict,
      },
      queryTime: `${queryTime}ms`,
      nextCursor: result.data.length === parseInt(limit) ? result.data[result.data.length - 1]?._id : null,
    };

    // Cache search results
    await cache.set(cacheKey, response, cache.searchTTL);
    logger.debug(`Search completed in ${queryTime}ms, cached for ${cache.searchTTL}s`);

    return response;
  }

  /**
   * Autocomplete suggestions for search bar
   * Uses prefix-based text index for instant results
   */
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
        isActive: true,
        isApproved: true,
      },
      { name: 1, type: 1, 'location.district': 1, 'pricing.baseRatePerDay': 1 }
    )
      .limit(limit)
      .lean();

    await cache.set(cacheKey, suggestions, 600); // 10 min TTL for autocomplete
    return suggestions;
  }

  /**
   * Geo-based nearby machine search
   * Uses MongoDB 2dsphere index for fast radius search
   */
  static async searchNearby(lat, lng, radiusKm = 25, limit = 10) {
    const cacheKey = `nearby:${lat}:${lng}:${radiusKm}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const Machine = mongoose.model('Machine');
    const results = await Machine.find({
      'location.coordinates': {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: radiusKm * 1000,
        },
      },
      isActive: true,
      isApproved: true,
      status: 'available',
    })
      .select('name type pricing.baseRatePerDay ratings location.district images')
      .limit(limit)
      .lean();

    await cache.set(cacheKey, results, cache.searchTTL);
    return results;
  }
}

module.exports = SearchService;
