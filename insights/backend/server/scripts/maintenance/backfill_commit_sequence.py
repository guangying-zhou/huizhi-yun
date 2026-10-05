#!/usr/bin/env python3
"""
Backfills the `commit_sequence` column in the `repo_commits` table.
- For SVN repos, it uses the revision number.
- For GitLab repos, it generates a sequence based on commit order.
"""
import os
import logging
import mysql.connector

# --- Basic Configuration ---
DB_HOST = os.environ.get("DB_HOST", "127.0.0.1")
DB_PORT = int(os.environ.get("DB_PORT", "3306"))
DB_USER = os.environ.get("DB_USER", "root")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "Wiztek@1902")
DB_NAME = os.environ.get("DB_NAME", "codeinsightdb")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")

logging.basicConfig(level=LOG_LEVEL.upper(), format="%(asctime)s %(levelname)s %(message)s")
LOGGER = logging.getLogger(__name__)

def run_backfill():
    """Connects to the database and runs the backfill logic."""
    connection = None
    try:
        connection = mysql.connector.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,
        )
        cursor = connection.cursor()
        
        LOGGER.info("Fetching list of repositories...")
        cursor.execute("SELECT id, source_type FROM repo_catalog")
        repos = cursor.fetchall()
        LOGGER.info(f"Found {len(repos)} repositories to process.")

        for repo_id, source_type in repos:
            LOGGER.info(f"Processing repo_catalog_id={repo_id} (type: {source_type})...")
            
            if source_type == 'svn':
                LOGGER.info("  -> SVN repo. Updating commit_sequence from revision number.")
                # For SVN, use the revision number directly.
                # Handle potential non-numeric revisions gracefully by updating only numeric ones.
                update_query = """
                UPDATE repo_commits
                SET commit_sequence = CAST(revision AS UNSIGNED)
                WHERE repo_catalog_id = %s AND revision REGEXP '^[0-9]+$'
                """
                cursor.execute(update_query, (repo_id,))
                connection.commit()
                LOGGER.info(f"  -> Updated {cursor.rowcount} rows.")
            
            elif source_type == 'gitlab':
                LOGGER.info("  -> GitLab repo. Generating sequence based on commit order.")
                # For GitLab, order by date and ID to assign a sequence.
                cursor.execute(
                    "SELECT id FROM repo_commits WHERE repo_catalog_id = %s ORDER BY committed_at ASC, id ASC",
                    (repo_id,)
                )
                commits_to_update = cursor.fetchall()
                
                if not commits_to_update:
                    LOGGER.info("  -> No commits found to update.")
                    continue

                LOGGER.info(f"  -> Found {len(commits_to_update)} commits. Updating sequence...")
                sequence = 1
                for (commit_id,) in commits_to_update:
                    cursor.execute(
                        "UPDATE repo_commits SET commit_sequence = %s WHERE id = %s",
                        (sequence, commit_id)
                    )
                    sequence += 1
                
                connection.commit()
                LOGGER.info(f"  -> Sequence update complete for repo {repo_id}.")
            
            else:
                LOGGER.warning(f"  -> Skipping unsupported source type: {source_type}")

        LOGGER.info("Backfill process completed successfully.")

    except mysql.connector.Error as err:
        LOGGER.error(f"Database error: {err}")
        if connection:
            connection.rollback()
    except Exception as e:
        LOGGER.error(f"An unexpected error occurred: {e}")
    finally:
        if connection and connection.is_connected():
            cursor.close()
            connection.close()
            LOGGER.info("Database connection closed.")

if __name__ == "__main__":
    run_backfill()
