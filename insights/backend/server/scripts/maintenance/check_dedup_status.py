#!/usr/bin/env python3
"""Check deduplication status in the database."""
import mysql.connector

config = {
    'host': '127.0.0.1',
    'port': 3306,
    'user': 'root',
    'password': 'Wiztek@1902',
    'database': 'codeinsightdb'
}

try:
    conn = mysql.connector.connect(**config)
    cursor = conn.cursor()

    print("=" * 80)
    print("1. Code files (can_line_count=1) duplicate breakdown:")
    print("=" * 80)

    cursor.execute("""
        SELECT
            file_type,
            can_line_count,
            duplicate_reason,
            COUNT(*) as count,
            COUNT(DISTINCT content_hash) as unique_hashes,
            SUM(CASE WHEN content_hash IS NULL THEN 1 ELSE 0 END) as null_hashes
        FROM repo_commit_files
        WHERE is_duplicate=1 AND can_line_count=1
        GROUP BY file_type, can_line_count, duplicate_reason
        ORDER BY count DESC
        LIMIT 20
    """)

    rows = cursor.fetchall()
    if rows:
        print(f"{'File Type':<15} {'Can Count':<10} {'Dup Reason':<20} {'Count':<10} {'Uniq Hash':<12} {'Null Hash':<10}")
        print("-" * 80)
        for row in rows:
            print(f"{str(row[0]):<15} {row[1]:<10} {str(row[2]):<20} {row[3]:<10} {row[4]:<12} {row[5]:<10}")
    else:
        print("No duplicate code files found.")

    print("\n" + "=" * 80)
    print("2. Code files missing content_hash:")
    print("=" * 80)

    cursor.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN content_hash IS NULL THEN 1 ELSE 0 END) as missing_hash,
            ROUND(SUM(CASE WHEN content_hash IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as missing_pct
        FROM repo_commit_files
        WHERE can_line_count=1
    """)

    row = cursor.fetchone()
    if row:
        print(f"Total code files: {row[0]:,}")
        print(f"Missing hash: {row[1]:,}")
        print(f"Missing percentage: {row[2]}%")

    print("\n" + "=" * 80)
    print("3. Duplicate code files missing hash by reason:")
    print("=" * 80)

    cursor.execute("""
        SELECT
            duplicate_reason,
            COUNT(*) as count
        FROM repo_commit_files
        WHERE is_duplicate=1 AND can_line_count=1 AND content_hash IS NULL
        GROUP BY duplicate_reason
        ORDER BY count DESC
    """)

    rows = cursor.fetchall()
    if rows:
        print(f"{'Duplicate Reason':<30} {'Count':<10}")
        print("-" * 40)
        for row in rows:
            print(f"{str(row[0]):<30} {row[1]:<10}")
    else:
        print("No duplicate code files missing hash.")

    print("\n" + "=" * 80)
    print("4. Sample files with duplicates (code files):")
    print("=" * 80)

    cursor.execute("""
        SELECT
            id, file_name, file_type, bytes_after, content_hash, duplicate_reason
        FROM repo_commit_files
        WHERE is_duplicate=1 AND can_line_count=1 AND duplicate_reason IS NOT NULL
        LIMIT 10
    """)

    rows = cursor.fetchall()
    if rows:
        for row in rows:
            print(f"ID: {row[0]}, File: {row[1]}, Type: {row[2]}, Size: {row[3]}, Hash: {row[4]}, Reason: {row[5]}")
    else:
        print("No samples found.")

    cursor.close()
    conn.close()

    print("\n" + "=" * 80)
    print("Analysis complete!")
    print("=" * 80)

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
