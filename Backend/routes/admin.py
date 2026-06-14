"""
routes/admin.py
---------------
Administrative endpoints: user management, listing moderation,
booking oversight, dashboard stats, analytics.
All require admin role.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from dependencies import require_role
from models.booking import Booking
from models.equipment import Equipment
from models.user import User, UserRole
from schemas.admin import AdminDashboardStats, AdminUserListResponse, AnalyticsSummary
from schemas.booking import BookingListResponse
from schemas.equipment import EquipmentListResponse
from services import analytics as analytics_service
from services import user as user_service
from utils.pagination import PaginationParams, paginate

router = APIRouter(prefix="/api/admin", tags=["admin"])

# All routes in this module require admin role
_admin = Depends(require_role(UserRole.admin))


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@router.get("/users", response_model=AdminUserListResponse, dependencies=[_admin])
def list_users(
    pagination: PaginationParams = Depends(),
    search: Optional[str] = Query(None, description="Search by name or email"),
    db: Session = Depends(get_db),
):
    """List all users (paginated, searchable)."""
    query = db.query(User).order_by(User.created_at.desc())
    if search:
        pattern = f"%{search}%"
        from sqlalchemy import or_
        query = query.filter(
            or_(User.full_name.ilike(pattern), User.email.ilike(pattern))
        )
    return paginate(query, pagination)


@router.patch("/users/{user_id}/role", dependencies=[_admin])
def change_user_role(
    user_id: UUID,
    role: str = Query(..., pattern="^(farmer|owner|admin)$"),
    db: Session = Depends(get_db),
):
    """Change a user's role."""
    user = user_service.get_user_by_id(db, user_id)
    user.role = UserRole(role)
    db.flush()
    return {"message": f"User role updated to '{role}'", "user_id": str(user_id)}


@router.delete("/users/{user_id}", status_code=204, dependencies=[_admin])
def delete_user(user_id: UUID, db: Session = Depends(get_db)):
    """Delete a user (cascades to all their data)."""
    user = user_service.get_user_by_id(db, user_id)
    db.delete(user)
    db.flush()


@router.patch("/users/{user_id}/verify-identity", dependencies=[_admin])
def verify_user_identity(
    user_id: UUID,
    verified: bool = Query(..., description="Set identity verification status"),
    db: Session = Depends(get_db),
):
    """Approve or reject owner identity verification status."""
    user = user_service.get_user_by_id(db, user_id)
    user.identity_verified = verified
    db.flush()
    return {"message": f"User identity verification status updated to {verified}", "user_id": str(user_id)}


@router.post("/users/{user_id}/gdpr", status_code=200, dependencies=[_admin])
def gdpr_anonymize_user(user_id: UUID, db: Session = Depends(get_db)):
    """Perform GDPR-compliant anonymization of user personal data."""
    user = user_service.get_user_by_id(db, user_id)

    user.full_name = "Anonymized User"
    user.email = f"anonymized_{user.id}@farmrent.com"
    user.phone_number = None
    user.password_hash = None
    user.profile_photo = None
    user.identity_verified = False
    user.notification_preferences = None

    # Delete addresses
    from models.address import Address
    db.query(Address).filter(Address.user_id == user.id).delete(synchronize_session=False)

    # Delete sessions
    from utils.session_cache import revoke_user_sessions_cache
    revoke_user_sessions_cache(db, user.id)
    from models.session import UserSession
    db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)

    # Delete reset tokens
    from models.password_reset import PasswordResetToken
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user.id).delete(synchronize_session=False)

    db.flush()
    return {"message": "User personal data anonymized for GDPR compliance", "user_id": str(user_id)}



# ---------------------------------------------------------------------------
# Equipment moderation
# ---------------------------------------------------------------------------

@router.get("/equipment", response_model=EquipmentListResponse, dependencies=[_admin])
def list_all_equipment(
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
):
    """List all equipment listings (admin view)."""
    query = db.query(Equipment).order_by(Equipment.created_at.desc())
    return paginate(query, pagination)


@router.delete("/equipment/{equipment_id}", status_code=204, dependencies=[_admin])
def remove_listing(equipment_id: UUID, db: Session = Depends(get_db)):
    """Remove an equipment listing (admin moderation)."""
    eq = db.query(Equipment).filter(Equipment.id == equipment_id).first()
    if not eq:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Equipment not found")
    db.delete(eq)
    db.flush()


# ---------------------------------------------------------------------------
# Booking oversight
# ---------------------------------------------------------------------------

@router.get("/bookings", response_model=BookingListResponse, dependencies=[_admin])
def list_all_bookings(
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db),
):
    """List all bookings (admin view)."""
    query = db.query(Booking).order_by(Booking.created_at.desc())
    return paginate(query, pagination)


# ---------------------------------------------------------------------------
# Dashboard & Analytics
# ---------------------------------------------------------------------------

@router.get("/dashboard", response_model=AdminDashboardStats, dependencies=[_admin])
def dashboard(db: Session = Depends(get_db)):
    """Aggregated platform statistics."""
    return analytics_service.get_dashboard_stats(db)


@router.get("/analytics", response_model=AnalyticsSummary, dependencies=[_admin])
def analytics(db: Session = Depends(get_db)):
    """Revenue, top categories, and growth analytics."""
    return analytics_service.get_analytics(db)
