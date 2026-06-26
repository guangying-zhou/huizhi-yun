#!/usr/bin/env python3
"""
Bulk deduplication script for repo_commit_files.
This script is intended to be run after ingestion when --skip-db-dedupe was used.
It identifies duplicates based on content_hash and (file_name, bytes_after),
updates the is_duplicate flags, and removes redundant diffs.

Now supports tracking via ingestion_runs and graceful stopping.
"""
import argparse

import os
import sys
import logging

try:
    from server.python_service.config import Config
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from server.python_service.config import Config
import sys
import time
import json
from typing import Optional
from datetime import datetime

try:
    import mysql.connector
except ImportError as exc:
    raise SystemExit("mysql-connector-python required. pip install mysql-connector-python") from exc

LOGGER = logging.getLogger(__name__)

# Global state for stop flag
STOP_REQUESTED = False

def get_db_connection(host, port, user, password, db_name):
    return mysql.connector.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=db_name,
        autocommit=True
    )

def check_stop_flag(cursor):
    global STOP_REQUESTED
    if STOP_REQUESTED:
        return True
    try:
        cursor.execute("SELECT param_value FROM system_parameters WHERE param_key='deduplicate_files_stop'")
        row = cursor.fetchone()
        if row and str(row[0]).strip() == '1':
            STOP_REQUESTED = True
            return True
    except Exception:
        pass
    return False

def log_db(cursor, run_id, level, message, details=None):
    """Log to ingestion_run_logs table."""
    if not run_id:
        return
    if level.upper() == "DEBUG":
        return
    try:
        cursor.execute("""
            INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context)
            VALUES (%s, %s, %s, %s)
        """, (run_id, level, message, json.dumps(details) if details else None))
    except Exception as e:
        LOGGER.error(f"Failed to log to DB: {e}")

def update_run_status(cursor, run_id, status, items_processed=None, items_total=None, error_message=None):
    """Update ingestion_runs status."""
    if not run_id:
        return

    updates = ["status=%s"]
    params = [status]

    if status in ('finished', 'failed', 'stopped'):
        updates.append("finished_at=%s")
        params.append(datetime.now())

    if items_processed is not None:
        updates.append("items_processed=%s")
        params.append(items_processed)

    if items_total is not None:
        updates.append("items_total=%s")
        params.append(items_total)

    if error_message is not None:
        updates.append("error_message=%s")
        params.append(error_message)

    params.append(run_id)

    sql = f"UPDATE ingestion_runs SET {', '.join(updates)} WHERE id=%s"
    try:
        cursor.execute(sql, tuple(params))
    except Exception as e:
        LOGGER.error(f"Failed to update run status: {e}")

def deduplicate_hashes(cursor, run_id):
    if check_stop_flag(cursor): return

    LOGGER.info("Starting hash-based deduplication...")
    log_db(cursor, run_id, "INFO", "Starting hash-based deduplication...")
    start_time = time.time()

    # 1. Identify duplicates: find min_id for each hash
    cursor.execute("CREATE TEMPORARY TABLE IF NOT EXISTS tmp_hash_min_ids (content_hash CHAR(64) COLLATE utf8mb4_unicode_ci, min_id BIGINT, PRIMARY KEY (content_hash)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    cursor.execute("TRUNCATE TABLE tmp_hash_min_ids")

    LOGGER.info("Finding canonical IDs for hashes...")
    log_db(cursor, run_id, "INFO", "Finding canonical IDs for hashes...")

    # Determine canonical commit per hash by earliest committed_at (global order),
    # then choose the smallest repo_commit_files.id within that canonical commit.
    cursor.execute(
        "CREATE TEMPORARY TABLE IF NOT EXISTS tmp_hash_canonical_commits ("
        "content_hash CHAR(64) COLLATE utf8mb4_unicode_ci, "
        "min_committed_at DATETIME(6), "
        "canonical_commit_id BIGINT, "
        "PRIMARY KEY (content_hash)"
        ") CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    )
    cursor.execute("TRUNCATE TABLE tmp_hash_canonical_commits")

    cursor.execute("""
        INSERT INTO tmp_hash_canonical_commits (content_hash, min_committed_at, canonical_commit_id)
        SELECT m.content_hash,
               m.min_committed_at,
               MIN(rc.id) AS canonical_commit_id
        FROM (
            SELECT r.content_hash, MIN(c.committed_at) AS min_committed_at
            FROM repo_commit_files r
            JOIN repo_commits c ON c.id = r.repo_commit_id
            WHERE r.content_hash IS NOT NULL AND r.content_hash != ''
              AND r.change_type != 'R'
            GROUP BY r.content_hash
            HAVING COUNT(*) > 1
        ) m
        JOIN repo_commit_files r2
          ON r2.content_hash = m.content_hash
         AND r2.content_hash IS NOT NULL AND r2.content_hash != ''
         AND r2.change_type != 'R'
        JOIN repo_commits rc
          ON rc.id = r2.repo_commit_id
         AND rc.committed_at = m.min_committed_at
        GROUP BY m.content_hash, m.min_committed_at
    """)

    cursor.execute("""
        INSERT INTO tmp_hash_min_ids (content_hash, min_id)
        SELECT t.content_hash, MIN(r.id) AS min_id
        FROM tmp_hash_canonical_commits t
        JOIN repo_commit_files r
          ON r.content_hash = t.content_hash
         AND r.repo_commit_id = t.canonical_commit_id
        WHERE r.content_hash IS NOT NULL AND r.content_hash != ''
          AND r.change_type != 'R'
        GROUP BY t.content_hash
    """)

    # Diagnostic: how many candidate hash groups were found
    cursor.execute("SELECT COUNT(*) FROM tmp_hash_min_ids")
    try:
        found_hash_groups = int(cursor.fetchone()[0] or 0)
    except Exception:
        found_hash_groups = 0
    LOGGER.info(f"Hash dedupe candidate groups: {found_hash_groups}")
    log_db(cursor, run_id, "DEBUG", "Hash dedupe candidate groups", {"count": found_hash_groups})

    # Show a small sample of content_hash keys for diagnosis
    if found_hash_groups > 0:
        cursor.execute("SELECT content_hash FROM tmp_hash_min_ids LIMIT 5")
        sample = [r[0] for r in cursor.fetchall()]
        LOGGER.info(f"Sample hash groups: {sample}")
        log_db(cursor, run_id, "DEBUG", "Sample hash groups", {"sample": sample})

    if check_stop_flag(cursor): return

    # 2. Update duplicates
    LOGGER.info("Updating duplicate records...")
    # Diagnostic: how many rows would match the update predicate
    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_hash_min_ids t ON r.content_hash = t.content_hash WHERE r.id != t.min_id")
    try:
        total_matching = int(cursor.fetchone()[0] or 0)
    except Exception:
        total_matching = 0
    LOGGER.info(f"Hash dedupe matching rows (all, before where predicate): {total_matching}")
    log_db(cursor, run_id, "DEBUG", "Hash dedupe matching rows (all)", {"count": total_matching})

    # Extra diagnostics: breakdown of matching rows by current duplicate state
    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_hash_min_ids t ON r.content_hash = t.content_hash WHERE r.id != t.min_id AND r.is_duplicate=1 AND r.duplicate_of_file_id IS NOT NULL")
    try:
        match_already_marked = int(cursor.fetchone()[0] or 0)
    except Exception:
        match_already_marked = 0
    LOGGER.info(f"Hash matching rows already marked as duplicate with duplicate_of_file_id: {match_already_marked}")
    log_db(cursor, run_id, "DEBUG", "Hash matching rows already marked", {"count": match_already_marked})

    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_hash_min_ids t ON r.content_hash = t.content_hash WHERE r.id != t.min_id AND r.is_duplicate=0 AND r.duplicate_of_file_id IS NOT NULL")
    try:
        match_dup_id_but_not_flagged = int(cursor.fetchone()[0] or 0)
    except Exception:
        match_dup_id_but_not_flagged = 0
    LOGGER.info(f"Hash matching rows with duplicate_of_file_id set but is_duplicate=0: {match_dup_id_but_not_flagged}")
    log_db(cursor, run_id, "DEBUG", "Hash matching rows dup_id_no_flag", {"count": match_dup_id_but_not_flagged})

    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_hash_min_ids t ON r.content_hash = t.content_hash WHERE r.id != t.min_id AND r.is_duplicate=1 AND r.duplicate_of_file_id IS NULL")
    try:
        match_marked_but_no_dup_id = int(cursor.fetchone()[0] or 0)
    except Exception:
        match_marked_but_no_dup_id = 0
    LOGGER.info(f"Hash matching rows with is_duplicate=1 but no duplicate_of_file_id: {match_marked_but_no_dup_id}")
    log_db(cursor, run_id, "DEBUG", "Hash matching rows marked_no_dup_id", {"count": match_marked_but_no_dup_id})

    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_hash_min_ids t ON r.content_hash = t.content_hash WHERE r.id != t.min_id AND (r.is_duplicate = 0 OR r.duplicate_of_file_id IS NULL)")
    try:
        updatable = int(cursor.fetchone()[0] or 0)
    except Exception:
        updatable = 0
    LOGGER.info(f"Hash dedupe rows qualifying for update: {updatable}")
    log_db(cursor, run_id, "DEBUG", "Hash dedupe rows qualifying for update", {"count": updatable})
    if updatable > 0:
        cursor.execute("SELECT r.id, r.repo_commit_id, r.content_hash FROM repo_commit_files r JOIN tmp_hash_min_ids t ON r.content_hash = t.content_hash WHERE r.id != t.min_id AND (r.is_duplicate = 0 OR r.duplicate_of_file_id IS NULL) LIMIT 5")
        sample_rows = cursor.fetchall()
        LOGGER.debug(f"Sample updatable hash rows: {sample_rows}")
        log_db(cursor, run_id, "DEBUG", "Sample updatable hash rows", {"sample": sample_rows})
    log_db(cursor, run_id, "INFO", "Updating duplicate records...")

    cursor.execute("""
        UPDATE repo_commit_files r
        JOIN tmp_hash_min_ids t ON r.content_hash = t.content_hash
        SET r.is_duplicate = 1,
            r.duplicate_of_file_id = t.min_id,
            r.duplicate_reason = 'hash'
        WHERE r.id != t.min_id
          AND r.content_hash IS NOT NULL
          AND r.content_hash != ''
          AND (r.is_duplicate = 0 OR r.duplicate_of_file_id IS NULL)
    """)
    updated_count = cursor.rowcount
    duration = time.time() - start_time
    LOGGER.info(f"Marked {updated_count} rows as hash duplicates. Time: {duration:.2f}s")
    log_db(cursor, run_id, "INFO", f"Marked {updated_count} rows as hash duplicates.", {"duration_seconds": duration, "count": updated_count})

    return updated_count

def deduplicate_names(cursor, run_id):
    if check_stop_flag(cursor): return

    LOGGER.info("Starting name+size based deduplication...")
    log_db(cursor, run_id, "INFO", "Starting name+size based deduplication...")
    start_time = time.time()

    # 1. Identify duplicates: find min_id for each (file_name, bytes_after)
    cursor.execute("CREATE TEMPORARY TABLE IF NOT EXISTS tmp_name_min_ids (file_name VARCHAR(255) COLLATE utf8mb4_unicode_ci, bytes_after BIGINT, min_id BIGINT, PRIMARY KEY (file_name, bytes_after)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    cursor.execute("TRUNCATE TABLE tmp_name_min_ids")

    LOGGER.info("Finding canonical IDs for name+size...")
    log_db(cursor, run_id, "INFO", "Finding canonical IDs for name+size...")

    # Determine canonical commit per (file_name, bytes_after) by earliest committed_at,
    # then choose the smallest repo_commit_files.id within that canonical commit.
    cursor.execute(
        "CREATE TEMPORARY TABLE IF NOT EXISTS tmp_name_canonical_commits ("
        "file_name VARCHAR(255) COLLATE utf8mb4_unicode_ci, "
        "bytes_after BIGINT, "
        "min_committed_at DATETIME(6), "
        "canonical_commit_id BIGINT, "
        "PRIMARY KEY (file_name, bytes_after)"
        ") CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    )
    cursor.execute("TRUNCATE TABLE tmp_name_canonical_commits")

    cursor.execute("""
        INSERT INTO tmp_name_canonical_commits (file_name, bytes_after, min_committed_at, canonical_commit_id)
        SELECT m.file_name,
               m.bytes_after,
               m.min_committed_at,
               MIN(rc.id) AS canonical_commit_id
        FROM (
            SELECT r.file_name, r.bytes_after, MIN(c.committed_at) AS min_committed_at
            FROM repo_commit_files r
            JOIN repo_commits c ON c.id = r.repo_commit_id
            WHERE r.bytes_after IS NOT NULL AND r.bytes_after > 0
              AND (r.is_duplicate = 0 OR r.duplicate_reason != 'hash')
              AND r.content_hash IS NULL
              AND r.change_type != 'R'
            GROUP BY r.file_name, r.bytes_after
            HAVING COUNT(*) > 1
        ) m
        JOIN repo_commit_files r2
          ON r2.file_name = m.file_name
         AND r2.bytes_after = m.bytes_after
         AND r2.bytes_after IS NOT NULL AND r2.bytes_after > 0
         AND (r2.is_duplicate = 0 OR r2.duplicate_reason != 'hash')
         AND r2.content_hash IS NULL
         AND r2.change_type != 'R'
        JOIN repo_commits rc
          ON rc.id = r2.repo_commit_id
         AND rc.committed_at = m.min_committed_at
        GROUP BY m.file_name, m.bytes_after, m.min_committed_at
    """)

    cursor.execute("""
        INSERT INTO tmp_name_min_ids (file_name, bytes_after, min_id)
        SELECT t.file_name, t.bytes_after, MIN(r.id) AS min_id
        FROM tmp_name_canonical_commits t
        JOIN repo_commit_files r
          ON r.file_name = t.file_name
         AND r.bytes_after = t.bytes_after
         AND r.repo_commit_id = t.canonical_commit_id
        WHERE r.bytes_after IS NOT NULL AND r.bytes_after > 0
          AND (r.is_duplicate = 0 OR r.duplicate_reason != 'hash')
          AND r.content_hash IS NULL
          AND r.change_type != 'R'
        GROUP BY t.file_name, t.bytes_after
    """)

    # Diagnostic: how many candidate name+size groups were found
    cursor.execute("SELECT COUNT(*) FROM tmp_name_min_ids")
    try:
        found_name_groups = int(cursor.fetchone()[0] or 0)
    except Exception:
        found_name_groups = 0
    LOGGER.info(f"Name+size dedupe candidate groups: {found_name_groups}")
    log_db(cursor, run_id, "DEBUG", "Name+size dedupe candidate groups", {"count": found_name_groups})

    # Small sample of name+size groups
    if found_name_groups > 0:
        cursor.execute("SELECT file_name, bytes_after FROM tmp_name_min_ids LIMIT 5")
        sample = cursor.fetchall()
        LOGGER.info(f"Sample name+size groups: {sample}")
        log_db(cursor, run_id, "DEBUG", "Sample name+size groups", {"sample": sample})

    if check_stop_flag(cursor): return

    # 2. Update duplicates
    LOGGER.info("Updating duplicate records...")
    # Diagnostic: how many rows would match the name+size update predicate
    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_name_min_ids t ON r.file_name = t.file_name AND r.bytes_after = t.bytes_after WHERE r.id != t.min_id")
    try:
        total_matching_name = int(cursor.fetchone()[0] or 0)
    except Exception:
        total_matching_name = 0
    LOGGER.info(f"Name+size dedupe matching rows (all, before where predicate): {total_matching_name}")
    log_db(cursor, run_id, "DEBUG", "Name+size matching rows (all)", {"count": total_matching_name})

    # Extra diagnostics for name+size: breakdown by current duplicate state
    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_name_min_ids t ON r.file_name = t.file_name AND r.bytes_after = t.bytes_after WHERE r.id != t.min_id AND r.is_duplicate=1 AND r.duplicate_of_file_id IS NOT NULL")
    try:
        ns_already_marked = int(cursor.fetchone()[0] or 0)
    except Exception:
        ns_already_marked = 0
    LOGGER.info(f"Name+size matching rows already marked as duplicate with duplicate_of_file_id: {ns_already_marked}")
    log_db(cursor, run_id, "DEBUG", "Name+size matching rows already marked", {"count": ns_already_marked})

    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_name_min_ids t ON r.file_name = t.file_name AND r.bytes_after = t.bytes_after WHERE r.id != t.min_id AND r.is_duplicate=0 AND r.duplicate_of_file_id IS NOT NULL")
    try:
        ns_dup_id_but_not_flagged = int(cursor.fetchone()[0] or 0)
    except Exception:
        ns_dup_id_but_not_flagged = 0
    LOGGER.info(f"Name+size matching rows with duplicate_of_file_id set but is_duplicate=0: {ns_dup_id_but_not_flagged}")
    log_db(cursor, run_id, "DEBUG", "Name+size matching rows dup_id_no_flag", {"count": ns_dup_id_but_not_flagged})

    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_name_min_ids t ON r.file_name = t.file_name AND r.bytes_after = t.bytes_after WHERE r.id != t.min_id AND r.is_duplicate=1 AND r.duplicate_of_file_id IS NULL")
    try:
        ns_marked_but_no_dup_id = int(cursor.fetchone()[0] or 0)
    except Exception:
        ns_marked_but_no_dup_id = 0
    LOGGER.info(f"Name+size matching rows with is_duplicate=1 but no duplicate_of_file_id: {ns_marked_but_no_dup_id}")
    log_db(cursor, run_id, "DEBUG", "Name+size matching rows marked_no_dup_id", {"count": ns_marked_but_no_dup_id})

    cursor.execute("SELECT COUNT(*) FROM repo_commit_files r JOIN tmp_name_min_ids t ON r.file_name = t.file_name AND r.bytes_after = t.bytes_after WHERE r.id != t.min_id AND (r.is_duplicate = 0)")
    try:
        updatable_name = int(cursor.fetchone()[0] or 0)
    except Exception:
        updatable_name = 0
    LOGGER.info(f"Name+size dedupe rows qualifying for update: {updatable_name}")
    log_db(cursor, run_id, "DEBUG", "Name+size rows qualifying for update", {"count": updatable_name})
    if updatable_name > 0:
        cursor.execute("SELECT r.id, r.repo_commit_id, r.file_name, r.bytes_after FROM repo_commit_files r JOIN tmp_name_min_ids t ON r.file_name = t.file_name AND r.bytes_after = t.bytes_after WHERE r.id != t.min_id AND (r.is_duplicate = 0) LIMIT 5")
        sample_rows = cursor.fetchall()
        LOGGER.debug(f"Sample updatable name+size rows: {sample_rows}")
        log_db(cursor, run_id, "DEBUG", "Sample updatable name+size rows", {"sample": sample_rows})
    log_db(cursor, run_id, "INFO", "Updating duplicate records...")

    cursor.execute("""
        UPDATE repo_commit_files r
        JOIN tmp_name_min_ids t ON r.file_name = t.file_name AND r.bytes_after = t.bytes_after
        SET r.is_duplicate = 1,
            r.duplicate_of_file_id = t.min_id,
            r.duplicate_reason = 'name_and_size'
        WHERE r.id != t.min_id
          AND (r.is_duplicate = 0)
    """)
    updated_count = cursor.rowcount
    duration = time.time() - start_time
    LOGGER.info(f"Marked {updated_count} rows as name+size duplicates. Time: {duration:.2f}s")
    log_db(cursor, run_id, "INFO", f"Marked {updated_count} rows as name+size duplicates.", {"duration_seconds": duration, "count": updated_count})

    return updated_count

def cleanup_diffs(cursor, run_id):
    if check_stop_flag(cursor): return

    LOGGER.info("Cleaning up redundant diffs...")
    log_db(cursor, run_id, "INFO", "Cleaning up redundant diffs...")
    start_time = time.time()

    # Delete diffs for files that are marked as duplicates
    cursor.execute("""
        DELETE d
        FROM repo_commit_diffs d
        JOIN repo_commit_files f ON d.repo_commit_file_id = f.id
        WHERE f.is_duplicate = 1
    """)
    deleted_count = cursor.rowcount
    duration = time.time() - start_time
    LOGGER.info(f"Deleted {deleted_count} redundant diffs. Time: {duration:.2f}s")
    log_db(cursor, run_id, "INFO", f"Deleted {deleted_count} redundant diffs.", {"duration_seconds": duration, "count": deleted_count})

    return deleted_count

def update_commit_duplicate_counts(cursor, run_id):
    """Aggregate repo_commit_files duplicate flags and update per-commit counters in repo_commits.

    This ensures that after marking repo_commit_files.is_duplicate we also populate
    repo_commits.duplicate_* columns which aggregation jobs (stat_repo_daily/monthly)
    expect to read.

    Also updates files_added to be "valid new files" (change_type='A', is_duplicate=0,
    file_type not in banned/unknown), since the original total can be computed as
    code_files_added + binary_files_added.
    """
    if check_stop_flag(cursor):
        return

    LOGGER.info("Updating per-commit duplicate counters from repo_commit_files...")
    log_db(cursor, run_id, "INFO", "Updating per-commit duplicate counters from repo_commit_files...")

    # Build temp table of aggregated duplicate stats per repo_commit_id
    cursor.execute("DROP TEMPORARY TABLE IF EXISTS tmp_commit_dup_stats")
    cursor.execute("CREATE TEMPORARY TABLE tmp_commit_dup_stats (repo_commit_id BIGINT PRIMARY KEY, dup_code_files INT, dup_bin_files INT, dup_lines BIGINT, dup_bin_bytes BIGINT, net_bytes BIGINT, net_added INT, net_deleted INT, net_modified INT, valid_files_added INT, net_code_added INT, net_code_deleted INT, net_code_modified INT, net_bin_added INT, net_bin_deleted INT, net_bin_modified INT) ENGINE=MEMORY")

    cursor.execute("\
        INSERT INTO tmp_commit_dup_stats (repo_commit_id, dup_code_files, dup_bin_files, dup_lines, dup_bin_bytes, net_bytes, net_added, net_deleted, net_modified, valid_files_added, net_code_added, net_code_deleted, net_code_modified, net_bin_added, net_bin_deleted, net_bin_modified)\
        SELECT repo_commit_id,\
               SUM(CASE WHEN is_duplicate=1 AND can_line_count=1 THEN 1 ELSE 0 END) AS dup_code_files,\
               SUM(CASE WHEN is_duplicate=1 AND can_line_count=0 THEN 1 ELSE 0 END) AS dup_bin_files,\
               SUM(CASE WHEN is_duplicate=1 AND can_line_count=1 THEN COALESCE(lines_added,0) + COALESCE(lines_deleted,0) + COALESCE(lines_modified,0) ELSE 0 END) AS dup_lines,\
               SUM(CASE WHEN is_duplicate=1 THEN COALESCE(bytes_after,0) ELSE 0 END) AS dup_bin_bytes,\
               (SUM(CASE WHEN is_duplicate=0 THEN COALESCE(bytes_after,0) ELSE 0 END) - SUM(CASE WHEN is_duplicate=0 THEN COALESCE(bytes_before,0) ELSE 0 END)) AS net_bytes,\
               SUM(CASE WHEN is_duplicate=0 THEN COALESCE(lines_added,0) ELSE 0 END) AS net_added,\
               SUM(CASE WHEN is_duplicate=0 THEN COALESCE(lines_deleted,0) ELSE 0 END) AS net_deleted,\
               SUM(CASE WHEN is_duplicate=0 THEN COALESCE(lines_modified,0) ELSE 0 END) AS net_modified,\
               SUM(CASE WHEN change_type='A' AND is_duplicate=0 AND file_type NOT IN ('banned', 'unknown') THEN 1 ELSE 0 END) AS valid_files_added,\
               SUM(CASE WHEN change_type='A' AND can_line_count=1 AND is_duplicate=0 AND file_type NOT IN ('banned', 'unknown') THEN 1 ELSE 0 END) AS net_code_added,\
               SUM(CASE WHEN change_type='D' AND can_line_count=1 AND is_duplicate=0 AND file_type NOT IN ('banned', 'unknown') THEN 1 ELSE 0 END) AS net_code_deleted,\
               SUM(CASE WHEN change_type!='A' AND change_type!='D' AND can_line_count=1 AND is_duplicate=0 AND file_type NOT IN ('banned', 'unknown') THEN 1 ELSE 0 END) AS net_code_modified,\
               SUM(CASE WHEN change_type='A' AND can_line_count=0 AND is_duplicate=0 AND file_type NOT IN ('banned', 'unknown') THEN 1 ELSE 0 END) AS net_bin_added,\
               SUM(CASE WHEN change_type='D' AND can_line_count=0 AND is_duplicate=0 AND file_type NOT IN ('banned', 'unknown') THEN 1 ELSE 0 END) AS net_bin_deleted,\
               SUM(CASE WHEN change_type!='A' AND change_type!='D' AND can_line_count=0 AND is_duplicate=0 AND file_type NOT IN ('banned', 'unknown') THEN 1 ELSE 0 END) AS net_bin_modified\
        FROM repo_commit_files\
        GROUP BY repo_commit_id")

    # Diagnostics: how many commits are in tmp table
    cursor.execute("SELECT COUNT(*) FROM tmp_commit_dup_stats")
    try:
        tmp_commits = int(cursor.fetchone()[0] or 0)
    except Exception:
        tmp_commits = 0
    LOGGER.info(f"tmp_commit_dup_stats rows: {tmp_commits}")
    log_db(cursor, run_id, "DEBUG", "tmp_commit_dup_stats rows", {"count": tmp_commits})

    # Diagnostic: how many tmp rows have non-zero duplicate counts (real duplicates)
    cursor.execute("SELECT COUNT(*) FROM tmp_commit_dup_stats WHERE dup_code_files>0 OR dup_bin_files>0 OR dup_lines>0 OR dup_bin_bytes>0")
    try:
        tmp_nonzero = int(cursor.fetchone()[0] or 0)
    except Exception:
        tmp_nonzero = 0
    LOGGER.info(f"tmp_commit_dup_stats non-zero duplicate rows: {tmp_nonzero}")
    log_db(cursor, run_id, "DEBUG", "tmp_commit_dup_stats non-zero", {"count": tmp_nonzero})
    if tmp_nonzero > 0:
        cursor.execute("SELECT repo_commit_id, dup_code_files, dup_bin_files, dup_lines, dup_bin_bytes FROM tmp_commit_dup_stats WHERE dup_code_files>0 OR dup_bin_files>0 OR dup_lines>0 OR dup_bin_bytes>0 LIMIT 5")
        sample_tmp_nonzero = cursor.fetchall()
        LOGGER.info(f"Sample non-zero tmp stats: {sample_tmp_nonzero}")
        log_db(cursor, run_id, "DEBUG", "Sample non-zero tmp stats", {"sample": sample_tmp_nonzero})

    # How many repo_commits would join
    cursor.execute("SELECT COUNT(*) FROM repo_commits rc JOIN tmp_commit_dup_stats t ON rc.id=t.repo_commit_id")
    try:
        commit_join_count = int(cursor.fetchone()[0] or 0)
    except Exception:
        commit_join_count = 0
    LOGGER.info(f"repo_commits matching tmp stats: {commit_join_count}")
    log_db(cursor, run_id, "DEBUG", "repo_commits matching tmp stats", {"count": commit_join_count})

    # How many of those have files_ingested=1
    cursor.execute("SELECT COUNT(*) FROM repo_commits rc JOIN tmp_commit_dup_stats t ON rc.id=t.repo_commit_id WHERE rc.files_ingested=1")
    try:
        commit_ingested_count = int(cursor.fetchone()[0] or 0)
    except Exception:
        commit_ingested_count = 0
    LOGGER.info(f"repo_commits with files_ingested=1 matching tmp stats: {commit_ingested_count}")
    log_db(cursor, run_id, "DEBUG", "repo_commits files_ingested=1 matching tmp stats", {"count": commit_ingested_count})

    # Sample some commit ids in tmp table (both ingested and not) for debugging
    cursor.execute("SELECT repo_commit_id FROM tmp_commit_dup_stats LIMIT 5")
    sample_tmp = [r[0] for r in cursor.fetchall()]
    if sample_tmp:
        LOGGER.info(f"Sample repo_commit_ids in tmp stats: {sample_tmp}")
        log_db(cursor, run_id, "DEBUG", "Sample repo_commit_ids in tmp stats", {"sample": sample_tmp})

    # Check for mismatches between current repo_commits duplicate_* values and aggregated tmp values
    cursor.execute("SELECT COUNT(*) FROM repo_commits rc JOIN tmp_commit_dup_stats t ON rc.id = t.repo_commit_id WHERE rc.files_ingested=1 AND (rc.code_files_duplicated <> COALESCE(t.dup_code_files,0) OR rc.binary_files_duplicated <> COALESCE(t.dup_bin_files,0) OR rc.duplicate_files_bytes <> COALESCE(t.dup_bin_bytes,0))")
    try:
        mismatch_count = int(cursor.fetchone()[0] or 0)
    except Exception:
        mismatch_count = 0
    LOGGER.info(f"repo_commits with mismatched duplicate_* values (files_ingested=1): {mismatch_count}")
    log_db(cursor, run_id, "DEBUG", "repo_commits mismatch count", {"count": mismatch_count})
    if mismatch_count > 0:
        cursor.execute("SELECT rc.id, rc.code_files_duplicated, rc.binary_files_duplicated, rc.duplicate_files_bytes, t.dup_code_files, t.dup_bin_files, t.dup_bin_bytes FROM repo_commits rc JOIN tmp_commit_dup_stats t ON rc.id = t.repo_commit_id WHERE rc.files_ingested=1 AND (rc.code_files_duplicated <> COALESCE(t.dup_code_files,0) OR rc.binary_files_duplicated <> COALESCE(t.dup_bin_files,0) OR rc.duplicate_files_bytes <> COALESCE(t.dup_bin_bytes,0)) LIMIT 5")
        sample_mismatch = cursor.fetchall()
        LOGGER.info(f"Sample mismatched commits: {sample_mismatch}")
        log_db(cursor, run_id, "DEBUG", "Sample mismatched commits", {"sample": sample_mismatch})

    # Also log how many repo_commits currently already have non-zero duplicate counters
    cursor.execute("SELECT COUNT(*) FROM repo_commits WHERE files_ingested=1 AND (code_files_duplicated>0 OR binary_files_duplicated>0 OR duplicate_files_bytes>0)")
    try:
        commits_with_existing_nonzero = int(cursor.fetchone()[0] or 0)
    except Exception:
        commits_with_existing_nonzero = 0
    LOGGER.info(f"repo_commits already with non-zero duplicate counters: {commits_with_existing_nonzero}")
    log_db(cursor, run_id, "DEBUG", "repo_commits existing non-zero duplicates", {"count": commits_with_existing_nonzero})

    # Update repo_commits using the temporary aggregation
    # Note: files_added is now redefined as "valid new files added" (excluding duplicates and unexpected)
    # The original total can be computed as: code_files_added + binary_files_added
    cursor.execute(
        "UPDATE repo_commits c "
        "JOIN tmp_commit_dup_stats t ON c.id = t.repo_commit_id "
        "SET c.code_files_duplicated = COALESCE(t.dup_code_files, 0), "
        "    c.binary_files_duplicated = COALESCE(t.dup_bin_files, 0), "
        "    c.duplicate_files_bytes = COALESCE(t.dup_bin_bytes, 0), "
        "    c.files_added = COALESCE(t.valid_files_added, 0), "
        "    c.code_files_added = COALESCE(t.net_code_added, 0), "
        "    c.code_files_deleted = COALESCE(t.net_code_deleted, 0), "
        "    c.code_files_modified = COALESCE(t.net_code_modified, 0), "
        "    c.binary_files_added = COALESCE(t.net_bin_added, 0), "
        "    c.binary_files_deleted = COALESCE(t.net_bin_deleted, 0), "
        "    c.binary_files_modified = COALESCE(t.net_bin_modified, 0), "
        "    c.lines_added = COALESCE(t.net_added, 0), "
        "    c.lines_deleted = COALESCE(t.net_deleted, 0), "
        "    c.lines_modified = COALESCE(t.net_modified, 0), "
        "    c.bytes_added = COALESCE(t.net_bytes, 0), "
        "    c.score_submission_quality = CASE WHEN (COALESCE(t.valid_files_added,0) + COALESCE(t.net_code_modified,0) + COALESCE(t.net_bin_modified,0) + c.files_in_banned_directories + c.files_unexpected + COALESCE(t.dup_code_files,0) + COALESCE(t.dup_bin_files,0)) > 0 THEN "
        "        (COALESCE(t.valid_files_added,0) + COALESCE(t.net_code_modified,0) + COALESCE(t.net_bin_modified,0)) * 100.0 / (COALESCE(t.valid_files_added,0) + COALESCE(t.net_code_modified,0) + COALESCE(t.net_bin_modified,0) + c.files_in_banned_directories + c.files_unexpected + COALESCE(t.dup_code_files,0) + COALESCE(t.dup_bin_files,0)) "
        "        ELSE 100.0 END, "
        "    c.score_code_quality = GREATEST(0, 100.0 - ABS(50.0 - (COALESCE(t.net_added,0) + COALESCE(t.net_deleted,0) + COALESCE(t.net_modified,0))) * 0.2) "
        "WHERE c.files_ingested=1")

    updated = cursor.rowcount
    LOGGER.info(f"Updated duplicate counters on {updated} repo_commits")
    log_db(cursor, run_id, "INFO", "Updated duplicate counters on repo_commits", {"rows_updated": updated})

    return updated

def main():
    parser = argparse.ArgumentParser(description="Deduplicate repo files based on content hash")
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", Config.DB_HOST))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", Config.DB_PORT)))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", Config.DB_USER))
    parser.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", Config.DB_PASSWORD))
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", Config.DB_NAME))
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", Config.LOG_LEVEL))
    parser.add_argument("--run-id", type=int, default=None, help="Existing ingestion_run_id to log to")
    parser.add_argument("--triggered-by", default="manual", help="Identifier for the trigger source")

    args = parser.parse_args()

    try:
        from log_utils import configure_logging
    except ImportError:
        from server.scripts.log_utils import configure_logging

    configure_logging(args.log_level)

    run_id = args.run_id
    is_external_run = run_id is not None
    conn = None
    try:
        conn = get_db_connection(args.db_host, args.db_port, args.db_user, args.db_password, args.db_name)
        cursor = conn.cursor()

        # Create ingestion run if triggered_by is provided and no run_id supplied
        if args.triggered_by and not run_id:
            cursor.execute("""
                INSERT INTO ingestion_runs (job_type, status, started_at, triggered_by)
                VALUES ('deduplicate_files', 'running', NOW(), %s)
            """, (args.triggered_by,))
            run_id = cursor.lastrowid
            LOGGER.info(f"Created ingestion run {run_id}")

        # Reset stop flag
        cursor.execute("INSERT INTO system_parameters (param_key, param_value, description) VALUES ('deduplicate_files_stop', '0', 'Flag to stop deduplication') ON DUPLICATE KEY UPDATE param_value='0'")

        total_processed = 0

        # Hash deduplication
        count = deduplicate_hashes(cursor, run_id)
        if count: total_processed += count

        # Name+Size deduplication
        count = deduplicate_names(cursor, run_id)
        if count: total_processed += count

        # Update per-commit counters from repo_commit_files so repo_commits reflect duplicates
        try:
            update_commit_duplicate_counts(cursor, run_id)
        except Exception as e:
            LOGGER.warning(f"Failed to update repo_commit duplicate counters: {e}")

        # Cleanup diffs
        cleanup_diffs(cursor, run_id)

        if check_stop_flag(cursor):
            LOGGER.info("Deduplication stopped by user.")
            log_db(cursor, run_id, "WARNING", "Deduplication stopped by user.")
            if not is_external_run:
                update_run_status(cursor, run_id, "stopped", items_processed=total_processed)
        else:
            LOGGER.info("Deduplication complete.")
            log_db(cursor, run_id, "INFO", "Deduplication complete.")
            if not is_external_run:
                update_run_status(cursor, run_id, "finished", items_processed=total_processed)

        cursor.close()
        conn.close()

    except Exception as e:
        LOGGER.error(f"Deduplication failed: {e}")
        if conn and run_id:
            try:
                cursor = conn.cursor()
                log_db(cursor, run_id, "ERROR", f"Deduplication failed: {e}")
                if not is_external_run:
                    update_run_status(cursor, run_id, "failed", error_message=str(e))
                conn.close()
            except Exception:
                pass
        sys.exit(1)

if __name__ == "__main__":
    main()
