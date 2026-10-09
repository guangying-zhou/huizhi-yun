package aims

import (
	"context"
	"database/sql"
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

func TestTimeEntryPaginationIsolatedMySQL(t *testing.T) {
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
	name := "time_page_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	exec("CREATE TABLE aims_projects(id BIGINT PRIMARY KEY,project_code VARCHAR(40),name VARCHAR(40),short_name VARCHAR(40),leader_uid VARCHAR(40),created_by VARCHAR(40),security_level VARCHAR(40),confidentiality_level VARCHAR(40),access_whitelist JSON,dept_code VARCHAR(40))")
	exec("CREATE TABLE aims_project_members(id BIGINT PRIMARY KEY,project_id BIGINT,uid VARCHAR(40),status VARCHAR(40),role VARCHAR(40))")
	exec("CREATE TABLE work_items(id BIGINT PRIMARY KEY,item_key VARCHAR(40),title VARCHAR(40))")
	exec("CREATE TABLE weekly_reporting_settings(config_key VARCHAR(40) PRIMARY KEY,timezone VARCHAR(64))")
	exec("INSERT INTO weekly_reporting_settings VALUES('default','Asia/Shanghai')")
	exec("CREATE TABLE time_entries(id BIGINT PRIMARY KEY,work_item_id BIGINT,project_id BIGINT,uid VARCHAR(40),entry_date DATE,hours DECIMAL(6,2),description VARCHAR(500),review_status VARCHAR(40),review_route VARCHAR(40),reviewer_uid_snapshot VARCHAR(40),locked_report_version_id BIGINT,row_version BIGINT,submitted_at DATETIME,reviewed_by VARCHAR(40),reviewed_at DATETIME,return_reason VARCHAR(500),created_at DATETIME,updated_at DATETIME,weekly_report_id BIGINT)")
	exec("INSERT INTO aims_projects VALUES(1,'P1','One','','owner','creator','project_team','L3',NULL,'D1'),(2,'P2','Two','','owner','creator','project_team','L3',NULL,'D2')")
	exec("INSERT INTO aims_project_members VALUES(1,1,'viewer','active','member')")
	for id := 1; id <= 105; id++ {
		if _, e = db.Exec("INSERT INTO time_entries(id,project_id,uid,entry_date,hours,review_status,row_version,created_at,updated_at)VALUES(?,1,'viewer','2026-09-01',0.10,'draft',1,'2026-01-01','2026-01-01')", id); e != nil {
			t.Fatal(e)
		}
	}
	exec("INSERT INTO time_entries(id,project_id,uid,entry_date,hours,review_status,row_version,created_at,updated_at,weekly_report_id) VALUES(106,1,'viewer','2026-08-31',2.25,'returned',1,'2026-01-01','2026-01-01',NULL),(107,2,'viewer','2026-09-01',4.50,'submitted',1,'2026-01-01','2026-01-01',NULL),(108,1,'other','2026-09-01',5,'approved',1,'2026-01-01','2026-01-01',NULL),(109,1,'viewer','2026-09-01',9,'approved',1,'2026-01-01','2026-01-01',1),(110,1,'viewer','2026-09-02',0,'approved',1,'2026-01-01','2026-01-01',NULL),(111,1,'viewer','2026-09-27',3,'draft',1,'2026-01-01','2026-01-01',NULL),(112,1,'viewer','2026-10-04',7,'draft',1,'2026-01-01','2026-01-01',NULL)")
	base := &compat.Adapter{}
	field := reflect.ValueOf(base).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	a := &Adapter{Adapter: base}
	ctx := context.Background()
	q := url.Values{"current_user": {"viewer"}, "startDate": {"2026-08-31"}, "endDate": {"2026-10-04"}, "pageSize": {"100"}, "monthStart": {"2026-09-01"}, "monthEnd": {"2026-09-30"}, "weekStart": {"2026-09-21"}, "weekEnd": {"2026-09-27"}, "todayDate": {"2026-09-27"}}
	read := func() map[string]any {
		t.Helper()
		r, e := a.userTimeEntries(ctx, "viewer", q)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	var previous timeEntrySummary
	for _, page := range []string{"1", "2", "9"} {
		q.Set("page", page)
		d := read()
		s := d["summary"].(timeEntrySummary)
		if d["total"] != int64(110) || s.TotalHours != 27.25 || s.MonthHours != 18 || s.MonthPositiveDays != 2 || s.PositiveDays != 4 || s.TodayHours != 3 || s.WeekHours != 3 || s.MonthMissingDays != 25 {
			t.Fatal(d, s)
		}
		if page != "1" && !reflect.DeepEqual(s, previous) {
			t.Fatal("aggregate changed with page", s, previous)
		}
		previous = s
		items := d["items"].([]timeEntryItem)
		if page == "1" && len(items) != 100 || page == "2" && len(items) != 10 || page == "9" && len(items) != 0 {
			t.Fatal(page, len(items))
		}
	}
	// UID aggregates remain on the independently authorized time-entry reader.
	q.Set("includeUidHours", "1")
	q.Set("page", "1")
	grouped := read()["summary"].(timeEntrySummary).UIDHours
	if len(grouped) != 1 || grouped[0].UID != "viewer" || grouped[0].Hours != 27.25 {
		t.Fatal(grouped)
	}
	q.Del("includeUidHours")
	// Calendar selection narrows count/page and displayed aggregates, keeping
	// base project/day groups and selected-week counts complete across projects.
	q.Set("calendarProjectId", "1")
	q.Set("page", "1")
	q.Set("weekStart", "2026-08-31")
	q.Set("weekEnd", "2026-09-06")
	d := read()
	s := d["summary"].(timeEntrySummary)
	if d["total"] != int64(109) || s.TotalHours != 22.75 || s.MonthHours != 13.50 || len(s.ProjectHours) != 2 || s.WeekStatusCounts["submitted"] != 1 || len(s.BaseDailyProjectHours) != 6 {
		t.Fatal(d, s)
	}
	// Mine/project pre-filter: projectId belongs in the WHERE, never hide a page.
	q.Del("calendarProjectId")
	q.Set("projectId", "2")
	d = read()
	s = d["summary"].(timeEntrySummary)
	if d["total"] != int64(1) || s.TotalHours != 4.50 || len(s.ProjectHours) != 1 {
		t.Fatal(d, s)
	}
	q.Set("projectId", "3")
	empty := read()
	emptySummary := empty["summary"].(timeEntrySummary)
	if empty["total"] != int64(0) || len(empty["items"].([]timeEntryItem)) != 0 || emptySummary.TotalHours != 0 || len(emptySummary.DailyHours) != 0 || len(emptySummary.ProjectHours) != 0 {
		t.Fatal("empty filter must have complete zero aggregates", empty)
	}
	q.Set("projectId", "2")
	if _, e = a.userTimeEntries(ctx, "other", q); e == nil {
		t.Fatal("other uid accepted")
	}
	// Project read uses current dynamic membership; count/summary/page also
	// include that same visibility predicate in the transaction snapshot.
	pq := url.Values{"current_user": {"viewer"}, "page": {"1"}, "pageSize": {"100"}, "startDate": {"2026-09-01"}, "endDate": {"2026-09-30"}, "weekStart": {"2026-09-21"}, "weekEnd": {"2026-09-27"}, "todayDate": {"2026-09-27"}}
	d, e = a.projectTimeEntries(ctx, "1", pq)
	if e != nil {
		t.Fatal(e)
	}
	s = d["summary"].(timeEntrySummary)
	if d["total"] != int64(108) || s.TotalHours != 18.50 || s.WeekHours != 3 {
		t.Fatal(d, s)
	}
	pq.Set("startDate", "2026-09-01")
	pq.Set("endDate", "2026-09-02")
	d, e = a.projectTimeEntries(ctx, "1", pq)
	if e != nil {
		t.Fatal(e)
	}
	s = d["summary"].(timeEntrySummary)
	if s.TodayHours != 0 || s.WeekHours != 0 {
		t.Fatal(s)
	}
	exec("UPDATE aims_project_members SET status='inactive' WHERE id=1")
	if _, e = a.projectTimeEntries(ctx, "1", pq); e == nil {
		t.Fatal("revoked member still sees project")
	}
	// Historical self-read stays self-owned; do not impose a new project gate.
	q = url.Values{"current_user": {"viewer"}}
	d = read()
	if len(d) != 4 || len(d["items"].([]timeEntryItem)) != 110 {
		t.Fatal("legacy shape/count changed", d)
	}
	if _, ok := d["summary"]; ok {
		t.Fatal("legacy got summary")
	}
}
