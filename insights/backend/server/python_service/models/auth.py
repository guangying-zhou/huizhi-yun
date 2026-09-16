"""
Authentication-related Pydantic models.
"""
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """Request model for user login."""

    email: EmailStr = Field(..., description="用户邮箱")
    password: str = Field(..., min_length=6, description="密码")
    remember_me: bool = Field(False, alias="rememberMe", description="记住登录状态")

    model_config = {"populate_by_name": True}


class LoginResponse(BaseModel):
    """Response model for successful login."""

    success: bool
    user: dict


class SendCodeRequest(BaseModel):
    """Request model for sending verification code."""

    email: EmailStr = Field(..., description="接收验证码的邮箱")


class VerifyCodeRequest(BaseModel):
    """Request model for verifying email code."""

    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)


class SetPasswordRequest(BaseModel):
    """Request model for setting/resetting password."""

    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)
    password: str = Field(..., min_length=6, description="新密码")


class CheckEmailRequest(BaseModel):
    """Request model for checking if email is registered."""

    email: EmailStr


class UserInfo(BaseModel):
    """User information model."""

    id: int
    email: str
    username: Optional[str] = None
    umask: int = Field(description="用户权限掩码")
    status: int

    model_config = {"from_attributes": True}
