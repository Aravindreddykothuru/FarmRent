/**
 * Backend_Node_legacy/services/auth-service/sessionService.js
 *
 * Manages active user sessions with Redis caching and Supabase persistence.
 */

const crypto = require('crypto');
const supabase = require('../../lib/supabase');
const { redisClient } = require('../tracking-service/redisClient');
const logger = require('../../lib/logger');

// 7 days expiration matching refresh token
const SESSION_EXPIRY_SEC = 7 * 24 * 60 * 60;

// Local memory fallback if Redis is down
const memorySessions = new Map();

class SessionService {
    /**
     * Create a new session record in DB and cache in Redis.
     */
    async createSession(userId, ipAddress, userAgent) {
        const sessionId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + SESSION_EXPIRY_SEC * 1000);

        // 1. Save to Supabase (if database configured)
        if (supabase) {
            try {
                const { error } = await supabase.from('user_sessions').insert({
                    token_id: sessionId,
                    user_id: userId,
                    ip_address: ipAddress || null,
                    user_agent: userAgent || null,
                    expires_at: expiresAt.toISOString(),
                });
                if (error) {
                    logger.error('[SessionService] Failed to save session in Supabase', { error: error.message });
                }
            } catch (err) {
                logger.error('[SessionService] Supabase insertion error', { error: err.message });
            }
        }

        // 2. Cache in Redis
        const redisKey = `sess:${sessionId}`;
        try {
            if (redisClient?.isReady) {
                await redisClient.set(redisKey, JSON.stringify({ userId, expiresAt: expiresAt.getTime() }), {
                    EX: SESSION_EXPIRY_SEC,
                });
                return sessionId;
            }
        } catch (err) {
            logger.warn('[SessionService] Redis set failed, falling back to memory', { error: err.message });
        }

        // Fallback to local memory cache
        memorySessions.set(sessionId, { userId, expiresAt: expiresAt.getTime() });
        return sessionId;
    }

    /**
     * List all active sessions for a user.
     */
    async listSessions(userId) {
        if (!supabase) {
            // Local memory fallback scan (mostly for tests/dev fallback)
            const active = [];
            const now = Date.now();
            for (const [id, s] of memorySessions) {
                if (s.userId === userId && s.expiresAt > now) {
                    active.push({
                        id,
                        user_id: userId,
                        created_at: new Date().toISOString(),
                        expires_at: new Date(s.expiresAt).toISOString(),
                    });
                }
            }
            return active;
        }

        try {
            const { data, error } = await supabase
                .from('user_sessions')
                .select('id, token_id, ip_address, user_agent, created_at, expires_at')
                .eq('user_id', userId)
                .gte('expires_at', new Date().toISOString())
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data || [];
        } catch (err) {
            logger.error('[SessionService] List active sessions error', { error: err.message });
            return [];
        }
    }

    /**
     * Revoke a single session.
     */
    async revokeSession(sessionId, userId) {
        // 1. Delete from Supabase
        if (supabase) {
            try {
                await supabase.from('user_sessions').delete().eq('token_id', sessionId).eq('user_id', userId);
            } catch (err) {
                logger.error('[SessionService] Supabase delete session error', { error: err.message });
            }
        }

        // 2. Delete from Redis
        const redisKey = `sess:${sessionId}`;
        try {
            if (redisClient?.isReady) {
                await redisClient.del(redisKey);
            }
        } catch (err) {
            logger.warn('[SessionService] Redis del session failed', { error: err.message });
        }

        // Memory fallback delete
        memorySessions.delete(sessionId);
        return true;
    }

    /**
     * Revoke all sessions for a user (e.g. on security breach or password change).
     */
    async revokeAllSessions(userId) {
        // 1. Get all session IDs for the user
        const sessions = await this.listSessions(userId);

        // 2. Delete from Supabase
        if (supabase) {
            try {
                await supabase.from('user_sessions').delete().eq('user_id', userId);
            } catch (err) {
                logger.error('[SessionService] Supabase delete all sessions error', { error: err.message });
            }
        }

        // 3. Clear Redis keys
        for (const s of sessions) {
            const tokId = s.token_id || s.id;
            const redisKey = `sess:${tokId}`;
            try {
                if (redisClient?.isReady) {
                    await redisClient.del(redisKey);
                }
            } catch (err) {
                logger.warn('[SessionService] Redis del all sessions failed', { error: err.message });
            }
            memorySessions.delete(tokId);
        }

        return true;
    }

    /**
     * Verify if a session is still active (checking Redis first, then Supabase).
     */
    async verifySession(sessionId) {
        if (!sessionId) return false;

        // 1. Check Redis first
        const redisKey = `sess:${sessionId}`;
        try {
            if (redisClient?.isReady) {
                const data = await redisClient.get(redisKey);
                if (data) {
                    const parsed = JSON.parse(data);
                    if (Date.now() < parsed.expiresAt) {
                        return true;
                    }
                    // Clean expired cache
                    await redisClient.del(redisKey);
                    return false;
                }
            }
        } catch (err) {
            logger.warn('[SessionService] Redis check failed, checking DB', { error: err.message });
        }

        // Check local memory fallback
        const sMem = memorySessions.get(sessionId);
        if (sMem) {
            if (Date.now() < sMem.expiresAt) {
                return true;
            }
            memorySessions.delete(sessionId);
            return false;
        }

        // 2. Fallback to Supabase check
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('user_sessions')
                    .select('user_id, expires_at')
                    .eq('token_id', sessionId)
                    .single();

                if (error || !data) return false;

                const expires = new Date(data.expires_at).getTime();
                if (Date.now() < expires) {
                    // Re-cache back to Redis for faster future lookups
                    if (redisClient?.isReady) {
                        const ttl = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
                        await redisClient.set(redisKey, JSON.stringify({ userId: data.user_id, expiresAt: expires }), {
                            EX: ttl,
                        });
                    }
                    return true;
                }
            } catch (err) {
                logger.error('[SessionService] Supabase verify check error', { error: err.message });
            }
        }

        return false;
    }
}

module.exports = new SessionService();
