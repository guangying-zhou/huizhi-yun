#!/usr/bin/env python3
"""
Analyze WARNING logs from ingestion_run_logs.
"""
import json
import logging
import os
import sys
from collections import Counter

try:
    import mysql.connector
except ImportError:
    print("mysql-connector-python required")
    sys.exit(1)

def load_env_file(filepath: str):
    if not os.path.exists(filepath):
        return
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, value = line.split('=', 1)
                if key not in os.environ:
                    os.environ[key] = value

# Try loading .env.dev from project root
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_env_file(os.path.join(project_root, '.env.dev'))

def get_db_connection():
    return mysql.connector.connect(
        host=os.environ.get("DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("DB_PORT", "3306")),
        user=os.environ.get("DB_USER", "root"),
        password=os.environ.get("DB_PASSWORD", ""),
        database=os.environ.get("DB_NAME", "codeinsightdb")
    )

def main():
    conn = get_db_connection()
    cursor = conn.cursor()

    print("Fetching repo_catalog columns...")
    cursor.execute("SHOW COLUMNS FROM repo_catalog")
    columns = cursor.fetchall()
    for col in columns:
        print(col)

    print("-" * 100)

    print("Fetching WARNING logs...")
    cursor.execute("""
        SELECT message, context, count(*) as cnt
        FROM ingestion_run_logs
        WHERE log_level = 'WARNING'
        GROUP BY message, context
        ORDER BY cnt DESC
        LIMIT 50
    """)

    rows = cursor.fetchall()

    print(f"{'Count':<8} | {'Message':<50} | {'Context'}")
    print("-" * 100)

    for message, context, count in rows:
        ctx_str = str(context) if context else "{}"
        # Truncate context if too long
        if len(ctx_str) > 100:
            ctx_str = ctx_str[:97] + "..."
        print(f"{count:<8} | {message:<50} | {ctx_str}")

    conn.close()

if __name__ == "__main__":
    main()
