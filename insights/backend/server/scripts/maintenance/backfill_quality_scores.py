import os
import sys
import mysql.connector
import time

# Add parent directory to path to import config
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from server.python_service.config import Config

def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", Config.DB_HOST),
        port=int(os.environ.get("DB_PORT", Config.DB_PORT)),
        user=os.environ.get("DB_USER", Config.DB_USER),
        password=os.environ.get("DB_PASSWORD", Config.DB_PASSWORD),
        database=os.environ.get("DB_NAME", Config.DB_NAME)
    )

def main():
    print("Starting backfill of quality scores...")
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    update_cursor = conn.cursor()

    # Fetch all commits
    cursor.execute("""
        SELECT
            id,
            files_added, code_files_modified, binary_files_modified,
            files_in_banned_directories, files_unexpected,
            code_files_duplicated, binary_files_duplicated,
            lines_added, lines_deleted, lines_modified
        FROM repo_commits
    """)

    commits = cursor.fetchall()
    total = len(commits)
    print(f"Found {total} commits to process.")

    batch_size = 1000
    updates = []
    processed = 0

    start_time = time.time()

    for row in commits:
        # 1. Calculate Submission Quality
        # Formula: (Add + Mod) / (Add + Mod + Banned + Unexpected + Duplicate) * 100

        # Handle None values
        files_added = row['files_added'] or 0
        code_files_modified = row['code_files_modified'] or 0
        binary_files_modified = row['binary_files_modified'] or 0

        banned = row['files_in_banned_directories'] or 0
        unexpected = row['files_unexpected'] or 0
        code_dup = row['code_files_duplicated'] or 0
        bin_dup = row['binary_files_duplicated'] or 0

        numerator = files_added + code_files_modified + binary_files_modified
        denominator = numerator + banned + unexpected + code_dup + bin_dup

        if denominator == 0:
            sub_score = 100.0 # No files involved? Default to 100 or 0? Usually 100 if no bad files.
            # But if truly empty, maybe 100 is safer.
        else:
            sub_score = (numerator / denominator) * 100.0

        # 2. Calculate Code Quality (Commit Granularity)
        # Formula: MAX(0, 100 - ABS(50 - TotalLines) * 0.2)
        lines_added = row['lines_added'] or 0
        lines_deleted = row['lines_deleted'] or 0
        lines_modified = row['lines_modified'] or 0

        total_lines = lines_added + lines_deleted + lines_modified

        code_score = max(0, 100.0 - abs(50.0 - total_lines) * 0.2)

        updates.append((sub_score, code_score, row['id']))
        processed += 1

        if len(updates) >= batch_size:
            update_cursor.executemany(
                "UPDATE repo_commits SET score_submission_quality=%s, score_code_quality=%s WHERE id=%s",
                updates
            )
            conn.commit()
            updates = []
            print(f"Processed {processed}/{total} commits...")

    # Flush remaining
    if updates:
        update_cursor.executemany(
            "UPDATE repo_commits SET score_submission_quality=%s, score_code_quality=%s WHERE id=%s",
            updates
        )
        conn.commit()

    elapsed = time.time() - start_time
    print(f"Backfill completed in {elapsed:.2f} seconds.")

    conn.close()

if __name__ == "__main__":
    main()
