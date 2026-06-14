import uuid
import datetime
from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from database import Base


class UserSession(Base):
    __tablename__ = "user_sessions"

    __table_args__ = (
        Index("idx_user_sessions_jti", "token_jti", "is_active"),
    )

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id    = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_jti  = Column(String(255), unique=True, index=True, nullable=False)  # Unique JWT token ID for revocation
    ip_address = Column(String(45), nullable=True)  # Supports IPv4 and IPv6
    user_agent = Column(String(500), nullable=True)
    expires_at = Column(DateTime, nullable=False)
    is_active  = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    # Relationships
    user = relationship("User", back_populates="sessions")

    def __repr__(self) -> str:
        return f"<UserSession id={self.id} user_id={self.user_id} is_active={self.is_active}>"
