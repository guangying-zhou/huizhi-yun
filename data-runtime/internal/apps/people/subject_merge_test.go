package people

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestMergeOnlyAcceptsSyntheticSourceAndRealTarget(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	cases := []struct{ legacy, canonical, why string }{
		{"", "liukai", "空 legacy"},
		{"dt-abc", "", "空 canonical"},
		{"dt-abc", "dt-abc", "同一个 UID"},
		{"liukai", "zhangwei", "两个真实主体之间不允许自动归并"},
		{"dt-abc", "dt-def", "不允许并入另一个合成主体"},
	}
	for _, item := range cases {
		if _, err := adapter.MergeSubjectReferences(context.Background(), item.legacy, item.canonical, "", "admin"); err == nil {
			t.Fatalf("%s 必须被拒绝", item.why)
		}
		if _, err := adapter.PreviewSubjectMerge(context.Background(), item.legacy, item.canonical); err == nil {
			t.Fatalf("预览同样必须拒绝：%s", item.why)
		}
	}
	if _, err := adapter.MergeSubjectReferences(context.Background(), "dt-abc", "liukai", "", ""); err == nil {
		t.Fatal("未验证的操作人必须被拒绝")
	}
	// 以上都必须在开事务之前失败。
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMergeReferenceInventoryCoversEveryPeopleUIDColumn(t *testing.T) {
	schema, err := os.ReadFile("../../../../people/docs/people_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	text := string(schema)

	// 归并清单漏一列就会留下悬挂引用，且不会有任何报错。
	// 这里按 schema 反查：每个承载员工 UID 的列都必须在清单里。
	covered := map[string]bool{}
	for _, table := range peopleMergeEmployeeUIDTables {
		covered[table+".employee_uid"] = true
	}
	covered["people_employees.employee_uid"] = true
	for _, ref := range peopleMergeActorColumns {
		covered[ref.table+"."+ref.column] = true
	}

	for _, table := range []string{
		"people_assignments", "people_cost_snapshots", "people_contribution_snapshots",
		"people_directory_lifecycle_versions", "people_documents", "people_offboarding_cases",
	} {
		marker := "CREATE TABLE IF NOT EXISTS `" + table + "`"
		if !strings.Contains(text, marker) {
			t.Fatalf("schema 中找不到 %s，归并清单可能已过期", table)
		}
		if !covered[table+".employee_uid"] {
			t.Fatalf("%s.employee_uid 不在归并清单里", table)
		}
	}
	// 非 *_uid 命名的引用同样必须覆盖。
	for _, ref := range []string{
		"people_offboarding_tasks.responsible_uid",
		"people_offboarding_notification_checkpoint.notified_recipient_uid",
		"people_offboarding_notification_checkpoint.previous_recipient_uid",
	} {
		if !covered[ref] {
			t.Fatalf("%s 不在归并清单里", ref)
		}
	}
}

func TestMergeSourceRefusesCanonicalEmployeeCollision(t *testing.T) {
	source := readPeopleSource(t, "subject_merge.go")
	// canonical 已有员工行意味着同一个人有两份独立的任职与成本事实，
	// 合并口径不是这里能自动判定的。
	if !strings.Contains(source, "people_merge_canonical_employee_exists") {
		t.Fatal("canonical 已存在员工行时必须拒绝自动归并")
	}
	// 表名与列名无法参数化，必须只来自固定白名单。
	if !strings.Contains(source, "白名单里的表名与列名") {
		t.Fatal("拼接表名的约束必须在代码里写明")
	}
	if strings.Contains(source, "table+\"` WHERE") && !strings.Contains(source, "peopleMergeEmployeeUIDTables") {
		t.Fatal("表名必须来自固定清单")
	}
}

func TestMergeDoesNotRewriteHistoricalAuditColumns(t *testing.T) {
	// created_by / original_actor_uid 记录的是「当时是谁做的」。
	// 改写它们等于篡改审计事实，归并后仍应指向旧 UID。
	for _, ref := range peopleMergeActorColumns {
		switch ref.column {
		case "created_by", "updated_by", "original_actor_uid", "last_replay_actor_uid", "locked_by":
			t.Fatalf("%s.%s 是审计列，不得被归并改写", ref.table, ref.column)
		}
		if strings.HasPrefix(ref.table, "integration_operation") {
			t.Fatalf("%s 是操作账本，不得被归并改写", ref.table)
		}
	}
	for _, table := range peopleMergeEmployeeUIDTables {
		if strings.HasPrefix(table, "integration_operation") {
			t.Fatalf("%s 是操作账本，不得被归并改写", table)
		}
	}
}

func TestMergeHandlesTheForeignKeyOnEmployeeUid(t *testing.T) {
	source := readPeopleSource(t, "subject_merge.go")
	// people_employees.employee_uid 被多张子表外键引用，直接改父行会报 1451。
	// 这是实测确认过的失败，不是理论顾虑。
	if !strings.Contains(source, "SET SESSION foreign_key_checks = 0") {
		t.Fatal("归并必须在事务内关闭外键检查，否则改父行会撞 1451")
	}
	if !strings.Contains(source, "SET SESSION foreign_key_checks = ?") {
		t.Fatal("必须恢复外键检查：连接可能被后续请求复用")
	}
	if !strings.Contains(source, "context.WithTimeout(context.Background()") {
		t.Fatal("恢复外键检查不得复用可能已经取消的请求 context")
	}
	if !strings.Contains(source, "conn, err := a.DB().Conn(ctx)") ||
		!strings.Contains(source, "restorePeopleForeignKeyChecks(conn, previousFKChecks)") {
		t.Fatal("失败路径必须在独占连接上回滚并恢复外键检查后再归还连接池")
	}
	// 关闭期间数据库不把关，提交前必须自己确认没有孤儿引用。
	if !strings.Contains(source, "people_merge_orphan_references") {
		t.Fatal("提交前必须校验没有留下孤儿引用")
	}
	commit := strings.Index(source, "tx.Commit()")
	orphanCheck := strings.Index(source, "people_merge_orphan_references")
	if orphanCheck < 0 || commit < 0 || orphanCheck > commit {
		t.Fatal("孤儿校验必须发生在提交之前")
	}
	restore := strings.LastIndex(source[:commit], "restorePeopleForeignKeyChecks(tx, previousFKChecks)")
	if restore < orphanCheck {
		t.Fatal("成功路径必须在提交前显式恢复外键检查")
	}
}
