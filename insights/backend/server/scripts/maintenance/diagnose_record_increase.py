#!/usr/bin/env python3
"""
诊断 stat_person_repo_daily 记录数增加的原因
"""
import mysql.connector

config = {
    'host': '127.0.0.1',
    'port': 3306,
    'user': 'root',
    'password': 'Wiztek@1902',
    'database': 'codeinsightdb'
}

conn = mysql.connector.connect(**config)
cursor = conn.cursor()

print("=" * 80)
print("诊断 stat_person_repo_daily 记录数增加原因")
print("=" * 80)

# 1. 检查重复记录
print("\n1. 检查是否有重复的主键组合:")
cursor.execute("""
    SELECT person_id, repo_catalog_id, stat_date, COUNT(*) as cnt
    FROM stat_person_repo_daily
    GROUP BY person_id, repo_catalog_id, stat_date
    HAVING cnt > 1
    LIMIT 10
""")
duplicates = cursor.fetchall()
if duplicates:
    print(f"   ⚠️  发现 {len(duplicates)} 组重复记录!")
    for person_id, repo_id, date, cnt in duplicates[:5]:
        print(f"     - person_id={person_id}, repo={repo_id}, date={date}: {cnt}条记录")
else:
    print("   ✓ 无重复记录")

# 2. 按person_id分组统计
print("\n2. 检查辅助账号的记录:")
cursor.execute("""
    SELECT
        sprd.person_id,
        op.username,
        op.parent_id,
        COUNT(*) as record_count,
        SUM(sprd.commits) as total_commits
    FROM stat_person_repo_daily sprd
    JOIN org_persons op ON op.id = sprd.person_id
    WHERE op.parent_id IS NOT NULL
    GROUP BY sprd.person_id, op.username, op.parent_id
    ORDER BY record_count DESC
""")
sub_accounts = cursor.fetchall()
if sub_accounts:
    print(f"   ⚠️  发现 {len(sub_accounts)} 个辅助账号仍有记录:")
    total_sub_records = sum(row[3] for row in sub_accounts)
    print(f"   总计辅助账号记录数: {total_sub_records}")
    for person_id, username, parent_id, rec_cnt, commits in sub_accounts[:10]:
        print(f"     - {username} (ID:{person_id}, parent:{parent_id}): {rec_cnt}条记录, {commits}次提交")
else:
    print("   ✓ 无辅助账号记录")

# 3. 统计各表的总记录数
print("\n3. 各统计表的记录数:")
tables = [
    'stat_person_repo_daily',
    'stat_person_daily',
    'stat_person_monthly',
    'stat_person_repo_monthly'
]
for table in tables:
    cursor.execute(f"SELECT COUNT(*) FROM {table}")
    count = cursor.fetchone()[0]
    print(f"   {table}: {count:,}")

# 4. 检查主账号+辅助账号的记录分布
print("\n4. 检查主账号归并情况:")
cursor.execute("""
    SELECT
        CASE WHEN op.parent_id IS NULL THEN '主账号' ELSE '辅助账号' END as account_type,
        COUNT(DISTINCT sprd.person_id) as person_count,
        COUNT(*) as record_count,
        SUM(sprd.commits) as total_commits
    FROM stat_person_repo_daily sprd
    JOIN org_persons op ON op.id = sprd.person_id
    GROUP BY account_type
""")
for account_type, person_cnt, rec_cnt, commits in cursor.fetchall():
    print(f"   {account_type}: {person_cnt}个人, {rec_cnt}条记录, {commits}次提交")

# 5. 查看最近的记录
print("\n5. 最近5条记录的person_id:")
cursor.execute("""
    SELECT person_id, repo_catalog_id, stat_date, commits
    FROM stat_person_repo_daily
    ORDER BY stat_date DESC, person_id DESC
    LIMIT 5
""")
for person_id, repo_id, date, commits in cursor.fetchall():
    cursor.execute("SELECT username, parent_id FROM org_persons WHERE id=%s", (person_id,))
    person_info = cursor.fetchone()
    if person_info:
        username, parent_id = person_info
        role = "SUB" if parent_id else "MAIN"
        print(f"   date={date}, person={username}({role}), repo={repo_id}, commits={commits}")

print("\n" + "=" * 80)
print("诊断完成")
print("=" * 80)

cursor.close()
conn.close()
