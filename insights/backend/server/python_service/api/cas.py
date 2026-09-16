import logging
import requests
import datetime
import urllib.parse
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Query, Response, Request
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

router = APIRouter(prefix="/api/cas", tags=["cas"])
LOGGER = logging.getLogger(__name__)

# ========== Models ==========

class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

# ========== Helpers ==========

def _db_conn(settings: Optional[DatabaseSettings] = None):
    host = settings.host if settings and settings.host else Config.DB_HOST
    port = settings.port if settings and settings.port else Config.DB_PORT
    user = settings.user if settings and settings.user else Config.DB_USER
    password = settings.password if settings and settings.password else Config.DB_PASSWORD
    database = settings.name if settings and settings.name else Config.DB_NAME
    return mysql.connector.connect(host=host, port=port, user=user, password=password, database=database)

def set_auth_cookies(response: Response, user: Dict[str, Any], token: str):
    max_age = 24 * 60 * 60 # 1 day session for CAS login

    def set_c(key, value):
        response.set_cookie(
            key=key,
            value=str(value),
            max_age=max_age,
            path="/",
            samesite="lax",
            httponly=False
        )

    set_c('auth_user', user['username'] or user['email'].split('@')[0])
    set_c('auth_email', user['email'])
    set_c('auth_id', str(user['id']))
    set_c('auth_role', str(user['umask']))
    set_c('token', token)

# ========== Endpoints ==========

@router.get("/validate")
def validate_ticket(
    ticket: str,
    service: str,
    response: Response,
    request: Request,
    db: Optional[DatabaseSettings] = None
) -> Dict[str, Any]:
    if not ticket or not service:
        raise HTTPException(status_code=400, detail="Missing ticket or service")

    # Clean service URL (remove ticket param if present)
    clean_service = service
    if 'ticket=' in clean_service:
        try:
             # Basic URL cleaning logic matching Node
             u = urllib.parse.urlparse(clean_service)
             query = urllib.parse.parse_qs(u.query)
             if 'ticket' in query:
                 del query['ticket']
             clean_query = urllib.parse.urlencode(query, doseq=True)
             clean_service = urllib.parse.urlunparse((u.scheme, u.netloc, u.path, u.params, clean_query, u.fragment))
        except:
             pass

    # Build CAS validate URL
    # Can't easily use runtime config like Node.js '#imports'
    # Use env var directly.
    import os
    cas_base_url = os.environ.get("CAS_BASE_URL", "https://cas.wiztek.cn:8443")
    validate_url = f"{cas_base_url.rstrip('/')}/cas/p3/serviceValidate"

    try:
        res = requests.get(validate_url, params={
            "service": clean_service,
            "ticket": ticket
        }, timeout=10)

        xml = res.text
        # console log logic
        # LOGGER.info(f"CAS XML: {xml}")

        if "<cas:authenticationSuccess" not in xml:
             raise HTTPException(status_code=401, detail="CAS validation failed")

        # Extract user
        import re
        user_match = re.search(r"<cas:user>([^<]+)</cas:user>", xml)
        user_str = user_match.group(1) if user_match else ""

        mail_match = re.search(r"<cas:mail>([^<]+)</cas:mail>", xml) or re.search(r"<cas:email>([^<]+)</cas:email>", xml)
        email = mail_match.group(1) if mail_match else ""

        user_role = 0
        user_id = 0
        user_data = {"id": 0, "email": email, "username": user_str, "umask": 0}

        if email:
            # Query User
            try:
                conn = _db_conn(db)
                cur = conn.cursor(dictionary=True)
                cur.execute("SELECT id, umask, status, username, email FROM system_users WHERE email = %s AND status = 1 LIMIT 1", (email,))
                row = cur.fetchone()
                if row:
                    user_role = row['umask']
                    user_id = row['id']
                    user_data = row
                conn.close()
            except Exception as e:
                LOGGER.error(f"Failed to fetch system user: {e}")

        # Set Cookies
        set_auth_cookies(response, user_data, ticket)

        return {"ok": True, "user": user_str, "role": user_role}

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
