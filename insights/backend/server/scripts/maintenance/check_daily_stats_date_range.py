
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

def check_daily_stats_date_range():
    """
    Connects to the database and retrieves the minimum and maximum stat_date
    from the stat_repo_daily table.
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
                MIN(stat_date),
                MAX(stat_date)
            FROM
                stat_repo_daily
        """
        cursor.execute(query)
        result = cursor.fetchone()

        min_date = result[0]
        max_date = result[1]

        logging.info(f"Min stat_date in stat_repo_daily: {min_date}")
        logging.info(f"Max stat_date in stat_repo_daily: {max_date}")

        return min_date, max_date

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
    check_daily_stats_date_range()
