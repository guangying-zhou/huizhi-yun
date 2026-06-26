#!/usr/bin/env python3
"""Daily commit sync coordinator

This script coordinates Stage A (metadata) and Stage B (files) sync runs for
GitLab and SVN. It's intended to be triggered frequently (e.g. every 5 minutes)
by systemd timer / cron. The coordinator reads schedule config from
`system_parameters` and will only run the A/B sequence when the configured
daily time hasn't been run yet for today. It uses a DB advisory lock
(MySQL GET_LOCK) to avoid concurrent executions.

Usage:
  # dry-run (decide whether to run now)
  python3 server/scripts/commit_sync_coordinator.py --dry-run

  # force run now
  python3 server/scripts/commit_sync_coordinator.py --run-now

Environment variables (defaults are sensible for local dev):
  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

The coordinator will run per-source Stage A then Stage B (gitlab then svn by
default). It creates an entry in `ingestion_runs` with job_type
'daily_commit_coordinator' to record the orchestration run.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shlex
import subprocess
import sys
import time
from typing import Optional, Tuple

try:
    import mysql.connector  # type: ignore
except Exception as exc:  # pragma: no cover - import guard
    raise SystemExit("mysql-connector-python is required. Install with pip") from exc


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
COORD_LOCK_NAME = "codeinsight_commit_sync_coordinator_lock"


def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "codeinsightdb"),
        autocommit=False,
    )


def acquire_lock(conn) -> bool:
    cur = conn.cursor()
    try:
        cur.execute("SELECT GET_LOCK(%s, 0)", (COORD_LOCK_NAME,))
        row = cur.fetchone()
        return bool(row and int(row[0]) == 1)
    finally:
        cur.close()


def release_lock(conn) -> None:
    cur = conn.cursor()
    try:
        cur.execute("SELECT RELEASE_LOCK(%s)", (COORD_LOCK_NAME,))
        conn.commit()
    finally:
        cur.close()


def get_param(conn, key: str) -> Optional[str]:
    cur = conn.cursor()
    try:
        cur.execute("SELECT param_value FROM system_parameters WHERE param_key=%s LIMIT 1", (key,))
        row = cur.fetchone()
        return row[0] if row else None
    finally:
        cur.close()


def set_param(conn, key: str, value: str) -> None:
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO system_parameters (param_key, param_value) VALUES (%s,%s) ON DUPLICATE KEY UPDATE param_value=VALUES(param_value)",
            (key, value),
        )
        conn.commit()
    finally:
        cur.close()


def create_coord_run(conn, params: dict) -> int:
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO ingestion_runs (job_type, source_type, status, started_at, params) VALUES (%s,%s,%s,NOW(6),%s)",
            ("daily_commit_coordinator", "orchestrator", "running", json.dumps(params, ensure_ascii=False)),
        )
        run_id = cur.lastrowid
        conn.commit()
        return run_id
    finally:
        cur.close()


def finalize_coord_run(conn, run_id: int, status: str, processed: int, failed: int, message: Optional[str]) -> None:
    cur = conn.cursor()
    try:
        cur.execute(
            "UPDATE ingestion_runs SET status=%s, finished_at=NOW(6), processed=%s, failed=%s, error_message=%s WHERE id=%s",
            (status, processed, failed, message, run_id),
        )
        conn.commit()
    finally:
        cur.close()


def insert_run_log(conn, run_id: int, level: str, message: str, context: Optional[dict]) -> None:
    cur = conn.cursor()
    try:
        cur.execute(
            "INSERT INTO ingestion_run_logs (ingestion_run_id, level, message, context, created_at) VALUES (%s,%s,%s,%s,NOW(6))",
            (run_id, level, message, json.dumps(context or {}, ensure_ascii=False)),
        )
        conn.commit()
    finally:
        cur.close()


def should_run_today(conn) -> bool:
    enabled = get_param(conn, "commits_sync_enabled")
    if enabled is None or enabled.strip() != "1":
        return False
    time_str = get_param(conn, "commits_sync_time") or "02:00"
    try:
        hh, mm = map(int, time_str.split(":"))
    except Exception:
        hh, mm = 2, 0
    now = dt.datetime.now()
    scheduled_today = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    last_run = get_param(conn, "commits_sync_last_run")
    if last_run:
        try:
            last_dt = dt.datetime.fromisoformat(last_run)
        except Exception:
            last_dt = None
    else:
        last_dt = None
    # run if now >= scheduled and last_run is not today
    if now >= scheduled_today:
        if last_dt is None:
            return True
        return last_dt.date() < now.date()
    return False


def run_child_script(script_name: str, mode: str, env: Optional[dict] = None, timeout: Optional[int] = None) -> Tuple[int, str, str]:
    python = sys.executable or "python3"
    script = os.path.join(SCRIPT_DIR, script_name)
    cmd = [python, script, "--mode", mode]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env or os.environ, timeout=timeout)
    return proc.returncode, proc.stdout or "", proc.stderr or ""


def run_source(conn, run_id: int, source: str, retries: int, retry_delay: int) -> Tuple[int, int]:
    """Run metadata then files for a single source. Returns (processed, failed) counts as best-effort."""
    processed = 0
    failed = 0
    script_map = {"gitlab": "sync_gitlab_commits.py", "svn": "sync_svn_commits.py"}
    script = script_map.get(source)
    if not script:
        insert_run_log(conn, run_id, "WARNING", f"Unknown source: {source}", None)
        return processed, failed

    # Stage A: metadata
    attempt = 0
    last_rc = 0
    while attempt <= retries:
        attempt += 1
        insert_run_log(conn, run_id, "INFO", f"Starting Stage A (metadata) for {source}, attempt {attempt}", None)
        try:
            rc, out, err = run_child_script(script, "metadata")
        except subprocess.TimeoutExpired:
            rc = 254
            out = ""
            err = "timeout"
        insert_run_log(conn, run_id, "INFO", f"Stage A finished for {source}", {"rc": rc, "stdout": out[:2000], "stderr": err[:2000]})
        if rc == 0:
            last_rc = 0
            break
        last_rc = rc
        failed += 1
        if attempt <= retries:
            insert_run_log(conn, run_id, "INFO", f"Stage A failed for {source}, retrying after {retry_delay}s", {"rc": rc})
            time.sleep(retry_delay)

    if last_rc != 0:
        insert_run_log(conn, run_id, "ERROR", f"Stage A failed for {source} after {attempt-1} attempts", {"last_rc": last_rc})
        return processed, failed

    # Stage B: files
    insert_run_log(conn, run_id, "INFO", f"Starting Stage B (files) for {source}", None)
    try:
        rc2, out2, err2 = run_child_script(script, "files")
    except subprocess.TimeoutExpired:
        rc2 = 254
        out2 = ""
        err2 = "timeout"
    insert_run_log(conn, run_id, "INFO", f"Stage B finished for {source}", {"rc": rc2, "stdout": out2[:2000], "stderr": err2[:2000]})
    if rc2 != 0:
        insert_run_log(conn, run_id, "ERROR", f"Stage B failed for {source}", {"rc": rc2})
        failed += 1
    else:
        processed += 1

    return processed, failed


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--run-now", action="store_true", help="Ignore schedule and run now")
    p.add_argument("--dry-run", action="store_true", help="Do not start child scripts; just report if it's time")
    p.add_argument("--sources", default="gitlab,svn", help="Comma separated sources to run (gitlab,svn)")
    args = p.parse_args()

    conn = get_db_connection()
    locked = False
    try:
        if not acquire_lock(conn):
            print("Another coordinator instance is running; exiting")
            return 0
        locked = True

        if not args.run_now and not should_run_today(conn):
            print("Not scheduled to run now (or already ran today)")
            return 0

        if args.dry_run:
            print("Dry-run: would run now")
            return 0

        retries = int(get_param(conn, "commits_sync_retry_count") or 1)
        retry_delay = int(get_param(conn, "commits_sync_retry_delay_secs") or 300)

        params = {"scheduled_at": get_param(conn, "commits_sync_time") or "02:00", "sources": args.sources}
        run_id = create_coord_run(conn, params)
        insert_run_log(conn, run_id, "INFO", "Coordinator run started", params)

        total_processed = 0
        total_failed = 0
        for source in [s.strip() for s in args.sources.split(",") if s.strip()]:
            processed, failed = run_source(conn, run_id, source, retries, retry_delay)
            total_processed += processed
            total_failed += failed

        status = "success" if total_failed == 0 else "failed"
        finalize_coord_run(conn, run_id, status, total_processed, total_failed, None if status == "success" else "Some sources failed")
        set_param(conn, "commits_sync_last_run", dt.datetime.now().isoformat())
        set_param(conn, "commits_sync_last_status", status)
        insert_run_log(conn, run_id, "INFO", "Coordinator run completed", {"status": status, "processed": total_processed, "failed": total_failed})
        return 0 if status == "success" else 2

    except Exception as exc:  # pragma: no cover - top level logging
        try:
            insert_run_log(conn, 0, "ERROR", "Coordinator exception", {"error": str(exc)})
        except Exception:
            pass
        print("Coordinator error:", exc)
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
