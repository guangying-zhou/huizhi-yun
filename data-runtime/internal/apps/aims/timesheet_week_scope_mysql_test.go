package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

// Uses only TestTimeEntryReviewPaginationIsolatedMySQL's disposable database.
func testTimesheetWeekScopeMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	exec("ALTER TABLE weekly_reporting_periods ADD id BIGINT NOT NULL DEFAULT 1, ADD timezone VARCHAR(40) NOT NULL DEFAULT 'UTC'")
	exec("CREATE TABLE project_manager_delegations(id BIGINT,project_id BIGINT,delegate_uid VARCHAR(40),starts_at DATETIME,ends_at DATETIME,revoked_at DATETIME)")
	exec("CREATE TABLE time_entry_review_events(time_entry_id BIGINT,from_status VARCHAR(40),to_status VARCHAR(40),actor_uid VARCHAR(40),reason VARCHAR(100))")
	exec("INSERT INTO aims_project_members VALUES(2,1,'submitter','active','member'),(3,2,'submitter','active','member')")
	exec("INSERT INTO time_entries(id,project_id,uid,entry_date,hours,review_status,row_version) VALUES(201,1,'submitter','2026-09-28',1,'draft',1),(202,2,'submitter','2026-09-28',1,'returned',1),(203,1,'other','2026-09-28',1,'draft',1)")
	identity := func(codes []string) context.Context {
		masks := make([]int, len(codes)+1)
		for i := 1; i < len(masks); i++ {
			masks[i] = 65535
		}
		return WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{ActorUID: "submitter", CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: masks}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
	}
	query := url.Values{"current_user": {"submitter"}, "current_user_can_submit_timesheet": {"1"}}
	unchanged := func() {
		t.Helper()
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM time_entries WHERE id IN(201,202) AND row_version=1 AND review_status IN('draft','returned')").Scan(&n); err != nil || n != 2 {
			t.Fatal("partial mutation", n, err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM time_entry_review_events").Scan(&n); err != nil || n != 0 {
			t.Fatal("partial audit", n, err)
		}
	}
	denied := func(ctx context.Context) {
		t.Helper()
		_, err := a.submitTimesheetWeek(ctx, "2026-W40", query, nil)
		var failure httperror.Error
		if !errors.As(err, &failure) || failure.Status != 403 {
			t.Fatal("expected denied", err)
		}
		unchanged()
	}
	denied(identity([]string{"P1"})) // One permitted project cannot authorize the entire week.
	exec("UPDATE aims_project_members SET status='inactive' WHERE id=3")
	denied(identity([]string{"P1", "P2"}))
	exec("UPDATE aims_project_members SET status='active' WHERE id=3")
	bad := WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{ActorUID: "other"})
	denied(bad)
	// A late failure after the first update rolls back both the rows and audit.
	exec("CREATE TRIGGER reject_second BEFORE UPDATE ON time_entries FOR EACH ROW BEGIN IF NEW.id=202 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'; END IF; END")
	if _, err := a.submitTimesheetWeek(identity([]string{"P1", "P2"}), "2026-W40", query, nil); err == nil {
		t.Fatal("expected injected failure")
	}
	unchanged()
	exec("DROP TRIGGER reject_second")
	result, err := a.submitTimesheetWeek(identity([]string{"P1", "P2"}), "2026-W40", query, map[string]any{"uid": "other"})
	if err != nil || result["submittedCount"] != 2 {
		t.Fatal("submit", result, err)
	}
	var n int
	if err := db.QueryRow("SELECT COUNT(*) FROM time_entries WHERE id IN(201,202) AND review_status='submitted' AND row_version=2").Scan(&n); err != nil || n != 2 {
		t.Fatal(n, err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM time_entries WHERE id=203 AND review_status='draft' AND row_version=1").Scan(&n); err != nil || n != 1 {
		t.Fatal("other user changed", n, err)
	}
	if _, err := a.submitTimesheetWeek(identity([]string{"P1", "P2"}), "2026-W40", query, nil); err == nil {
		t.Fatal("already submitted week accepted")
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM time_entry_review_events").Scan(&n); err != nil || n != 2 {
		t.Fatal("duplicate audit", n, err)
	}
}
