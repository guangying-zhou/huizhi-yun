import logging
import json
from typing import Dict, List, Optional, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from server.python_service.config import Config
try:
    import mysql.connector
except ImportError:
    mysql = None

router = APIRouter(prefix="/api/system", tags=["system"])
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

# ========== Endpoints ==========

@router.get("/ingestion_completed")
def get_ingestion_completed(db: Optional[DatabaseSettings] = None) -> bool:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key = 'ingestion_completed'")
        row = cur.fetchone()
        if row and row['param_value'] == 'true':
            return True
        return False
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass

@router.get("/users/by-email")
def get_user_by_email(email: str, db: Optional[DatabaseSettings] = None) -> Dict[str, Any]:
    try:
        conn = _db_conn(db)
        cur = conn.cursor(dictionary=True)

        cur.execute("""
            SELECT id, email, username, umask, status
            FROM system_users
            WHERE email = %s
        """, (email,))
        row = cur.fetchone()

        if not row:
             raise HTTPException(status_code=404, detail="User not found")

        return {
            "id": row['id'],
            "email": row['email'],
            "username": row['username'],
            "umask": row['umask'],
            "status": row['status']
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
         try: conn.close()
         except: pass
