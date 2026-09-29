package aims

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unsafe"
)

func TestWeeklySummaryPaginationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_TIME_ENTRY_PAGINATION_SOCKET")
	if socket == "" {
		t.Skip("temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.ParseTime = true
	root, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	name := "weekly_page_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = root.Exec("CREATE DATABASE " + name); e != nil {
		t.Fatal(e)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	exec := func(q string) {
		t.Helper()
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}

	exec("CREATE TABLE aims_projects(id BIGINT PRIMARY KEY,project_code VARCHAR(40),internal_code VARCHAR(40),name VARCHAR(60),category VARCHAR(40),lifecycle_status VARCHAR(40),leader_uid VARCHAR(40),created_by VARCHAR(40),security_level VARCHAR(40),confidentiality_level VARCHAR(40),access_whitelist JSON,dept_code VARCHAR(40))")
	exec("CREATE TABLE aims_project_members(id BIGINT PRIMARY KEY,project_id BIGINT,uid VARCHAR(40),status VARCHAR(40),role VARCHAR(40))")
	exec("CREATE TABLE time_entries(id BIGINT PRIMARY KEY,project_id BIGINT,entry_date DATE,hours DECIMAL(8,2),weekly_report_id BIGINT)")
	exec("CREATE TABLE project_weekly_report_entries(id BIGINT PRIMARY KEY,report_id BIGINT,hours DECIMAL(8,2))")
	columns := "id BIGINT PRIMARY KEY,project_id BIGINT,report_year INT,report_week INT,week_start DATE,week_end DATE,main_work TEXT,overall_progress TEXT,status VARCHAR(30)"
	for _, c := range projectWeeklyReportSummaryColumnDefinitions() {
		columns += "," + c.name + " TEXT"
	}
	exec("CREATE TABLE project_weekly_reports(" + columns + ")")
	exec("CREATE TABLE project_weekly_report_work_items(id BIGINT PRIMARY KEY,report_id BIGINT,project_id BIGINT,plan_type VARCHAR(20),source_type VARCHAR(20),work_item_id BIGINT,module_name VARCHAR(40),sort_order INT,task_summary TEXT,owner_uid VARCHAR(40),owner_name VARCHAR(40),completion_percent DECIMAL(5,2),incomplete_reason TEXT,workload_days DECIMAL(8,2),created_at DATETIME,updated_at DATETIME)")
	for j := 1; j <= 106; j++ {
		name := fmt.Sprintf("P%03d", j)
		if j == 1 {
			name = "literal_%"
		}
		_, e = db.Exec("INSERT INTO aims_projects VALUES(?,?,?,?,'dev','active','owner','creator','project_team','L3',NULL,'D1')", j, name, name, name)
		if e != nil {
			t.Fatal(e)
		}
		exec(fmt.Sprintf("INSERT INTO aims_project_members VALUES(%d,%d,'viewer','active','member')", j, j))
		if j <= 105 {
			exec(fmt.Sprintf("INSERT INTO project_weekly_reports(id,project_id,report_year,report_week,week_start,week_end,status,department_name,project_manager_name,cumulative_labor_cost) VALUES(%d,%d,2026,1,'2025-12-29','2026-01-04','draft','SnapshotDept','SnapshotManager','10000')", j, j))
			exec(fmt.Sprintf("INSERT INTO project_weekly_report_entries VALUES(%d,%d,8)", j, j))
		}
	}
	exec("INSERT INTO project_weekly_reports(id,project_id,report_year,report_week,week_start,week_end,status)VALUES(1000,1,2025,52,'2025-12-22','2025-12-28','submitted')")
	exec("INSERT INTO project_weekly_report_entries VALUES(1000,1000,16)")
	exec("INSERT INTO time_entries VALUES(1,1,'2026-01-04',4,NULL),(2,1,'2026-01-05',9,NULL),(3,1,'2026-01-04',9,1)")
	exec("INSERT INTO project_weekly_report_work_items(id,report_id,project_id,plan_type,sort_order,task_summary,source_type,created_at,updated_at)VALUES(1,1,1,'this_week',1,'full detail','manual','2026-01-01','2026-01-01')")
	base := &compat.Adapter{}
	field := reflect.ValueOf(base).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	a := &Adapter{Adapter: base}
	ctx := context.Background()
	q := url.Values{"current_user": {"viewer"}, "current_user_can_view_weekly_report_summary": {"1"}, "year": {"2026"}, "week": {"1"}, "pageSize": {"100"}, "includeWorkItems": {"1"}}
	read := func() map[string]any {
		t.Helper()
		d, e := a.projectWeeklyReportSummary(ctx, q)
		if e != nil {
			t.Fatal(e)
		}
		return d
	}
	var initial weeklySummaryTotals
	for _, page := range []string{"1", "2", "9"} {
		q.Set("page", page)
		d := read()
		s := d["summary"].(weeklySummaryTotals)
		if d["total"] != 106 || s.Total != 106 || s.Filled != 105 || s.CurrentDays != 105 || s.ActualDays != 0.5 || s.PreviousDays != 2 || s.CumulativeLaborCost != 1050000 || s.MemberSlots != 106 {
			t.Fatal(d)
		}
		if page != "1" && !reflect.DeepEqual(initial, s) {
			t.Fatal("page-dependent aggregate")
		}
		initial = s
		items := d["items"].([]projectWeeklyReportSummaryItem)
		if page == "1" && len(items) != 100 || page == "2" && len(items) != 6 || page == "9" && len(items) != 0 {
			t.Fatal(page, len(items))
		}
	}
	for _, keyword := range []string{"SnapshotDept", "SnapshotManager", "owner", "D1", "literal_%", "DirectoryRenamed"} {
		q.Set("search", keyword)
		q.Set("page", "1")
		d := read()
		want := 106
		if keyword == "SnapshotDept" || keyword == "SnapshotManager" {
			want = 105
		}
		if keyword == "literal_%" {
			want = 1
		}
		if keyword == "DirectoryRenamed" {
			want = 0
		}
		if d["total"] != want || !reflect.DeepEqual(initial, d["summary"]) {
			t.Fatal(keyword, d)
		}
	}
	q.Del("search")
	q.Del("page")
	q.Del("pageSize")
	legacy := read()
	if len(legacy) != 5 || legacy["total"] != 106 || legacy["summary"] != nil {
		t.Fatal("legacy shape", legacy)
	}
	exec("UPDATE aims_project_members SET status='inactive' WHERE project_id=106")
	q.Set("page", "1")
	d := read()
	if d["total"] != 105 || d["summary"].(weeklySummaryTotals).Total != 105 {
		t.Fatal("dynamic visibility", d)
	}
	// P5b2 adds only fixture-local columns and rows; it never accesses the local unified DB.
	exec("ALTER TABLE project_weekly_reports ADD created_by VARCHAR(40) NOT NULL DEFAULT 'viewer',ADD updated_by VARCHAR(40),ADD created_at DATETIME NOT NULL DEFAULT '2026-01-01',ADD updated_at DATETIME NOT NULL DEFAULT '2026-01-01',ADD current_version_no INT NOT NULL DEFAULT 1,ADD current_submitted_version_id BIGINT,ADD current_reviewed_version_id BIGINT,ADD current_frozen_version_id BIGINT")
	exec("ALTER TABLE project_weekly_report_entries ADD project_id BIGINT NOT NULL DEFAULT 1,ADD uid VARCHAR(40) NOT NULL DEFAULT 'viewer',ADD allocation_percent DECIMAL(8,2) NOT NULL DEFAULT 100,ADD created_at DATETIME NOT NULL DEFAULT '2026-01-01',ADD updated_at DATETIME NOT NULL DEFAULT '2026-01-01'")
	for j := 1; j <= 104; j++ {
		exec(fmt.Sprintf("INSERT INTO aims_project_members VALUES(%d,1,'M%03d','active','member')", j+1000, j))
		exec(fmt.Sprintf("INSERT INTO project_weekly_report_entries(id,report_id,uid,hours) VALUES(%d,1,'M%03d',1)", j+2000, j))
		exec(fmt.Sprintf("INSERT INTO project_weekly_report_work_items(id,report_id,project_id,plan_type,source_type,sort_order,task_summary,created_at,updated_at)VALUES(%d,1,1,'this_week','manual',%d,'detail','2026-01-01','2026-01-01')", j+1000, j+1))
	}
	exec("INSERT INTO project_weekly_report_entries(id,report_id,uid,hours)VALUES(5001,1,'HIST1',2),(5002,1,'HIST2',3)")
	exec("UPDATE project_weekly_reports SET cumulative_labor_cost='44',completion_percent='20' WHERE id=1000")
	for j := 1; j <= 105; j++ {
		year := 2020 + (j-1)/52
		week := (j-1)%52 + 1
		exec(fmt.Sprintf("INSERT INTO project_weekly_reports(id,project_id,report_year,report_week,week_start,week_end,status,completion_percent)VALUES(%d,1,%d,%d,'2020-01-01','2020-01-07','draft','10')", 10000+j, year, week))
	}
	exec("UPDATE project_weekly_report_work_items SET workload_days=1 WHERE report_id=1")
	pq := url.Values{"current_user": {"viewer"}, "page": {"1"}, "pageSize": {"100"}, "includeBaseline": {"1"}}
	for _, page := range []string{"1", "2", "9"} {
		pq.Set("page", page)
		d, e = a.getProjectWeeklyReportPeriod(ctx, "1", "2026-W01", pq)
		if e != nil {
			t.Fatal(e)
		}
		if d["summary"].(map[string]any)["persistedWorkloadDays"] != float64(105) {
			t.Fatal(d)
		}
		members := d["entriesPage"].(map[string]any)
		work := d["workItemsPage"].(map[string]any)
		if members["total"] != int64(107) || work["total"] != int64(105) {
			t.Fatal(d)
		}
		wantMembers, wantWork := 100, 100
		if page == "2" {
			wantMembers = 7
			wantWork = 5
		}
		if page == "9" {
			wantMembers = 0
			wantWork = 0
		}
		if len(members["items"].([]string)) != wantMembers || len(work["items"].([]int64)) != wantWork {
			t.Fatal(d)
		}
		baseline := d["baseline"].(*projectWeeklyReportItem)
		if len(baseline.Entries) != 107 || len(baseline.WorkItems) != 105 || baseline.TotalHours != 117 {
			t.Fatal(baseline)
		}
		history := d["history"].(weeklyReportHistory)
		if history.CumulativeLaborCost == nil || *history.CumulativeLaborCost != 44 || history.ProgressPercent == nil || *history.ProgressPercent != 20 || history.ProgressYear != 2025 || history.ProgressWeek != 52 {
			t.Fatal(history)
		}
	}
	pq.Del("includeBaseline")
	pq.Set("page", "2")
	d, e = a.getProjectWeeklyReportPeriod(ctx, "1", "2026-W01", pq)
	if e != nil || d["baseline"] != nil {
		t.Fatal("page reloaded full editing baseline", d, e)
	}
	d, e = a.getProjectWeeklyReportPeriod(ctx, "1", "2026-W02", pq)
	if e != nil || d["report"] != nil || d["entriesPage"].(map[string]any)["total"] != int64(105) {
		t.Fatal("new period initialization", d, e)
	}
	for _, page := range []string{"1", "2", "9"} {
		pq.Set("page", page)
		d, e := a.projectWeeklyReports(ctx, "1", pq)
		if e != nil {
			t.Fatal(e)
		}
		if d["total"] != int64(107) || len(d["calendar"].([]weeklyReportCalendarRow)) != 107 {
			t.Fatal(d)
		}
		want := 100
		if page == "2" {
			want = 7
		}
		if page == "9" {
			want = 0
		}
		if len(d["items"].([]projectWeeklyReportItem)) != want {
			t.Fatal(d)
		}
	}

	pq.Set("current_user", "outsider")
	if _, e = a.getProjectWeeklyReportPeriod(ctx, "1", "2026-W01", pq); e == nil {
		t.Fatal("outsider read period")
	}
	if _, e = a.projectWeeklyReports(ctx, "1", pq); e == nil {
		t.Fatal("outsider read calendar/list")
	}
	pq.Set("current_user", "viewer")
	exec("UPDATE aims_project_members SET status='inactive' WHERE project_id=1 AND uid='viewer'")
	if _, e = a.getProjectWeeklyReportPeriod(ctx, "1", "2026-W01", pq); e == nil {
		t.Fatal("revoked membership read baseline")
	}

}
