import os
import mysql.connector

def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", "svn.wiztek.cn"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", "Wiztek@1902"),
        database=os.environ.get("DB_NAME", "codeinsightdb")
    )

def add_column():
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        print("Checking if event_time column exists...")
        cursor.execute("SHOW COLUMNS FROM monitoring_events LIKE 'event_time'")
        result = cursor.fetchone()
        if result:
            print("Column event_time already exists.")
        else:
            print("Adding event_time column...")
            cursor.execute("ALTER TABLE monitoring_events ADD COLUMN event_time DATETIME DEFAULT NULL AFTER created_at")
            conn.commit()
            print("Column added successfully.")
    except mysql.connector.Error as err:
        print(f"Error: {err}")
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    add_column()
