package aims

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"strings"
	"testing"
)

func TestReviewSensitiveScopeNeverInheritsPublicProjectReadExemption(t *testing.T) {
	projection := projectscope.Projection{Version: 1, Masks: []int{0}}
	ctx := WithEnterpriseTimeEntryReviewScopes(context.Background(), []projectscope.Projection{projection}, nil)
	where, _, e := enterpriseTimeEntryReviewWhere(ctx, "viewer")
	if e != nil || strings.Contains(where, "security_level") || strings.Contains(where, "confidentiality_level") || !strings.Contains(where, "scope_pm.status='active'") {
		t.Fatal(where, e)
	}
	ordinary, _, e := enterpriseProjectReadScopeWhere(WithEnterpriseProjectReadScope(context.Background(), projection, nil), "viewer")
	if e != nil || !strings.Contains(ordinary, "security_level") {
		t.Fatal("ordinary projects:view exception changed", ordinary, e)
	}
}
func TestReviewCountPageAndScopeGateShareWhereAndTransaction(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	m.ExpectBegin()
	m.ExpectQuery(`SELECT p.id FROM aims_projects p WHERE p.id=\? AND.*`).WithArgs(int64(1), "viewer", "viewer", "viewer", "viewer", "viewer", "viewer").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	where := `(?s).*period.period_key=\?.*entry.project_id=\? AND entry.review_route='project_manager' AND BINARY entry.reviewer_uid_snapshot=BINARY \? AND entry.review_status IN \('submitted','approved','returned'\).*`
	m.ExpectQuery(`SELECT COUNT\(\*\),COALESCE.*`+where).WithArgs("2026-W39", int64(1), "viewer", "viewer", "viewer", "viewer", "viewer", "viewer", "viewer").WillReturnRows(sqlmock.NewRows([]string{"total", "submitted", "approved", "returned"}).AddRow(107, 105, 1, 1))
	m.ExpectQuery(`SELECT entry.id.*`+where+`ORDER BY entry.review_status='submitted' DESC,entry.entry_date,entry.id LIMIT \? OFFSET \?`).WithArgs("2026-W39", int64(1), "viewer", "viewer", "viewer", "viewer", "viewer", "viewer", "viewer", 20, 20).WillReturnRows(sqlmock.NewRows([]string{"id", "uid", "date", "hours", "desc", "key", "title", "status", "route", "reviewer", "version", "submitted"}))
	m.ExpectCommit()
	ctx := WithEnterpriseTimeEntryReviewScopes(context.Background(), []projectscope.Projection{{Version: 1, Masks: []int{65535}}}, nil)
	data, e := a.listProjectTimeEntryReviews(ctx, "1", url.Values{"current_user": {"viewer"}, "current_user_can_review_assigned_timesheet": {"1"}, "periodKey": {"2026-W39"}, "page": {"2"}, "pageSize": {"20"}})
	if e != nil {
		t.Fatal(e)
	}
	if data["total"] != int64(107) || data["statusCounts"].(map[string]int64)["submitted"] != 105 {
		t.Fatal(data)
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
