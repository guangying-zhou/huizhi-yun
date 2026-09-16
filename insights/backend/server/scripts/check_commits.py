import os
import sys
import mysql.connector

# Add parent directory to path to import config
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from server.python_service.config import Config
except ImportError:
    sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    from server.python_service.config import Config

def get_db_connection():
    db_config = {
        "host": Config.DB_HOST,
        "port": Config.DB_PORT,
        "user": Config.DB_USER,
        "password": Config.DB_PASSWORD,
        "database": Config.DB_NAME,
    }
    return mysql.connector.connect(**db_config)

def check_commits():
    conn = get_db_connection()
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM repo_commits")
    total = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM repo_commits WHERE files_ingested=1")
    ingested = cur.fetchone()[0]

    print(f"Total commits: {total}")
    print(f"Ingested commits: {ingested}")

    cur.close()
    conn.close()

if __name__ == "__main__":
    check_commits()
