"""
routes/equipment.py
-------------------
Equipment CRUD, search, and image upload endpoints.
"""

from decimal import Decimal
from typing import Optional, Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, UploadFile, File, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, require_role
from models.user import User, UserRole
from schemas.equipment import (
    EquipmentCreateRequest,
    EquipmentDetailResponse,
    EquipmentListResponse,
    EquipmentResponse,
    EquipmentUpdateRequest,
)
from services import equipment as eq_service
from services import s3 as s3_service
from utils.pagination import PaginationParams

router = APIRouter(prefix="/api/equipment", tags=["equipment"])


@router.post("", response_model=EquipmentResponse, status_code=201)
def create_equipment(
    body: EquipmentCreateRequest,
    current_user: User = Depends(require_role(UserRole.owner, UserRole.admin)),
    db: Session = Depends(get_db),
) -> Any:
    """Create a new equipment listing. Requires 'owner' or 'admin' role."""
    return eq_service.create_equipment(db, owner=current_user, data=body.model_dump())


@router.post("/upload-images")
async def upload_equipment_images(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(require_role(UserRole.owner, UserRole.admin)),
) -> dict[str, list[str]]:
    """Upload multiple listing images (JPEG/PNG, min 1, max 10, max 5MB each)."""
    if len(files) < 1 or len(files) > 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You must upload between 1 and 10 images",
        )

    urls = []
    for file in files:
        # Validate format
        if file.content_type not in ["image/jpeg", "image/png", "image/jpg"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File {file.filename} is not a valid JPEG or PNG image",
            )

        # Read and check size
        contents = await file.read()
        if len(contents) > 5 * 1024 * 1024:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File {file.filename} exceeds the 5MB size limit",
            )

        # Validate file signature (magic bytes)
        from utils.file_validation import validate_image_file_signature
        validate_image_file_signature(contents, file.filename)

        # Store file
        url = s3_service.upload_file(contents, file.filename, file.content_type)
        urls.append(url)

    return {"images": urls}


@router.get("", response_model=EquipmentListResponse)
def search_equipment(
    pagination: PaginationParams = Depends(),
    keyword: Optional[str] = Query(None, description="Search keyword"),
    category: Optional[str] = Query(None),
    subcategory: Optional[str] = Query(None),
    min_price: Optional[Decimal] = Query(None, ge=0),
    max_price: Optional[Decimal] = Query(None, ge=0),
    availability: Optional[str] = Query(None, pattern="^(available|unavailable|booked)$"),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    radius_km: Optional[float] = Query(None, gt=0, le=500),
    sort_by: str = Query("created_at", pattern="^(created_at|price_asc|price_desc|name|rating|popularity|distance)$"),
    db: Session = Depends(get_db),
) -> Any:
    """Search equipment with filters. Public endpoint — no auth required."""
    return eq_service.search_equipment(
        db,
        params=pagination,
        keyword=keyword,
        category=category,
        subcategory=subcategory,
        min_price=min_price,
        max_price=max_price,
        availability=availability,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        sort_by=sort_by,
    )



@router.get("/my-listings", response_model=EquipmentListResponse)
def my_listings(
    pagination: PaginationParams = Depends(),
    current_user: User = Depends(require_role(UserRole.owner, UserRole.admin)),
    db: Session = Depends(get_db),
) -> Any:
    """List the authenticated owner's equipment."""
    return eq_service.list_owner_equipment(db, current_user.id, pagination)


@router.get("/{equipment_id}", response_model=EquipmentDetailResponse)
def get_equipment(equipment_id: UUID, db: Session = Depends(get_db)) -> Any:
    """Get equipment detail (public)."""
    return eq_service.get_equipment_by_id(db, equipment_id)


@router.put("/{equipment_id}", response_model=EquipmentResponse)
def update_equipment(
    equipment_id: UUID,
    body: EquipmentUpdateRequest,
    current_user: User = Depends(require_role(UserRole.owner, UserRole.admin)),
    db: Session = Depends(get_db),
) -> Any:
    """Update an equipment listing. Only the owner or admin can update."""
    return eq_service.update_equipment(
        db, equipment_id, current_user, body.model_dump(exclude_unset=True),
    )


@router.delete("/{equipment_id}", status_code=204)
def delete_equipment(
    equipment_id: UUID,
    current_user: User = Depends(require_role(UserRole.owner, UserRole.admin)),
    db: Session = Depends(get_db),
) -> None:
    """Soft delete an equipment listing. Only the owner or admin can delete."""
    eq_service.delete_equipment(db, equipment_id, current_user)

