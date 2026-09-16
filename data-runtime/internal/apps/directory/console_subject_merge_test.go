package directory

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestConsoleMergeRejectsWrongDirectionAndSelfMerge(t *testing.T) {
	adapter := &Adapter{}
	cases := []struct{ legacy, canonical, why string }{
		{"", "liukai", "空 legacy"},
		{"dt-abc", "", "空 canonical"},
		{"dt-abc", "dt-abc", "同一个 UID"},
		{"liukai", "zhangwei", "两个真实主体之间不允许自动归并"},
		{"dt-abc", "dt-def", "不允许并入另一个合成主体"},
	}
	for _, item := range cases {
		if _, err := adapter.ConsoleMergeDirectorySubject(context.Background(), item.legacy, item.canonical, "admin", ""); err == nil {
			t.Fatalf("%s 必须被拒绝", item.why)
		}
		if _, err := adapter.ConsoleMergePreview(context.Background(), item.legacy, item.canonical); err == nil {
			t.Fatalf("预览同样必须拒绝：%s", item.why)
		}
	}
	if _, err := adapter.ConsoleMergeDirectorySubject(context.Background(), "dt-abc", "liukai", "", ""); err == nil {
		t.Fatal("未验证的操作人必须被拒绝")
	}
}

func TestConsoleMergeOrderCutsOffNewReferencesFirst(t *testing.T) {
	source, err := os.ReadFile("console_subject_merge.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(source)
	start := strings.Index(body, "func (a *Adapter) ConsoleMergeDirectorySubject")
	if start < 0 {
		t.Fatal("ConsoleMergeDirectorySubject must exist")
	}
	merge := body[start:]

	// 顺序不可颠倒：先停用旧主体切断归并期间的新引用，再撤销会话，
	// 最后才迁移归属与重绑身份。
	inFlight := strings.Index(merge, "directory_merge_operations_in_flight")
	disable := strings.Index(merge, "1. 停用旧主体")
	sessions := strings.Index(merge, "UPDATE local_sessions")
	memberships := strings.Index(merge, "UPDATE IGNORE directory_user_departments")
	identities := strings.Index(merge, "UPDATE IGNORE directory_identities")
	for name, index := range map[string]int{
		"in-flight check": inFlight, "disable": disable,
		"revoke sessions": sessions, "memberships": memberships, "identities": identities,
	} {
		if index < 0 {
			t.Fatalf("merge is missing a required step: %s", name)
		}
	}
	// 在途操作未结算时不得归并：回执会写回一个已被停用的主体。
	if inFlight > disable {
		t.Fatal("the in-flight check must happen before the subject is disabled")
	}
	if !(disable < sessions && sessions < memberships && memberships < identities) {
		t.Fatal("merge steps must run in order: disable, revoke sessions, memberships, identities")
	}
}

func TestConsoleMergeRebuildsExportsInsideTheTransaction(t *testing.T) {
	source, err := os.ReadFile("console_subject_merge.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(source)
	start := strings.Index(body, "func (a *Adapter) ConsoleMergeDirectorySubject")
	if start < 0 {
		t.Fatal("ConsoleMergeDirectorySubject must exist")
	}
	merge := body[start:]
	if !strings.Contains(merge, "rebuildUserSubjectExportsWith(ctx, tx)") {
		t.Fatal("subject exports must be rebuilt on the merge transaction")
	}
	if strings.Contains(merge, "a.rebuildUserSubjectExports(ctx)") {
		t.Fatal("merge must not rebuild exports through an independent database connection")
	}
}

func TestConsoleRuntimeSubjectMergeMutationIsFailClosed(t *testing.T) {
	source, err := os.ReadFile("../../server/server.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(source)
	start := strings.Index(body, `case r.Method == http.MethodPost && path == "/v1/console/directory/subject-merge":`)
	if start < 0 {
		t.Fatal("Console runtime subject merge route must remain explicit")
	}
	end := strings.Index(body[start+1:], "\n\t\t\tcase ")
	if end < 0 {
		t.Fatal("Console runtime subject merge route body must be locatable")
	}
	route := body[start : start+1+end]
	if !strings.Contains(route, "console_subject_merge_manual_only") || !strings.Contains(route, "http.StatusGone") {
		t.Fatal("Console runtime subject merge mutation must return 410")
	}
	if strings.Contains(route, "ConsoleMergeDirectorySubject") {
		t.Fatal("the online runtime route must not execute a partial cross-database merge")
	}
}

func TestConsoleMergeUsesStatusValuesTheSchemaAccepts(t *testing.T) {
	source, err := os.ReadFile("console_subject_merge.go")
	if err != nil {
		t.Fatal(err)
	}
	merge := string(source)
	schema, err := os.ReadFile("../../../../console/docs/hzy_console_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	text := string(schema)

	// 这些表都有 CHECK 约束限制 status 取值，写错会在生产上报 3819
	// 而不是在任何测试里失败——实测踩过一次（directory_user_departments
	// 写了离职语义的 'left'，而该表只接受 active/inactive/deleted）。
	for _, table := range []string{
		"directory_users", "directory_identities",
		"directory_user_departments", "directory_subject_exports",
	} {
		if !strings.Contains(text, "ck_"+table+"_status") {
			continue
		}
		start := strings.Index(text, "ck_"+table+"_status")
		clause := text[start:min(start+160, len(text))]
		for _, written := range statusLiteralsFor(merge, table) {
			if !strings.Contains(clause, "'"+written+"'") {
				t.Fatalf("%s 被写入 status='%s'，但 schema 的 CHECK 不接受该值", table, written)
			}
		}
	}
}

// statusLiteralsFor 找出代码里对某张表写入的 status 字面量。
func statusLiteralsFor(source, table string) []string {
	values := map[string]bool{}
	for _, chunk := range strings.Split(source, "UPDATE ") {
		if !strings.HasPrefix(chunk, table) && !strings.HasPrefix(chunk, "IGNORE "+table) {
			continue
		}
		for _, part := range strings.Split(chunk, "status='")[1:] {
			if end := strings.Index(part, "'"); end > 0 {
				values[part[:end]] = true
			}
		}
	}
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	return result
}
