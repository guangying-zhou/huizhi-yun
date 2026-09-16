"""
Background scheduler for daily ingestion and other periodic tasks.

Uses APScheduler to run tasks within the uvicorn process.
The scheduler reads configuration from system_parameters and
uses MySQL GET_LOCK to prevent duplicate runs across multiple workers.
"""

import logging
import os
import subprocess
import sys
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from server.python_service.config import Config

try:
    import mysql.connector
except ImportError:
    mysql = None

LOGGER = logging.getLogger(__name__)

# Global scheduler instance
_scheduler: Optional[AsyncIOScheduler] = None

BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOCK_NAME = "codeinsight_daily_ingestion_lock"


def _get_db_connection():
    """Get a database connection using Config settings."""
    return mysql.connector.connect(
        host=Config.DB_HOST,
        port=Config.DB_PORT,
        user=Config.DB_USER,
        password=Config.DB_PASSWORD,
        database=Config.DB_NAME,
        autocommit=False,
    )


def _get_param(conn, key: str) -> Optional[str]:
    """Get a system parameter value."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key=%s LIMIT 1", (key,))
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        cur.close()


def _acquire_lock(conn, timeout: int = 0) -> bool:
    """Try to acquire MySQL advisory lock."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT GET_LOCK(%s, %s)", (LOCK_NAME, timeout))
        row = cur.fetchone()
        return bool(row and int(row[0]) == 1)
    finally:
        cur.close()


def _release_lock(conn) -> None:
    """Release MySQL advisory lock."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))
        conn.commit()
    finally:
        cur.close()


def _should_run_now(conn) -> tuple[bool, str]:
    """
    Check if daily ingestion should run now.
    Returns (should_run, reason).
    """
    import datetime as dt

    enabled = _get_param(conn, "daily_ingestion_enabled")
    if enabled is None or enabled.strip() != "1":
        return False, "daily_ingestion_enabled is not set to 1"

    raw = _get_param(conn, "daily_ingestion_cron") or "0 2 * * *"
    hh, mm = 2, 0
    try:
        if ":" in raw:
            hh, mm = map(int, raw.split(":"))
        else:
            parts = raw.split()
            if len(parts) == 5:
                mm = int(parts[0])
                hh = int(parts[1])
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            hh, mm = 2, 0
    except Exception:
        hh, mm = 2, 0

    now = dt.datetime.now()
    scheduled_today = now.replace(hour=hh, minute=mm, second=0, microsecond=0)

    if now < scheduled_today:
        return False, f"Not yet scheduled time ({raw})"

    last_run = _get_param(conn, "daily_ingestion_last_run")
    if last_run:
        try:
            last_dt = dt.datetime.fromisoformat(last_run)
            if last_dt.date() >= now.date():
                return False, f"Already ran today at {last_run}"
        except Exception:
            pass

    return True, "Ready to run"


async def check_and_run_daily_ingestion():
    """
    Check if daily ingestion should run and launch it if needed.
    Called periodically by the scheduler.
    """
    conn = None
    locked = False

    try:
        conn = _get_db_connection()

        # Check if we should run
        should_run, reason = _should_run_now(conn)
        if not should_run:
            LOGGER.debug(f"Daily ingestion check: {reason}")
            return

        # Try to acquire lock (non-blocking)
        if not _acquire_lock(conn, timeout=0):
            LOGGER.info("Daily ingestion: Another instance is running (could not acquire lock)")
            return
        locked = True

        LOGGER.info("Daily ingestion: Starting coordinator script")

        # Launch the coordinator script
        python = sys.executable or "python3"
        cmd = [python, "-m", "server.scripts.maintenance.daily_ingestion_coordinator", "--run-now"]

        env = dict(os.environ)
        existing_path = env.get("PYTHONPATH", "")
        if BACKEND_ROOT not in existing_path:
            env["PYTHONPATH"] = f"{BACKEND_ROOT}:{existing_path}" if existing_path else BACKEND_ROOT

        # Run in background (non-blocking)
        subprocess.Popen(
            cmd,
            env=env,
            cwd=BACKEND_ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        LOGGER.info("Daily ingestion: Coordinator script launched")

    except Exception as exc:
        LOGGER.exception(f"Daily ingestion check failed: {exc}")
    finally:
        if locked and conn:
            try:
                _release_lock(conn)
            except Exception:
                pass
        if conn:
            try:
                conn.close()
            except Exception:
                pass


def get_scheduler() -> AsyncIOScheduler:
    """Get or create the scheduler instance."""
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler()
    return _scheduler


def start_scheduler():
    """Start the background scheduler with all configured jobs."""
    scheduler = get_scheduler()

    # Add daily ingestion check job - runs every 5 minutes
    scheduler.add_job(
        check_and_run_daily_ingestion,
        CronTrigger(minute="*/5"),
        id="daily_ingestion_check",
        replace_existing=True,
        max_instances=1,
    )

    scheduler.start()
    LOGGER.info("Background scheduler started")


def stop_scheduler():
    """Stop the background scheduler."""
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        LOGGER.info("Background scheduler stopped")
