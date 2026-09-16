#!/usr/bin/env python3
"""
Clean up inconsistent duplicate records where duplicate_reason='hash' but content_hash IS NULL.

These records should either:
1. Be re-deduplicated using name+size if they have valid file_name and bytes_after
2. Be unmarked as duplicates if they can't be deduplicated by any method

Run this after fixing deduplicate_repo_files.py to clean up existing data.
"""
import argparse
import logging
import sys
import time
import mysql.connector
from typing import Optional

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
LOGGER = logging.getLogger(__name__)


def create_run(cursor, conn) -> int:
    """Create an ingestion_run record for tracking."""
    cursor.execute("""
        INSERT INTO ingestion_runs (job_type, source_type, status, started_at, params, triggered_by)
        VALUES ('cleanup_hash_inconsistency', 'mixed', 'running', NOW(6), '{}', 'manual')
    """)
    conn.commit()
    return cursor.lastrowid


def log_db(cursor, run_id: int, level: str, message: str, context: Optional[dict] = None):
    """Log to ingestion_run_logs."""
    import json
    cursor.execute(
        "INSERT INTO ingestion_run_logs (ingestion_run_id, log_level, message, context) VALUES (%s,%s,%s,%s)",
        (run_id, level, message, json.dumps(context, ensure_ascii=False) if context else None)
    )


def cleanup_inconsistent_hash_duplicates(config: dict):
    """Main cleanup function."""
    conn = mysql.connector.connect(
        host=config['db_host'],
        port=config['db_port'],
        user=config['db_user'],
        password=config['db_password'],
        database=config['db_name'],
        autocommit=False
    )

    cursor = conn.cursor()
    run_id = create_run(cursor, conn)

    try:
        LOGGER.info("=" * 80)
        LOGGER.info("Starting cleanup of inconsistent hash duplicate records...")
        LOGGER.info("=" * 80)
        log_db(cursor, run_id, "INFO", "Starting cleanup of inconsistent hash duplicate records")

        # Step 1: Count affected records
        cursor.execute("""
            SELECT COUNT(*)
            FROM repo_commit_files
            WHERE is_duplicate=1
              AND duplicate_reason='hash'
              AND (content_hash IS NULL OR content_hash = '')
        """)
        affected_count = cursor.fetchone()[0]
        LOGGER.info(f"Found {affected_count:,} inconsistent records (duplicate_reason='hash' but content_hash IS NULL)")
        log_db(cursor, run_id, "INFO", f"Found {affected_count} inconsistent records", {"count": affected_count})

        if affected_count == 0:
            LOGGER.info("No inconsistent records found. Exiting.")
            cursor.execute("UPDATE ingestion_runs SET status='success' WHERE id=%s", (run_id,))
            conn.commit()
            return

        # Step 2: Try to re-deduplicate using name+size for files that have valid name and size
        LOGGER.info("\nStep 2: Re-deduplicating using name+size method...")
        log_db(cursor, run_id, "INFO", "Re-deduplicating using name+size method")

        # Create temp table for name+size canonical IDs
        cursor.execute("""
            CREATE TEMPORARY TABLE IF NOT EXISTS tmp_namesize_fix (
                file_name VARCHAR(255) COLLATE utf8mb4_unicode_ci,
                bytes_after BIGINT,
                min_id BIGINT,
                PRIMARY KEY (file_name, bytes_after)
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """)
        cursor.execute("TRUNCATE TABLE tmp_namesize_fix")

        # Find canonical IDs for name+size groups that include affected records
        cursor.execute("""
            INSERT INTO tmp_namesize_fix (file_name, bytes_after, min_id)
            SELECT f.file_name, f.bytes_after, MIN(f.id)
            FROM repo_commit_files f
            WHERE f.file_name IS NOT NULL
              AND f.bytes_after IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM repo_commit_files bad
                  WHERE bad.file_name = f.file_name
                    AND bad.bytes_after = f.bytes_after
                    AND bad.is_duplicate=1
                    AND bad.duplicate_reason='hash'
                    AND (bad.content_hash IS NULL OR bad.content_hash = '')
              )
            GROUP BY f.file_name, f.bytes_after
            HAVING COUNT(*) > 1
        """)
        namesize_groups = cursor.rowcount
        LOGGER.info(f"Found {namesize_groups:,} name+size groups for re-deduplication")
        log_db(cursor, run_id, "INFO", f"Found {namesize_groups} name+size groups", {"count": namesize_groups})

        # Update affected records to use name_and_size deduplication
        cursor.execute("""
            UPDATE repo_commit_files r
            JOIN tmp_namesize_fix t ON r.file_name = t.file_name AND r.bytes_after = t.bytes_after
            SET r.duplicate_of_file_id = t.min_id,
                r.duplicate_reason = 'name_and_size',
                r.is_duplicate = IF(r.id != t.min_id, 1, 0)
            WHERE (r.content_hash IS NULL OR r.content_hash = '')
              AND r.file_name IS NOT NULL
              AND r.bytes_after IS NOT NULL
        """)
        updated_namesize = cursor.rowcount
        LOGGER.info(f"Re-deduplicated {updated_namesize:,} records using name+size method")
        log_db(cursor, run_id, "INFO", f"Re-deduplicated using name+size", {"count": updated_namesize})
        conn.commit()

        # Step 3: Unmark remaining records that can't be deduplicated
        LOGGER.info("\nStep 3: Unmarking records that can't be re-deduplicated...")
        log_db(cursor, run_id, "INFO", "Unmarking records that can't be re-deduplicated")

        cursor.execute("""
            UPDATE repo_commit_files
            SET is_duplicate = 0,
                duplicate_of_file_id = NULL,
                duplicate_reason = NULL
            WHERE is_duplicate=1
              AND duplicate_reason='hash'
              AND (content_hash IS NULL OR content_hash = '')
        """)
        unmarked = cursor.rowcount
        LOGGER.info(f"Unmarked {unmarked:,} records that couldn't be re-deduplicated")
        log_db(cursor, run_id, "INFO", f"Unmarked records", {"count": unmarked})
        conn.commit()

        # Step 4: Verification
        LOGGER.info("\nStep 4: Verification...")
        cursor.execute("""
            SELECT COUNT(*)
            FROM repo_commit_files
            WHERE is_duplicate=1
              AND duplicate_reason='hash'
              AND (content_hash IS NULL OR content_hash = '')
        """)
        remaining = cursor.fetchone()[0]

        LOGGER.info("=" * 80)
        LOGGER.info("Cleanup Summary:")
        LOGGER.info(f"  Initial inconsistent records: {affected_count:,}")
        LOGGER.info(f"  Re-deduplicated (name+size): {updated_namesize:,}")
        LOGGER.info(f"  Unmarked (can't dedupe): {unmarked:,}")
        LOGGER.info(f"  Remaining inconsistent: {remaining:,}")
        LOGGER.info("=" * 80)

        log_db(cursor, run_id, "INFO", "Cleanup complete", {
            "initial": affected_count,
            "re_deduped": updated_namesize,
            "unmarked": unmarked,
            "remaining": remaining
        })

        if remaining > 0:
            LOGGER.warning(f"WARNING: {remaining} inconsistent records remain!")
            cursor.execute("UPDATE ingestion_runs SET status='failed' WHERE id=%s", (run_id,))
        else:
            cursor.execute("UPDATE ingestion_runs SET status='success' WHERE id=%s", (run_id,))

        conn.commit()

    except Exception as e:
        LOGGER.error(f"Error during cleanup: {e}")
        log_db(cursor, run_id, "ERROR", f"Cleanup failed: {str(e)}")
        cursor.execute("UPDATE ingestion_runs SET status='failed' WHERE id=%s", (run_id,))
        conn.commit()
        raise
    finally:
        cursor.close()
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Clean up inconsistent hash duplicate records")
    parser.add_argument('--db-host', default='127.0.0.1', help='Database host')
    parser.add_argument('--db-port', type=int, default=3306, help='Database port')
    parser.add_argument('--db-user', default='root', help='Database user')
    parser.add_argument('--db-password', default='Wiztek@1902', help='Database password')
    parser.add_argument('--db-name', default='codeinsightdb', help='Database name')

    args = parser.parse_args()

    config = {
        'db_host': args.db_host,
        'db_port': args.db_port,
        'db_user': args.db_user,
        'db_password': args.db_password,
        'db_name': args.db_name
    }

    cleanup_inconsistent_hash_duplicates(config)
    LOGGER.info("Done!")


if __name__ == '__main__':
    main()
