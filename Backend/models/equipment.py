import uuid
import datetime
import enum
from sqlalchemy import Column, String, Text, Numeric, DateTime, JSON, Float, ForeignKey, Boolean, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database import Base


class AvailabilityStatus(str, enum.Enum):
    available   = "available"
    unavailable = "unavailable"
    booked      = "booked"


class Equipment(Base):
    __tablename__ = "equipment"

    id                  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id            = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    equipment_name      = Column(String(200), nullable=False)
    category            = Column(String(100), nullable=False, index=True)
    subcategory         = Column(String(100), nullable=True, index=True)

    description         = Column(Text, nullable=True)
    price_per_day       = Column(Numeric(10, 2), nullable=False)
    price_weekly        = Column(Numeric(10, 2), nullable=True)
    price_monthly       = Column(Numeric(10, 2), nullable=True)
    availability_status = Column(
        SAEnum(AvailabilityStatus, name="availability_status_enum"),
        default=AvailabilityStatus.available,
        nullable=False,
    )
    specifications = Column(JSON, nullable=True)   # e.g. {"horsepower": 75, "fuel_type": "diesel"}
    images         = Column(JSON, nullable=True)   # list of S3 URLs
    latitude       = Column(Float, nullable=True, index=True)
    longitude      = Column(Float, nullable=True, index=True)
    address        = Column(String(255), nullable=True)
    is_deleted     = Column(Boolean, default=False, nullable=False)
    created_at     = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at     = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )

    # Relationships
    owner               = relationship("User", back_populates="equipment")
    bookings            = relationship("Booking", back_populates="equipment", cascade="all, delete-orphan")
    maintenance_records = relationship("Maintenance", back_populates="equipment", cascade="all, delete-orphan")


    def __repr__(self) -> str:
        return f"<Equipment id={self.id} name={self.equipment_name!r} status={self.availability_status}>"
