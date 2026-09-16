#!/usr/bin/env python3
"""
清理统计表中的辅助账号旧记录

由于主账号归并功能修改后，INSERT ... ON DUPLICATE KEY UPDATE
只会创建新的主账号记录，不会删除旧的辅助账号记录。
此脚本删除所有 parent_id IS NOT NULL 的账号的统计记录。
"""
import mysql.connector
import argparse

config = {
    'host': '127.0.0.1',
    'port': 3306,
    'user': 'root',
    'password': 'Wiztek@1902',
    'database': 'codeinsightdb'
}

def cleanup_sub_account_stats(dry_run=False):
    conn = mysql.connector.connect(**config)
    cursor = conn.cursor()

    print("=" * 80)
    print("清理辅助账号统计记录")
    print("=" * 80)

    # 1. 获取所有辅助账号ID
    cursor.execute("SELECT id, username, parent_id FROM org_persons WHERE parent_id IS NOT NULL")
    sub_accounts = cursor.fetchall()

    if not sub_accounts:
        print("\n✓ 没有找到辅助账号，无需清理")
        cursor.close()
        conn.close()
        return

    sub_account_ids = [row[0] for row in sub_accounts]
    print(f"\n找到 {len(sub_account_ids)} 个辅助账号:")
    for acc_id, username, parent_id in sub_accounts:
        print(f"  - {username} (ID:{acc_id}, parent_id:{parent_id})")

    # 2. 统计各表中的辅助账号记录数
    tables = [
        'stat_person_repo_daily',
        'stat_person_daily',
        'stat_person_monthly',
        'stat_person_repo_monthly'
    ]

    print(f"\n检查各统计表中的辅助账号记录:")
    total_to_delete = 0
    table_counts = {}

    for table in tables:
        cursor.execute(
            f"SELECT COUNT(*) FROM {table} WHERE person_id IN ({','.join(['%s']*len(sub_account_ids))})",
            sub_account_ids
        )
        count = cursor.fetchone()[0]
        table_counts[table] = count
        total_to_delete += count
        print(f"  {table}: {count:,} 条记录")

    print(f"\n总计需要删除: {total_to_delete:,} 条记录")

    if dry_run:
        print("\n⚠️  DRY RUN 模式 - 未执行删除操作")
        cursor.close()
        conn.close()
        return

    # 3. 执行删除
    print(f"\n开始删除...")
    deleted_counts = {}

    for table in tables:
        if table_counts[table] == 0:
            continue

        print(f"\n处理 {table}...")
        cursor.execute(
            f"DELETE FROM {table} WHERE person_id IN ({','.join(['%s']*len(sub_account_ids))})",
            sub_account_ids
        )
        deleted = cursor.rowcount
        deleted_counts[table] = deleted
        print(f"  ✓ 删除了 {deleted:,} 条记录")

    # 4. 提交更改
    conn.commit()

    # 5. 验证结果
    print(f"\n验证删除结果:")
    for table in tables:
        cursor.execute(
            f"SELECT COUNT(*) FROM {table} WHERE person_id IN ({','.join(['%s']*len(sub_account_ids))})",
            sub_account_ids
        )
        remaining = cursor.fetchone()[0]
        if remaining > 0:
            print(f"  ⚠️  {table}: 仍有 {remaining} 条记录")
        else:
            print(f"  ✓ {table}: 已清理完成")

    # 6. 显示清理后的统计
    print(f"\n清理汇总:")
    print(f"  总删除记录数: {sum(deleted_counts.values()):,}")
    for table, count in deleted_counts.items():
        print(f"    - {table}: {count:,}")

    print("\n" + "=" * 80)
    print("清理完成!")
    print("建议运行以下命令重新聚合数据以确保一致性:")
    print("  python3 server/scripts/aggregate_stats.py --jobs person_daily,person_monthly,department_monthly,person_repo_monthly --window-days 0")
    print("=" * 80)

    cursor.close()
    conn.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="清理辅助账号的统计记录")
    parser.add_argument('--dry-run', action='store_true', help='只显示将要删除的记录，不实际执行')
    args = parser.parse_args()

    if not args.dry_run:
        confirm = input("\n⚠️  此操作将删除所有辅助账号的统计记录！是否继续? (yes/no): ")
        if confirm.lower() != 'yes':
            print("已取消")
            exit(0)

    cleanup_sub_account_stats(dry_run=args.dry_run)
