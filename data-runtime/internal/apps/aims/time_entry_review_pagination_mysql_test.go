package aims

import (
	"context"
	"database/sql"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"unsafe"
)

func TestTimeEntryReviewPaginationIsolatedMySQL(t *testing.T) {
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
	name := "time_review_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	exec("CREATE TABLE time_entries(id BIGINT PRIMARY KEY,work_item_id BIGINT,project_id BIGINT,uid VARCHAR(40),entry_date DATE,hours DECIMAL(6,2),description VARCHAR(500),review_status VARCHAR(40),review_route VARCHAR(40),reviewer_uid_snapshot VARCHAR(40),locked_report_version_id BIGINT,row_version BIGINT,submitted_at DATETIME,reviewed_by VARCHAR(40),reviewed_at DATETIME,return_reason VARCHAR(500),created_at DATETIME,updated_at DATETIME,weekly_report_id BIGINT)")
	exec("INSERT INTO aims_projects VALUES(1,'P1','One','','owner','creator','company','L1',NULL,'D1'),(2,'P2','Two','','owner','creator','company','L1',NULL,'D2')")
	exec("INSERT INTO aims_project_members VALUES(1,1,'viewer','active','member')")

	exec("CREATE TABLE weekly_reporting_periods(period_key VARCHAR(20) PRIMARY KEY,week_start DATETIME,week_end DATETIME)")
	exec("INSERT INTO weekly_reporting_periods VALUES('2026-W39','2026-09-21','2026-09-27'),('2026-W40','2026-09-28','2026-10-04')")
	for id := 1; id <= 105; id++ {
		if _, e = db.Exec("INSERT INTO time_entries(id,project_id,uid,entry_date,hours,review_status,review_route,reviewer_uid_snapshot,row_version)VALUES(?,1,'writer','2026-09-22',0.10,'submitted','project_manager','viewer',1)", id); e != nil {
			t.Fatal(e)
		}
	}
	exec("INSERT INTO time_entries(id,project_id,uid,entry_date,hours,review_status,review_route,reviewer_uid_snapshot,row_version) VALUES(106,1,'writer','2026-09-23',1,'approved','project_manager','viewer',1),(107,1,'writer','2026-09-23',1,'returned','project_manager','viewer',1),(108,1,'writer','2026-09-23',1,'submitted','project_manager','other',1),(109,2,'writer','2026-09-23',1,'submitted','project_manager','viewer',1),(110,1,'writer','2026-09-28',1,'submitted','project_manager','viewer',1),(111,1,'writer','2026-09-23',1,'submitted','company_summary','viewer',1),(112,1,'writer','2026-09-23',1,'draft','project_manager','viewer',1)")
	exec("INSERT INTO time_entries(id,project_id,uid,entry_date,hours,review_status,review_route,reviewer_uid_snapshot,row_version) VALUES(113,1,'writer','2026-09-23',1,'submitted','project_manager','VIEWER',1),(114,1,'writer','2026-09-23',1,'submitted','project_manager','viewer ',1)")
	base := &compat.Adapter{}
	field := reflect.ValueOf(base).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	a := &Adapter{Adapter: base}
	q := url.Values{"current_user": {"viewer"}, "current_user_can_review_assigned_timesheet": {"1"}, "periodKey": {"2026-W39"}, "page": {"1"}, "pageSize": {"100"}}
	projection := projectscope.Projection{Version: 1, ProjectCodes: []string{"P1"}, Masks: []int{0, 65535}}
	ctx := WithEnterpriseTimeEntryReviewScopes(context.Background(), []projectscope.Projection{projection}, nil)
	for _, page := range []string{"1", "2", "9"} {
		q.Set("page", page)
		data, e := a.listProjectTimeEntryReviews(ctx, "1", q)
		if e != nil {
			t.Fatal(e)
		}
		counts := data["statusCounts"].(map[string]int64)
		if data["total"] != int64(107) || counts["submitted"] != 105 || counts["approved"] != 1 || counts["returned"] != 1 {
			t.Fatal("scope/count mismatch", data)
		}
		items := data["items"].([]map[string]any)
		if page == "1" && len(items) != 100 || page == "2" && len(items) != 7 || page == "9" && len(items) != 0 {
			t.Fatal(page, len(items))
		}
	}
	q.Set("page", "1")
	assertTotal := func(ctx context.Context, id string, expected int64) {
		t.Helper()
		data, e := a.listProjectTimeEntryReviews(ctx, id, q)
		if e != nil {
			t.Fatal(e)
		}
		if data["total"] != expected {
			t.Fatal(data)
		}
	}
	assertDenied := func(ctx context.Context, id string) {
		t.Helper()
		_, e := a.listProjectTimeEntryReviews(ctx, id, q)
		var failure httperror.Error
		if !errors.As(e, &failure) || failure.Status != 403 {
			t.Fatal("scope denial expected", e)
		}
	}
	assertDenied(ctx, "2") // another project is outside the branch, even though it is company L1.
	deny := WithEnterpriseTimeEntryReviewScopes(context.Background(), []projectscope.Projection{{Version: 1, Masks: []int{0}}}, nil)
	q.Set("current_user_can_approve_timesheet", "1")
	assertDenied(deny, "1") // approve does not override the scoped branch or public scope.
	assertTotal(ctx, "1", 107)
	member := WithEnterpriseTimeEntryReviewScopes(context.Background(), []projectscope.Projection{{Version: 1, Masks: []int{43690}}}, nil)
	assertTotal(member, "1", 107)
	exec("UPDATE aims_project_members SET status='inactive' WHERE id=1")
	assertDenied(member, "1")
	assertTotal(ctx, "1", 107) // explicit project-code scope still applies independently.
	exec("UPDATE time_entries SET reviewer_uid_snapshot='other' WHERE id=1")
	assertTotal(ctx, "1", 106) // current assignment snapshot, not role name or stale selected ids.
	q.Set("current_user", "other")
	assertTotal(ctx, "1", 2)
	q.Set("current_user", "viewer")
	q.Set("periodKey", "2026-W40")
	assertTotal(ctx, "1", 1)
	q.Set("periodKey", "2021-W53")
	if _, e = a.listProjectTimeEntryReviews(ctx, "1", q); e == nil {
		t.Fatal("invalid real ISO week")
	}
	q.Set("periodKey", "2026-W39")
	q.Del("page")
	q.Del("pageSize")
	legacy, e := a.listProjectTimeEntryReviews(ctx, "1", q)
	if e != nil {
		t.Fatal(e)
	}
	if len(legacy) != 3 || legacy["total"] != int64(106) || len(legacy["items"].([]map[string]any)) != 106 {
		t.Fatal("legacy read shape changed", legacy)
	}
	q.Del("current_user_can_approve_timesheet")
	q.Del("current_user_can_review_assigned_timesheet")
	if _, e = a.listProjectTimeEntryReviews(ctx, "1", q); e == nil {
		t.Fatal("review entrypoint permission still required")
	}
	t.Run("host week submission scope", func(t *testing.T) { testTimesheetWeekScopeMySQL(t, a, db) })
}
