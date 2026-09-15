const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../../middleware/asyncHandler');
const { redisClient } = require('../tracking-service/redisClient');
const logger = require('../../lib/logger');

// WMO Weather Code Mapper & Recommendation Generator
function getWeatherRecommendation(code) {
    const c = Number(code);
    if (c === 0) {
        return {
            label: 'Clear Sky',
            icon: '☀️',
            farmingTip: 'Ideal time for harvesting and planting. Prepare machinery and irrigate as planned.',
            alert: null,
        };
    } else if (c >= 1 && c <= 3) {
        return {
            label: 'Partly Cloudy',
            icon: '⛅',
            farmingTip: 'Excellent conditions for soil preparation, weeding, and equipment maintenance.',
            alert: null,
        };
    } else if (c === 45 || c === 48) {
        return {
            label: 'Foggy',
            icon: '🌫️',
            farmingTip: 'Low visibility. Exercise caution when driving tractors and operating machinery.',
            alert: 'Visibility Alert: Drive heavy equipment carefully.',
        };
    } else if ((c >= 51 && c <= 55) || (c >= 61 && c <= 65) || (c >= 80 && c <= 82)) {
        return {
            label: 'Rainy',
            icon: '🌧️',
            farmingTip: 'Wet conditions. Avoid chemical spraying or pesticide applications. Guard seeds against water clogging.',
            alert: 'Rain Forecast: Postpone harvesting and outdoor drying.',
        };
    } else if (c >= 71 && c <= 77) {
        return {
            label: 'Snowy',
            icon: '❄️',
            farmingTip: 'Freezing temperatures. Protect sensitive crops, shield livestock, and winterize machinery.',
            alert: 'Frost/Freeze Warning: Protect exposed equipment and crops.',
        };
    } else if (c >= 95 && c <= 99) {
        return {
            label: 'Thunderstorm',
            icon: '⛈️',
            farmingTip: 'Severe storm hazard. Discontinue heavy equipment operation and seek indoor shelter immediately.',
            alert: 'Severe Weather Warning: Lightning and high winds expected.',
        };
    } else {
        return {
            label: 'Overcast',
            icon: '☁️',
            farmingTip: 'Suitable conditions for general farm work and crop checking.',
            alert: null,
        };
    }
}

// Farming recommendations based on weather conditions
function generateFarmingTips({ humidity, windSpeed, precipitation }) {
    const tips = [];
    if (humidity > 80) tips.push('High humidity: watch for fungal disease');
    if (windSpeed > 20) tips.push('High winds: avoid spraying pesticides');
    if (precipitation > 5) tips.push('Rain likely: delay irrigation today');
    return tips;
}

// GET /api/v1/weather — Fetch current weather & crop recommendations
router.get(
    '/',
    asyncHandler(async (req, res) => {
        const latVal = req.query.lat;
        const lngVal = req.query.lng;

        if (!latVal || !lngVal) {
            return res.status(400).json({ status: 'error', message: 'lat and lng query parameters are required' });
        }

        const lat = Number(latVal);
        const lng = Number(lngVal);

        if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return res.status(400).json({ status: 'error', message: 'Valid latitude (-90 to 90) and longitude (-180 to 180) required' });
        }

        // Round coordinates to 0.1 degrees (~11km precision) to optimize cache hits
        const roundedLat = (Math.round(lat * 10) / 10).toFixed(1);
        const roundedLng = (Math.round(lng * 10) / 10).toFixed(1);
        const cacheKey = `weather:${roundedLat}:${roundedLng}`;

        // Attempt cache hit
        if (redisClient?.isReady) {
            try {
                const cachedData = await redisClient.get(cacheKey);
                if (cachedData) {
                    return res.json({ success: true, source: 'cache', data: JSON.parse(cachedData) });
                }
            } catch (err) {
                logger.warn('[weather-service] Redis read failed', { error: err.message });
            }
        }

        // Call Open-Meteo API
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;

        try {
            const response = await fetch(weatherUrl);
            if (!response.ok) {
                throw new Error(`Open-Meteo API error: HTTP ${response.status}`);
            }

            const payload = await response.json();

            // Generate recommendations
            const currentCode = payload.current?.weather_code ?? 0;
            const recommendations = getWeatherRecommendation(currentCode);

            const weatherResult = {
                latitude: payload.latitude,
                longitude: payload.longitude,
                current: {
                    temp: payload.current?.temperature_2m,
                    temperature: payload.current?.temperature_2m, // spec variable
                    humidity: payload.current?.relative_humidity_2m,
                    windSpeed: payload.current?.wind_speed_10m,
                    weatherCode: currentCode,
                    ...recommendations,
                    farmingTips: generateFarmingTips({
                        humidity: payload.current?.relative_humidity_2m,
                        windSpeed: payload.current?.wind_speed_10m,
                        precipitation: payload.daily?.precipitation_sum?.[0] || 0,
                    }),
                },
                daily: payload.daily
                    ? {
                          time: payload.daily.time,
                          tempMax: payload.daily.temperature_2m_max,
                          tempMin: payload.daily.temperature_2m_min,
                          precipitation: payload.daily.precipitation_sum,
                          weatherCodes: payload.daily.weather_code,
                      }
                    : null,
                timestamp: new Date().toISOString(),
            };

            // Cache result in Redis for 30 minutes (1800 seconds)
            if (redisClient?.isReady) {
                try {
                    await redisClient.set(cacheKey, JSON.stringify(weatherResult), {
                        EX: 1800,
                    });
                } catch (err) {
                    logger.warn('[weather-service] Redis write failed', { error: err.message });
                }
            }

            return res.json({ success: true, source: 'api', data: weatherResult });
        } catch (err) {
            logger.error('[weather-service] Fetch failed', { error: err.message });
            // Never substitute invented conditions: farmers act on this (spraying, harvesting).
            return res
                .status(502)
                .json({ status: 'error', code: 'WEATHER_UNAVAILABLE', message: 'Weather data is temporarily unavailable' });
        }
    }),
);

module.exports = router;
