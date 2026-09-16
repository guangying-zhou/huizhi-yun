import os
import mysql.connector

def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", "Wiztek@1902"),
        database=os.environ.get("DB_NAME", "codeinsightdb")
    )

def check_schema():
    conn = get_db_connection()
    cursor = conn.cursor()

    print("--- ingestion_run_logs columns ---")
    cursor.execute("DESCRIBE ingestion_run_logs")
    for row in cursor.fetchall():
        print(row)

    print("\n--- repo_commit_files collation ---")
    cursor.execute("SHOW TABLE STATUS LIKE 'repo_commit_files'")
    row = cursor.fetchone()
    # Collation is usually the 15th column (index 14) in SHOW TABLE STATUS output
    # But let's print the whole row or look for the collation field
    # Actually, let's use information_schema for clarity

    cursor.execute("""
        SELECT TABLE_NAME, TABLE_COLLATION
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repo_commit_files'
    """)
    print(cursor.fetchone())

    print("\n--- repo_commit_files.content_hash collation ---")
    cursor.execute("""
        SELECT COLUMN_NAME, COLLATION_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'repo_commit_files' AND COLUMN_NAME = 'content_hash'
    """)
    print(cursor.fetchone())

    conn.close()

if __name__ == "__main__":
    check_schema()
