#!/usr/bin/env python3
"""Purge all commit-related data (repo_commits, repo_commit_files, repo_commit_diffs) and reset counters.

Safety features:
  * Requires explicit --confirm flag unless --dry-run.
  * Logs a run record (job_type=commit_purge) into ingestion_runs & ingestion_run_logs.
  * Reports row counts before and after.

Usage examples:
  python purge_commit_data.py --confirm
  python purge_commit_data.py --dry-run

Optional environment overrides (same as other scripts): DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
from dataclasses import dataclass
from typing import Optional

try:
    import mysql.connector  # type: ignore
except ImportError as exc:  # pragma: no cover
    raise SystemExit("mysql-connector-python is required. Install via 'pip install mysql-connector-python'") from exc

LOGGER = logging.getLogger(__name__)


@dataclass
class Config:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    dry_run: bool = False
    confirm: bool = False


def load_config(argv: Optional[list[str]] = None) -> Config:
    parser = argparse.ArgumentParser(description="Purge all commit-related tables for a fresh start")
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", "127.0.0.1"))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", "3306")))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", "root"))
    parser.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", "Wiztek@1902"))
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", "codeinsightdb"))
    parser.add_argument("--dry-run", action="store_true", help="Show counts only; do not delete")
    parser.add_argument("--confirm", action="store_true", help="Actually perform purge (required unless --dry-run)")
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))
    args = parser.parse_args(argv)
    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(message)s")
    return Config(
        db_host=args.db_host,
        db_port=args.db_port,
        db_user=args.db_user,
        db_password=args.db_password,
        db_name=args.db_name,
        dry_run=args.dry_run,
        confirm=args.confirm,
    )


def connect(cfg: Config):
    return mysql.connector.connect(
        host=cfg.db_host,
        port=cfg.db_port,
        user=cfg.db_user,
        password=cfg.db_password,
        database=cfg.db_name,
        autocommit=False,
    )


def insert_run(connection, status: str, params: dict) -> int:
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ingestion_runs (job_type, source_type, status, started_at, params) VALUES ('commit_purge', NULL, %s, NOW(6), %s)",
        (status, json.dumps(params, ensure_ascii=False)),
    )
    run_id = cursor.lastrowid
    connection.commit()
    cursor.close()
    return run_id


def log_run(connection, run_id: int, level: str, message: str, context: Optional[dict] = None) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context) VALUES (%s, %s, %s, %s)",
        (run_id, level, message, json.dumps(context, ensure_ascii=False) if context else None),
    )
    connection.commit()
    cursor.close()


def finalize_run(connection, run_id: int, status: str, error: Optional[str] = None) -> None:
    cursor = connection.cursor()
    cursor.execute(
        "UPDATE ingestion_runs SET status=%s, finished_at=NOW(6), error_message=%s WHERE id=%s",
        (status, error, run_id),
    )
    connection.commit()
    cursor.close()


TABLES = ["repo_commit_diffs", "repo_commit_files", "repo_commits"]  # delete in this order


def count_rows(connection, table: str) -> int:
    cursor = connection.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
    row = cursor.fetchone()
    cursor.close()
    return int(row[0]) if row else 0


def perform_purge(connection, cfg: Config, run_id: int) -> None:
    # Collect counts before
    before = {t: count_rows(connection, t) for t in TABLES}
    log_run(connection, run_id, "INFO", "Pre-purge commit table counts", before)

    if cfg.dry_run:
        log_run(connection, run_id, "INFO", "Dry-run mode: no deletion executed")
        return
    if not cfg.confirm:
        raise SystemExit("Refusing to purge: --confirm flag not provided (use --dry-run to inspect)")

    cursor = connection.cursor()
    try:
        # Disable FK checks and truncate in dependency order
        cursor.execute("SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS")
        cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
        for table in TABLES:
            cursor.execute(f"TRUNCATE TABLE `{table}`")
            log_run(connection, run_id, "INFO", f"Truncated {table}")
        # Reset counters in repo_catalog
        cursor.execute(
            "UPDATE repo_catalog SET total_commits = 0, current_commit_year = NULL, current_year_commits = 0"
        )
        log_run(connection, run_id, "INFO", "Reset repo_catalog commit counters")
        cursor.execute("SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS")
        connection.commit()
    except Exception as exc:  # pylint: disable=broad-except
        connection.rollback()
        log_run(connection, run_id, "ERROR", "Purge failed", {"error": str(exc)})
        raise
    finally:
        cursor.close()

    # Counts after
    after = {t: count_rows(connection, t) for t in TABLES}
    log_run(connection, run_id, "INFO", "Post-purge commit table counts", after)


def main(argv: Optional[list[str]] = None) -> int:
    cfg = load_config(argv)
    connection = connect(cfg)
    run_id = insert_run(connection, "running", {"dry_run": cfg.dry_run})
    log_run(connection, run_id, "INFO", "Commit purge started", {"dry_run": cfg.dry_run})
    try:
        perform_purge(connection, cfg, run_id)
        finalize_run(connection, run_id, "success")
        LOGGER.info("Commit purge completed (run_id=%s)", run_id)
        return 0
    except SystemExit as exc:
        # SystemExit used for missing --confirm; mark aborted but not failure
        finalize_run(connection, run_id, "aborted", str(exc))
        LOGGER.warning("Commit purge aborted: %s", exc)
        return 1
    except Exception as exc:  # pylint: disable=broad-except
        finalize_run(connection, run_id, "failed", str(exc))
        LOGGER.exception("Commit purge failed")
        return 2
    finally:
        connection.close()


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
