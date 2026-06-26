import logging
import os
import subprocess
import time
import uuid
import datetime as dt
from typing import Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Import new API routers
from server.python_service.api import auth
from server.python_service.api import dashboard_contributors
from server.python_service.api import dashboard_repos
from server.python_service.api import dashboard_complete
from server.python_service.api import repos
from server.python_service.api import contributors
from server.python_service.api import departments
from server.python_service.api import settings
from server.python_service.api import ingestion
from server.python_service.api import monitoring
from server.python_service.api import reports
from server.python_service.api import commits
from server.python_service.api import statistics
from server.python_service.api import profile
from server.python_service.api import system
from server.python_service.api import dashboard
from server.python_service.api import cas


# Import existing data ingestion modules
from server.scripts import (
    sync_gitlab_commits,
    sync_svn_commits,

)



from server.scripts.log_utils import configure_logging
from server.python_service.config import Config
from server.python_service.scheduler import start_scheduler, stop_scheduler

try:
    import mysql.connector  # type: ignore
except Exception:  # pragma: no cover
    mysql = None  # type: ignore

# Configure logging globally for the service (file only, no stdout)
configure_logging(os.environ.get("LOG_LEVEL", "INFO"), console_output=False)

LOGGER = logging.getLogger(__name__)

# Ensure background scripts spawned by this service can import the top-level
# `server` package even if uvicorn is started from a subdirectory.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _child_env(triggered_by: str) -> Dict[str, str]:
    env: Dict[str, str] = dict(os.environ)
    env["TRIGGERED_BY"] = triggered_by
    existing = env.get("PYTHONPATH")
    if existing:
        paths = existing.split(os.pathsep)
        if REPO_ROOT not in paths:
            env["PYTHONPATH"] = os.pathsep.join([REPO_ROOT, existing])
    else:
        env["PYTHONPATH"] = REPO_ROOT
    return env

app = FastAPI(
    title="CodeInsight Backend Service",
    version="2.0.0",
    description="FastAPI backend for CodeInsight - Repository analytics and management platform.",
)


@app.on_event("startup")
async def on_startup():
    """Start background scheduler on application startup."""
    LOGGER.info("Starting background scheduler...")
    start_scheduler()


@app.on_event("shutdown")
async def on_shutdown():
    """Stop background scheduler on application shutdown."""
    LOGGER.info("Stopping background scheduler...")
    stop_scheduler()


# Configure CORS (matching Node.js configuration)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
# app.include_router(auth.router)
# Dashboard complete module (detailed endpoints) - Replaced by dashboard.py
# app.include_router(dashboard_complete.contributors_detail_router)
# app.include_router(dashboard_complete.repos_router)
# app.include_router(dashboard_complete.departments_router)
# app.include_router(dashboard_complete.overview_router)
# Management APIs
app.include_router(repos.router)
app.include_router(contributors.router)
app.include_router(departments.router)
app.include_router(settings.router)
app.include_router(ingestion.router)
app.include_router(monitoring.router)
app.include_router(reports.router)
app.include_router(commits.router)
app.include_router(statistics.router)
app.include_router(profile.router)
app.include_router(system.router)
app.include_router(dashboard.router)
app.include_router(auth.router)
app.include_router(cas.router)


# Force reload for departments
class DatabaseSettings(BaseModel):
    host: Optional[str] = Field(None, description="Database host")
    port: Optional[int] = Field(None, description="Database port")
    user: Optional[str] = Field(None, description="Database user name")
    password: Optional[str] = Field(None, description="Database password")
    name: Optional[str] = Field(None, description="Database schema name")

























def _db_overrides(settings: Optional[DatabaseSettings]) -> Dict[str, object]:
    overrides: Dict[str, object] = {}
    if settings is None:
        return overrides
    if settings.host is not None:
        overrides["db_host"] = settings.host
    if settings.port is not None:
        overrides["db_port"] = settings.port
    if settings.user is not None:
        overrides["db_user"] = settings.user
    if settings.password is not None:
        overrides["db_password"] = settings.password
    if settings.name is not None:
        overrides["db_name"] = settings.name
    return overrides





def _db_conn(settings: Optional[DatabaseSettings]):
    host = settings.host if settings and settings.host else Config.DB_HOST
    port = settings.port if settings and settings.port else Config.DB_PORT
    user = settings.user if settings and settings.user else Config.DB_USER
    password = settings.password if settings and settings.password else Config.DB_PASSWORD
    database = settings.name if settings and settings.name else Config.DB_NAME
    return mysql.connector.connect(host=host, port=port, user=user, password=password, database=database)





@app.get("/healthz")
def healthcheck() -> Dict[str, str]:
    return {"status": "ok"}




















# NOTE: /statistics/update and /statistics/status endpoints have been removed.
# Please use /run/aggregate-stats instead, which uses the current aggregate_stats.py script.





