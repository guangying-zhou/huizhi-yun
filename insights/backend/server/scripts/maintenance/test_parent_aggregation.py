#!/usr/bin/env python3
"""
Test script to verify parent account aggregation works correctly.

This script:
1. Queries org_persons to find accounts with parent_id relationships
2. Runs a small aggregation test
3. Verifies that sub-account data is consolidated into parent accounts
"""
import mysql.connector

config = {
    'host': '127.0.0.1',
    'port': 3306,
    'user': 'root',
    'password': 'Wiztek@1902',
    'database': 'codeinsightdb'
}

def test_parent_account_aggregation():
    conn = mysql.connector.connect(**config)
    cursor = conn.cursor()

    print("=" * 80)
    print("Parent Account Aggregation Test")
    print("=" * 80)

    # 1. Find accounts with parent_id relationships
    print("\n1. Checking accounts with parent relationships:")
    cursor.execute("""
        SELECT
            sub.id AS sub_id,
            sub.username AS sub_username,
            parent.id AS parent_id,
            parent.username AS parent_username
        FROM org_persons sub
        JOIN org_persons parent ON parent.id = sub.parent_id
        LIMIT 10
    """)

    parent_relationships = cursor.fetchall()
    if not parent_relationships:
        print("   No parent-child relationships found in org_persons")
        cursor.close()
        conn.close()
        return

    print(f"   Found {len(parent_relationships)} parent-child relationships:")
    for sub_id, sub_user, parent_id, parent_user in parent_relationships[:5]:
        print(f"   - {sub_user} (ID:{sub_id}) → {parent_user} (ID:{parent_id})")

    # 2. Check original commit distribution
    print("\n2. Checking commit distribution before aggregation:")
    test_parent_id = parent_relationships[0][2]
    test_parent_username = parent_relationships[0][3]

    cursor.execute("""
        SELECT
            op.username,
            op.id,
            op.parent_id,
            COUNT(c.id) as commit_count
        FROM repo_commits c
        JOIN org_persons op ON op.username = TRIM(c.author_name)
        WHERE op.id = %s OR op.parent_id = %s
        GROUP BY op.username, op.id, op.parent_id
    """, (test_parent_id, test_parent_id))

    commit_dist = cursor.fetchall()
    total_commits = sum(row[3] for row in commit_dist)

    print(f"   Testing with parent account: {test_parent_username} (ID:{test_parent_id})")
    print(f"   Total commits across parent + sub-accounts: {total_commits}")
    for username, pid, parent_id, count in commit_dist:
        role = "PARENT" if parent_id is None else "SUB"
        print(f"     - {username} ({role}): {count} commits")

    # 3. Check aggregated stats
    print("\n3. Checking aggregated statistics in stat_person_daily:")
    cursor.execute("""
        SELECT
            spd.person_id,
            spd.username,
            SUM(spd.commits) as total_commits,
            COUNT(DISTINCT spd.stat_date) as days_active
        FROM stat_person_daily spd
        WHERE spd.person_id = %s
        GROUP BY spd.person_id, spd.username
    """, (test_parent_id,))

    agg_result = cursor.fetchone()
    if agg_result:
        agg_person_id, agg_username, agg_commits, days_active = agg_result
        print(f"   ✓ Found aggregated record:")
        print(f"     Person ID: {agg_person_id}")
        print(f"     Username: {agg_username}")
        print(f"     Total commits: {agg_commits}")
        print(f"     Days active: {days_active}")

        if agg_commits == total_commits:
            print(f"   ✅ SUCCESS: Aggregated commits ({agg_commits}) matches sum of all accounts ({total_commits})")
        else:
            print(f"   ⚠️  WARNING: Aggregated commits ({agg_commits}) != sum of all accounts ({total_commits})")
            print(f"     This may be expected if aggregation hasn't been run recently.")
    else:
        print(f"   ⚠️  No aggregated data found for parent account {test_parent_username}")

    # 4. Check for orphaned sub-account records
    print("\n4. Checking for orphaned sub-account records in statistics:")
    cursor.execute("""
        SELECT
            spd.person_id,
            spd.username,
            op.parent_id
        FROM stat_person_daily spd
        JOIN org_persons op ON op.id = spd.person_id
        WHERE op.parent_id IS NOT NULL
        LIMIT 5
    """)

    orphans = cursor.fetchall()
    if orphans:
        print(f"   ⚠️  Found {len(orphans)} records for sub-accounts (should be 0 after re-aggregation):")
        for person_id, username, parent_id in orphans:
            print(f"     - {username} (ID:{person_id}, parent_id:{parent_id})")
    else:
        print(f"   ✅ No orphaned sub-account records found")

    print("\n" + "=" * 80)
    print("Test complete!")
    print("To rebuild aggregation and fix any issues, run:")
    print("  python3 server/scripts/aggregate_stats.py --jobs person_daily --window-days 0")
    print("=" * 80)

    cursor.close()
    conn.close()

if __name__ == '__main__':
    test_parent_account_aggregation()
