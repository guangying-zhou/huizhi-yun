import logging
import hashlib
import json
import random
import datetime
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Query, Body, Cookie, Response, Request
from pydantic import BaseModel, Field

from server.python_service.config import Config
from server.python_service.utils.auth_email import AuthEmailDeliveryError, send_auth_verification_email
try:
    import mysql.connector
except ImportError:
    mysql = None

router = APIRouter(prefix="/api/auth", tags=["auth"])
LOGGER = logging.getLogger(__name__)

# ========== Models ==========

class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

class LoginBody(BaseModel):
    email: str
    password: str
    rememberMe: Optional[bool] = False

class CheckEmailBody(BaseModel):
    email: str

class SendCodeBody(BaseModel):
    email: str

class VerifyCodeBody(BaseModel):
    email: str
    code: str

class ResetPasswordBody(BaseModel):
    email: str
    code: str
    password: str

class SetPasswordBody(BaseModel):
    email: str
    code: str
    password: str
    rememberMe: Optional[bool] = False

# ========== Helpers ==========

def _db_conn(settings: Optional[DatabaseSettings] = None):
    host = settings.host if settings and settings.host else Config.DB_HOST
    port = settings.port if settings and settings.port else Config.DB_PORT
    user = settings.user if settings and settings.user else Config.DB_USER
    password = settings.password if settings and settings.password else Config.DB_PASSWORD
    database = settings.name if settings and settings.name else Config.DB_NAME
    return mysql.connector.connect(host=host, port=port, user=user, password=password, database=database)

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def generate_verification_code() -> str:
    return str(random.randint(100000, 999999))

def set_auth_cookies(response: Response, user: Dict[str, Any], remember_me: bool = False, token: str = None):
    max_age = 30 * 24 * 60 * 60 if remember_me else 24 * 60 * 60

    # helper for cookie setting
    def set_c(key, value):
        response.set_cookie(
            key=key,
            value=str(value), # Ensure string
            max_age=max_age,
            path="/",
            samesite="lax",
            httponly=False
        )

    set_c('auth_user', user['username'] or user['email'].split('@')[0])
    set_c('auth_email', user['email'])
    set_c('auth_id', str(user['id']))
    set_c('auth_role', str(user['umask']))

    if token:
        set_c('token', token)
    else:
        set_c('token', f"email_{user['id']}_{int(datetime.datetime.now().timestamp()*1000)}")


# ========== Endpoints ==========

@router.post("/check-email")
def check_email(
    body: CheckEmailBody,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    if not body.email:
        raise HTTPException(status_code=400, detail="请提供有效的邮箱地址")

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, email, username, password_hash, status FROM system_users WHERE email = %s", (body.email.lower().strip(),))
        user = cur.fetchone()

        if not user:
            return {
                "exists": False,
                "status": None,
                "hasPassword": False,
                "message": "该邮箱未注册为系统用户"
            }

        return {
            "exists": True,
            "status": user['status'],
            "hasPassword": bool(user['password_hash']),
            "username": user['username']
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.post("/login")
def login(
    body: LoginBody,
    response: Response,
    request: Request,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    if not body.email or not body.password:
        raise HTTPException(status_code=400, detail="请提供邮箱和密码")

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, email, username, password_hash, umask, status FROM system_users WHERE email = %s", (body.email.lower().strip(),))
        user = cur.fetchone()

        if not user:
            # Matches Node logic: 404
            raise HTTPException(status_code=404, detail="该邮箱未注册为系统用户")

        if user['status'] == 0:
            raise HTTPException(status_code=403, detail="该账户已被禁用，请联系管理员")
        if user['status'] == 2:
            raise HTTPException(status_code=403, detail="账户未验证，请先验证邮箱")
        if not user['password_hash']:
             raise HTTPException(status_code=403, detail="请先设置密码")

        if hash_password(body.password) != user['password_hash']:
            raise HTTPException(status_code=401, detail="密码错误")

        # Client IP
        client_ip = request.client.host
        x_forwarded = request.headers.get("x-forwarded-for")
        if x_forwarded:
            client_ip = x_forwarded.split(",")[0].strip()

        # Update login info
        cur.execute("UPDATE system_users SET latest_logged_at = NOW(), login_ip = %s WHERE id = %s", (client_ip, user['id']))
        conn.commit()

        set_auth_cookies(response, user, body.rememberMe)

        return {
            "success": True,
            "user": {
                "id": user['id'],
                "email": user['email'],
                "username": user['username'],
                "umask": user['umask']
            }
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.post("/send-code")
def send_code(
    body: SendCodeBody,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    if not body.email:
        raise HTTPException(status_code=400, detail="请提供有效的邮箱地址")

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM system_users WHERE email = %s", (body.email.lower().strip(),))
        user = cur.fetchone()

        if not user:
            raise HTTPException(status_code=404, detail="该邮箱未注册为系统用户")
        if user['status'] == 0:
            raise HTTPException(status_code=403, detail="该账户已被禁用，请联系管理员")

        code = generate_verification_code()
        expired_at = datetime.datetime.now() + datetime.timedelta(minutes=10)

        cur.execute("UPDATE system_users SET verification_code = %s, vc_expired_at = %s WHERE id = %s", (code, expired_at, user['id']))
        conn.commit()

        try:
            send_auth_verification_email(
                recipient_email=user['email'],
                recipient_name=user['username'] or user['email'],
                code=code,
            )
        except AuthEmailDeliveryError:
            LOGGER.error("Authentication verification email could not be delivered")
            raise HTTPException(status_code=500, detail="发送验证邮件失败，请稍后重试")

        masked_email = user['email']
        if '@' in masked_email:
             head, tail = masked_email.split('@')
             masked_email = f"{head[:2]}***@{tail}"

        return {
            "success": True,
            "message": "验证码已发送到您的邮箱",
            "email": masked_email,
            "status": user['status'],
            "hasPassword": bool(user['password_hash'])
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.post("/verify-code")
def verify_code(
    body: VerifyCodeBody,
    request: Request,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    if not body.email or not body.code:
        raise HTTPException(status_code=400, detail="请提供邮箱和验证码")

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM system_users WHERE email = %s", (body.email.lower().strip(),))
        user = cur.fetchone()

        if not user:
            raise HTTPException(status_code=404, detail="该邮箱未注册为系统用户")
        if user['status'] == 0:
            raise HTTPException(status_code=403, detail="该账户已被禁用")

        if not user['verification_code'] or user['verification_code'] != body.code.strip():
            raise HTTPException(status_code=401, detail="验证码错误")

        if not user['vc_expired_at'] or user['vc_expired_at'] < datetime.datetime.now():
            raise HTTPException(status_code=401, detail="验证码已过期，请重新获取")

        client_ip = request.client.host
        x_forwarded = request.headers.get("x-forwarded-for")
        if x_forwarded:
            client_ip = x_forwarded.split(",")[0].strip()

        cur.execute("""
            UPDATE system_users
            SET verification_code = NULL,
                vc_expired_at = NULL,
                status = 1,
                latest_logged_at = NOW(),
                login_ip = %s
            WHERE id = %s
        """, (client_ip, user['id']))
        conn.commit()

        return {
            "success": True,
            "user": {
                "id": user['id'],
                "email": user['email'],
                "username": user['username'],
                "umask": user['umask'],
                "personId": user['person_id'],
                "departmentId": user['department_id'],
                "status": 1
            }
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.post("/reset-password")
def reset_password(
    body: ResetPasswordBody,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    if not body.email or not body.code or not body.password:
        raise HTTPException(status_code=400, detail="请提供邮箱、验证码和新密码")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码长度不能少于6位")

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM system_users WHERE email = %s", (body.email.lower().strip(),))
        user = cur.fetchone()

        if not user:
            raise HTTPException(status_code=404, detail="该邮箱未注册为系统用户")
        if user['status'] == 0:
            raise HTTPException(status_code=403, detail="该账户已被禁用")

        if not user['verification_code'] or user['verification_code'] != body.code.strip():
            raise HTTPException(status_code=401, detail="验证码错误")
        if not user['vc_expired_at'] or user['vc_expired_at'] < datetime.datetime.now():
            raise HTTPException(status_code=401, detail="验证码已过期，请重新获取")

        new_hash = hash_password(body.password)

        cur.execute("""
            UPDATE system_users
            SET verification_code = NULL,
                vc_expired_at = NULL,
                password_hash = %s,
                updated_at = NOW()
            WHERE id = %s
        """, (new_hash, user['id']))
        conn.commit()

        return {
            "success": True,
            "message": "密码重置成功，请使用新密码登录"
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.post("/set-password")
def set_password(
    body: SetPasswordBody,
    response: Response,
    request: Request,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    if not body.email or not body.code or not body.password:
        raise HTTPException(status_code=400, detail="请提供邮箱、验证码和新密码")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="密码长度不能少于6位")

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT * FROM system_users WHERE email = %s", (body.email.lower().strip(),))
        user = cur.fetchone()

        if not user:
             raise HTTPException(status_code=404, detail="该邮箱未注册为系统用户")
        if user['status'] == 0:
            raise HTTPException(status_code=403, detail="该账户已被禁用")

        if not user['verification_code'] or user['verification_code'] != body.code.strip():
            raise HTTPException(status_code=401, detail="验证码错误")
        if not user['vc_expired_at'] or user['vc_expired_at'] < datetime.datetime.now():
            raise HTTPException(status_code=401, detail="验证码已过期，请重新获取")

        client_ip = request.client.host
        x_forwarded = request.headers.get("x-forwarded-for")
        if x_forwarded:
            client_ip = x_forwarded.split(",")[0].strip()

        new_hash = hash_password(body.password)

        cur.execute("""
            UPDATE system_users
            SET verification_code = NULL,
                vc_expired_at = NULL,
                password_hash = %s,
                status = 1,
                latest_logged_at = NOW(),
                login_ip = %s,
                updated_at = NOW()
            WHERE id = %s
        """, (new_hash, client_ip, user['id']))
        conn.commit()

        set_auth_cookies(response, user, body.rememberMe)

        return {
            "success": True,
            "message": "密码设置成功",
            "user": {
                "id": user['id'],
                "email": user['email'],
                "username": user['username'],
                "umask": user['umask']
            }
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass
class PlatformLoginBody(BaseModel):
    email: str
    username: Optional[str] = None
    secret: str

@router.post("/platform-login")
def platform_login(
    body: PlatformLoginBody,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    if not body.email:
        raise HTTPException(status_code=400, detail="Missing email")
    if not body.secret:
        raise HTTPException(status_code=400, detail="Missing secret")

    if body.secret != Config.PLATFORM_SECRET:
        raise HTTPException(status_code=401, detail="Invalid platform secret")

    email = body.email
    username = body.username
    # ... rest of the function using email/username variables ...

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT id, email, username, password_hash, umask, status FROM system_users WHERE email = %s", (email.lower().strip(),))
        user = cur.fetchone()

        if not user:
            # Auto-provision user
            LOGGER.info(f"Auto-provisioning platform user: {email}")
            cur.execute("""
                INSERT INTO system_users (email, username, password_hash, status, created_at, updated_at)
                VALUES (%s, %s, '', 1, NOW(), NOW())
            """, (email.lower().strip(), username or email.split('@')[0]))
            conn.commit()
            
            # Fetch the new user
            cur.execute("SELECT id, email, username, password_hash, umask, status FROM system_users WHERE email = %s", (email.lower().strip(),))
            user = cur.fetchone()

        if user['status'] == 0:
             # If user existed but was disabled, maybe reactivate? Or just deny.
             # For now, deny as it might be manual ban.
            raise HTTPException(status_code=403, detail="Account disabled")

        return {
            "success": True,
            "user": {
                "id": user['id'],
                "email": user['email'],
                "username": user['username'],
                "umask": user['umask']
            },
            # Generate a temporary token if needed, or rely on cookie set by frontend
            # Here we just return user info so frontend can set cookie
            "token": f"platform_{user['id']}_{int(datetime.datetime.now().timestamp())}" 
        }

    except HTTPException:
        raise
    except Exception as exc:
        LOGGER.error(f"Platform login error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass
