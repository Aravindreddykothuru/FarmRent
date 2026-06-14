"""
utils/session_cache.py
-------------------------
Utility functions to manage the Redis cache for user session (JTI) states.
"""
from services.otp import _get_redis_client

def get_session_cache(jti: str) -> str | None:
    """
    Get the session status from Redis.
    Returns "active", "revoked", or None.
    """
    redis_client = _get_redis_client()
    if not redis_client:
        return None
    try:
        val = redis_client.get(f"session:jti:{jti}")
        return val
    except Exception:
        return None

def set_session_cache(jti: str, status: str, ttl: int = 900) -> None:
    """
    Set the session status in Redis with a TTL (default 15 minutes / 900s).
    """
    redis_client = _get_redis_client()
    if not redis_client:
        return
    try:
        redis_client.setex(f"session:jti:{jti}", ttl, status)
    except Exception:
        pass

def revoke_session_cache(jti: str) -> None:
    """
    Mark a session as revoked in Redis. We set it to "revoked" with a TTL.
    """
    set_session_cache(jti, "revoked", ttl=900)

def revoke_user_sessions_cache(db, user_id) -> None:
    """
    Revoke all active sessions of a user from Redis.
    We query the active JTIs for this user from DB and mark them revoked in Redis.
    """
    from models.session import UserSession
    redis_client = _get_redis_client()
    if not redis_client:
        return
    try:
        # Query active JTIs for the user
        sessions = db.query(UserSession).filter(UserSession.user_id == user_id, UserSession.is_active == True).all()
        for sess in sessions:
            revoke_session_cache(sess.token_jti)
    except Exception:
        pass
