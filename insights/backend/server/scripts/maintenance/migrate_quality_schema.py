import os
import sys
import mysql.connector
from mysql.connector import errorcode

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

def add_column_if_not_exists(cursor, table, column_def):
    try:
        print(f"Adding column to {table}: {column_def}")
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column_def}")
        print(f"Success: Added to {table}")
    except mysql.connector.Error as err:
        if err.errno == errorcode.ER_DUP_FIELDNAME:
            print(f"Skipping: Column already exists in {table}")
        else:
            print(f"Error: {err}")

def main():
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. repo_commits: Add score columns
    # Using DECIMAL(5,2) allows scores like 100.00
    add_column_if_not_exists(cursor, "repo_commits", "score_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '本次提交的文件质量得分'")
    add_column_if_not_exists(cursor, "repo_commits", "score_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '本次提交的代码粒度得分'")

    # 2. Stat tables: Add avg columns (repo, person, department)
    stat_tables = [
        "stat_repo_daily", "stat_repo_monthly",
        "stat_person_daily", "stat_person_monthly",
        "stat_person_repo_daily", "stat_person_repo_monthly",
        "stat_department_monthly"
    ]

    for table in stat_tables:
        add_column_if_not_exists(cursor, table, "avg_submission_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均文件提交质量'")
        add_column_if_not_exists(cursor, table, "avg_code_quality DECIMAL(5,2) DEFAULT NULL COMMENT '平均代码提交质量'")

    conn.close()
    print("Schema migration completed.")

if __name__ == "__main__":
    main()
