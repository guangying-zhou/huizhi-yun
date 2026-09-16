
import os
import mysql.connector
from dotenv import load_dotenv
import logging
import sys

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Load environment variables from .env.dev
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '..', '.env.dev')
load_dotenv(dotenv_path)

def get_latest_commit_info():
    """
    Connects to the database and retrieves the maximum commit ID and latest committed_at date
    from the repo_commits table where files_ingested=1 and repo is valid.
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

        query = """
            SELECT
                MAX(rc.id),
                MAX(rc.committed_at)
            FROM
                repo_commits rc
            JOIN
                repo_catalog r ON r.id=rc.repo_catalog_id
            WHERE
                rc.files_ingested=1 AND r.is_valid=1
        """
        cursor.execute(query)
        result = cursor.fetchone()

        max_id = result[0]
        max_committed_at = result[1]

        logging.info(f"Max Commit ID (files_ingested=1, is_valid=1): {max_id}")
        logging.info(f"Max Committed At (files_ingested=1, is_valid=1): {max_committed_at}")
        
        return max_id, max_committed_at

    except mysql.connector.Error as err:
        logging.error(f"Database Error: {err}")
        return None, None
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")
        return None, None
    finally:
        if conn and conn.is_connected():
            cursor.close()
            conn.close()

if __name__ == "__main__":
    get_latest_commit_info()
