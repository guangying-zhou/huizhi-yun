#!/usr/bin/env python3
"""Backfill directories_banned and files_unexpected for existing commits.

This script recalculates and updates the directories_banned and files_unexpected
fields in the repo_commits table for all commits that have files_ingested=1.

The calculation logic:
- directories_banned: COUNT of distinct banned directories from repo_commit_banned_directories
- files_unexpected: SUM of files in banned directories + COUNT of files with type='banned'/'unknown' in repo_commit_files

Usage:
    python server/scripts/backfill_banned_counts.py
    python server/scripts/backfill_banned_counts.py --batch-size 500 --limit 10000
    python server/scripts/backfill_banned_counts.py --repo-catalog-id 123
    python server/scripts/backfill_banned_counts.py --dry-run
"""

import argparse
import logging
import os
import sys
from typing import Optional, Iterable

try:
    import mysql.connector
    from mysql.connector import errors as mysql_errors
except ImportError as exc:
    raise SystemExit("mysql-connector-python required. pip install mysql-connector-python") from exc

LOGGER = logging.getLogger(__name__)


def parse_args(argv: Optional[Iterable[str]] = None):
    parser = argparse.ArgumentParser(description="Backfill banned counts in repo_commits")
    parser.add_argument("--db-host", default=os.environ.get("DB_HOST", "127.0.0.1"))
    parser.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", "3306")))
    parser.add_argument("--db-user", default=os.environ.get("DB_USER", "root"))
    parser.add_argument("--db-password", default=os.environ.get("DB_PASSWORD", "Wiztek@1902"))
    parser.add_argument("--db-name", default=os.environ.get("DB_NAME", "codeinsightdb"))
    parser.add_argument("--batch-size", type=int, default=100, help="Number of commits to process per batch")
    parser.add_argument("--limit", type=int, default=None, help="Maximum number of commits to process (for testing)")
    parser.add_argument("--repo-catalog-id", type=int, default=None, help="Only process commits for this repository")
    parser.add_argument("--dry-run", action="store_true", help="Don't commit changes to database")
    parser.add_argument("--log-level", default=os.environ.get("LOG_LEVEL", "INFO"))
    args = parser.parse_args(list(argv) if argv is not None else None)
    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)s %(message)s"
    )
    return args


def connect(args):
    return mysql.connector.connect(
        host=args.db_host,
        port=args.db_port,
        user=args.db_user,
        password=args.db_password,
        database=args.db_name,
        autocommit=False,
    )


def get_commits_to_process(conn, args):
    """Get list of commit IDs that need banned counts updated."""
    cursor = conn.cursor()

    where_clauses = ["files_ingested = 1"]
    params = []

    if args.repo_catalog_id:
        where_clauses.append("repo_catalog_id = %s")
        params.append(args.repo_catalog_id)

    where_sql = " AND ".join(where_clauses)

    sql = f"SELECT id FROM repo_commits WHERE {where_sql} ORDER BY id ASC"

    if args.limit:
        sql += " LIMIT %s"
        params.append(args.limit)

    cursor.execute(sql, tuple(params))
    commit_ids = [row[0] for row in cursor.fetchall()]
    cursor.close()

    return commit_ids


def process_commit_batch(conn, commit_ids):
    """Process a batch of commits to calculate and update banned counts."""
    cursor = conn.cursor()

    # Prepare batch data
    updates = []

    for commit_id in commit_ids:
        # Get banned directories count and files count from repo_commit_banned_directories
        cursor.execute(
            "SELECT COUNT(DISTINCT bd.id), COALESCE(SUM(bd.files_unexpected), 0) "
            "FROM repo_commit_banned_directories bd WHERE bd.repo_commit_id = %s",
            (commit_id,)
        )
        banned_row = cursor.fetchone()
        directories_banned = int(banned_row[0]) if banned_row and banned_row[0] else 0
        banned_dir_files = int(banned_row[1]) if banned_row and banned_row[1] else 0

        # Get count of files with type='banned' or 'unknown' from repo_commit_files
        cursor.execute(
            "SELECT COUNT(*) FROM repo_commit_files "
            "WHERE repo_commit_id = %s AND file_type IN ('banned', 'unknown')",
            (commit_id,)
        )
        banned_type_files = int(cursor.fetchone()[0] or 0)

        # Total banned files = files in banned directories + banned/unknown type files
        total_banned_files = banned_dir_files + banned_type_files

        updates.append((directories_banned, total_banned_files, commit_id))

    # Batch update
    if updates:
        cursor.executemany(
            "UPDATE repo_commits SET directories_banned = %s, files_unexpected = %s WHERE id = %s",
            updates
        )

    cursor.close()
    return len(updates)


def main(argv: Optional[Iterable[str]] = None) -> int:
    args = parse_args(argv)

    LOGGER.info("Starting banned counts backfill")
    LOGGER.info(f"Configuration: batch_size={args.batch_size}, limit={args.limit}, "
                f"repo_catalog_id={args.repo_catalog_id}, dry_run={args.dry_run}")

    conn = connect(args)

    try:
        # Get all commits to process
        commit_ids = get_commits_to_process(conn, args)
        total_commits = len(commit_ids)

        if total_commits == 0:
            LOGGER.info("No commits found to process")
            return 0

        LOGGER.info(f"Found {total_commits} commits to process")

        # Process in batches
        processed = 0
        failed = 0

        for i in range(0, total_commits, args.batch_size):
            batch = commit_ids[i:i + args.batch_size]
            batch_num = (i // args.batch_size) + 1
            total_batches = (total_commits + args.batch_size - 1) // args.batch_size

            try:
                count = process_commit_batch(conn, batch)
                processed += count

                if not args.dry_run:
                    conn.commit()
                else:
                    conn.rollback()

                if batch_num % 10 == 0 or batch_num == total_batches:
                    LOGGER.info(f"Processed batch {batch_num}/{total_batches} "
                               f"({processed}/{total_commits} commits)")

            except Exception as exc:
                LOGGER.error(f"Failed to process batch {batch_num}: {exc}")
                conn.rollback()
                failed += len(batch)

        LOGGER.info(f"Backfill completed: {processed} commits processed, {failed} failed")

        if args.dry_run:
            LOGGER.info("DRY RUN - No changes were committed to the database")

        return 0 if failed == 0 else 1

    except Exception as exc:
        LOGGER.error(f"Fatal error: {exc}")
        return 2

    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
