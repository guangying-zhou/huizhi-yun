import logging
import hashlib
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Query, Body, Cookie, Request, Header
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

router = APIRouter(prefix="/api/profile", tags=["profile"])
LOGGER = logging.getLogger(__name__)

# ========== Models ==========

class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

class UpdateProfileBody(BaseModel):
    username: Optional[str] = None
    mobile: Optional[str] = None
    remark: Optional[str] = None

class ChangePasswordBody(BaseModel):
    currentPassword: Optional[str] = None
    newPassword: str

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


ROLE_ADMIN = 16
ROLE_DEPT_MANAGER = 2
ROLE_HR = 4
ROLE_SUPERVISOR = 8

def get_current_user_id(
    auth_id: Optional[str] = Cookie(None),
    auth_email: Optional[str] = Cookie(None),
    x_tenant_user_id: Optional[str] = Header(None, alias="x-tenant-user-id"),
    x_tenant_user_email: Optional[str] = Header(None, alias="x-tenant-user-email"),
    db: Optional[DatabaseSettings] = None
) -> int:
    # Check header first (SaaS proxy)
    if x_tenant_user_id:
        try:
            uid = int(x_tenant_user_id)
            if uid > 0: return uid
        except: pass

    # Logic matches Node.js: Check cookie auth_id, else auth_email
    user_id = 0
    if auth_id:
        try: user_id = int(auth_id)
        except: pass

    if user_id > 0:
        return user_id

    # Fallback: check email (cookie or header)
    email_to_check = x_tenant_user_email if x_tenant_user_email else auth_email
    if email_to_check:
        # Lookup by email
        try:
            conn = _db_conn(db)
            cur = conn.cursor(dictionary=True)
            cur.execute("SELECT id FROM system_users WHERE email = %s LIMIT 1", (email_to_check,))
            row = cur.fetchone()
            if row:
                return row['id']
        except Exception as e:
            LOGGER.error(f"Error checking user email: {e}")
        finally:
            try: conn.close()
            except: pass

    return 0

    if auth_email:
        # Lookup by email
        try:
            conn = _db_conn(db)
            cur = conn.cursor(dictionary=True)
            cur.execute("SELECT id FROM system_users WHERE email = %s LIMIT 1", (auth_email,))
            row = cur.fetchone()
            if row:
                return row['id']
        except Exception as e:
            LOGGER.error(f"Error checking user email: {e}")
        finally:
            try: conn.close()
            except: pass

    if user_id == 0:
        # Not authenticated
        # For dependency injection, maybe raise HTTPException?
        # But endpoints handle it.
        pass
    return user_id

# ========== Endpoints ==========

@router.get("/")
def get_profile(
    auth_id: Optional[str] = Cookie(None),
    auth_email: Optional[str] = Cookie(None),
    x_tenant_user_id: Optional[str] = Header(None, alias="x-tenant-user-id"),
    x_tenant_user_email: Optional[str] = Header(None, alias="x-tenant-user-email"),
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    user_id = get_current_user_id(auth_id, auth_email, x_tenant_user_id, x_tenant_user_email, db)
    if user_id == 0:
        raise HTTPException(status_code=401, detail="未登录或用户不存在")

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        sql = """
            SELECT
              su.id,
              su.email,
              su.username,
              su.umask,
              su.person_id,
              su.department_id,
              su.mobile,
              su.status,
              su.remark,
              su.latest_logged_at,
              su.login_ip,
              su.created_at,
              su.updated_at,
              COALESCE(p.real_name, p.username) as person_name,
              d.name as department_name
            FROM system_users su
            LEFT JOIN org_persons p ON su.person_id = p.id
            LEFT JOIN org_departments d ON su.department_id = d.id
            WHERE su.id = %s
        """
        cur.execute(sql, (user_id,))
        user = cur.fetchone()

        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")

        # Parse roles
        roles = []
        umask = user['umask'] or 0
        if umask & ROLE_ADMIN: roles.append('总经理')
        if umask & ROLE_SUPERVISOR: roles.append('分管领导')
        if umask & ROLE_HR: roles.append('HR')
        if umask & ROLE_DEPT_MANAGER: roles.append('部门经理')
        if not roles: roles.append('普通用户')

        return {
            "id": user['id'],
            "email": user['email'],
            "username": user['username'],
            "mobile": user['mobile'],
            "status": user['status'],
            "remark": user['remark'],
            "roles": roles,
            "umask": umask,
            "personId": user['person_id'],
            "personName": user['person_name'],
            "departmentId": user['department_id'],
            "departmentName": user['department_name'],
            "latestLoggedAt": str(user['latest_logged_at']) if user['latest_logged_at'] else None,
            "loginIp": user['login_ip'],
            "createdAt": str(user['created_at']) if user['created_at'] else None,
            "updatedAt": str(user['updated_at']) if user['updated_at'] else None
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.patch("/")
def update_profile(
    body: UpdateProfileBody,
    auth_id: Optional[str] = Cookie(None),
    auth_email: Optional[str] = Cookie(None),
    x_tenant_user_id: Optional[str] = Header(None, alias="x-tenant-user-id"),
    x_tenant_user_email: Optional[str] = Header(None, alias="x-tenant-user-email"),
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    user_id = get_current_user_id(auth_id, auth_email, x_tenant_user_id, x_tenant_user_email, db)
    if user_id == 0:
        raise HTTPException(status_code=401, detail="未登录或用户不存在")

    try:
        # Check updates?
        updates = []
        params = []

        if body.username is not None:
            updates.append("username = %s")
            params.append(body.username)
        if body.mobile is not None:
            updates.append("mobile = %s")
            params.append(body.mobile)
        if body.remark is not None:
            updates.append("remark = %s")
            params.append(body.remark)

        if not updates:
            raise HTTPException(status_code=400, detail="没有要更新的字段")

        updates.append("updated_at = NOW()")
        params.append(user_id)

        conn = _db_conn(db)
        cur = conn.cursor()

        sql = f"UPDATE system_users SET {', '.join(updates)} WHERE id = %s"
        cur.execute(sql, tuple(params))
        conn.commit()

        return {"success": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.post("/password")
def change_password(
    body: ChangePasswordBody,
    auth_id: Optional[str] = Cookie(None),
    auth_email: Optional[str] = Cookie(None),
    x_tenant_user_id: Optional[str] = Header(None, alias="x-tenant-user-id"),
    x_tenant_user_email: Optional[str] = Header(None, alias="x-tenant-user-email"),
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    user_id = get_current_user_id(auth_id, auth_email, x_tenant_user_id, x_tenant_user_email, db)
    if user_id == 0:
        raise HTTPException(status_code=401, detail="未登录或用户不存在")

    if not body.newPassword or len(body.newPassword) < 6:
        raise HTTPException(status_code=400, detail="新密码不能少于6位")

    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        cur.execute("SELECT id, password_hash FROM system_users WHERE id = %s", (user_id,))
        user = cur.fetchone()

        if not user:
             raise HTTPException(status_code=404, detail="用户不存在")

        if user['password_hash']:
            if not body.currentPassword:
                raise HTTPException(status_code=400, detail="请输入当前密码")

            current_hash = hash_password(body.currentPassword)
            if current_hash != user['password_hash']:
                 raise HTTPException(status_code=403, detail="当前密码不正确")

        new_hash = hash_password(body.newPassword)

        cur.execute("UPDATE system_users SET password_hash = %s, updated_at = NOW() WHERE id = %s", (new_hash, user_id))
        conn.commit()

        return {"success": True, "message": "密码修改成功"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass
