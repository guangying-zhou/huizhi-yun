
import os
import sys
import argparse
import mysql.connector
from mysql.connector import errorcode
import logging
from typing import Dict, List, Optional, Tuple

# Add parent directory to path to import utils if needed,
# but we'll try to keep it self-contained or use standard imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
LOGGER = logging.getLogger("backfill_banned")

def connect_db(args):
    try:
        return mysql.connector.connect(
            host=args.db_host,
            port=args.db_port,
            user=args.db_user,
            password=args.db_password,
            database=args.db_name,
            autocommit=False
        )
    except mysql.connector.Error as err:
        LOGGER.error(f"Database connection failed: {err}")
        sys.exit(1)

def backfill_banned_files(args):
    conn = connect_db(args)
    cursor = conn.cursor()

    try:
        # 1. Find commits that have banned directories recorded
        LOGGER.info("Fetching commits from repo_commit_banned_directories...")
        cursor.execute("SELECT DISTINCT repo_commit_id FROM repo_commit_banned_directories")
        commit_ids = [row[0] for row in cursor.fetchall()]

        LOGGER.info(f"Found {len(commit_ids)} commits to process.")

        processed = 0
        updated = 0

        for commit_id in commit_ids:
            # 2. Calculate files_in_banned_directories and directories_banned
            cursor.execute(
                "SELECT COUNT(DISTINCT id), COALESCE(SUM(files_unexpected), 0) "
                "FROM repo_commit_banned_directories WHERE repo_commit_id = %s",
                (commit_id,)
            )
            row = cursor.fetchone()
            directories_banned = int(row[0]) if row else 0
            banned_dir_files = int(row[1]) if row else 0

            if directories_banned > 0:
                # 3. Update repo_commits
                # Update both files_in_banned_directories AND directories_banned
                # because the bug caused directories_banned to be 0 as well.
                cursor.execute(
                    "UPDATE repo_commits SET files_in_banned_directories = %s, directories_banned = %s WHERE id = %s",
                    (banned_dir_files, directories_banned, commit_id)
                )
                updated += 1

            processed += 1
            if processed % 100 == 0:
                conn.commit()
                LOGGER.info(f"Processed {processed}/{len(commit_ids)} commits...")

        conn.commit()
        LOGGER.info(f"Backfill completed. Processed: {processed}, Updated: {updated}")

    except Exception as e:
        LOGGER.error(f"An error occurred: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill files_in_banned_directories count")
    parser.add_argument("--db-host", default="127.0.0.1", help="Database host")
    parser.add_argument("--db-port", type=int, default=3306, help="Database port")
    parser.add_argument("--db-user", default="root", help="Database user")
    parser.add_argument("--db-password", default="Wiztek@1902", help="Database password")
    parser.add_argument("--db-name", default="codeinsightdb", help="Database name")

    args = parser.parse_args()
    backfill_banned_files(args)
