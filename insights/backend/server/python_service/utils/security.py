"""
Security utilities for authentication and password handling.

Maintains compatibility with existing Node.js SHA256 hashing.
"""
import hashlib
from typing import Optional

from fastapi import Cookie, HTTPException, status


def hash_password(password: str) -> str:
    """
    Hash password using SHA256.

    Compatible with Node.js implementation:
    crypto.createHash('sha256').update(password).digest('hex')

    Args:
        password: Plain text password

    Returns:
        Hexadecimal hash string
    """
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify password against hash.

    Args:
        plain_password: Plain text password to verify
        hashed_password: Stored hash

    Returns:
        True if password matches
    """
    return hash_password(plain_password) == hashed_password


async def get_current_user(
    auth_id: Optional[str] = Cookie(None),
    auth_email: Optional[str] = Cookie(None),
    auth_role: Optional[str] = Cookie(None),
    token: Optional[str] = Cookie(None),
) -> dict:
    """
    Dependency to get current authenticated user from cookies.

    This maintains compatibility with the existing Node.js cookie-based auth.

    Args:
        auth_id: User ID from cookie
        auth_email: User email from cookie
        auth_role: User role (umask) from cookie
        token: Auth token from cookie

    Returns:
        Dict with user info

    Raises:
        HTTPException: If not authenticated
    """
    if not auth_id or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录或会话已过期",
        )

    return {
        "id": int(auth_id),
        "email": auth_email,
        "role": int(auth_role) if auth_role else 0,
    }


async def get_optional_user(
    auth_id: Optional[str] = Cookie(None),
    auth_email: Optional[str] = Cookie(None),
    auth_role: Optional[str] = Cookie(None),
) -> Optional[dict]:
    """
    Optional user dependency (doesn't raise if not authenticated).

    Returns:
        User dict if authenticated, None otherwise
    """
    if not auth_id:
        return None

    return {
        "id": int(auth_id),
        "email": auth_email,
        "role": int(auth_role) if auth_role else 0,
    }
