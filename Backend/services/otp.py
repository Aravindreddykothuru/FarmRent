import secrets
import logging
from redis import Redis
from redis.exceptions import ConnectionError as RedisConnectionError
from config import get_settings

logger = logging.getLogger(__name__)

# Fallback in-memory dictionary for OTP storage when Redis is unavailable
_memory_otp_store: dict[str, str] = {}


def _get_redis_client() -> Redis | None:
    """Return a Redis client if connection is successful, otherwise None."""
    settings = get_settings()
    if not settings.REDIS_URL:
        return None
    try:
        # Explicitly specify protocol=2 to avoid HELLO command in older Redis servers
        client = Redis.from_url(settings.REDIS_URL, decode_responses=True, protocol=2)
        # Test connection
        client.ping()
        return client
    except Exception as e:
        logger.warning("Redis is unreachable or misconfigured: %s. Falling back.", e)
        return None


def generate_otp() -> str:
    """Generate a secure 6-digit numeric OTP."""
    return "".join(secrets.choice("0123456789") for _ in range(6))


def send_otp(phone_number: str) -> str:
    """
    Generate an OTP for the given phone number, save it (5-min expiry),
    and simulate sending it by printing to console.
    """
    otp = generate_otp()
    redis_client = _get_redis_client()

    if redis_client:
        redis_client.setex(f"otp:{phone_number}", 300, otp)
    else:
        _memory_otp_store[phone_number] = otp
        # We can implement a simple clean-up or just rely on overwrite in dev

    # Simulate Twilio SMS send
    print(f"\n[OTP SMS] Twilio sending OTP code {otp} to {phone_number}\n")
    logger.info("OTP sent to %s", phone_number)
    
    return otp


def verify_otp(phone_number: str, otp_code: str) -> bool:
    """
    Verify the OTP for the given phone number.
    Returns True if valid, False otherwise. Deletes the OTP on success.
    """
    redis_client = _get_redis_client()

    if redis_client:
        stored_otp = redis_client.get(f"otp:{phone_number}")
        if stored_otp and stored_otp == otp_code:
            redis_client.delete(f"otp:{phone_number}")
            return True
    else:
        stored_otp = _memory_otp_store.get(phone_number)
        if stored_otp and stored_otp == otp_code:
            del _memory_otp_store[phone_number]
            return True

    return False
