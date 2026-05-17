const ngeohash = require('ngeohash');

function encodeGeohash(lat, lng, precision = 9) {
    const la = Number(lat);
    const lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    return ngeohash.encode(la, lo, precision);
}

module.exports = { encodeGeohash };

