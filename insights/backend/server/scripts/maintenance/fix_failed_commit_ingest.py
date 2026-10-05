#!/usr/bin/env python3
"""Find and clean failed commit_files_ingest items based on ingestion_run_logs.

Usage examples:
  python server/scripts/fix_failed_commit_ingest.py
  python server/scripts/fix_failed_commit_ingest.py --run-id 123 --cleanup
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from typing import Dict, Iterable, List, Optional, Tuple

import mysql.connector


def load_config(argv: Optional[Iterable[str]] = None):
    parser = argparse.ArgumentParser(description="Inspect and clean failed commit_files_ingest logs")
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", "127.0.0.1"))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", "3306")))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", "root"))
    parser.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", ""))
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", "codeinsightdb"))
    parser.add_argument("--run-id", type=int, help="ingestion_runs.id to inspect; default latest commit_files_ingest")
    parser.add_argument("--since-hours", type=int, default=72, help="When run-id is not set, only consider runs within the last N hours")
    parser.add_argument("--cleanup", action="store_true", help="Delete partial repo_commit_files rows for failed commits and reset files_ingested=0")
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))
    return parser.parse_args(list(argv) if argv is not None else None)


def connect_db(cfg) -> mysql.connector.connection.MySQLConnection:
    return mysql.connector.connect(
        host=cfg.db_host,
        port=cfg.db_port,
        user=cfg.db_user,
        password=cfg.db_password,
        database=cfg.db_name,
        autocommit=False,
    )


def latest_run_id(conn, hours: int) -> Optional[int]:
    cur = conn.cursor()
    try:
        cur.execute(
            """
            SELECT id
            FROM ingestion_runs
            WHERE job_type='commit_files_ingest'
              AND started_at >= NOW() - INTERVAL %s HOUR
            ORDER BY id DESC
            LIMIT 1
            """,
            (hours,),
        )
        row = cur.fetchone()
        return int(row[0]) if row else None
    finally:
        cur.close()


def failed_commits_for_run(conn, run_id: int) -> List[Dict]:
    """Return list of {commit_id, error, log_id} for the given run."""
    cur = conn.cursor()
    results: List[Dict] = []
    try:
        cur.execute(
            """
            SELECT id, context
            FROM ingestion_run_logs
            WHERE ingestion_run_id=%s
              AND log_level='ERROR'
              AND message LIKE 'Commit files ingest failed%%'
            """,
            (run_id,),
        )
        for log_id, ctx_json in cur.fetchall():
            ctx = {}
            try:
                ctx = json.loads(ctx_json) if ctx_json else {}
            except Exception:
                ctx = {}
            commit_id = ctx.get("commit_id")
            err = ctx.get("error") or ""
            if commit_id is not None:
                results.append({"commit_id": int(commit_id), "error": str(err), "log_id": int(log_id)})
    finally:
        cur.close()
    return results


def cleanup_commit(conn, commit_id: int) -> None:
    """Remove partial ingest artifacts for a commit so it can be retried cleanly."""
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM repo_commit_files WHERE repo_commit_id=%s", (commit_id,))
        cur.execute("DELETE FROM repo_commit_diffs WHERE repo_commit_file_id NOT IN (SELECT id FROM repo_commit_files)")
        cur.execute("UPDATE repo_commits SET files_ingested=0 WHERE id=%s", (commit_id,))
    finally:
        cur.close()


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = load_config(argv)
    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(message)s")
    conn = connect_db(args)
    try:
        run_id = args.run_id or latest_run_id(conn, args.since_hours)
        if not run_id:
            logging.error("No commit_files_ingest run found in the last %s hours", args.since_hours)
            return 1
        logging.info("Inspecting run_id=%s", run_id)
        failed = failed_commits_for_run(conn, run_id)
        if not failed:
            logging.info("No failed commits found for run %s", run_id)
            return 0
        logging.info("Found %s failed commits", len(failed))
        by_error: Dict[str, List[int]] = {}
        for item in failed:
            by_error.setdefault(item["error"], []).append(item["commit_id"])
        for err, commits in by_error.items():
            logging.info("Error[%s]: %s commits (examples: %s)", err, len(commits), commits[:10])
        if args.cleanup:
            for item in failed:
                cleanup_commit(conn, item["commit_id"])
            conn.commit()
            logging.info("Cleaned %s commits; ready for re-run of ingest", len(failed))
        else:
            logging.info("Run with --cleanup to delete partial data and reset files_ingested for these commits")
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    import sys

    sys.exit(main())
