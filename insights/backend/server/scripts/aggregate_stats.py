#!/usr/bin/env python3
"""Unified statistics aggregation script.

Supports incremental aggregation for all stat_* tables:
  - repo_daily: stat_repo_daily (with churn, files_unexpected, file_type_breakdown)
  - repo_monthly: stat_repo_monthly (with denormalized fields)
  - person_daily: stat_person_repo_daily + stat_person_daily
  - person_monthly: stat_person_monthly
  - department_monthly: stat_department_monthly
  - person_repo_monthly: stat_person_repo_monthly

Watermarks stored in stats_watermarks. Progress logged to ingestion_runs.

Usage examples:
  python server/scripts/aggregate_stats.py --jobs all --window-days 2
  python server/scripts/aggregate_stats.py --jobs repo_daily,repo_monthly
  python server/scripts/aggregate_stats.py --jobs person_daily,person_monthly,department_monthly

Exit codes: 0 success, 1 partial failures, >1 fatal error.
"""
from __future__ import annotations

import argparse
import os
import sys

try:
    from server.python_service.config import Config
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from server.python_service.config import Config
import datetime as dt
import json
import logging
from typing import Iterable, List, Optional, Tuple, Dict, Set

try:
    import mysql.connector  # type: ignore
    from mysql.connector import errors as mysql_errors  # type: ignore
except ImportError as exc:
    raise SystemExit("mysql-connector-python required. pip install mysql-connector-python") from exc

LOGGER = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def parse_args(argv: Optional[Iterable[str]] = None):
    parser = argparse.ArgumentParser(description="Aggregate statistics for CodeInsight")
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", Config.DB_HOST))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", Config.DB_PORT)))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", Config.DB_USER))
    parser.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", Config.DB_PASSWORD))
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", Config.DB_NAME))
    parser.add_argument("--jobs", default="all", help="Comma list or 'all': repo_daily,repo_monthly,person_daily,person_monthly,department_monthly,person_repo_monthly")
    parser.add_argument("--window-days", type=int, default=30, help="Number of days to look back for incremental update")
    parser.add_argument("--full-aggregation", action="store_true", help="Force full aggregation of all time")
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", Config.LOG_LEVEL))
    parser.add_argument("--dry-run", action="store_true", help="Do not write changes")
    parser.add_argument("--triggered-by", default="manual", help="Identifier for the trigger source")
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        from log_utils import configure_logging
    except ImportError:
        from server.scripts.log_utils import configure_logging

    configure_logging(args.log_level)
    return args

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def connect(args):
    return mysql.connector.connect(
        host=args.db_host,
        port=args.db_port,
        user=args.db_user,
        password=args.db_password,
        database=args.db_name,
        autocommit=False,
    )


def create_run(conn, params: Dict, triggered_by: Optional[str]) -> int:
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO ingestion_runs (job_type, source_type, status, started_at, params, triggered_by) "
        "VALUES ('stats_aggregate','mixed','running',NOW(6),%s,%s)",
        (json.dumps(params, ensure_ascii=False), triggered_by),
    )
    run_id = cur.lastrowid
    conn.commit()
    cur.close()
    return run_id


def finalize_run(conn, run_id: int, status: str, processed: int, failed: int, error_message: Optional[str]):
    cur = conn.cursor()
    cur.execute(
        "UPDATE ingestion_runs SET status=%s, finished_at=NOW(6), items_processed=%s, items_failed=%s, error_message=%s WHERE id=%s",
        (status, processed, failed, error_message, run_id),
    )
    conn.commit()
    cur.close()


def log_message(conn, run_id: int, level: str, message: str, context: Optional[Dict] = None):
    lvl = level.upper()
    py_map = {
        "DEBUG": logging.DEBUG,
        "INFO": logging.INFO,
        "WARNING": logging.WARNING,
        "ERROR": logging.ERROR,
        "CRITICAL": logging.CRITICAL,
    }
    try:
        if context:
            LOGGER.log(py_map.get(lvl, logging.INFO), "%s | %s", message, json.dumps(context, ensure_ascii=False))
        else:
            LOGGER.log(py_map.get(lvl, logging.INFO), "%s", message)
    except Exception:
        pass

    if lvl == "DEBUG":
        return

    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context) VALUES (%s,%s,%s,%s)",
            (run_id, lvl, message, json.dumps(context, ensure_ascii=False) if context else None),
        )
        conn.commit()
        cur.close()
    except Exception:
        pass


def is_conn_lost(exc: Exception) -> bool:
    msg = str(exc).lower()
    return isinstance(exc, (mysql_errors.InterfaceError, mysql_errors.OperationalError)) and (
        "lost connection" in msg or "server has gone away" in msg
    )


def reconnect(conn, args):
    try:
        conn.close()
    except Exception:
        pass
    return connect(args)

# ---------------------------------------------------------------------------
# Watermark helpers
# ---------------------------------------------------------------------------

def ensure_watermark_table(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stats_watermarks (
            job_name VARCHAR(50) PRIMARY KEY,
            last_commit_id BIGINT UNSIGNED,
            window_days INT DEFAULT 1,
            updated_at DATETIME(6)
        )
    """)
    conn.commit()
    cur.close()


def get_watermark(conn, job_name: str) -> Tuple[Optional[int], int]:
    ensure_watermark_table(conn)
    cur = conn.cursor()
    cur.execute("SELECT last_commit_id, window_days FROM stats_watermarks WHERE job_name=%s", (job_name,))
    row = cur.fetchone()
    if not row:
        # Create default
        cur.execute(
            "INSERT INTO stats_watermarks (job_name, last_commit_id, window_days) VALUES (%s,%s,%s)",
            (job_name, None, 1),
        )
        conn.commit()
        cur.close()
        return None, 1
    cur.close()
    last_commit_id, window_days = row
    return (int(last_commit_id) if last_commit_id is not None else None, int(window_days))


def update_watermark(conn, job_name: str, last_commit_id: Optional[int]):
    cur = conn.cursor()
    cur.execute(
        "UPDATE stats_watermarks SET last_commit_id=%s, updated_at=NOW(6) WHERE job_name=%s",
        (last_commit_id, job_name),
    )
    conn.commit()
    cur.close()


def get_incremental_window_start(conn, last_commit_id: Optional[int], default_days: int) -> Optional[dt.date]:
    """
    Determine the start date for incremental aggregation.
    If last_commit_id is None, returns now - default_days.
    Otherwise, finds the minimum committed_at of all commits > last_commit_id.
    If no new commits, returns None (signal to skip aggregation).
    """
    if last_commit_id is None:
        return (dt.datetime.now() - dt.timedelta(days=default_days)).date()

    cur = conn.cursor()
    cur.execute(
        "SELECT MIN(DATE(committed_at)) FROM repo_commits WHERE id > %s AND files_ingested=1",
        (last_commit_id,)
    )
    row = cur.fetchone()
    cur.close()

    if row and row[0]:
        return row[0]

    # No new commits found
    return None


import requests

# ... (existing imports)

def ensure_holidays_for_year(conn, year: int) -> None:
    """
    Ensure holiday data exists for the given year in system_holidays table.
    If not, fetch from GitHub and insert.
    """
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM system_holidays WHERE year=%s LIMIT 1", (year,))
    if cur.fetchone():
        cur.close()
        return

    print(f"Fetching holiday data for {year} from GitHub...")
    try:
        url = f"https://raw.githubusercontent.com/Natescarlet/holiday-cn/master/{year}.json"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        if not data or 'days' not in data:
            print(f"No holiday data found for {year}")
            cur.close()
            return

        days = data['days']
        if not days:
            cur.close()
            return

        print(f"Fetched {len(days)} days for {year}")

        values = []
        for day in days:
            # day: {date: 'YYYY-MM-DD', name: '...', isOffDay: bool}
            values.append((
                day['date'],
                day['name'],
                1 if day['isOffDay'] else 0,
                year
            ))

        cur.executemany(
            "INSERT INTO system_holidays (date, name, is_off_day, year) "
            "VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE name=VALUES(name), is_off_day=VALUES(is_off_day), year=VALUES(year)",
            values
        )
        conn.commit()
        print(f"Synced {len(values)} holiday records for {year}")

    except Exception as e:
        print(f"Failed to fetch/sync holidays for {year}: {e}")
    finally:
        cur.close()


def get_holiday_map(conn, start_date: dt.date, end_date: dt.date) -> Dict[str, bool]:
    """
    Fetch holiday configuration for a given date range.
    Returns a dict where key is date string (YYYY-MM-DD) and value is boolean (true=off day, false=work day).
    """
    # Ensure holidays exist for the requested years
    start_year = start_date.year
    end_year = end_date.year
    for year in range(start_year, end_year + 1):
        ensure_holidays_for_year(conn, year)

    holiday_map = {}
    cur = conn.cursor()
    cur.execute(
        "SELECT date, is_off_day FROM system_holidays WHERE date BETWEEN %s AND %s",
        (start_date, end_date)
    )
    for row in cur.fetchall():
        date_str = str(row[0])
        is_off_day = bool(row[1])
        holiday_map[date_str] = is_off_day
    cur.close()
    return holiday_map


def get_work_days(start_date: dt.date, end_date: dt.date, holiday_map: Dict[str, bool]) -> int:
    """
    Calculate number of working days between start and end dates (inclusive).
    Uses holiday_map to handle statutory holidays and make-up workdays.
    """
    if start_date > end_date:
        return 0

    days = 0
    curr = start_date
    while curr <= end_date:
        date_str = str(curr)
        if date_str in holiday_map:
            # If defined in system_holidays
            # is_off_day: True = rest, False = work (make-up day)
            if not holiday_map[date_str]:
                days += 1
        else:
            # Standard weekend logic
            if curr.weekday() < 5: # 0-4 are Mon-Fri
                days += 1
        curr += dt.timedelta(days=1)
    return days


# ---------------------------------------------------------------------------
# Person management helpers
# ---------------------------------------------------------------------------

def ensure_person_exists(conn, author_name: str, run_id: int, first_commit_at: Optional[dt.datetime] = None) -> Optional[int]:
    """
    确保作者在 org_persons 表中存在，如不存在则自动创建

    Args:
        conn: 数据库连接
        author_name: 提交者用户名
        author_email: 提交者邮箱
        run_id: 运行ID（用于日志）

    Returns:
        person_id: 作者的 person_id，如果无法确定则返回 None
    """
    # NOTE: This function is the canonical place to ensure an org_persons record
    # exists for an author and to initialize first_commit_at when creating new
    # rows. Ingestion scripts intentionally avoid creating org_persons records
    # to keep high-throughput ingest fast; aggregate_stats.py is expected to run
    # regularly and will handle person creation and timestamp initialization.
    if not author_name:
        return None

    cur = conn.cursor()

    # 1. 尝试通过 username 查找
    if author_name and author_name.strip():
        cur.execute(
            "SELECT id FROM org_persons WHERE username = %s LIMIT 1",
            (author_name.strip(),)
        )
        row = cur.fetchone()
        if row:
            cur.close()
            return row[0]

    # 3. 不存在，创建新记录
    username = (author_name or 'unknown').strip()[:50]

    try:
        # 使用 INSERT IGNORE 避免并发时的重复键错误
        # If first_commit_at is provided, include it in initial INSERT so newly created
        # org_persons records will have the correct first_commit_at value.
        if first_commit_at is not None:
            cur.execute(
                "INSERT INTO org_persons (username, department_id, is_active, created_at, updated_at, first_commit_at) "
                "VALUES (%s, 999, 0, NOW(), NOW(), %s) "
                "ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
                (username, first_commit_at),
            )
        else:
            cur.execute(
                "INSERT INTO org_persons (username, department_id, is_active, created_at, updated_at) "
                "VALUES (%s, 999, 0, NOW(), NOW()) "
                "ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",  # 如果重复，返回现有ID
                (username),
            )
        person_id = cur.lastrowid

        if person_id > 0:
            conn.commit()
            log_message(conn, run_id, "INFO", f"Auto-created org_persons record", {
                "person_id": person_id,
                "username": username,
            })

        cur.close()
        return person_id if person_id > 0 else None

    except Exception as e:
        LOGGER.warning(f"Failed to create org_persons record for {username}: {e}")
        cur.close()
        return None

# ---------------------------------------------------------------------------
# Workload calculation
# ---------------------------------------------------------------------------

def get_system_param(conn, key: str, default: str) -> str:
    """Get a system parameter value, returning default if not found."""
    cur = conn.cursor()
    cur.execute("SELECT param_value FROM system_parameters WHERE param_key = %s", (key,))
    row = cur.fetchone()
    cur.close()
    return row[0] if row else default


def update_commit_workload(conn, run_id: int, args) -> Tuple[int, int]:
    """
    Calculate and update workload for repo_commits.

    Formula: LEAST(lines_added, 500) + weight_modified * lines_modified + weight_deleted * lines_deleted

    Weights are configurable via system_parameters:
      - workload_weight_modified (default: 1.3)
      - workload_weight_deleted (default: 0.5)
      - workload_max_added (default: 500)
    """
    processed = 0
    failed = 0

    # Read weights from system_parameters
    weight_modified = float(get_system_param(conn, 'workload_weight_modified', '1.3'))
    weight_deleted = float(get_system_param(conn, 'workload_weight_deleted', '0.5'))
    max_added = int(get_system_param(conn, 'workload_max_added', '500'))

    log_message(conn, run_id, "INFO", "commit_workload: Starting workload calculation", {
        "weight_modified": weight_modified,
        "weight_deleted": weight_deleted,
        "max_added": max_added
    })

    cur = conn.cursor()
    try:
        # Update workload for all ingested commits
        sql = f"""
            UPDATE repo_commits
            SET workload = ROUND(
                LEAST(COALESCE(lines_added, 0), {max_added})
                + {weight_modified} * COALESCE(lines_modified, 0)
                + {weight_deleted} * COALESCE(lines_deleted, 0)
            )
            WHERE files_ingested = 1
        """
        cur.execute(sql)
        processed = cur.rowcount
        conn.commit()

        log_message(conn, run_id, "INFO", "commit_workload: Workload calculation completed", {
            "rows_updated": processed
        })
    except Exception as e:
        failed = 1
        log_message(conn, run_id, "ERROR", f"commit_workload: Failed to update workload: {e}")
    finally:
        cur.close()

    return processed, failed


# ---------------------------------------------------------------------------
# Aggregation logic
# ---------------------------------------------------------------------------

def aggregate_repo_daily(conn, run_id: int, args) -> Tuple[int, int]:
    processed = 0
    failed = 0

    # Fetch watermark
    last_commit_id, wm_window_days = get_watermark(conn, "repo_daily")
    bootstrap = args.full_aggregation

    # Determine window start
    if args.full_aggregation:
        window_start = dt.date(2000, 1, 1) # Effectively all time
        last_commit_id = None # Ignore watermark for full aggregation
    else:
        window_start = get_incremental_window_start(conn, last_commit_id, max(args.window_days, wm_window_days))
        # Bootstrap check: if target table is empty, force full scan.
        try:
            boot_cur = conn.cursor()
            boot_cur.execute("SELECT COUNT(*) FROM stat_repo_daily")
            daily_count = int((boot_cur.fetchone() or [0])[0] or 0)
            boot_cur.close()
            if daily_count == 0:
                bootstrap = True
                window_start = dt.date(2000, 1, 1)
                last_commit_id = None
        except Exception as _boot_exc:
            log_message(conn, run_id, "WARNING", f"repo_daily bootstrap check failed: {_boot_exc}")

        if window_start is None and not bootstrap:
            log_message(conn, run_id, "INFO", "repo_daily: No new data to aggregate, skipping")
            return processed, failed

    log_message(conn, run_id, "INFO", f"repo_daily: Aggregating from {window_start}", {
        "last_commit_id": last_commit_id,
        "bootstrap": bootstrap,
    })

    # Identify max commit id for updating watermark later
    cur = conn.cursor()
    cur.execute(
        "SELECT MAX(id) FROM repo_commits WHERE files_ingested=1"
    )
    row = cur.fetchone()
    max_commit_id = int(row[0]) if row and row[0] is not None else None

    if max_commit_id is None:
        log_message(conn, run_id, "INFO", "No ingested commits to process")
        cur.close()
        return processed, failed

    # Base daily aggregation (including banned counts)
    # We aggregate everything >= window_start
    daily_sql = (
        "SELECT c.repo_catalog_id, DATE(c.committed_at) AS stat_date, COUNT(*) commits, "
        "SUM(COALESCE(c.files_added,0)) files_added, "
        "SUM(COALESCE(c.code_files_added,0)) code_files_added, SUM(COALESCE(c.code_files_deleted,0)) code_files_deleted, "
        # New: Average Quality Scores
        "COALESCE(AVG(c.score_submission_quality), 0) as avg_submission_quality, "
        "COALESCE(AVG(c.score_code_quality), 0) as avg_code_quality, "
        "SUM(COALESCE(c.code_files_modified,0)) code_files_modified, "
        "SUM(COALESCE(c.lines_added,0)) lines_added, "
        "SUM(COALESCE(c.lines_deleted,0)) lines_deleted, SUM(COALESCE(c.lines_modified,0)) lines_modified, "
        "SUM(COALESCE(c.code_files_duplicated,0)) dup_code_files, "
        "SUM(COALESCE(c.binary_files_duplicated,0)) dup_bin_files, "
        "SUM(COALESCE(c.duplicate_files_bytes,0)) dup_bin_bytes, "
        "SUM(COALESCE(c.directories_banned,0)) banned_dirs, "
        "SUM(COALESCE(c.files_unexpected,0) + COALESCE(c.files_in_banned_directories,0)) files_unexpected, "
        "SUM(COALESCE(c.binary_files_added,0)) binary_files_added, "
        "SUM(COALESCE(c.binary_files_deleted,0)) bin_deleted, "
        "SUM(COALESCE(c.binary_files_modified,0)) bin_modified, "
        "SUM(COALESCE(c.binary_bytes_added,0)) bin_bytes_added, "
        "SUM(COALESCE(c.unexcepted_files_bytes,0)) unex_bytes, "
        "SUM(COALESCE(c.bytes_added,0)) bytes_added, "
        "SUM(COALESCE(c.workload,0)) workload "
        "FROM repo_commits c JOIN repo_catalog r ON r.id=c.repo_catalog_id "
        "WHERE c.files_ingested=1 AND r.is_valid=1 AND c.committed_at >= %s "
        "GROUP BY c.repo_catalog_id, stat_date"
    )
    cur.execute(daily_sql, (window_start,))
    rows = cur.fetchall()
    log_message(conn, run_id, "INFO", f"repo_daily: Processing {len(rows)} repo-day records", {"total_rows": len(rows)})
    # Upsert daily base metrics including churn and banned counts
    for idx, row in enumerate(rows, 1):
        (repo_catalog_id, stat_date, commits, files_added,
         code_files_added, code_files_deleted,
         arg_avg_sub_q, arg_avg_code_q,
         code_files_modified,
         lines_added, lines_deleted, lines_modified, dup_code_files, dup_bin_files, dup_bin_bytes,
         banned_dirs, files_unexpected, bin_added, bin_deleted, bin_modified, bin_bytes_added, unex_bytes, bytes_added, workload) = row
        total_lines_changed = (lines_added or 0) + (lines_deleted or 0) + (lines_modified or 0)
        churn = (lines_added or 0) + (lines_deleted or 0)
        cur.execute(
            "INSERT INTO stat_repo_daily (repo_catalog_id, stat_date, commits, files_added, code_files_added, code_files_deleted, code_files_modified, lines_added, lines_deleted, lines_modified, churn, code_files_duplicated, binary_files_duplicated, duplicate_files_bytes, directories_banned, files_unexpected, binary_files_added, binary_files_deleted, binary_files_modified, binary_bytes_added, unexcepted_files_bytes, total_lines_changed, bytes_added, avg_submission_quality, avg_code_quality, workload) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE commits=VALUES(commits), files_added=VALUES(files_added), code_files_added=VALUES(code_files_added), code_files_deleted=VALUES(code_files_deleted), code_files_modified=VALUES(code_files_modified), lines_added=VALUES(lines_added), lines_deleted=VALUES(lines_deleted), lines_modified=VALUES(lines_modified), churn=VALUES(churn), code_files_duplicated=VALUES(code_files_duplicated), binary_files_duplicated=VALUES(binary_files_duplicated), duplicate_files_bytes=VALUES(duplicate_files_bytes), directories_banned=VALUES(directories_banned), files_unexpected=VALUES(files_unexpected), binary_files_added=VALUES(binary_files_added), binary_files_deleted=VALUES(binary_files_deleted), binary_files_modified=VALUES(binary_files_modified), binary_bytes_added=VALUES(binary_bytes_added), unexcepted_files_bytes=VALUES(unexcepted_files_bytes), total_lines_changed=VALUES(total_lines_changed), bytes_added=VALUES(bytes_added), avg_submission_quality=VALUES(avg_submission_quality), avg_code_quality=VALUES(avg_code_quality), workload=VALUES(workload)",
            (
                repo_catalog_id,
                stat_date,
                commits,
                files_added,
                code_files_added,
                code_files_deleted,
                code_files_modified,
                lines_added,
                lines_deleted,
                lines_modified,
                churn,
                dup_code_files,
                dup_bin_files,
                dup_bin_bytes,
                banned_dirs,
                files_unexpected,
                bin_added,
                bin_deleted,
                bin_modified,
                bin_bytes_added,
                unex_bytes,
                total_lines_changed,
                bytes_added,
                arg_avg_sub_q,
                arg_avg_code_q,
                workload or 0
            ),
        )
        processed += 1
        # Log progress every 1000 rows
        if idx % 1000 == 0:
            conn.commit()  # Commit periodically
            log_message(conn, run_id, "INFO", f"repo_daily: Processed {idx}/{len(rows)} rows", {"current": idx, "total": len(rows)})


    # Sixth pass: file_type_breakdown (JSON aggregation)
    ft_sql = (
        "SELECT c.repo_catalog_id, DATE(c.committed_at) AS stat_date, f.file_type, COUNT(*) AS cnt "
        "FROM repo_commits c "
        "JOIN repo_commit_files f ON f.repo_commit_id=c.id "
        "JOIN repo_catalog r ON r.id=c.repo_catalog_id "
        "WHERE c.files_ingested=1 AND r.is_valid=1 AND c.committed_at >= %s "
        "GROUP BY c.repo_catalog_id, stat_date, f.file_type"
    )
    cur.execute(ft_sql, (window_start,))
    ft_map: Dict[Tuple, Dict[str, int]] = {}
    for repo_catalog_id, stat_date, file_type, cnt in cur.fetchall():
        key = (repo_catalog_id, stat_date)
        if key not in ft_map:
            ft_map[key] = {}
        ft_map[key][file_type or 'unknown'] = cnt
    for (repo_catalog_id, stat_date), breakdown in ft_map.items():
        cur.execute(
            "UPDATE stat_repo_daily SET file_type_breakdown=%s WHERE repo_catalog_id=%s AND stat_date=%s",
            (json.dumps(breakdown, ensure_ascii=False), repo_catalog_id, stat_date),
        )
    # Update watermark
    if max_commit_id is not None:
        update_watermark(conn, "repo_daily", max_commit_id)
    log_message(conn, run_id, "INFO", "repo_daily aggregation completed", {
        "rows_upserted": processed,
        "last_commit_id": max_commit_id,
        "window_start": str(window_start),
        "watermark_prev": last_commit_id,
    })
    cur.close()
    return processed, failed


def aggregate_repo_monthly(conn, run_id: int, args) -> Tuple[int, int]:
    processed = 0
    failed = 0

    # Determine start date for monthly aggregation
    # We use the same logic as daily: find where new data starts
    last_commit_id, wm_window_days = get_watermark(conn, "repo_daily") # Use repo_daily watermark as it drives monthly
    bootstrap = args.full_aggregation

    if args.full_aggregation:
        start_date = dt.date(2000, 1, 1)
        last_commit_id = None
    else:
        start_date = get_incremental_window_start(conn, last_commit_id, max(args.window_days, wm_window_days))
        # Bootstrap check: if target monthly table is empty, force full scan.
        try:
            boot_cur = conn.cursor()
            boot_cur.execute("SELECT COUNT(*) FROM stat_repo_monthly")
            monthly_count = int((boot_cur.fetchone() or [0])[0] or 0)
            boot_cur.close()
            if monthly_count == 0:
                bootstrap = True
                start_date = dt.date(2000, 1, 1)
                last_commit_id = None
        except Exception as _boot_exc:
            log_message(conn, run_id, "WARNING", f"repo_monthly bootstrap check failed: {_boot_exc}")

        if start_date is None and not bootstrap:
            log_message(conn, run_id, "INFO", "repo_monthly: No new data to aggregate, skipping")
            return processed, failed

    # We must aggregate from the beginning of the month of the start_date
    start_year = start_date.year
    start_month = start_date.month

    log_message(conn, run_id, "INFO", f"repo_monthly: Aggregating from {start_year}-{start_month} (derived from {start_date})", {
        "last_commit_id": last_commit_id,
        "bootstrap": bootstrap,
    })

    # Determine months to recompute: all months present in daily stats >= start_date
    cur = conn.cursor()
    cur.execute(
        "SELECT DISTINCT YEAR(stat_date) AS stat_year, MONTH(stat_date) AS stat_month "
        "FROM stat_repo_daily "
        "WHERE stat_date >= %s "
        "ORDER BY stat_year, stat_month",
        (dt.date(start_year, start_month, 1),)
    )
    months = [(int(row[0]), int(row[1])) for row in cur.fetchall()]
    if not months:
        log_message(conn, run_id, "INFO", "No months to aggregate for repo_monthly")
        cur.close()
        return processed, failed

    # Cache for last_day_lines to avoid repeated DB lookups when processing sequential months
    # repo_id -> last_day_lines
    repo_last_lines_cache: Dict[int, int] = {}

    for stat_year, stat_month in months:
        # Calculate month boundaries
        month_start = dt.date(stat_year, stat_month, 1)
        if stat_month == 12:
            month_end = dt.date(stat_year + 1, 1, 1) - dt.timedelta(days=1)
        else:
            month_end = dt.date(stat_year, stat_month + 1, 1) - dt.timedelta(days=1)

        # Fetch holiday map for the month
        holiday_map = get_holiday_map(conn, month_start, month_end)

        # Aggregate monthly stats from daily
        cur.execute(
            "SELECT srd.repo_catalog_id, rc.name AS repo_name, rc.source_type, rc.department_id, "
            "SUM(srd.commits) AS total_commits, "
            "SUM(srd.files_added) AS files_added, "
            "SUM(srd.code_files_added) AS code_files_added, SUM(srd.code_files_deleted) AS code_files_deleted, SUM(srd.code_files_modified) AS code_files_modified, "
            # Weighted average for monthly stats
            "SUM(srd.avg_submission_quality * srd.commits) / NULLIF(SUM(srd.commits), 0) as avg_submission_quality, "
            "SUM(srd.avg_code_quality * srd.commits) / NULLIF(SUM(srd.commits), 0) as avg_code_quality, "
            "SUM(srd.lines_added) AS lines_added, SUM(srd.lines_deleted) AS lines_deleted, SUM(srd.lines_modified) AS lines_modified, "
            "SUM(srd.lines_added + srd.lines_deleted + srd.lines_modified) AS total_lines_changed, "
            "SUM(srd.binary_bytes_added) AS binary_bytes_added, "

            "SUM(COALESCE(srd.code_files_duplicated,0)) AS dup_code_files, "
            "SUM(COALESCE(srd.binary_files_duplicated,0)) AS binary_files_duplicated, "
            "SUM(COALESCE(srd.duplicate_files_bytes,0)) AS duplicate_files_bytes, "
            "SUM(COALESCE(srd.directories_banned,0)) AS banned_dirs, "
            "SUM(COALESCE(srd.files_unexpected,0)) AS files_unexpected, "
            "SUM(COALESCE(srd.unexcepted_files_bytes,0)) AS unexcepted_files_bytes, "
            "SUM(COALESCE(srd.bytes_added,0)) AS bytes_added, "
            "SUM(COALESCE(srd.workload,0)) AS workload, "
            "rc.repo_created_at "
            "FROM stat_repo_daily srd "
            "JOIN repo_catalog rc ON rc.id=srd.repo_catalog_id "
            "WHERE YEAR(srd.stat_date)=%s AND MONTH(srd.stat_date)=%s "
            "GROUP BY srd.repo_catalog_id, rc.name, rc.source_type, rc.department_id, rc.repo_created_at",
            (stat_year, stat_month),
        )
        rows = cur.fetchall()

        # Determine previous month for last_day_lines lookup
        if stat_month == 1:
            prev_year = stat_year - 1
            prev_month = 12
        else:
            prev_year = stat_year
            prev_month = stat_month - 1

        # Determine last day of current month (for active contributors query)
        # Already calculated as month_end

        for row in rows:
            (repo_catalog_id, repo_name, source_type, department_id, total_commits,
             files_added,
             code_files_added, code_files_deleted, code_files_modified,
             avg_submission_quality, avg_code_quality,
             lines_added, lines_deleted, lines_modified, total_lines_changed,
             binary_bytes_added,
             dup_code_files, binary_files_duplicated, duplicate_files_bytes,
             banned_dirs, files_unexpected, unexcepted_files_bytes, bytes_added, workload, repo_created_at) = row

            # Calculate work_days
            repo_start_date = repo_created_at.date() if repo_created_at else month_start
            effective_start = max(month_start, repo_start_date)
            work_days = get_work_days(effective_start, month_end, holiday_map)

            # Calculate active contributors for this month
            # We query stat_person_repo_daily for this repo and month
            cur.execute(
                "SELECT COUNT(DISTINCT person_id) FROM stat_person_repo_daily "
                "WHERE repo_catalog_id=%s AND YEAR(stat_date)=%s AND MONTH(stat_date)=%s",
                (repo_catalog_id, stat_year, stat_month)
            )
            active_contributors = cur.fetchone()[0]

            # Calculate total_lines (snapshot at end of month)
            # Logic: total_lines = prev_month_total_lines + lines_added - lines_deleted
            prev_lines = repo_last_lines_cache.get(repo_catalog_id)
            if prev_lines is None:
                # Try to fetch from DB
                cur.execute(
                    "SELECT last_day_lines FROM stat_repo_monthly WHERE repo_catalog_id=%s AND stat_year=%s AND stat_month=%s",
                    (repo_catalog_id, prev_year, prev_month)
                )
                prev_row = cur.fetchone()
                prev_lines = prev_row[0] if prev_row else 0

            current_lines = prev_lines + (lines_added or 0) - (lines_deleted or 0)
            if current_lines < 0: current_lines = 0 # Should not happen but safe guard

            # Update cache
            repo_last_lines_cache[repo_catalog_id] = current_lines

            # Get binary files breakdown from daily stats
            cur2 = conn.cursor()
            cur2.execute(
                "SELECT SUM(binary_files_added), SUM(binary_files_deleted), SUM(binary_files_modified) "
                "FROM stat_repo_daily WHERE repo_catalog_id=%s AND YEAR(stat_date)=%s AND MONTH(stat_date)=%s",
                (repo_catalog_id, stat_year, stat_month)
            )
            bin_row = cur2.fetchone()
            binary_files_added = int(bin_row[0] or 0) if bin_row else 0
            binary_files_deleted = int(bin_row[1] or 0) if bin_row else 0
            binary_files_modified = int(bin_row[2] or 0) if bin_row else 0
            cur2.close()
            cur.execute(
                "INSERT INTO stat_repo_monthly (repo_catalog_id, repo_name, source_type, department_id, stat_year, stat_month, work_days, active_contributors, total_commits, files_added, code_files_added, code_files_deleted, code_files_modified, avg_submission_quality, avg_code_quality, lines_added, lines_deleted, lines_modified, total_lines_changed, last_day_lines, binary_bytes_added, code_files_duplicated, binary_files_duplicated, duplicate_files_bytes, bytes_added, directories_banned, files_unexpected, unexcepted_files_bytes, workload) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE repo_name=VALUES(repo_name), source_type=VALUES(source_type), department_id=VALUES(department_id), work_days=VALUES(work_days), active_contributors=VALUES(active_contributors), total_commits=VALUES(total_commits), files_added=VALUES(files_added), code_files_added=VALUES(code_files_added), code_files_deleted=VALUES(code_files_deleted), code_files_modified=VALUES(code_files_modified), avg_submission_quality=VALUES(avg_submission_quality), avg_code_quality=VALUES(avg_code_quality), lines_added=VALUES(lines_added), lines_deleted=VALUES(lines_deleted), lines_modified=VALUES(lines_modified), total_lines_changed=VALUES(total_lines_changed), last_day_lines=VALUES(last_day_lines), binary_bytes_added=VALUES(binary_bytes_added), code_files_duplicated=VALUES(code_files_duplicated), binary_files_duplicated=VALUES(binary_files_duplicated), duplicate_files_bytes=VALUES(duplicate_files_bytes), bytes_added=VALUES(bytes_added), directories_banned=VALUES(directories_banned), files_unexpected=VALUES(files_unexpected), unexcepted_files_bytes=VALUES(unexcepted_files_bytes), workload=VALUES(workload)",
                (
                    repo_catalog_id, repo_name, source_type, department_id, stat_year, stat_month, work_days,
                    active_contributors, total_commits,
                    files_added,
                    code_files_added, code_files_deleted, code_files_modified,
                    avg_submission_quality, avg_code_quality,
                    lines_added, lines_deleted, lines_modified, total_lines_changed,
                    current_lines,
                    binary_bytes_added,
                    dup_code_files or 0, binary_files_duplicated or 0, duplicate_files_bytes or 0,
                    bytes_added or 0,
                    banned_dirs or 0, files_unexpected or 0, unexcepted_files_bytes or 0,
                    workload or 0,
                ),
            )
            processed += 1
    log_message(conn, run_id, "INFO", "repo_monthly aggregation completed", {"months_count": len(months), "rows_upserted": processed})
    cur.close()
    return processed, failed


def aggregate_person_daily(conn, run_id: int, args) -> Tuple[int, int]:
    """Aggregate stat_person_repo_daily and stat_person_daily incrementally.

    Mapping logic: prefer username match (repo_commits.author_name -> org_persons.username).
    Only counts commits with files_ingested=1 and repos with is_valid=1.
    """
    processed = 0
    failed = 0
    cur = conn.cursor()

    # Watermark & window
    last_commit_id, wm_window_days = get_watermark(conn, "person_daily")

    if args.full_aggregation:
        window_start = dt.date(2000, 1, 1)
        last_commit_id = None
        bootstrap = True # Treat full aggregation like bootstrap
    else:
        window_start = get_incremental_window_start(conn, last_commit_id, max(args.window_days, wm_window_days))
        bootstrap = False
        if window_start is None:
            # Check if we really need to skip. If bootstrap is needed, we wouldn't be here (last_commit_id would be None or we'd be in full_aggregation)
            # But wait, bootstrap check is below.
            # If last_commit_id is present, we assume bootstrap is done.
            # However, let's allow the bootstrap check to run first?
            # Actually, if last_commit_id is present, we trust it.
            pass

    # Bootstrap check: if target tables empty, force full scan
    try:
        cur.execute("SELECT COUNT(*) FROM stat_person_repo_daily")
        pr_count = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM stat_person_daily")
        p_count = int(cur.fetchone()[0])
        if pr_count == 0 and p_count == 0:
            bootstrap = True
            window_start = dt.date(2000, 1, 1)
            last_commit_id = None
    except Exception as _boot_exc:
        log_message(conn, run_id, "WARNING", f"Bootstrap check failed: {_boot_exc}")

    if window_start is None and not bootstrap:
         log_message(conn, run_id, "INFO", "person_daily: No new data to aggregate, skipping")
         cur.close()
         return processed, failed

    log_message(conn, run_id, "INFO", f"person_daily: Aggregating from {window_start}", {"last_commit_id": last_commit_id, "bootstrap": bootstrap})

    # Max commit id to advance watermark
    cur.execute("SELECT MAX(id) FROM repo_commits WHERE files_ingested=1")
    row = cur.fetchone()
    max_commit_id = int(row[0]) if row and row[0] is not None else None
    if max_commit_id is None:
        log_message(conn, run_id, "INFO", "No ingested commits for person_daily")
        cur.close()
        return processed, failed

    # Diagnostics: log author coverage and window commit counts
    try:
        diag_cur = conn.cursor()
        # Count window commits
        diag_cur.execute(
            "SELECT COUNT(*) FROM repo_commits c JOIN repo_catalog r ON r.id=c.repo_catalog_id AND r.is_valid=1 "
            "WHERE c.files_ingested=1 AND c.committed_at >= %s",
            (window_start,),
        )
        window_commits = int(diag_cur.fetchone()[0])
        # Distinct authors in window
        diag_cur.execute(
            "SELECT COUNT(DISTINCT TRIM(c.author_name)) FROM repo_commits c JOIN repo_catalog r ON r.id=c.repo_catalog_id AND r.is_valid=1 "
            "WHERE c.files_ingested=1 AND c.committed_at >= %s AND c.author_name IS NOT NULL AND TRIM(c.author_name) <> ''",
            (window_start,),
        )
        distinct_authors = int(diag_cur.fetchone()[0])
        # Mapped authors in window
        diag_cur.execute(
            "SELECT COUNT(DISTINCT TRIM(c.author_name)) FROM repo_commits c JOIN repo_catalog r ON r.id=c.repo_catalog_id AND r.is_valid=1 "
            "LEFT JOIN org_persons pu ON pu.username=TRIM(c.author_name) "
            "WHERE c.files_ingested=1 AND c.committed_at >= %s AND c.author_name IS NOT NULL AND TRIM(c.author_name) <> '' AND pu.id IS NOT NULL",
            (window_start,),
        )
        mapped_authors = int(diag_cur.fetchone()[0])
        log_message(conn, run_id, "INFO", "person_daily diagnostics", {
            "window_commits": window_commits,
            "distinct_authors": distinct_authors,
            "watermark_prev": last_commit_id,
            "bootstrap": bootstrap,
        })
        diag_cur.close()
    except Exception as _diag_exc:
        # Non-fatal diagnostics
        pass

    # ===== 预处理：为未映射的作者创建 org_persons 记录 =====
    preprocess_cur = conn.cursor()
    try:
        # 查找窗口内所有未在 org_persons 中的作者
        # MySQL ONLY_FULL_GROUP_BY 容忍度较低，使用子查询再聚合以避免非确定列报错
        preprocess_cur.execute(
            "SELECT name, MIN(committed_at) AS first_seen FROM ( "
            "  SELECT TRIM(c.author_name) AS name, c.committed_at "
            "  FROM repo_commits c "
            "  JOIN repo_catalog r ON r.id = c.repo_catalog_id AND r.is_valid = 1 "
            "  LEFT JOIN org_persons pu ON pu.username = TRIM(c.author_name) "
            "  WHERE c.files_ingested = 1 "
            "    AND c.committed_at >= %s "
            "    AND c.author_name IS NOT NULL "
            "    AND TRIM(c.author_name) <> '' "
            "    AND pu.id IS NULL "
            ") t GROUP BY name",
            (window_start,)
        )

        unmapped_authors = preprocess_cur.fetchall()
        created_count = 0

        for (author_name, first_seen) in unmapped_authors:
            # pass the first seen commit timestamp so that newly-created org_persons get first_commit_at
            person_id = ensure_person_exists(conn, author_name, run_id, first_commit_at=first_seen)
            if person_id:
                created_count += 1

        if created_count > 0:
            log_message(conn, run_id, "INFO", f"Auto-created {created_count} org_persons records for unmapped authors")

        preprocess_cur.close()
    except Exception as e:
        LOGGER.warning(f"Preprocessing unmapped authors failed: {e}")
        preprocess_cur.close()
    # ===== 预处理结束 =====

    # 1) Upsert stat_person_repo_daily (base metrics from repo_commits)
    # 映射优先使用 author_name -> org_persons.username；邮箱仅作回退
    # Note: MySQL may run with sql_mode=ONLY_FULL_GROUP_BY which requires
    # that non-aggregated SELECT expressions are functionally dependent on
    # GROUP BY columns. The username expression uses TRIM(c.author_name)
    # (non-aggregated); wrap with ANY_VALUE() to avoid 1055 errors while
    # preserving the intended fallback behavior (use pu.username when
    # available, otherwise use any observed author_name from the group).
    base_sql = (
        # Consolidate sub-accounts into parent accounts using parent_id relationship
        "SELECT COALESCE(p_main.id, pu.id) AS person_id, "
        "COALESCE(p_main.username, pu.username, ANY_VALUE(TRIM(c.author_name))) AS username, "
        "COALESCE(p_main.department_id, pu.department_id) AS department_id, "
        "c.repo_catalog_id, DATE(c.committed_at) AS stat_date, "
        "COUNT(*) AS commits, "
        "SUM(COALESCE(c.files_added,0)) AS files_added, "
        "SUM(COALESCE(c.code_files_added,0)) AS code_files_added, "
        "SUM(COALESCE(c.code_files_modified,0)) AS code_files_modified, "
        "SUM(COALESCE(c.code_files_deleted,0)) AS code_files_deleted, "
        "SUM(COALESCE(c.lines_added,0)) AS lines_added, "
        "SUM(COALESCE(c.lines_deleted,0)) AS lines_deleted, "
        "SUM(COALESCE(c.lines_modified,0)) AS lines_modified, "

        "SUM(COALESCE(c.code_files_duplicated,0)) AS dup_code_files, "
        "SUM(COALESCE(c.binary_files_duplicated,0)) AS dup_bin_files, "
        "SUM(COALESCE(c.duplicate_files_bytes,0)) AS dup_files_bytes, "
        "SUM(COALESCE(c.directories_banned,0)) AS banned_dirs, "
        "SUM(COALESCE(c.files_unexpected,0) + COALESCE(c.files_in_banned_directories,0)) AS files_unexpected, "
        "SUM(COALESCE(c.binary_files_added,0)) AS bin_added, "
        "SUM(COALESCE(c.binary_files_deleted,0)) AS bin_deleted, "
        "SUM(COALESCE(c.binary_files_modified,0)) AS bin_modified, "
        "SUM(COALESCE(c.binary_bytes_added,0)) AS bin_bytes_added, "
        "SUM(COALESCE(c.unexcepted_files_bytes,0)) AS unex_bytes, "
        "SUM(COALESCE(c.bytes_added,0)) AS bytes_added, "
        "SUM(COALESCE(c.workload,0)) AS workload, "
        "COALESCE(AVG(c.score_submission_quality), 0) AS avg_submission_quality, "
        "COALESCE(AVG(c.score_code_quality), 0) AS avg_code_quality, "
        "MIN(c.committed_at) AS first_commit_at, MAX(c.committed_at) AS last_commit_at "
        "FROM repo_commits c "
        "LEFT JOIN org_persons pu ON pu.username=TRIM(c.author_name) "
        "LEFT JOIN org_persons p_main ON p_main.id = pu.parent_id "
        "JOIN repo_catalog r ON r.id=c.repo_catalog_id AND r.is_valid=1 "
        "WHERE c.files_ingested=1 AND c.committed_at >= %s "
        "GROUP BY person_id, username, department_id, c.repo_catalog_id, stat_date "
        "HAVING person_id IS NOT NULL"
    )
    cur.execute(base_sql, (window_start,))
    base_rows = cur.fetchall()
    log_message(conn, run_id, "INFO", f"person_repo_daily: Processing {len(base_rows)} person-repo-day records", {"total_rows": len(base_rows)})
    for idx, row in enumerate(base_rows, 1):
        (person_id, username, department_id, repo_catalog_id, stat_date, commits,
         files_added,
         code_files_added, code_files_modified, code_files_deleted,
         lines_added, lines_deleted, lines_modified,
         dup_code_files, dup_bin_files, dup_files_bytes,
         banned_dirs, files_unexpected, bin_added, bin_deleted, bin_modified, bin_bytes_added, unex_bytes, bytes_added, workload,
         avg_submission_quality, avg_code_quality,
         first_commit_at, last_commit_at) = row
        total_lines_changed = (lines_added or 0) + (lines_deleted or 0) + (lines_modified or 0)
        cur.execute(
            "INSERT INTO stat_person_repo_daily (person_id, repo_catalog_id, department_id, stat_date, commits, files_added, code_files_added, code_files_modified, code_files_deleted, lines_added, lines_deleted, lines_modified, total_lines_changed, binary_files_added, binary_files_deleted, binary_files_modified, binary_bytes_added, code_files_duplicated, binary_files_duplicated, duplicate_files_bytes, directories_banned, files_unexpected, unexcepted_files_bytes, bytes_added, workload, avg_submission_quality, avg_code_quality, first_commit_at, last_commit_at) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
            "ON DUPLICATE KEY UPDATE commits=VALUES(commits), files_added=VALUES(files_added), code_files_added=VALUES(code_files_added), code_files_modified=VALUES(code_files_modified), code_files_deleted=VALUES(code_files_deleted), lines_added=VALUES(lines_added), lines_deleted=VALUES(lines_deleted), lines_modified=VALUES(lines_modified), total_lines_changed=VALUES(total_lines_changed), binary_files_added=VALUES(binary_files_added), binary_files_deleted=VALUES(binary_files_deleted), binary_files_modified=VALUES(binary_files_modified), binary_bytes_added=VALUES(binary_bytes_added), code_files_duplicated=VALUES(code_files_duplicated), binary_files_duplicated=VALUES(binary_files_duplicated), duplicate_files_bytes=VALUES(duplicate_files_bytes), directories_banned=VALUES(directories_banned), files_unexpected=VALUES(files_unexpected), unexcepted_files_bytes=VALUES(unexcepted_files_bytes), bytes_added=VALUES(bytes_added), workload=VALUES(workload), avg_submission_quality=VALUES(avg_submission_quality), avg_code_quality=VALUES(avg_code_quality), first_commit_at=LEAST(COALESCE(first_commit_at, VALUES(first_commit_at)), VALUES(first_commit_at)), last_commit_at=GREATEST(COALESCE(last_commit_at, VALUES(last_commit_at)), VALUES(last_commit_at))",
            (
                person_id,
                repo_catalog_id,
                department_id,
                stat_date,
                commits,
                files_added,
                code_files_added,
                code_files_modified,
                code_files_deleted,
                lines_added,
                lines_deleted,
                lines_modified,
                total_lines_changed,
                bin_added,
                bin_deleted,
                bin_modified,
                bin_bytes_added,

                dup_code_files or 0,
                dup_bin_files or 0,
                dup_files_bytes or 0,
                banned_dirs or 0,
                files_unexpected or 0,
                unex_bytes,
                bytes_added,
                workload or 0,
                avg_submission_quality,
                avg_code_quality,
                first_commit_at,
                last_commit_at,
            ),
        )
        processed += 1




    # 3) Aggregate into stat_person_daily
    # Get all distinct dates from stat_person_repo_daily that were affected by this run
    # We only need to re-aggregate dates within our window
    cur.execute(
        "SELECT DISTINCT stat_date FROM stat_person_repo_daily WHERE stat_date >= %s ORDER BY stat_date",
        (window_start,)
    )
    dates = [row[0] for row in cur.fetchall()]
    if not dates:
        log_message(conn, run_id, "INFO", "No dates found in stat_person_repo_daily to aggregate")

    log_message(conn, run_id, "INFO", f"person_daily: Aggregating stats for {len(dates)} days", {"total_days": len(dates)})

    for idx, d in enumerate(dates, 1):
        cur.execute(
            "SELECT person_id, COALESCE(MAX(department_id), NULL) AS department_id, COUNT(DISTINCT repo_catalog_id) AS repos_participated, "
            "SUM(commits), SUM(files_added), "
            "SUM(code_files_added), SUM(code_files_modified), SUM(code_files_deleted), "
            "SUM(lines_added), SUM(lines_deleted), SUM(lines_modified), SUM(total_lines_changed), "
            "SUM(binary_files_added), SUM(binary_files_deleted), SUM(binary_files_modified), SUM(binary_bytes_added), "
            "SUM(COALESCE(code_files_duplicated,0)), SUM(COALESCE(binary_files_duplicated,0)), SUM(COALESCE(duplicate_files_bytes,0)), "
            "SUM(COALESCE(bytes_added,0)), "
            "SUM(COALESCE(workload,0)), "
            "SUM(COALESCE(directories_banned,0)), SUM(COALESCE(files_unexpected,0)), "
            "SUM(COALESCE(unexcepted_files_bytes,0)), "
            "SUM(COALESCE(avg_submission_quality * commits, 0)) / NULLIF(SUM(commits), 0) AS avg_submission_quality, "
            "SUM(COALESCE(avg_code_quality * commits, 0)) / NULLIF(SUM(commits), 0) AS avg_code_quality, "
            "MIN(first_commit_at), MAX(last_commit_at) "
            "FROM stat_person_repo_daily WHERE stat_date=%s GROUP BY person_id",
            (d,),
        )
        for row in cur.fetchall():
            (person_id, department_id, repos_participated, commits, files_added,
             code_files_added, code_files_modified, code_files_deleted,
             lines_added, lines_deleted, lines_modified, total_lines_changed,
             bin_files_added, bin_files_deleted, bin_files_modified, bin_bytes_added,
             dup_code_files, dup_bin_files, dup_files_bytes,
             bytes_added, workload,
             banned_dirs, files_unexpected, unexcepted_files_bytes,
             avg_submission_quality, avg_code_quality,
             first_commit_at, last_commit_at) = row
            # Need username for stat_person_daily; fetch once (cheap by id)
            cur2 = conn.cursor()
            cur2.execute("SELECT username FROM org_persons WHERE id=%s", (person_id,))
            uname_row = cur2.fetchone()
            username = uname_row[0] if uname_row else None
            cur2.close()
            cur.execute(
                "INSERT INTO stat_person_daily (person_id, username, department_id, stat_date, repos_participated, commits, files_added, code_files_added, code_files_modified, code_files_deleted, lines_added, lines_deleted, lines_modified, total_lines_changed, binary_files_added, binary_files_deleted, binary_files_modified, binary_bytes_added, code_files_duplicated, binary_files_duplicated, duplicate_files_bytes, bytes_added, workload, directories_banned, files_unexpected, unexcepted_files_bytes, avg_submission_quality, avg_code_quality, first_commit_at, last_commit_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE repos_participated=VALUES(repos_participated), commits=VALUES(commits), files_added=VALUES(files_added), code_files_added=VALUES(code_files_added), code_files_modified=VALUES(code_files_modified), code_files_deleted=VALUES(code_files_deleted), lines_added=VALUES(lines_added), lines_deleted=VALUES(lines_deleted), lines_modified=VALUES(lines_modified), total_lines_changed=VALUES(total_lines_changed), binary_files_added=VALUES(binary_files_added), binary_files_deleted=VALUES(binary_files_deleted), binary_files_modified=VALUES(binary_files_modified), binary_bytes_added=VALUES(binary_bytes_added), code_files_duplicated=VALUES(code_files_duplicated), binary_files_duplicated=VALUES(binary_files_duplicated), duplicate_files_bytes=VALUES(duplicate_files_bytes), bytes_added=VALUES(bytes_added), workload=VALUES(workload), directories_banned=VALUES(directories_banned), files_unexpected=VALUES(files_unexpected), unexcepted_files_bytes=VALUES(unexcepted_files_bytes), avg_submission_quality=VALUES(avg_submission_quality), avg_code_quality=VALUES(avg_code_quality), first_commit_at=LEAST(COALESCE(first_commit_at, VALUES(first_commit_at)), VALUES(first_commit_at)), last_commit_at=GREATEST(COALESCE(last_commit_at, VALUES(last_commit_at)), VALUES(last_commit_at))",
                (
                    person_id, username, department_id, d, repos_participated, commits or 0,
                    files_added or 0,
                    code_files_added or 0, code_files_modified or 0, code_files_deleted or 0,
                    lines_added or 0, lines_deleted or 0, lines_modified or 0, total_lines_changed or 0,
                    bin_files_added or 0, bin_files_deleted or 0, bin_files_modified or 0, bin_bytes_added or 0,
                    dup_code_files or 0, dup_bin_files or 0, dup_files_bytes or 0,
                    bytes_added or 0, workload or 0,
                    banned_dirs or 0, files_unexpected or 0, unexcepted_files_bytes or 0,
                    avg_submission_quality, avg_code_quality,
                    first_commit_at, last_commit_at,
                ),
            )

        # Commit transaction periodically to avoid lock wait timeout
        conn.commit()

        # Log progress every 30 days
        if idx % 30 == 0:
            log_message(conn, run_id, "INFO", f"person_daily: Processed {idx}/{len(dates)} days", {"current": idx, "total": len(dates)})
    # Advance watermark
    update_watermark(conn, "person_daily", max_commit_id)
    log_message(conn, run_id, "INFO", "person_daily aggregation completed", {
        "rows_person_repo_daily": len(base_rows),
        "dates_affected": len(dates),
        "last_commit_id": max_commit_id,
        "window_start": str(window_start)
    })
    # Update org_persons.last_commit_at to reflect latest commit times seen in this aggregation window
    try:
        # Only match by author_name -> username (many commits lack author_email)
        cur.execute(
            "UPDATE org_persons p JOIN ("
            " SELECT pu.id AS person_id, MAX(c.committed_at) AS max_commit_at"
            " FROM repo_commits c"
            " LEFT JOIN org_persons pu ON pu.username=TRIM(c.author_name)"
            " JOIN repo_catalog r ON r.id=c.repo_catalog_id AND r.is_valid=1"
            " WHERE c.files_ingested=1 AND c.committed_at >= %s"
            " GROUP BY person_id"
            " ) t ON p.id = t.person_id"
            " SET p.last_commit_at = GREATEST(COALESCE(p.last_commit_at, t.max_commit_at), t.max_commit_at)"
            " WHERE t.max_commit_at IS NOT NULL",
            (window_start,),
        )
        conn.commit()
    except Exception as _e:
        # Non-fatal; log for diagnostics
        log_message(conn, run_id, "WARNING", "Failed to update org_persons.last_commit_at", {"error": str(_e)})

    cur.close()
    return processed, failed

    cur.close()
    return processed, failed


def aggregate_person_monthly(conn, run_id: int, args) -> Tuple[int, int]:
    """Aggregate stat_person_monthly from stat_person_daily."""
    processed = 0
    failed = 0

    # Check if we have new data based on person_daily watermark
    # Since person_monthly is derived from person_daily, we use person_daily's watermark
    last_commit_id, wm_window_days = get_watermark(conn, "person_daily")

    if args.full_aggregation:
        start_date = dt.date(2000, 1, 1)
    else:
        # We use the same window logic as person_daily to see if there's anything new
        start_date = get_incremental_window_start(conn, last_commit_id, max(args.window_days, wm_window_days))
        if start_date is None:
            log_message(conn, run_id, "INFO", "person_monthly: No new data to aggregate, skipping")
            return processed, failed

    # We must aggregate from the beginning of the month of the start_date
    start_year = start_date.year
    start_month = start_date.month

    log_message(conn, run_id, "INFO", f"person_monthly: Aggregating from {start_year}-{start_month}")

    cur = conn.cursor()
    # Get all distinct year-months from person_daily >= start_date
    cur.execute(
        "SELECT DISTINCT YEAR(stat_date) AS stat_year, MONTH(stat_date) AS stat_month "
        "FROM stat_person_daily "
        "WHERE stat_date >= %s "
        "ORDER BY stat_year, stat_month",
        (dt.date(start_year, start_month, 1),)
    )
    months = [(int(row[0]), int(row[1])) for row in cur.fetchall()]
    if not months:
        log_message(conn, run_id, "INFO", "No months to aggregate for person_monthly")
        cur.close()
        return processed, failed
    for stat_year, stat_month in months:
        # Calculate month boundaries
        month_start = dt.date(stat_year, stat_month, 1)
        if stat_month == 12:
            month_end = dt.date(stat_year + 1, 1, 1) - dt.timedelta(days=1)
        else:
            month_end = dt.date(stat_year, stat_month + 1, 1) - dt.timedelta(days=1)

        # Fetch holiday map for the month
        holiday_map = get_holiday_map(conn, month_start, month_end)

        cur.execute(
            "SELECT pd.person_id, pd.username, pd.department_id, "
            "SUM(pd.repos_participated) AS repos_participated, "
            "SUM(pd.commits) AS total_commits, "
            "SUM(pd.files_added) AS files_added, "
            "SUM(pd.code_files_added) AS code_files_added, SUM(pd.code_files_modified) AS code_files_modified, SUM(pd.code_files_deleted) AS code_files_deleted, "
            "SUM(pd.lines_added) AS lines_added, SUM(pd.lines_deleted) AS lines_deleted, SUM(pd.lines_modified) AS lines_modified, "
            "SUM(pd.total_lines_changed) AS total_lines_changed, "
            "SUM(pd.binary_files_added) AS binary_files_added, SUM(pd.binary_files_deleted) AS binary_files_deleted, SUM(pd.binary_files_modified) AS binary_files_modified, SUM(pd.binary_bytes_added) AS binary_bytes_added, "
            "SUM(COALESCE(pd.code_files_duplicated,0)) AS dup_code_files, SUM(COALESCE(pd.binary_files_duplicated,0)) AS dup_bin_files, SUM(COALESCE(pd.duplicate_files_bytes,0)) AS dup_files_bytes, "
            "SUM(COALESCE(pd.bytes_added,0)) AS bytes_added, "
            "SUM(COALESCE(pd.workload,0)) AS workload, "
            "SUM(COALESCE(pd.directories_banned,0)) AS banned_dirs, SUM(COALESCE(pd.files_unexpected,0)) AS files_unexpected, "
            "SUM(COALESCE(pd.unexcepted_files_bytes,0)) AS unexcepted_files_bytes, "
            "SUM(COALESCE(pd.avg_submission_quality * pd.commits, 0)) / NULLIF(SUM(pd.commits), 0) AS avg_submission_quality, "
            "SUM(COALESCE(pd.avg_code_quality * pd.commits, 0)) / NULLIF(SUM(pd.commits), 0) AS avg_code_quality, "
            "MIN(pd.first_commit_at) AS first_commit_at, MAX(pd.last_commit_at) AS last_commit_at, "
            "op.first_commit_at AS global_first_commit_at "
            "FROM stat_person_daily pd "
            "JOIN org_persons op ON op.id=pd.person_id "
            "WHERE YEAR(pd.stat_date)=%s AND MONTH(pd.stat_date)=%s "
            "GROUP BY pd.person_id, pd.username, pd.department_id, op.first_commit_at",
            (stat_year, stat_month),
        )
        for row in cur.fetchall():
            (person_id, username, department_id, repos_participated, total_commits,
             files_added,
             code_files_added, code_files_modified, code_files_deleted,
             lines_added, lines_deleted, lines_modified, total_lines_changed,
             bin_files_added, bin_files_deleted, bin_files_modified, bin_bytes_added,
             dup_code_files, dup_bin_files, dup_files_bytes,
             bytes_added, workload,
             banned_dirs, files_unexpected, unexcepted_files_bytes,
             avg_submission_quality, avg_code_quality,
             first_commit_at, last_commit_at, global_first_commit_at) = row

            # Calculate work_days
            person_start_date = global_first_commit_at.date() if global_first_commit_at else month_start
            effective_start = max(month_start, person_start_date)
            work_days = get_work_days(effective_start, month_end, holiday_map)

            cur.execute(
                "INSERT INTO stat_person_monthly (person_id, username, department_id, stat_year, stat_month, work_days, repos_participated, total_commits, files_added, code_files_added, code_files_modified, code_files_deleted, lines_added, lines_deleted, lines_modified, total_lines_changed, binary_files_added, binary_files_deleted, binary_files_modified, binary_bytes_added, code_files_duplicated, binary_files_duplicated, duplicate_files_bytes, bytes_added, workload, directories_banned, files_unexpected, unexcepted_files_bytes, avg_submission_quality, avg_code_quality, first_commit_at, last_commit_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE username=VALUES(username), department_id=VALUES(department_id), work_days=VALUES(work_days), repos_participated=VALUES(repos_participated), total_commits=VALUES(total_commits), files_added=VALUES(files_added), code_files_added=VALUES(code_files_added), code_files_modified=VALUES(code_files_modified), code_files_deleted=VALUES(code_files_deleted), lines_added=VALUES(lines_added), lines_deleted=VALUES(lines_deleted), lines_modified=VALUES(lines_modified), total_lines_changed=VALUES(total_lines_changed), binary_files_added=VALUES(binary_files_added), binary_files_deleted=VALUES(binary_files_deleted), binary_files_modified=VALUES(binary_files_modified), binary_bytes_added=VALUES(binary_bytes_added), code_files_duplicated=VALUES(code_files_duplicated), binary_files_duplicated=VALUES(binary_files_duplicated), duplicate_files_bytes=VALUES(duplicate_files_bytes), bytes_added=VALUES(bytes_added), workload=VALUES(workload), directories_banned=VALUES(directories_banned), files_unexpected=VALUES(files_unexpected), unexcepted_files_bytes=VALUES(unexcepted_files_bytes), avg_submission_quality=VALUES(avg_submission_quality), avg_code_quality=VALUES(avg_code_quality), first_commit_at=VALUES(first_commit_at), last_commit_at=VALUES(last_commit_at)",
                (
                person_id, username, department_id, stat_year, stat_month, work_days,
                    repos_participated, total_commits,
                    files_added,
                    code_files_added, code_files_modified, code_files_deleted,
                    lines_added, lines_deleted, lines_modified, total_lines_changed,
                    bin_files_added, bin_files_deleted, bin_files_modified, bin_bytes_added,
                    dup_code_files or 0, dup_bin_files or 0, dup_files_bytes or 0,
                    bytes_added or 0, workload or 0,
                    banned_dirs or 0, files_unexpected or 0, unexcepted_files_bytes or 0,
                    avg_submission_quality, avg_code_quality,
                    first_commit_at, last_commit_at
                ),
            )
            processed += 1

        # Backfill for active persons who have no commits in this month
        # They should still have a record with work_days
        cur.execute(
            "SELECT p.id, p.username, p.department_id, p.first_commit_at "
            "FROM org_persons p "
            "LEFT JOIN stat_person_monthly s ON s.person_id = p.id AND s.stat_year = %s AND s.stat_month = %s "
            "WHERE p.is_active = 1 "
            "AND p.first_commit_at IS NOT NULL "
            "AND p.first_commit_at <= %s "
            "AND s.id IS NULL",
            (stat_year, stat_month, month_end)
        )
        missing_persons = cur.fetchall()

        if missing_persons:
            log_message(conn, run_id, "INFO", f"person_monthly: Backfilling {len(missing_persons)} active persons for {stat_year}-{stat_month}")

            final_args = []
            for row in missing_persons:
                p_id, p_username, p_dept_id, p_first_commit = row
                p_start_date = p_first_commit.date() if p_first_commit else month_start
                effective_start = max(month_start, p_start_date)
                p_work_days = get_work_days(effective_start, month_end, holiday_map)

                final_args.append((
                    p_id, p_username, p_dept_id, stat_year, stat_month, p_work_days,
                    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
                    None, None
                ))

            cur.executemany(
                "INSERT INTO stat_person_monthly (person_id, username, department_id, stat_year, stat_month, work_days, repos_participated, total_commits, files_added, code_files_added, code_files_modified, code_files_deleted, lines_added, lines_deleted, lines_modified, total_lines_changed, binary_files_added, binary_files_deleted, binary_files_modified, binary_bytes_added, code_files_duplicated, binary_files_duplicated, duplicate_files_bytes, bytes_added, directories_banned, files_unexpected, unexcepted_files_bytes, first_commit_at, last_commit_at) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ",
                final_args
            )
            processed += len(final_args)
    log_message(conn, run_id, "INFO", "person_monthly aggregation completed", {"months_count": len(months), "rows_upserted": processed})
    cur.close()
    return processed, failed


def aggregate_department_monthly(conn, run_id: int, args) -> Tuple[int, int]:
    """Aggregate stat_department_monthly from stat_person_daily grouped by department."""
    processed = 0
    failed = 0

    # Check if we have new data based on person_daily watermark
    last_commit_id, wm_window_days = get_watermark(conn, "person_daily")

    if args.full_aggregation:
        start_date = dt.date(2000, 1, 1)
    else:
        start_date = get_incremental_window_start(conn, last_commit_id, max(args.window_days, wm_window_days))
        if start_date is None:
            log_message(conn, run_id, "INFO", "department_monthly: No new data to aggregate, skipping")
            return processed, failed

    # We must aggregate from the beginning of the month of the start_date
    start_year = start_date.year
    start_month = start_date.month

    log_message(conn, run_id, "INFO", f"department_monthly: Aggregating from {start_year}-{start_month}")

    cur = conn.cursor()
    # Get all distinct year-months from person_daily >= start_date
    cur.execute(
        "SELECT DISTINCT YEAR(stat_date) AS stat_year, MONTH(stat_date) AS stat_month "
        "FROM stat_person_daily "
        "WHERE department_id IS NOT NULL AND stat_date >= %s "
        "ORDER BY stat_year, stat_month",
        (dt.date(start_year, start_month, 1),)
    )
    months = [(int(row[0]), int(row[1])) for row in cur.fetchall()]
    if not months:
        log_message(conn, run_id, "INFO", "No months to aggregate for department_monthly")
        cur.close()
        return processed, failed
    for stat_year, stat_month in months:
        # Calculate work_days for the whole month
        month_start = dt.date(stat_year, stat_month, 1)
        # Get last day of month
        if stat_month == 12:
            month_end = dt.date(stat_year + 1, 1, 1) - dt.timedelta(days=1)
        else:
            month_end = dt.date(stat_year, stat_month + 1, 1) - dt.timedelta(days=1)

        # Fetch holiday map for the month
        holiday_map = get_holiday_map(conn, month_start, month_end)

        work_days = get_work_days(month_start, month_end, holiday_map)

        cur.execute(
            "SELECT pd.department_id, d.name AS department_name, d.parent_id AS parent_department_id, "
            "COUNT(DISTINCT pd.person_id) AS active_contributors, "
            "COUNT(DISTINCT CONCAT(pd.person_id, '-', pd.repos_participated)) AS repos_participated, "
            "SUM(pd.commits) AS total_commits, "
            "SUM(pd.files_added) AS files_added, "
            "SUM(pd.lines_added) AS lines_added, SUM(pd.lines_deleted) AS lines_deleted, SUM(pd.lines_modified) AS lines_modified, "
            "SUM(pd.total_lines_changed) AS total_lines_changed, "
            "SUM(pd.binary_files_added) AS binary_files_added, SUM(pd.binary_files_deleted) AS binary_files_deleted, SUM(pd.binary_files_modified) AS binary_files_modified, SUM(pd.binary_bytes_added) AS binary_bytes_added, "
            "SUM(COALESCE(pd.code_files_duplicated,0)) AS dup_code_files, SUM(COALESCE(pd.binary_files_duplicated,0)) AS dup_bin_files, SUM(COALESCE(pd.duplicate_files_bytes,0)) AS dup_files_bytes, "
            "SUM(COALESCE(pd.bytes_added,0)) AS bytes_added, "
            "SUM(COALESCE(pd.workload,0)) AS workload, "
            "SUM(COALESCE(pd.directories_banned,0)) AS banned_dirs, SUM(COALESCE(pd.files_unexpected,0)) AS files_unexpected, "
            "SUM(COALESCE(pd.unexcepted_files_bytes,0)) AS unexcepted_files_bytes, "
            "SUM(COALESCE(pd.avg_submission_quality * pd.commits, 0)) / NULLIF(SUM(pd.commits), 0) AS avg_submission_quality, "
            "SUM(COALESCE(pd.avg_code_quality * pd.commits, 0)) / NULLIF(SUM(pd.commits), 0) AS avg_code_quality "
            "FROM stat_person_daily pd "
            "JOIN org_departments d ON d.id=pd.department_id "
            "WHERE YEAR(pd.stat_date)=%s AND MONTH(pd.stat_date)=%s AND pd.department_id IS NOT NULL "
            "GROUP BY pd.department_id, d.name, d.parent_id",
            (stat_year, stat_month),
        )
        for row in cur.fetchall():
            (department_id, department_name, parent_department_id, active_contributors, repos_participated,
             total_commits, files_added,
             lines_added, lines_deleted, lines_modified, total_lines_changed,
             bin_files_added, bin_files_deleted, bin_files_modified, bin_bytes_added,
             dup_code_files, dup_bin_files, dup_files_bytes,
             bytes_added, workload,
             banned_dirs, files_unexpected, unexcepted_files_bytes,
             avg_submission_quality, avg_code_quality) = row
            cur.execute(
                "INSERT INTO stat_department_monthly (department_id, department_name, parent_department_id, stat_year, stat_month, work_days, active_contributors, repos_participated, total_commits, files_added, lines_added, lines_deleted, lines_modified, total_lines_changed, binary_files_added, binary_files_deleted, binary_files_modified, binary_bytes_added, code_files_duplicated, binary_files_duplicated, duplicate_files_bytes, bytes_added, workload, directories_banned, files_unexpected, unexcepted_files_bytes, avg_submission_quality, avg_code_quality) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE department_name=VALUES(department_name), parent_department_id=VALUES(parent_department_id), work_days=VALUES(work_days), active_contributors=VALUES(active_contributors), repos_participated=VALUES(repos_participated), total_commits=VALUES(total_commits), files_added=VALUES(files_added), lines_added=VALUES(lines_added), lines_deleted=VALUES(lines_deleted), lines_modified=VALUES(lines_modified), total_lines_changed=VALUES(total_lines_changed), binary_files_added=VALUES(binary_files_added), binary_files_deleted=VALUES(binary_files_deleted), binary_files_modified=VALUES(binary_files_modified), binary_bytes_added=VALUES(binary_bytes_added), code_files_duplicated=VALUES(code_files_duplicated), binary_files_duplicated=VALUES(binary_files_duplicated), duplicate_files_bytes=VALUES(duplicate_files_bytes), bytes_added=VALUES(bytes_added), workload=VALUES(workload), directories_banned=VALUES(directories_banned), files_unexpected=VALUES(files_unexpected), unexcepted_files_bytes=VALUES(unexcepted_files_bytes), avg_submission_quality=VALUES(avg_submission_quality), avg_code_quality=VALUES(avg_code_quality)",
                (
                    department_id, department_name, parent_department_id, stat_year, stat_month, work_days,
                    active_contributors, repos_participated, total_commits,
                    files_added,
                    lines_added, lines_deleted, lines_modified, total_lines_changed,
                    bin_files_added, bin_files_deleted, bin_files_modified, bin_bytes_added,
                    dup_code_files or 0, dup_bin_files or 0, dup_files_bytes or 0,
                    bytes_added or 0, workload or 0,
                    banned_dirs or 0, files_unexpected or 0, unexcepted_files_bytes or 0,
                    avg_submission_quality, avg_code_quality,
                ),
            )
            processed += 1
    log_message(conn, run_id, "INFO", "department_monthly aggregation completed", {"months_count": len(months), "rows_upserted": processed})
    cur.close()
    return processed, failed


def aggregate_person_repo_monthly(conn, run_id: int, args) -> Tuple[int, int]:
    """Aggregate stat_person_repo_monthly from stat_person_repo_daily."""
    processed = 0
    failed = 0

    # Check if we have new data based on person_daily watermark
    last_commit_id, wm_window_days = get_watermark(conn, "person_daily")

    if args.full_aggregation:
        start_date = dt.date(2000, 1, 1)
    else:
        start_date = get_incremental_window_start(conn, last_commit_id, max(args.window_days, wm_window_days))
        if start_date is None:
            log_message(conn, run_id, "INFO", "person_repo_monthly: No new data to aggregate, skipping")
            return processed, failed

    # We must aggregate from the beginning of the month of the start_date
    start_year = start_date.year
    start_month = start_date.month

    log_message(conn, run_id, "INFO", f"person_repo_monthly: Aggregating from {start_year}-{start_month}")

    cur = conn.cursor()
    # Get all distinct year-months from person_repo_daily >= start_date
    cur.execute(
        "SELECT DISTINCT YEAR(stat_date) AS stat_year, MONTH(stat_date) AS stat_month "
        "FROM stat_person_repo_daily "
        "WHERE stat_date >= %s "
        "ORDER BY stat_year, stat_month",
        (dt.date(start_year, start_month, 1),)
    )
    months = [(int(row[0]), int(row[1])) for row in cur.fetchall()]
    if not months:
        log_message(conn, run_id, "INFO", "No months to aggregate for person_repo_monthly")
        cur.close()
        return processed, failed
    for stat_year, stat_month in months:
        # Calculate month boundaries
        month_start = dt.date(stat_year, stat_month, 1)
        if stat_month == 12:
            month_end = dt.date(stat_year + 1, 1, 1) - dt.timedelta(days=1)
        else:
            month_end = dt.date(stat_year, stat_month + 1, 1) - dt.timedelta(days=1)

        # Fetch holiday map for the month
        holiday_map = get_holiday_map(conn, month_start, month_end)

        cur.execute(
            "SELECT sprd.person_id, sprd.repo_catalog_id, sprd.department_id, "
            "SUM(sprd.commits) AS total_commits, "
            "SUM(sprd.files_added) AS files_added, "
            "SUM(sprd.lines_added) AS lines_added, SUM(sprd.lines_deleted) AS lines_deleted, SUM(sprd.lines_modified) AS lines_modified, "
            "SUM(sprd.total_lines_changed) AS total_lines_changed, "
            "SUM(sprd.binary_files_added) AS binary_files_added, SUM(sprd.binary_files_deleted) AS binary_files_deleted, SUM(sprd.binary_files_modified) AS binary_files_modified, SUM(sprd.binary_bytes_added) AS binary_bytes_added, "
            "SUM(COALESCE(sprd.code_files_duplicated,0)) AS dup_code_files, SUM(COALESCE(sprd.binary_files_duplicated,0)) AS dup_bin_files, SUM(COALESCE(sprd.duplicate_files_bytes,0)) AS dup_files_bytes, "
            "SUM(COALESCE(sprd.bytes_added,0)) AS bytes_added, "
            "SUM(COALESCE(sprd.workload,0)) AS workload, "
            "SUM(COALESCE(sprd.directories_banned,0)) AS banned_dirs, SUM(COALESCE(sprd.files_unexpected,0)) AS files_unexpected, "
            "SUM(COALESCE(sprd.unexcepted_files_bytes,0)) AS unexcepted_files_bytes, "
            "SUM(COALESCE(sprd.avg_submission_quality * sprd.commits, 0)) / NULLIF(SUM(sprd.commits), 0) AS avg_submission_quality, "
            "SUM(COALESCE(sprd.avg_code_quality * sprd.commits, 0)) / NULLIF(SUM(sprd.commits), 0) AS avg_code_quality, "
            "op.first_commit_at AS global_first_commit_at, rc.repo_created_at "
            "FROM stat_person_repo_daily sprd "
            "JOIN org_persons op ON op.id=sprd.person_id "
            "JOIN repo_catalog rc ON rc.id=sprd.repo_catalog_id "
            "WHERE YEAR(sprd.stat_date)=%s AND MONTH(sprd.stat_date)=%s "
            "GROUP BY sprd.person_id, sprd.repo_catalog_id, sprd.department_id, op.first_commit_at, rc.repo_created_at",
            (stat_year, stat_month),
        )
        for row in cur.fetchall():
            (person_id, repo_catalog_id, department_id, total_commits,
             files_added,
             lines_added, lines_deleted, lines_modified, total_lines_changed,
             bin_files_added, bin_files_deleted, bin_files_modified, bin_bytes_added,
             dup_code_files, dup_bin_files, dup_files_bytes,
             bytes_added, workload,
             banned_dirs, files_unexpected, unexcepted_files_bytes,
             avg_submission_quality, avg_code_quality,
             global_first_commit_at, repo_created_at) = row

            # Calculate work_days
            person_start_date = global_first_commit_at.date() if global_first_commit_at else month_start
            repo_start_date = repo_created_at.date() if repo_created_at else month_start
            effective_start = max(month_start, person_start_date, repo_start_date)
            work_days = get_work_days(effective_start, month_end, holiday_map)

            cur.execute(
                "INSERT INTO stat_person_repo_monthly (person_id, repo_catalog_id, department_id, stat_year, stat_month, work_days, total_commits, files_added, lines_added, lines_deleted, lines_modified, total_lines_changed, binary_files_added, binary_files_deleted, binary_files_modified, binary_bytes_added, code_files_duplicated, binary_files_duplicated, duplicate_files_bytes, bytes_added, workload, directories_banned, files_unexpected, unexcepted_files_bytes, avg_submission_quality, avg_code_quality) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON DUPLICATE KEY UPDATE department_id=VALUES(department_id), work_days=VALUES(work_days), total_commits=VALUES(total_commits), files_added=VALUES(files_added), lines_added=VALUES(lines_added), lines_deleted=VALUES(lines_deleted), lines_modified=VALUES(lines_modified), total_lines_changed=VALUES(total_lines_changed), binary_files_added=VALUES(binary_files_added), binary_files_deleted=VALUES(binary_files_deleted), binary_files_modified=VALUES(binary_files_modified), binary_bytes_added=VALUES(binary_bytes_added), code_files_duplicated=VALUES(code_files_duplicated), binary_files_duplicated=VALUES(binary_files_duplicated), duplicate_files_bytes=VALUES(duplicate_files_bytes), bytes_added=VALUES(bytes_added), workload=VALUES(workload), directories_banned=VALUES(directories_banned), files_unexpected=VALUES(files_unexpected), unexcepted_files_bytes=VALUES(unexcepted_files_bytes), avg_submission_quality=VALUES(avg_submission_quality), avg_code_quality=VALUES(avg_code_quality)",
                (
                    person_id, repo_catalog_id, department_id, stat_year, stat_month, work_days,
                    total_commits,
                    files_added,
                    lines_added, lines_deleted, lines_modified, total_lines_changed,
                    bin_files_added, bin_files_deleted, bin_files_modified, bin_bytes_added,
                    dup_code_files or 0, dup_bin_files or 0, dup_files_bytes or 0,
                    bytes_added or 0, workload or 0,
                    banned_dirs or 0, files_unexpected or 0, unexcepted_files_bytes or 0,
                    avg_submission_quality, avg_code_quality,
                ),
            )
            processed += 1
    log_message(conn, run_id, "INFO", "person_repo_monthly aggregation completed", {"months_count": len(months), "rows_upserted": processed})
    cur.close()
    return processed, failed


def aggregate_language_stats(conn, run_id: int, args) -> Tuple[int, int]:
    """
    Aggregate language breakdown for Repos and Persons.
    Based on active files in repo_files (is_deleted=0).
    """
    processed = 0
    failed = 0

    log_message(conn, run_id, "INFO", "language_stats: Starting aggregation...")

    # 1. Load Extension -> Language map
    cur = conn.cursor()
    cur.execute("SELECT extension, language FROM file_type_catalog")
    ext_map = {}
    for ext, lang in cur.fetchall():
        if lang:
            ext_map[ext.lower()] = lang
    cur.close()

    # 2. Aggregate Repo Languages
    # Query active files and their extensions
    cur = conn.cursor()
    cur.execute(
        "SELECT repo_catalog_id, file_extension, COUNT(*) "
        "FROM repo_files "
        "WHERE is_deleted = 0 "
        "GROUP BY repo_catalog_id, file_extension"
    )

    repo_stats: Dict[int, Dict[str, int]] = {}
    for repo_id, ext, count in cur.fetchall():
        if repo_id not in repo_stats:
            repo_stats[repo_id] = {}

        # Determine language
        ext_str = (ext or '').lower().lstrip('.')
        lang = ext_map.get(ext_str, 'Other')

        repo_stats[repo_id][lang] = repo_stats[repo_id].get(lang, 0) + count

    # Update repo_catalog
    for repo_id, stats in repo_stats.items():
        try:
            # Sort by count descending, but keep 'Other' at the end
            other_count = stats.pop('Other', 0)
            sorted_stats = [{"name": k, "value": v} for k, v in sorted(stats.items(), key=lambda item: item[1], reverse=True)]
            if other_count > 0:
                sorted_stats.append({"name": "Other", "value": other_count})
            cur.execute(
                "UPDATE repo_catalog SET language_breakdown = %s WHERE id = %s",
                (json.dumps(sorted_stats, ensure_ascii=False), repo_id)
            )
            processed += 1
        except Exception as e:
            failed += 1
            log_message(conn, run_id, "ERROR", f"Failed to update repo {repo_id}: {e}")

    log_message(conn, run_id, "INFO", f"language_stats: Updated {len(repo_stats)} repos")

    # 3. Aggregate Person Languages
    # Join repo_files -> repo_commits -> org_persons
    # Note: We match org_persons by username = author_name
    cur.execute(
        "SELECT p.id, f.file_extension, COUNT(*) "
        "FROM repo_files f "
        "JOIN repo_commits c ON f.created_in_commit_id = c.id "
        "JOIN org_persons p ON p.username = c.author_name "
        "WHERE f.is_deleted = 0 "
        "GROUP BY p.id, f.file_extension"
    )

    person_stats: Dict[int, Dict[str, int]] = {}
    for person_id, ext, count in cur.fetchall():
        if person_id not in person_stats:
            person_stats[person_id] = {}

        ext_str = (ext or '').lower().lstrip('.')
        lang = ext_map.get(ext_str, 'Other')

        person_stats[person_id][lang] = person_stats[person_id].get(lang, 0) + count

    # Update org_persons
    for person_id, stats in person_stats.items():
        try:
            # Sort by count descending, but keep 'Other' at the end
            other_count = stats.pop('Other', 0)
            sorted_stats = [{"name": k, "value": v} for k, v in sorted(stats.items(), key=lambda item: item[1], reverse=True)]
            if other_count > 0:
                sorted_stats.append({"name": "Other", "value": other_count})
            cur.execute(
                "UPDATE org_persons SET language_breakdown = %s WHERE id = %s",
                (json.dumps(sorted_stats, ensure_ascii=False), person_id)
            )
            processed += 1
        except Exception as e:
            failed += 1
            log_message(conn, run_id, "ERROR", f"Failed to update person {person_id}: {e}")

    log_message(conn, run_id, "INFO", f"language_stats: Updated {len(person_stats)} persons")

    conn.commit()
    cur.close()
    return processed, failed


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def main(argv: Optional[Iterable[str]] = None) -> int:
    args = parse_args(argv)
    conn = connect(args)

    # Handle full aggregation mode
    if args.full_aggregation:
        args.window_days = 0
        LOGGER.info("Full aggregation mode enabled - resetting window_days to 0")

        # Cleanup historical data
        if not args.dry_run:
            LOGGER.info("Cleaning up historical data for full aggregation...")
            try:
                cur = conn.cursor()
                # Disable foreign key checks to allow truncation
                cur.execute("SET FOREIGN_KEY_CHECKS = 0")

                tables_to_truncate = [
                    'stat_repo_daily',
                    'stat_repo_monthly',
                    'stat_person_repo_daily',
                    'stat_person_daily',
                    'stat_person_monthly',
                    'stat_department_monthly',
                    'stat_person_repo_monthly',
                    'stats_watermarks' # Also reset watermarks
                ]

                for table in tables_to_truncate:
                    LOGGER.info(f"Truncating table {table}...")
                    cur.execute(f"TRUNCATE TABLE {table}")

                cur.execute("SET FOREIGN_KEY_CHECKS = 1")
                conn.commit()
                cur.close()
                LOGGER.info("Historical data cleanup completed.")
            except Exception as e:
                LOGGER.error(f"Failed to cleanup historical data: {e}")
                conn.rollback()
                raise

    params = {"jobs": args.jobs, "window_days": args.window_days, "dry_run": args.dry_run, "full_aggregation": args.full_aggregation}
    run_id = create_run(conn, params, args.triggered_by)
    log_message(conn, run_id, "INFO", "Stats aggregation started", params)
    # Expand 'all' to all available jobs
    if args.jobs.strip().lower() == 'all':
        # logic: repo_monthly needs active_contributors from person_repo_daily (aggregated in person_daily)
        # so person_daily MUST run before repo_monthly
        jobs = ['commit_workload', 'repo_daily', 'person_daily', 'repo_monthly', 'person_monthly', 'department_monthly', 'person_repo_monthly', 'language_stats']
    else:
        jobs = [j.strip() for j in args.jobs.split(',') if j.strip()]
    processed_total = 0
    failed_total = 0
    try:
        for job in jobs:
            try:
                if job == "repo_daily":
                    p, f = aggregate_repo_daily(conn, run_id, args)
                elif job == "repo_monthly":
                    p, f = aggregate_repo_monthly(conn, run_id, args)
                elif job == "person_daily":
                    p, f = aggregate_person_daily(conn, run_id, args)
                elif job == "person_monthly":
                    p, f = aggregate_person_monthly(conn, run_id, args)
                elif job == "department_monthly":
                    p, f = aggregate_department_monthly(conn, run_id, args)
                elif job == "person_repo_monthly":
                    p, f = aggregate_person_repo_monthly(conn, run_id, args)
                elif job == "language_stats":
                    p, f = aggregate_language_stats(conn, run_id, args)
                elif job == "commit_workload":
                    p, f = update_commit_workload(conn, run_id, args)
                else:
                    log_message(conn, run_id, "WARNING", "Unknown job skipped", {"job": job})
                    p, f = 0, 0
                processed_total += p
                failed_total += f
                if not args.dry_run:
                    conn.commit()
            except Exception as exc:
                failed_total += 1
                log_message(conn, run_id, "ERROR", f"Job {job} failed", {"error": str(exc)})
                if is_conn_lost(exc):
                    conn = reconnect(conn, args)
        finalize_run(conn, run_id, "success" if failed_total == 0 else "failed", processed_total, failed_total, None if failed_total == 0 else f"{failed_total} job parts failed")
        log_message(conn, run_id, "INFO", "Stats aggregation finished", {"processed": processed_total, "failed": failed_total})
    except Exception as exc:
        conn.rollback()
        finalize_run(conn, run_id, "failed", processed_total, failed_total, str(exc))
        log_message(conn, run_id, "ERROR", "Aggregation aborted", {"error": str(exc)})
        raise
    finally:
        conn.close()
    return 0 if failed_total == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
