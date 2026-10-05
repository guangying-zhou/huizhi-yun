package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"strings"
	"testing"
)

type projectSnapshotTestDB struct {
	tx         *sql.Tx
	beforePage func()
}

func (db *projectSnapshotTestDB) QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row {
	return db.tx.QueryRowContext(ctx, q, args...)
}
func (db *projectSnapshotTestDB) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	if db.beforePage != nil {
		hook := db.beforePage
		db.beforePage = nil
		hook()
	}
	return db.tx.QueryContext(ctx, q, args...)
}

func testProjectOverviewPaginationMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	t.Helper()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	for i := 1; i <= 106; i++ {
		exec("INSERT INTO project_portfolios(id,code,name,created_by)VALUES(?,?,?,'p6')", 8000+i, fmt.Sprintf("P6G-%d", i), fmt.Sprintf("P6Group-%d", i))
	}
	defer db.Exec("DELETE FROM project_portfolios WHERE id>=8001 AND id<=8106")
	defer db.Exec("DELETE FROM user_favorite_projects WHERE uid='p6-actor'")
	defer db.Exec("DELETE FROM aims_projects WHERE id>=9001 AND id<=9106")
	defer db.Exec("DELETE FROM aims_project_members WHERE project_id>=9001 AND project_id<=9106")
	for i := 1; i <= 106; i++ {
		group := 8001
		if i == 2 {
			group = 8002
		}
		exec("INSERT INTO aims_projects(id,project_code,name,short_name,portfolio_id,leader_uid,created_by,security_level,confidentiality_level,lifecycle_status,start_date,service_line_code,service_period_seq)VALUES(?,?,?,?,?,'other','other','project_team','L3','active','2026-01-01','P6Line',?)", 9000+i, fmt.Sprintf("P6-%d", i), fmt.Sprintf("P6Name-%d", i), "P6", group, i)
		exec("INSERT INTO aims_project_members(project_id,uid,role,status)VALUES(?,'p6-actor','member','active')", 9000+i)
	}
	scope := WithEnterpriseProjectReadScope(context.Background(), projectscope.Projection{Version: 1, ProjectCodes: []string{"P6-1", "P6-2"}, Masks: []int{0, 65535, 65535}}, nil)
	q := url.Values{"projection": {"portfolios"}, "current_user": {"p6-actor"}, "search": {"P6Name"}, "page": {"1"}, "pageSize": {"100"}}
	read := func(ctx context.Context) map[string]any {
		t.Helper()
		out, err := a.memberProjects(ctx, q)
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	out := read(scope)
	if out["total"] != int64(106) || len(out["items"].([]map[string]any)) != 100 {
		t.Fatal(out)
	}
	if out["summary"].(map[string]any)["projectCount"] != int64(2) {
		t.Fatal("out of scope projects counted", out)
	}
	for _, item := range out["items"].([]map[string]any) {
		root := item["portfolio"].(portfolioListItem)
		if item["canDelete"] != false {
			t.Fatal("nonmanager delete disclosure")
		}
		if root.ID == 8001 && root.ProjectCount != 1 {
			t.Fatal("hidden project count disclosed", root)
		}
	}
	managed := WithEnterprisePortfolioManagement(scope, true)
	out = read(managed)
	for _, item := range out["items"].([]map[string]any) {
		root := item["portfolio"].(portfolioListItem)
		if root.ID == 8001 && item["canDelete"] != false {
			t.Fatal("hidden project permits delete")
		}
		if root.ID == 8003 && item["canDelete"] != true {
			t.Fatal("empty group not deletable")
		}
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "completeCount") || strings.Contains(string(raw), "P6Name-3") {
		t.Fatal("hidden data leaked")
	}
	q.Set("page", "2")
	out = read(managed)
	if len(out["items"].([]map[string]any)) != 6 || out["total"] != int64(106) {
		t.Fatal(out)
	}
	q.Set("page", "9")
	out = read(managed)
	if len(out["items"].([]map[string]any)) != 0 || out["summary"].(map[string]any)["projectCount"] != int64(2) {
		t.Fatal(out)
	}
	q.Set("projection", "projects")
	q.Set("page", "1")
	q.Set("pageSize", "1")
	out = read(scope)
	if out["total"] != int64(2) || len(out["items"].([]map[string]any)) != 1 {
		t.Fatal(out)
	}
	q.Set("page", "2")
	out = read(scope)
	if out["total"] != int64(2) || len(out["items"].([]map[string]any)) != 1 {
		t.Fatal(out)
	}
	q.Set("page", "1000000")
	out = read(scope)
	if out["page"] != 1000000 || len(out["items"].([]map[string]any)) != 0 {
		t.Fatal(out)
	}
	exec("UPDATE aims_projects SET portfolio_id=8001,category='maintenance',service_period_seq=2,service_period_start='2025-01-01' WHERE id=9002")
	exec("UPDATE aims_projects SET category='maintenance',service_period_start='2024-01-01' WHERE id=9001")
	q.Set("page", "1")
	q.Set("portfolio_id", "8001")
	out = read(scope)
	summary := out["summary"].(map[string]any)
	if summary["latestByLine"].(map[string]int64)["8001:P6Line"] != 2 || summary["historicalCounts"].(map[string]int64)["8001:history-2024"] != 1 {
		t.Fatal("historical classification truncated or hidden latest leaked", summary)
	}
	q.Del("portfolio_id")
	exec("INSERT INTO user_favorite_projects(uid,project_id)VALUES('p6-actor',9002)")
	q.Set("projection", "switcher")
	q.Set("participating_only", "1")
	q.Set("favoritesOnly", "1")
	out = read(scope)
	if out["total"] != int64(1) || out["items"].([]map[string]any)[0]["id"] != int64(9002) {
		t.Fatal("favorite filtered after COUNT", out)
	}
	q.Del("favoritesOnly")
	q.Del("participating_only")
	legacy, err := a.memberProjects(scope, url.Values{"current_user": {"p6-actor"}, "search": {"P6Name"}})
	if err != nil || len(legacy) != 4 || legacy["summary"] != nil || legacy["total"] != int64(2) {
		t.Fatal("legacy no-parameter shape changed", legacy, err)
	}
	q.Set("projection", "projects")
	q.Set("pageSize", "100")
	tx, err := db.BeginTx(scope, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	snapshot := &projectSnapshotTestDB{tx: tx, beforePage: func() { exec("UPDATE aims_projects SET lifecycle_status='archived' WHERE id=9002") }}
	consistent, err := a.memberProjectsWithDB(scope, snapshot, q)
	if err != nil || consistent["total"] != int64(2) || len(consistent["items"].([]map[string]any)) != 2 || consistent["summary"].(map[string]any)["projectCount"] != int64(2) {
		t.Fatal("COUNT/page/summary snapshot split", consistent, err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	out = read(scope)
	if out["total"] != int64(1) {
		t.Fatal("new snapshot failed to observe mutation", out)
	}
	exec("UPDATE aims_projects SET lifecycle_status='active' WHERE id=9002")
	q.Set("pageSize", "1")
	q.Set("projection", "candidates")
	q.Set("page", "1")
	exec("UPDATE aims_project_members SET role='viewer' WHERE project_id=9002")
	out = read(scope)
	if out["total"] != int64(1) {
		t.Fatal("candidate role filtered after pagination", out)
	}
	exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=9001")
	out = read(scope)
	if out["total"] != int64(0) {
		t.Fatal("revoked candidate remains", out)
	}
	q.Set("pageSize", "101")
	if _, err := a.memberProjects(scope, q); err == nil {
		t.Fatal("oversize accepted")
	}
	q["pageSize"] = []string{"1", "2"}
	if _, err := a.memberProjects(scope, q); err == nil {
		t.Fatal("duplicate accepted")
	}
}
