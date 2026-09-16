
import os
import mysql.connector
from dotenv import load_dotenv
import logging
import datetime as dt
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Load environment variables from .env.dev
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '..', '.env.dev')
load_dotenv(dotenv_path)

def debug_daily_aggregation_query(last_commit_id: int, window_days: int):
    """
    Connects to the database and counts commits that would be processed by aggregate_repo_daily.
    """
    conn = None
    try:
        conn = mysql.connector.connect(
            host=os.getenv("DB_HOST"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
            database=os.getenv("DB_NAME"),
            port=os.getenv("DB_PORT")
        )
        cursor = conn.cursor()

        window_start = (dt.datetime.utcnow() - dt.timedelta(days=window_days)).date()

        cond_id = f"c.id > {last_commit_id}" if last_commit_id is not None else "TRUE"
        
        daily_sql_count = f"""
            SELECT COUNT(*)
            FROM repo_commits c
            JOIN repo_catalog r ON r.id=c.repo_catalog_id
            WHERE c.files_ingested=1
              AND r.is_valid=1
              AND ({cond_id} OR c.committed_at >= '{window_start}')
        """
        logging.info(f"Executing query: {daily_sql_count}")
        cursor.execute(daily_sql_count)
        count = cursor.fetchone()[0]
        logging.info(f"Query returned {count} commits.")
        return count

    except mysql.connector.Error as err:
        logging.error(f"Database Error: {err}")
        return -1
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")
        return -1
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()

if __name__ == "__main__":
    # Using values from the last log: last_commit_id = 135626, window_start (derived from window_days=2) = 2025-11-19
    # (dt.datetime.utcnow() - dt.timedelta(days=2)).date()
    # Assuming current date is 2025-11-21 as per log timestamps.
    # window_start is 2025-11-21 - 2 days = 2025-11-19.

    # Default values from aggregate_stats.py
    default_last_commit_id = 135626 # From log
    default_window_days = 2 # From log

    # Override if provided as command line arguments
    if len(sys.argv) > 1:
        default_last_commit_id = int(sys.argv[1])
    if len(sys.argv) > 2:
        default_window_days = int(sys.argv[2])

    logging.info(f"Debugging with last_commit_id={default_last_commit_id}, window_days={default_window_days}")
    debug_daily_aggregation_query(default_last_commit_id, default_window_days)
