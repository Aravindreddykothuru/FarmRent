"""
services/auth.py
----------------
Business logic for user registration, login, token refresh, sessions, and password recovery.
"""

from __future__ import annotations

import secrets
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from config import get_settings
from models.user import User, UserRole
from models.password_reset import PasswordResetToken
from models.session import UserSession
from services import notification as notif_service
from services.otp import verify_otp, _get_redis_client
from utils.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal Token & Session Issuance
# ---------------------------------------------------------------------------

def _issue_tokens(
    db: Session,
    user: User,
    ip_address: str | None = None,
    user_agent: str | None = None,
    remember_me: bool = False,
) -> dict:
    """Issue a JWT access + refresh token pair and record the session."""
    settings = get_settings()
    jti = str(secrets.token_hex(16))  # Unique ID for this specific token session

    # Determine expiries
    access_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_days = 30 if remember_me else settings.REFRESH_TOKEN_EXPIRE_DAYS
    refresh_expires = timedelta(days=refresh_days)

    token_payload = {
        "sub": str(user.id),
        "email": user.email,
        "role": user.role.value,
        "jti": jti,
    }

    access_token = create_access_token(token_payload, expires_delta=access_expires)
    refresh_token = create_refresh_token(token_payload, expires_delta=refresh_expires)

    # Save session in database
    session_record = UserSession(
        user_id=user.id,
        token_jti=jti,
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=datetime.utcnow() + refresh_expires,
        is_active=True,
    )
    db.add(session_record)
    db.flush()

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "expires_in": int(access_expires.total_seconds()),
    }


# ---------------------------------------------------------------------------
# User Registration
# ---------------------------------------------------------------------------

def register_user(
    db: Session,
    full_name: str,
    email: str,
    password: str,
    phone_number: str | None = None,
    role: str = "farmer",
) -> dict:
    """
    Create a new user with email registration.
    Detects duplicates and sends a mock verification link.
    """
    # Detect duplicate email or phone
    filters = [User.email == email]
    if phone_number:
        filters.append(User.phone_number == phone_number)
    existing = db.query(User).filter(or_(*filters)).first()


    if existing:
        if existing.email == email:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
        else:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this phone number already exists")

    # Enforce password policy
    if len(password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters long")

    user = User(
        full_name=full_name,
        email=email,
        password_hash=hash_password(password),
        phone_number=phone_number,
        role=UserRole(role),
        is_verified=False,  # Email-verification required
    )
    db.add(user)
    db.flush()

    # Generate email verification token (temporary JWT token)
    verify_payload = {"sub": str(user.id), "email": user.email, "type": "verify_email"}
    verify_token = create_access_token(verify_payload, expires_delta=timedelta(hours=24))

    # Send mock verification email
    verify_link = f"http://localhost:8000/api/auth/verify-email?token={verify_token}"
    notif_service.send_notification(
        db,
        user_id=user.id,
        title="Verify Your FarmRent Email",
        message=f"Please verify your account by clicking: {verify_link}",
        channel="email",
    )
    print(f"\n[DEV] Verification Email Link: {verify_link}\n")

    return {
        "message": "Registration successful. Please check your email for the verification link.",
        "verification_token": verify_token,
    }


def verify_email(db: Session, token: str) -> dict:
    """Consume a verification token and activate the user."""
    try:
        payload = decode_token(token)
        if payload.get("type") != "verify_email":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid token type")
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification token")

    user = db.query(User).filter(User.id == UUID(user_id)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user.is_verified = True
    db.flush()

    return {"message": "Email verified successfully. You can now log in."}


def register_mobile_user(
    db: Session,
    full_name: str,
    phone_number: str,
    password: str,
    otp_code: str,
    role: str = "farmer",
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict:
    """Register user with phone number and OTP code verification."""
    # Verify OTP
    if not verify_otp(phone_number, otp_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OTP code")

    # Check duplicates
    existing = db.query(User).filter(
        or_(
            User.phone_number == phone_number,
            User.email == f"{phone_number}@farmrent.sms"  # Mock unique email for phone-only signup
        )
    ).first()

    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this mobile number already exists")

    if len(password) < 8:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters long")

    user = User(
        full_name=full_name,
        email=f"{phone_number}@farmrent.sms",  # placeholder email
        phone_number=phone_number,
        password_hash=hash_password(password),
        role=UserRole(role),
        is_verified=True,  # OTP verified phone users are verified immediately
    )
    db.add(user)
    db.flush()

    # Issue tokens
    return _issue_tokens(db, user, ip_address, user_agent, remember_me=False)


# ---------------------------------------------------------------------------
# User Login
# ---------------------------------------------------------------------------

def login_user(
    db: Session,
    email: str,
    password: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    remember_me: bool = False,
) -> dict:
    """Authenticate via email/password, returning JWT tokens."""
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.password_hash or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your email has not been verified. Please check your inbox.",
        )

    return _issue_tokens(db, user, ip_address, user_agent, remember_me)


def login_mobile_otp(
    db: Session,
    phone_number: str,
    otp_code: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    remember_me: bool = False,
) -> dict:
    """Authenticate via mobile OTP code."""
    if not verify_otp(phone_number, otp_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired OTP code")

    user = db.query(User).filter(User.phone_number == phone_number).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mobile number not registered.")

    return _issue_tokens(db, user, ip_address, user_agent, remember_me)


def login_google(
    db: Session,
    id_token: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    remember_me: bool = False,
) -> dict:
    """
    Authenticate via Google OAuth 2.0 ID Token.
    Accepts sandboxed credentials (starting with mock_).
    """
    if id_token.startswith("mock_"):
        # Local Sandbox Mock Mode
        name_part = id_token.replace("mock_", "")
        email = f"{name_part}@gmail.com"
        full_name = f"{name_part.capitalize()} Google"
    else:
        # Try real Google Token Verification or fail if keys are unset
        try:
            # Simple API mock / validation
            import requests as req
            res = req.get(f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}", timeout=5)
            if res.status_code != 200:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google OAuth token")
            payload = res.json()
            email = payload.get("email")
            full_name = payload.get("name", "Google User")
            if not email:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email not provided by Google")
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Google OAuth check failed: {e}")

    # Log in or auto-register user
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            full_name=full_name,
            email=email,
            password_hash=None,  # No password needed for Google accounts
            is_verified=True,   # Auto verified via Google
            role=UserRole.farmer,
        )
        db.add(user)
        db.flush()

    return _issue_tokens(db, user, ip_address, user_agent, remember_me)


# ---------------------------------------------------------------------------
# Sessions & Logout
# ---------------------------------------------------------------------------

def list_active_sessions(db: Session, user_id: UUID) -> list[dict]:
    """Retrieve all currently active logged-in sessions for a user."""
    sessions = (
        db.query(UserSession)
        .filter(
            UserSession.user_id == user_id,
            UserSession.is_active == True,  # noqa: E712
            UserSession.expires_at > datetime.utcnow(),
        )
        .all()
    )
    return [
        {
            "id": str(s.id),
            "ip_address": s.ip_address,
            "user_agent": s.user_agent,
            "created_at": s.created_at.isoformat(),
            "expires_at": s.expires_at.isoformat(),
        }
        for s in sessions
    ]


def logout_session(db: Session, user_id: UUID, session_id: UUID) -> dict:
    """Deactivate/revoke a specific token session."""
    sess = db.query(UserSession).filter(UserSession.id == session_id, UserSession.user_id == user_id).first()
    if not sess:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    sess.is_active = False
    db.flush()
    from utils.session_cache import revoke_session_cache
    revoke_session_cache(sess.token_jti)
    return {"message": "Session logged out successfully"}


def logout_all_sessions(db: Session, user_id: UUID) -> dict:
    """Deactivate/revoke all token sessions for a user (forces remote logout everywhere)."""
    from utils.session_cache import revoke_user_sessions_cache
    revoke_user_sessions_cache(db, user_id)
    db.query(UserSession).filter(UserSession.user_id == user_id, UserSession.is_active == True).update({"is_active": False})  # noqa: E712
    db.flush()
    return {"message": "Logged out from all sessions successfully"}


# ---------------------------------------------------------------------------
# Token Refresh
# ---------------------------------------------------------------------------

def refresh_access_token(db: Session, refresh_token: str, ip_address: str | None = None, user_agent: str | None = None) -> dict:
    """Validate a refresh token and issue a fresh access + refresh token pair."""
    try:
        payload = decode_token(refresh_token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token is not a refresh token")

    jti = payload.get("jti")
    user_id = payload.get("sub")

    # Check session revocation status via Redis cache
    from utils.session_cache import get_session_cache, set_session_cache, revoke_session_cache
    cached_status = get_session_cache(jti)
    if cached_status == "revoked":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or revoked")

    sess = None
    if cached_status != "active":
        sess = db.query(UserSession).filter(UserSession.token_jti == jti, UserSession.is_active == True).first()  # noqa: E712
        if not sess or sess.expires_at < datetime.utcnow():
            if sess:
                sess.is_active = False
                db.flush()
            set_session_cache(jti, "revoked", ttl=900)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired or revoked")

    user = db.query(User).filter(User.id == UUID(user_id)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Invalidate previous token session and generate new one
    if not sess:
        sess = db.query(UserSession).filter(UserSession.token_jti == jti).first()
    if sess:
        sess.is_active = False
        db.flush()
    revoke_session_cache(jti)

    return _issue_tokens(db, user, ip_address, user_agent, remember_me=False)


# ---------------------------------------------------------------------------
# Password Reset Recovery
# ---------------------------------------------------------------------------

def request_password_reset(db: Session, email: str) -> dict:
    """Generate a password reset token and notify the user."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # Silent response to prevent email discovery
        return {"message": "If that email is registered, a reset link has been sent."}

    token_str = secrets.token_urlsafe(64)
    # Expiry 30 minutes (per Security Requirements)
    reset_token = PasswordResetToken(
        user_id=user.id,
        reset_token=token_str,
        expires_at=datetime.utcnow() + timedelta(minutes=30),
        used=False,
    )
    db.add(reset_token)
    db.flush()

    # Send reset email
    reset_link = f"http://localhost:3000/reset-password?token={token_str}"
    notif_service.send_notification(
        db,
        user_id=user.id,
        title="Reset Your FarmRent Password",
        message=f"Click the link to reset your password within 30 minutes: {reset_link}",
        channel="email",
    )
    print(f"\n[DEV] Password Reset Link: {reset_link}\n")

    return {"message": "If that email is registered, a reset link has been sent."}


def confirm_password_reset(db: Session, token: str, new_password: str, client_ip: str | None = None) -> dict:
    """Validate token, enforce policy, rate-limit failures, and execute change."""
    redis_client = _get_redis_client()
    rate_limit_key = f"rate_limit:pw_reset:{client_ip}" if client_ip else None

    # Check Rate Limit (Max 5 failed attempts per hour per IP)
    if redis_client and rate_limit_key:
        attempts = redis_client.get(rate_limit_key)
        if attempts and int(attempts) >= 5:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed password reset attempts. Please try again in an hour.",
            )

    def _increment_failures():
        if redis_client and rate_limit_key:
            pipe = redis_client.pipeline()
            pipe.incr(rate_limit_key)
            pipe.expire(rate_limit_key, 3600, nx=True)
            pipe.execute()

    # Enforce password policy
    if len(new_password) < 8:
        _increment_failures()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 8 characters long")

    # Fetch token
    reset = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.reset_token == token, PasswordResetToken.used == False)  # noqa: E712
        .first()
    )

    if not reset:
        _increment_failures()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or already-used reset token")

    if reset.expires_at < datetime.utcnow():
        _increment_failures()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reset token has expired")

    user = db.query(User).filter(User.id == reset.user_id).first()
    if not user:
        _increment_failures()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Execute password update
    user.password_hash = hash_password(new_password)
    reset.used = True
    db.flush()

    # Revoke all current active sessions for security (remote logout on password change)
    logout_all_sessions(db, user.id)

    # Send confirmation email
    notif_service.send_notification(
        db,
        user_id=user.id,
        title="FarmRent Password Changed Successfully",
        message="Your password was successfully updated. If you did not make this change, contact support immediately.",
        channel="email",
    )

    return {"message": "Password has been reset successfully"}
