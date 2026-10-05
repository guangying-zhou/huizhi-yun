#!/usr/bin/env python3
"""Daily ingestion coordinator

This script coordinates the full data processing pipeline:
1. Scan - Discover repos from sources (scan_repos.py)
2. Sync - Fetch commit metadata (sync_gitlab_commits.py, sync_svn_commits.py)
3. Ingest - Download diffs and file details (ingest_commit_files.py)
4. Dedup - Remove duplicate file records (deduplicate_repo_files.py)
5. Aggregate - Calculate statistics (aggregate_stats.py)

It reads schedule config from `system_parameters` and will only run when:
- daily_ingestion_enabled = '1'
- Current time >= daily_ingestion_cron time
- Not already run today (checked via daily_ingestion_last_run)

Uses MySQL GET_LOCK to prevent concurrent executions.

Usage:
  # Check if it's time to run (called by cron/systemd every 5 minutes)
  python3 -m server.scripts.maintenance.daily_ingestion_coordinator

  # Force run now (for manual trigger)
  python3 -m server.scripts.maintenance.daily_ingestion_coordinator --run-now

  # Dry run (just report if it would run)
  python3 -m server.scripts.maintenance.daily_ingestion_coordinator --dry-run

Environment variables:
  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from typing import Dict, List, Optional, Tuple

try:
    import mysql.connector  # type: ignore
except ImportError as exc:
    raise SystemExit("mysql-connector-python is required. Install with pip") from exc

from server.scripts.log_utils import configure_logging

# Configure logging
configure_logging(os.environ.get("LOG_LEVEL", "INFO"))

import logging
LOGGER = logging.getLogger(__name__)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "..", ".."))
LOCK_NAME = "codeinsight_daily_ingestion_lock"

# Default steps in order
DEFAULT_STEPS = ["scan", "sync", "ingest", "dedup", "aggregate"]


def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "codeinsightdb"),
        autocommit=False,
    )


def acquire_lock(conn, timeout: int = 0) -> bool:
    """Acquire advisory lock. Returns True if acquired."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT GET_LOCK(%s, %s)", (LOCK_NAME, timeout))
        row = cur.fetchone()
        return bool(row and int(row[0]) == 1)
    finally:
        cur.close()


def release_lock(conn) -> None:
    """Release advisory lock."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))
        conn.commit()
    finally:
        cur.close()


def get_param(conn, key: str) -> Optional[str]:
    """Get a system parameter value."""
    cur = conn.cursor()
    try:
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key=%s LIMIT 1", (key,))
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        cur.close()


def set_param(conn, key: str, value: str, description: str = "") -> None:
    """Set a system parameter value."""
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO system_parameters (param_key, param_value, description) "
            "VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE param_value=VALUES(param_value)",
            (key, value, description),
        )
        conn.commit()
    finally:
        cur.close()


def create_run(conn, params: Dict) -> int:
    """Create an ingestion run record."""
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO ingestion_runs (job_type, source_type, status, started_at, params) "
            "VALUES (%s, %s, %s, NOW(6), %s)",
            ("daily_ingestion", "orchestrator", "running", json.dumps(params, ensure_ascii=False)),
        )
        run_id = cur.lastrowid
        conn.commit()
        return run_id
    finally:
        cur.close()


def finalize_run(conn, run_id: int, status: str, processed: int, failed: int, error_message: Optional[str]) -> None:
    """Finalize an ingestion run record."""
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE ingestion_runs SET status=%s, finished_at=NOW(6), items_processed=%s, items_failed=%s, error_message=%s WHERE id=%s",
            (status, processed, failed, error_message, run_id),
        )
        conn.commit()
    finally:
        cur.close()


def insert_run_log(conn, run_id: int, level: str, message: str, context: Optional[Dict] = None) -> None:
    """Insert a log entry for the run."""
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context, created_at) "
            "VALUES (%s, %s, %s, %s, NOW(6))",
            (run_id, level, message, json.dumps(context or {}, ensure_ascii=False)),
        )
        conn.commit()
    finally:
        cur.close()


def should_run_today(conn) -> Tuple[bool, str]:
    """
    Check if we should run today based on system parameters.
    Returns (should_run, reason).
    """
    enabled = get_param(conn, "daily_ingestion_enabled")
    if enabled is None or enabled.strip() != "1":
        return False, "daily_ingestion_enabled is not set to 1"

    raw = get_param(conn, "daily_ingestion_cron") or "0 2 * * *"
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

    last_run = get_param(conn, "daily_ingestion_last_run")
    if last_run:
        try:
            last_dt = dt.datetime.fromisoformat(last_run)
            if last_dt.date() >= now.date():
                return False, f"Already ran today at {last_run}"
        except Exception:
            pass

    return True, "Ready to run"


def get_steps(conn) -> List[str]:
    """Get the list of steps to run from system parameters."""
    steps_str = get_param(conn, "daily_ingestion_steps")
    if steps_str:
        return [s.strip() for s in steps_str.split(",") if s.strip()]
    return DEFAULT_STEPS


def run_script(script_module: str, args: List[str] = None, timeout: int = 7200) -> Tuple[int, str, str]:
    """
    Run a Python script as a subprocess.
    Returns (return_code, stdout, stderr).
    """
    python = sys.executable or "python3"
    cmd = [python, "-m", script_module] + (args or [])
    
    env = dict(os.environ)
    # Ensure PYTHONPATH includes backend root
    existing_path = env.get("PYTHONPATH", "")
    if BACKEND_ROOT not in existing_path:
        env["PYTHONPATH"] = f"{BACKEND_ROOT}:{existing_path}" if existing_path else BACKEND_ROOT

    LOGGER.info(f"Running: {' '.join(cmd)}")
    
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            timeout=timeout,
            cwd=BACKEND_ROOT,
        )
        return proc.returncode, proc.stdout or "", proc.stderr or ""
    except subprocess.TimeoutExpired:
        return 254, "", "Timeout expired"
    except Exception as exc:
        return 255, "", str(exc)


def run_step(conn, run_id: int, step: str) -> Tuple[bool, str]:
    """
    Run a single step of the pipeline.
    Returns (success, message).
    """
    insert_run_log(conn, run_id, "INFO", f"Starting step: {step}", {"step": step})

    success = True
    message = ""

    if step == "scan":
        rc, out, err = run_script("server.scripts.scan_repos")
        if rc != 0:
            success = False
            message = f"scan_repos failed with rc={rc}: {err[:500]}"

    elif step == "sync":
        # Run GitLab sync
        rc1, out1, err1 = run_script("server.scripts.sync_gitlab_commits")
        if rc1 != 0:
            insert_run_log(conn, run_id, "WARNING", f"sync_gitlab_commits failed with rc={rc1}", {"stderr": err1[:1000]})

        # Run SVN sync
        rc2, out2, err2 = run_script("server.scripts.sync_svn_commits")
        if rc2 != 0:
            insert_run_log(conn, run_id, "WARNING", f"sync_svn_commits failed with rc={rc2}", {"stderr": err2[:1000]})

        if rc1 != 0 and rc2 != 0:
            success = False
            message = "Both GitLab and SVN sync failed"

    elif step == "ingest":
        rc, out, err = run_script(
            "server.scripts.ingest_commit_files",
            ["--include-invalid", "--save-diffs"],
            timeout=14400,  # 4 hours for potentially long ingestion
        )
        if rc != 0:
            success = False
            message = f"ingest_commit_files failed with rc={rc}: {err[:500]}"

    elif step == "dedup":
        rc, out, err = run_script("server.scripts.deduplicate_repo_files", timeout=7200)
        if rc != 0:
            success = False
            message = f"deduplicate_repo_files failed with rc={rc}: {err[:500]}"

    elif step == "aggregate":
        rc, out, err = run_script("server.scripts.aggregate_stats", timeout=7200)
        if rc != 0:
            success = False
            message = f"aggregate_stats failed with rc={rc}: {err[:500]}"

    else:
        success = False
        message = f"Unknown step: {step}"

    if success:
        insert_run_log(conn, run_id, "INFO", f"Step completed: {step}", {"step": step})
    else:
        insert_run_log(conn, run_id, "ERROR", f"Step failed: {step}", {"step": step, "message": message})

    return success, message


def main() -> int:
    parser = argparse.ArgumentParser(description="Daily ingestion coordinator")
    parser.add_argument("--run-now", action="store_true", help="Ignore schedule and run now")
    parser.add_argument("--dry-run", action="store_true", help="Just report if it would run")
    parser.add_argument("--steps", type=str, help="Override steps (comma-separated)")
    args = parser.parse_args()

    conn = get_db_connection()
    locked = False

    try:
        # Check if we should run
        if not args.run_now:
            should_run, reason = should_run_today(conn)
            if not should_run:
                LOGGER.info(f"Not running: {reason}")
                return 0

        if args.dry_run:
            LOGGER.info("Dry run: would run now")
            return 0

        # Try to acquire lock
        if not acquire_lock(conn):
            LOGGER.info("Another instance is already running (could not acquire lock)")
            return 0
        locked = True

        # Get steps to run
        if args.steps:
            steps = [s.strip() for s in args.steps.split(",") if s.strip()]
        else:
            steps = get_steps(conn)

        LOGGER.info(f"Starting daily ingestion with steps: {steps}")

        # Create run record
        params = {
            "scheduled_at": get_param(conn, "daily_ingestion_cron") or "02:00",
            "steps": steps,
            "triggered_at": dt.datetime.now().isoformat(),
        }
        run_id = create_run(conn, params)
        insert_run_log(conn, run_id, "INFO", "Daily ingestion started", params)

        # Run each step
        processed = 0
        failed = 0
        failed_steps = []

        for step in steps:
            success, message = run_step(conn, run_id, step)
            if success:
                processed += 1
            else:
                failed += 1
                failed_steps.append(step)

        # Finalize
        status = "success" if failed == 0 else "failed"
        error_message = f"Failed steps: {', '.join(failed_steps)}" if failed_steps else None

        finalize_run(conn, run_id, status, processed, failed, error_message)

        # Update last run info
        set_param(conn, "daily_ingestion_last_run", dt.datetime.now().isoformat(), "Last daily ingestion run timestamp")
        set_param(conn, "daily_ingestion_last_status", status, "Last daily ingestion run status")

        insert_run_log(conn, run_id, "INFO", "Daily ingestion completed", {
            "status": status,
            "processed": processed,
            "failed": failed,
        })

        LOGGER.info(f"Daily ingestion completed: status={status}, processed={processed}, failed={failed}")
        return 0 if status == "success" else 2

    except Exception as exc:
        LOGGER.exception("Daily ingestion coordinator error")
        try:
            insert_run_log(conn, 0, "ERROR", "Daily ingestion coordinator exception", {"error": str(exc)})
        except Exception:
            pass
        return 3

    finally:
        if locked:
            try:
                release_lock(conn)
            except Exception:
                pass
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
