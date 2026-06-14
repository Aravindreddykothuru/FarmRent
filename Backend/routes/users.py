"""
routes/users.py
---------------
User profile and address management endpoints.
"""

from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File

from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user
from models.user import User
from schemas.user import (
    UserPublicProfile,
    UserResponse,
    UserUpdateRequest,
    AddressCreateRequest,
    AddressUpdateRequest,
    AddressResponse,
    NotificationPreferencesRequest,
)
from services import user as user_service
from services import s3 as s3_service

router = APIRouter(prefix="/api/users", tags=["users"])


# ---------------------------------------------------------------------------
# Profile Operations
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserResponse)
def get_own_profile(current_user: User = Depends(get_current_user)) -> User:
    """Return the authenticated user's full profile."""
    return current_user


@router.put("/me", response_model=UserResponse)
def update_own_profile(
    body: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Update the authenticated user's profile name and phone number."""
    return user_service.update_user_profile(
        db,
        user=current_user,
        full_name=body.full_name,
        phone_number=body.phone_number,
    )


@router.post("/me/profile-photo", response_model=UserResponse)
async def upload_profile_photo(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Upload profile photo (JPEG/PNG, max 5MB) and save link."""
    # Validate content type
    if file.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only JPEG and PNG formats are allowed",
        )

    # Read file and validate size (5MB = 5 * 1024 * 1024 bytes)
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Profile picture size cannot exceed 5MB",
        )

    # Validate file signature (magic bytes)
    from utils.file_validation import validate_image_file_signature
    validate_image_file_signature(contents, file.filename)

    # Upload via S3 / Local fallback service
    photo_url = s3_service.upload_file(contents, file.filename, file.content_type)
    
    # Save to user record
    return user_service.update_profile_photo(db, current_user.id, photo_url)


@router.put("/me/preferences", response_model=UserResponse)
def update_preferences(
    body: NotificationPreferencesRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Toggle notification channels (email, SMS, push) preferences."""
    return user_service.update_notification_preferences(
        db,
        user=current_user,
        preferences=body.model_dump(exclude_unset=True),
    )


@router.get("/{user_id}", response_model=UserPublicProfile)
def get_public_profile(user_id: UUID, db: Session = Depends(get_db)) -> User:
    """Return a user's public profile (no sensitive fields)."""
    return user_service.get_user_by_id(db, user_id)


# ---------------------------------------------------------------------------
# Address CRUD Operations
# ---------------------------------------------------------------------------

@router.get("/me/addresses", response_model=list[AddressResponse])
def get_addresses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> list[Any]:
    """Retrieve all contact/delivery addresses registered by the user."""
    return user_service.list_addresses(db, user_id=current_user.id)


@router.post("/me/addresses", response_model=AddressResponse, status_code=201)
def create_address(
    body: AddressCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Any:
    """Add a new delivery/contact address to the user's list."""
    return user_service.add_address(db, user_id=current_user.id, address_data=body.model_dump())


@router.put("/me/addresses/{address_id}", response_model=AddressResponse)
def update_address(
    address_id: UUID,
    body: AddressUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> Any:
    """Update details or default status of a specific address."""
    return user_service.update_address(
        db,
        user_id=current_user.id,
        address_id=address_id,
        address_data=body.model_dump(exclude_unset=True),
    )


@router.delete("/me/addresses/{address_id}", status_code=204)
def delete_address(
    address_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> None:
    """Delete a specific address."""
    user_service.delete_address(db, user_id=current_user.id, address_id=address_id)
