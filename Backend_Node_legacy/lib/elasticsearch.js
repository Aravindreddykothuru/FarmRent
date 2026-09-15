const { Client } = require('@elastic/elasticsearch');
const logger = require('./logger');

const esNode = process.env.ELASTICSEARCH_NODE;
const esUsername = process.env.ELASTICSEARCH_USERNAME;
const esPassword = process.env.ELASTICSEARCH_PASSWORD;

let esClient = null;

let isEsUnreachable = false;
let loggedEsFallback = false;

if (esNode) {
    try {
        const config = { node: esNode };
        if (esUsername && esPassword) {
            config.auth = {
                username: esUsername,
                password: esPassword,
            };
        }
        esClient = new Client(config);
        logger.info('[Elasticsearch] Client successfully initialized');

        // Asynchronously check connection status at boot
        esClient
            .ping()
            .then(() => {
                logger.info('[Startup] Elasticsearch: connected');
            })
            .catch((err) => {
                isEsUnreachable = true;
                if (!loggedEsFallback) {
                    logger.warn('[Elasticsearch] Node is unreachable. Falling back to PostgreSQL search.', { error: err.message });
                    loggedEsFallback = true;
                }
            });
    } catch (err) {
        isEsUnreachable = true;
        logger.warn('[Elasticsearch] Initialization failed. Falling back to PostgreSQL search.', { error: err.message });
    }
} else {
    isEsUnreachable = true;
    logger.info('[Elasticsearch] ELASTICSEARCH_NODE not configured. Using PostgreSQL search.');
}

/**
 * Checks if Elasticsearch is active and reachable
 */
async function isEsReady() {
    if (!esClient || isEsUnreachable) return false;
    try {
        await esClient.ping();
        return true;
    } catch (err) {
        isEsUnreachable = true;
        if (!loggedEsFallback) {
            logger.warn('[Elasticsearch] Node went offline. Falling back to PostgreSQL search.', { error: err.message });
            loggedEsFallback = true;
        }
        return false;
    }
}

/**
 * Indexes/Updates an equipment document in Elasticsearch
 */
async function indexMachine(machine) {
    if (!(await isEsReady())) return;

    try {
        await esClient.index({
            index: 'machines',
            id: String(machine.id),
            document: {
                id: machine.id,
                name: machine.name,
                type: machine.type || machine.category,
                brand: machine.brand,
                description: machine.description,
                status: machine.status,
                price_per_day: Number(machine.price_per_day || machine.price || 0),
                is_verified: !!machine.is_verified,
                location:
                    machine.latitude && machine.longitude
                        ? {
                              lat: Number(machine.latitude),
                              lon: Number(machine.longitude),
                          }
                        : null,
                village: machine.village,
                district: machine.district || machine.location_district,
                state: machine.state || machine.location_state,
                created_at: machine.created_at || new Date().toISOString(),
            },
        });
        logger.debug('[Elasticsearch] Successfully indexed machine:', { machineId: machine.id });
    } catch (err) {
        logger.error('[Elasticsearch] Failed to index machine:', { error: err.message, machineId: machine.id });
    }
}

/**
 * Deletes an equipment document from Elasticsearch
 */
async function deleteMachine(machineId) {
    if (!(await isEsReady())) return;

    try {
        await esClient.delete({
            index: 'machines',
            id: String(machineId),
        });
        logger.debug('[Elasticsearch] Successfully deleted machine:', { machineId });
    } catch (err) {
        logger.error('[Elasticsearch] Failed to delete machine:', { error: err.message, machineId });
    }
}

/**
 * Performs advanced fuzzy, filtering, and geolocational search on indexed equipment.
 */
async function searchMachines({ q, type, lat, lon, radius = '50km', limit = 20, offset = 0 }) {
    if (!(await isEsReady())) {
        throw new Error('Elasticsearch is unavailable');
    }

    const must = [];
    const filter = [{ term: { is_verified: true } }, { term: { status: 'active' } }];

    // 1. Fuzzy full-text match
    if (q) {
        must.push({
            multi_match: {
                query: q,
                fields: ['name^3', 'brand^2', 'description'],
                fuzziness: 'AUTO',
            },
        });
    } else {
        must.push({ match_all: {} });
    }

    // 2. Exact match filter for type
    if (type) {
        filter.push({ term: { type: type.toLowerCase() } });
    }

    // 3. Location distance filter
    if (lat && lon) {
        filter.push({
            geo_distance: {
                distance: radius,
                location: {
                    lat: Number(lat),
                    lon: Number(lon),
                },
            },
        });
    }

    const queryBody = {
        query: {
            bool: {
                must,
                filter,
            },
        },
        from: Number(offset),
        size: Number(limit),
    };

    // Location scoring sorting
    if (lat && lon) {
        queryBody.sort = [
            {
                _geo_distance: {
                    location: {
                        lat: Number(lat),
                        lon: Number(lon),
                    },
                    order: 'asc',
                    unit: 'km',
                    mode: 'min',
                    distance_type: 'arc',
                    ignore_unmapped: true,
                },
            },
        ];
    }

    const response = await esClient.search({
        index: 'machines',
        body: queryBody,
    });

    const hits = response.hits.hits;
    return hits.map((hit) => ({
        ...hit._source,
        _score: hit._score,
        distance_km: hit.sort ? Number(hit.sort[0]) : null,
    }));
}

/**
 * Suggests machine names matching prefix text (for autocomplete suggestion)
 */
async function suggestMachines(text) {
    if (!(await isEsReady()) || !text) return [];
    try {
        const response = await esClient.search({
            index: 'machines',
            body: {
                query: {
                    match_phrase_prefix: {
                        name: {
                            query: text.toLowerCase(),
                        },
                    },
                },
                size: 5,
            },
        });
        const hits = response.hits.hits || [];
        return hits.map((h) => ({
            id: h._source.id,
            name: h._source.name,
            type: h._source.type || h._source.category,
            brand: h._source.brand,
        }));
    } catch (err) {
        logger.error('[Elasticsearch] Suggest failed:', { error: err.message });
        return [];
    }
}

module.exports = {
    esClient,
    isEsReady,
    indexMachine,
    deleteMachine,
    searchMachines,
    suggestMachines,
};
