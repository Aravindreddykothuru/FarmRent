"""
routes/auth.py
--------------
Authentication endpoints: email/OTP/Google registration & login, sessions, password reset.
"""

from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, Request, Query
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models.user import User
from schemas.auth import (
    LoginRequest,
    MobileRegisterRequest,
    SendOTPRequest,
    MobileLoginRequest,
    GoogleLoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshTokenRequest,
    RegisterRequest,
    TokenResponse,
    UserSessionResponse,
)
from schemas.user import UserResponse
from services import auth as auth_service
from services import otp as otp_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# Registration Pathways
# ---------------------------------------------------------------------------

@router.post("/register", status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Create a new user account (unverified) and dispatch verification email."""
    return auth_service.register_user(
        db,
        full_name=body.full_name,
        email=body.email,
        password=body.password,
        phone_number=body.phone_number,
        role=body.role,
    )


@router.get("/verify-email")
def verify_email(token: str = Query(...), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Verify email address using token from verification link."""
    return auth_service.verify_email(db, token=token)


@router.post("/register/mobile", response_model=TokenResponse, status_code=201)
def register_mobile(
    body: MobileRegisterRequest,
    request: Request,
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Create verified mobile user account using phone number and OTP code."""
    ip_addr = request.client.host if request.client else None
    user_agt = request.headers.get("user-agent")
    return auth_service.register_mobile_user(
        db,
        full_name=body.full_name,
        phone_number=body.phone_number,
        password=body.password,
        otp_code=body.otp_code,
        role=body.role,
        ip_address=ip_addr,
        user_agent=user_agt,
    )


@router.post("/otp/send")
def send_otp(body: SendOTPRequest) -> dict[str, Any]:
    """Generate and dispatch OTP code via SMS to a user's phone number."""
    code = otp_service.send_otp(body.phone_number)
    return {"message": "OTP sent successfully", "phone_number": body.phone_number, "dev_otp": code}


# ---------------------------------------------------------------------------
# Login Methods
# ---------------------------------------------------------------------------

@router.post("/login", response_model=TokenResponse)
def login(
    body: LoginRequest,
    request: Request,
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Authenticate with email + password, receive JWT tokens + session."""
    ip_addr = request.client.host if request.client else None
    user_agt = request.headers.get("user-agent")
    return auth_service.login_user(
        db,
        email=body.email,
        password=body.password,
        ip_address=ip_addr,
        user_agent=user_agt,
        remember_me=body.remember_me,
    )


@router.post("/login/otp", response_model=TokenResponse)
def login_otp(
    body: MobileLoginRequest,
    request: Request,
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Authenticate with mobile number + OTP code, receive JWT tokens + session."""
    ip_addr = request.client.host if request.client else None
    user_agt = request.headers.get("user-agent")
    return auth_service.login_mobile_otp(
        db,
        phone_number=body.phone_number,
        otp_code=body.otp_code,
        ip_address=ip_addr,
        user_agent=user_agt,
        remember_me=body.remember_me,
    )


@router.post("/login/google", response_model=TokenResponse)
def login_google(
    body: GoogleLoginRequest,
    request: Request,
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Authenticate via Google Sign-In, returning JWT tokens."""
    ip_addr = request.client.host if request.client else None
    user_agt = request.headers.get("user-agent")
    return auth_service.login_google(
        db,
        id_token=body.id_token,
        ip_address=ip_addr,
        user_agent=user_agt,
        remember_me=body.remember_me,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    body: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Exchange a valid refresh token for a new token pair."""
    ip_addr = request.client.host if request.client else None
    user_agt = request.headers.get("user-agent")
    return auth_service.refresh_access_token(
        db,
        refresh_token=body.refresh_token,
        ip_address=ip_addr,
        user_agent=user_agt,
    )


# ---------------------------------------------------------------------------
# Session Control & Logout
# ---------------------------------------------------------------------------

@router.get("/sessions", response_model=list[UserSessionResponse])
def get_sessions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> list[dict[str, Any]]:
    """List all currently active sessions for the authenticated user."""
    return auth_service.list_active_sessions(db, user_id=current_user.id)


@router.post("/sessions/{session_id}/logout")
def logout_session(
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Revoke a specific active session, force-logging it out."""
    return auth_service.logout_session(db, user_id=current_user.id, session_id=session_id)


@router.post("/logout-all")
def logout_all(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Revoke all active sessions for the user (forces logout everywhere)."""
    return auth_service.logout_all_sessions(db, user_id=current_user.id)


# ---------------------------------------------------------------------------
# Password Recovery
# ---------------------------------------------------------------------------

@router.post("/password-reset")
def request_password_reset(body: PasswordResetRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Request a password reset email."""
    return auth_service.request_password_reset(db, email=body.email)


@router.post("/forgot-password")
def forgot_password(body: PasswordResetRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Initiate password reset flow."""
    return auth_service.request_password_reset(db, email=body.email)


@router.post("/password-reset/confirm")
def confirm_password_reset(
    body: PasswordResetConfirm,
    request: Request,
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Reset password using a valid reset token (rate-limited by IP)."""
    client_ip = request.client.host if request.client else "unknown"
    return auth_service.confirm_password_reset(
        db,
        token=body.token,
        new_password=body.new_password,
        client_ip=client_ip,
    )


@router.post("/reset-password")
def reset_password(
    body: PasswordResetConfirm,
    request: Request,
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Submit new password with valid reset token."""
    client_ip = request.client.host if request.client else "unknown"
    return auth_service.confirm_password_reset(
        db,
        token=body.token,
        new_password=body.new_password,
        client_ip=client_ip,
    )


@router.get("/verify-reset-token")
def verify_reset_token(token: str = Query(...), db: Session = Depends(get_db)) -> dict[str, Any]:
    """Validate reset token before displaying reset form."""
    from models.password_reset import PasswordResetToken
    from datetime import datetime
    prt = db.query(PasswordResetToken).filter(
        PasswordResetToken.reset_token == token,
        PasswordResetToken.expires_at > datetime.utcnow(),
        PasswordResetToken.used == False
    ).first()
    if not prt:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    return {"message": "Reset token is valid", "user_id": str(prt.user_id)}


@router.post("/logout")
def logout(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Invalidate current session token."""
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            from utils.security import decode_token
            payload = decode_token(token)
            jti = payload.get("jti")
            if jti:
                from models.session import UserSession
                sess = db.query(UserSession).filter(UserSession.token_jti == jti).first()
                if sess:
                    sess.is_active = False
                    db.flush()
                from utils.session_cache import revoke_session_cache
                revoke_session_cache(jti)
        except Exception:
            pass
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user's profile."""
    return current_user
