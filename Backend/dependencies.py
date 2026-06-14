"""
dependencies.py
---------------
FastAPI dependencies for authentication and role-based access control.
"""

from __future__ import annotations

from typing import Sequence
from uuid import UUID

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from database import get_db
from models.user import User, UserRole
from utils.security import decode_token

# OAuth2 scheme — extracts the Bearer token from the Authorization header
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


# ---------------------------------------------------------------------------
# Current user dependency
# ---------------------------------------------------------------------------

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    Decode the JWT access token, check that the session is active in DB,
    and return the User model.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise credentials_exception
        user_id: str | None = payload.get("sub")
        jti: str | None = payload.get("jti")
        if user_id is None or jti is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # Check session revocation status via Redis cache
    from utils.session_cache import get_session_cache, set_session_cache
    from datetime import datetime

    cached_status = get_session_cache(jti)
    if cached_status == "revoked":
        raise credentials_exception
    elif cached_status != "active":
        # Cache miss or Redis unavailable: query database
        from models.session import UserSession
        sess = db.query(UserSession).filter(UserSession.token_jti == jti, UserSession.is_active == True).first()  # noqa: E712
        if not sess or sess.expires_at < datetime.utcnow():
            if sess:
                sess.is_active = False
                db.flush()
            set_session_cache(jti, "revoked", ttl=900)
            raise credentials_exception

        # Calculate remaining token life up to 15 mins (900s)
        time_left = int((sess.expires_at - datetime.utcnow()).total_seconds())
        ttl = max(1, min(900, time_left))
        set_session_cache(jti, "active", ttl=ttl)


    user = db.query(User).filter(User.id == UUID(user_id)).first()
    if user is None:
        raise credentials_exception
    return user



# ---------------------------------------------------------------------------
# Role-based access dependency factory
# ---------------------------------------------------------------------------

def require_role(*roles: UserRole):
    """
    Returns a dependency that ensures the current user has one of the
    specified roles. Use in route handlers:

        @router.post("/admin/...", dependencies=[Depends(require_role(UserRole.admin))])

    Or inject as a parameter:

        current_user: User = Depends(require_role(UserRole.owner, UserRole.admin))
    """

    async def _check_role(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of these roles: {', '.join(r.value for r in roles)}",
            )
        return current_user

    return _check_role


# ---------------------------------------------------------------------------
# Rate Limiting Dependency
# ---------------------------------------------------------------------------

class RateLimiter:
    """
    Rate limiting dependency using Redis counters per user and per IP.
    """
    def __init__(self, requests_limit: int = 100, window_seconds: int = 60):
        self.requests_limit = requests_limit
        self.window_seconds = window_seconds

    async def __call__(self, request: Request):
        from services.otp import _get_redis_client
        redis_client = _get_redis_client()
        if not redis_client:
            # If Redis is unavailable, skip rate limiting to avoid blocking requests
            return

        # 1. IP-based rate limit
        client_ip = request.client.host if request.client else "unknown"
        ip_key = f"rate_limit:ip:{client_ip}"
        
        try:
            ip_count = redis_client.incr(ip_key)
            if ip_count == 1:
                redis_client.expire(ip_key, self.window_seconds)
            
            if ip_count > self.requests_limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests from this IP. Please try again later."
                )
        except HTTPException:
            raise
        except Exception:
            # Prevent Redis exceptions from crashing the API
            pass

        # 2. User-based rate limit (if token is present)
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
            try:
                payload = decode_token(token)
                user_id = payload.get("sub")
                if user_id:
                    user_key = f"rate_limit:user:{user_id}"
                    user_count = redis_client.incr(user_key)
                    if user_count == 1:
                        redis_client.expire(user_key, self.window_seconds)
                    
                    if user_count > self.requests_limit:
                        raise HTTPException(
                            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Too many requests. Please try again later."
                        )
            except HTTPException:
                raise
            except Exception:
                pass

