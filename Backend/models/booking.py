import uuid
import datetime
import enum
from sqlalchemy import Column, Date, DateTime, Numeric, ForeignKey, Enum as SAEnum, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database import Base


class BookingStatus(str, enum.Enum):
    requested = "requested"
    pending   = "pending"
    confirmed = "confirmed"
    active    = "active"
    completed = "completed"
    cancelled = "cancelled"
    refunded  = "refunded"


class Booking(Base):
    __tablename__ = "bookings"

    __table_args__ = (
        Index(
            "idx_bookings_overlap",
            "equipment_id",
            "start_date",
            "end_date",
            postgresql_where=text("booking_status IN ('requested', 'pending', 'confirmed', 'active')"),
            sqlite_where=text("booking_status IN ('requested', 'pending', 'confirmed', 'active')")
        ),
    )

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id        = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    equipment_id   = Column(UUID(as_uuid=True), ForeignKey("equipment.id", ondelete="CASCADE"), nullable=False, index=True)
    start_date     = Column(Date, nullable=False)
    end_date       = Column(Date, nullable=False)
    booking_status = Column(
        SAEnum(BookingStatus, name="booking_status_enum"),
        default=BookingStatus.requested,
        nullable=False,
    )
    total_price = Column(Numeric(10, 2), nullable=False)
    created_at  = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at  = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )

    # Relationships
    user       = relationship("User", foreign_keys=[user_id], back_populates="bookings")
    equipment  = relationship("Equipment", back_populates="bookings")
    reviews    = relationship("Review", back_populates="booking", cascade="all, delete-orphan")
    extensions = relationship("BookingExtension", back_populates="booking", cascade="all, delete-orphan")


    def __repr__(self) -> str:
        return f"<Booking id={self.id} status={self.booking_status}>"
